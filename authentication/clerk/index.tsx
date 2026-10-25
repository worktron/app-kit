import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { ClerkProvider, useAuth, useClerk, useSignIn, useUser } from '@clerk/react';
import type { GoogleReturnProps, Outcome, ProviderSession, SignInProvider } from '../../web/sign-in/provider';
import { checkEmailCode, googleAccountParams, messageFor, sendEmailCode } from './email-code';
import { signInWithTicket } from './ticket';

export { CODE_LENGTH, cleanCode, checkEmailCode, googleAccountParams, messageFor, sendEmailCode, type EmailCodeSignIn } from './email-code';
export { signInWithTicket, type TicketSignIn } from './ticket';

/**
 * Clerk as the kit's sign-in provider. An app makes it once, outside React, and gives it to the sign-in gate. An app
 * with its own ClerkProvider and no gate, such as one that uses only the desktop sign-in part, reads the same session
 * with the provider's `useSession` inside its own. A part of an app that needs more of Clerk than the kit asks for uses
 * Clerk's own hooks inside the gate, since the gate's provider is Clerk's.
 */
export function clerkSignIn({ publishableKey }: { publishableKey: string }): SignInProvider {
  function Root({ children }: { children: ReactNode }) {
    return <ClerkProvider publishableKey={publishableKey}>{children}</ClerkProvider>;
  }
  return { Root, useSession, GoogleReturn };
}

function useSession(): ProviderSession {
  const clerk = useClerk();
  const { isLoaded, userId, getToken } = useAuth();
  const { user } = useUser();
  const { signIn } = useSignIn();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const person = useMemo(() => (userId ? { id: userId, email } : null), [userId, email]);

  return {
    loaded: isLoaded,
    person,
    token: (options) => getToken(options?.fresh ? { skipCache: true } : undefined),
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
    sendEmailCode: (address) => sendEmailCode(signIn, address),
    checkEmailCode: (code, address) => checkEmailCode(signIn, code, address),
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
  // Where Clerk draws a captcha when its bot check asks for one.
  return <div id="clerk-captcha" />;
}
