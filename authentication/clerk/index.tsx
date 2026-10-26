import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { ClerkProvider, useAuth, useClerk, useSignIn, useSignUp, useUser } from '@clerk/react';
import type { GoogleReturnProps, Outcome, ProviderSession, SignInProvider } from '../../web/sign-in/provider';
import { standInSignIn } from '../stand-in';
import { checkEmailCode, googleAccountParams, messageFor, sendEmailCode } from './email-code';
import { signInWithTicket } from './ticket';
import { tokenStillGood } from './token-now';

export {
  CODE_LENGTH,
  cleanCode,
  checkEmailCode,
  googleAccountParams,
  messageFor,
  sendEmailCode,
  SIGN_UP_UNFINISHED,
  type EmailCodeSignIn,
  type EmailCodeSignUp,
} from './email-code';
export { signInWithTicket, type TicketSignIn } from './ticket';

/**
 * Clerk as the kit's sign-in provider. An app makes it once, outside React, and gives it to the sign-in gate. An app
 * with its own ClerkProvider and no gate, such as one that uses only the desktop sign-in part, reads the same session
 * with `useClerkSession` inside its own. A part of an app that needs more of Clerk than the kit asks for uses
 * Clerk's own hooks inside the gate, since the gate's provider is Clerk's.
 */
export function clerkSignIn({ publishableKey }: { publishableKey: string }): SignInProvider {
  function Root({ children }: { children: ReactNode }) {
    return (
      <ClerkProvider publishableKey={publishableKey}>
        {children}
        <CaptchaPlace />
      </ClerkProvider>
    );
  }
  return { Root, useSession: useClerkSession, GoogleReturn };
}

/** The settings a page's build carries, as Vite's `import.meta.env` holds them. */
export interface PageSignInSettings {
  /** `stand-in` for browser tests, which drive the real sign-in screen with no network. */
  VITE_SIGN_IN?: string;
  VITE_CLERK_PUBLISHABLE_KEY?: string;
}

/**
 * Who signs in on this page, from its build's settings: the stand-in under `VITE_SIGN_IN=stand-in`, Clerk with a
 * publishable key, and nobody with neither, for a server that runs open on this machine; the sign-in gate given null
 * draws the app with no sign-in. A hosted build that lost its key is not left open by this: its server refuses to
 * start without its own keys, or refuses every request without a session.
 */
export function signInFromEnvironment(settings: PageSignInSettings): SignInProvider | null {
  if (settings.VITE_SIGN_IN === 'stand-in') return standInSignIn({ store: sessionStorage });
  const publishableKey = settings.VITE_CLERK_PUBLISHABLE_KEY?.trim();
  return publishableKey ? clerkSignIn({ publishableKey }) : null;
}

/**
 * Where Clerk draws its bot check's challenge, while nobody is signed in: a sign-up, by Google or by emailed code,
 * shows it when Clerk suspects a bot, and without the place Clerk refuses a suspected person with no way to prove
 * otherwise.
 */
function CaptchaPlace() {
  const { userId } = useAuth();
  return userId ? null : <div id="clerk-captcha" />;
}

/**
 * The Clerk adapter's session, read from whatever ClerkProvider it is inside: the gate's, or an app's own when it has
 * one and no gate, as one that uses only the desktop sign-in part.
 */
export function useClerkSession(): ProviderSession {
  const clerk = useClerk();
  const { isLoaded, userId, getToken } = useAuth();
  const { user } = useUser();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const person = useMemo(() => (userId ? { id: userId, email } : null), [userId, email]);

  return {
    loaded: isLoaded,
    person,
    token: (options) => getToken(options?.fresh ? { skipCache: true } : undefined),
    tokenNow: () => tokenStillGood(clerk.session?.lastActiveToken),
    google: async ({ callbackPath, account }): Promise<Outcome> => {
      const back = `${window.location.origin}${callbackPath}`;
      // Clerk's newer sign-in object takes no account for Google to sign in as, so this trip goes through its classic
      // sign-in resource, which takes both the account and the ask for Google's list.
      const classic = clerk.client?.signIn;
      if (!classic) return { ok: false, message: messageFor(undefined, '') };
      try {
        await classic.authenticateWithRedirect({
          strategy: 'oauth_google',
          redirectUrl: back,
          redirectUrlComplete: back,
          ...googleAccountParams(account),
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, message: messageFor(error, account ?? '') };
      }
    },
    sendEmailCode: (address, options) => sendEmailCode(signIn, address, options),
    checkEmailCode: (code, address) => checkEmailCode(signIn, code, address, signUp),
    ticket: (ticket) => signInWithTicket(signIn, ticket),
    // Given a function to run instead, Clerk stays on this page rather than loading another once the session has ended.
    signOut: () => clerk.signOut(() => {}),
  };
}

/**
 * Finishes the sign-in Google has sent back with Clerk's own redirect handling. Clerk then navigates through the
 * function given here rather than the browser: with a session made, the gate moves on to the asked address; without
 * one, the sign-in did not finish.
 */
function GoogleReturn({ onUnfinished }: GoogleReturnProps) {
  const clerk = useClerk();
  const ran = useRef(false);
  useEffect(() => {
    if (!clerk.loaded || ran.current) return;
    ran.current = true;
    const here = window.location.pathname;
    clerk
      .handleRedirectCallback({ signInFallbackRedirectUrl: here, signUpFallbackRedirectUrl: here }, async () => {
        if (!clerk.session) onUnfinished();
      })
      .catch(onUnfinished);
  }, [clerk, clerk.loaded, onUnfinished]);
  return null;
}
