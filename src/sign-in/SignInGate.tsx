import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { setCurrentSession } from './current';
import type { Outcome, ProviderSession, SignedInPerson, SignInProvider } from './provider';
import { currentAddress, lastAccount, lastSignedIn, rememberAccount, rememberReturn, rememberSignedIn, takeReturn } from './remembered';

/** Where Google sends the browser back to, unless the gate is told another. The server must answer it with the app. */
export const GOOGLE_CALLBACK_PATH = '/sso-callback';

export const GOOGLE_UNFINISHED = 'Signing in with Google did not finish. Try again, or use an emailed code.';
export const SESSION_ENDED = 'Your session ended. Sign in again to carry on where you were.';

/** Which Google account a sign-in asks for. */
export type GoogleAccount = 'remembered' | 'choose' | { account: string };

/** The account to name to Google, or null for its list. */
export function accountFor(choice: GoogleAccount, remembered: string | null): string | null {
  if (choice === 'choose') return null;
  if (choice === 'remembered') return remembered;
  return choice.account;
}

/** What the app's sign-in screen works with. */
export interface SignIn {
  /** The account this app last signed in with on this device, for Continue as that account, or null. */
  lastAccount: string | null;
  /** Something to say above the buttons: Google did not finish, or the server ended the session. */
  notice: string | null;
  /**
   * Google, returning to this address. `remembered` names the last account to Google, so it shows no page while it is
   * still signed in to it; `choose` has Google list its accounts, as does `remembered` with no account remembered. An
   * account named outright is for a choice made elsewhere, as in a desktop app's window that hands sign-in to the browser.
   */
  google(account: GoogleAccount): Promise<Outcome>;
  sendEmailCode(email: string): Promise<Outcome>;
  checkEmailCode(code: string, email: string): Promise<Outcome>;
}

const SignInContext = createContext<SignIn | null>(null);
const SignOutContext = createContext<(() => void) | null>(null);
const AppDrawnContext = createContext<() => void>(() => {});
const PersonContext = createContext<SignedInPerson | null>(null);

/** For the app's sign-in screen, which the gate draws while nobody is signed in. */
export function useSignIn(): SignIn {
  const signIn = useContext(SignInContext);
  if (!signIn) throw new Error('useSignIn is for the screen the sign-in gate draws while nobody is signed in.');
  return signIn;
}

/** Signs out with no page load, straight to the sign-in screen. Null outside the gate, so the app draws no Sign out there. */
export const useSignOut = () => useContext(SignOutContext);

/** Who is signed in, or null outside the gate. */
export const usePerson = () => useContext(PersonContext);

/** Tells the gate the app has drawn its first screen with its first data, so the placeholder goes in the same frame. */
export const useAppDrawn = () => useContext(AppDrawnContext);

export interface SignInGateProps {
  provider: SignInProvider;
  /** The one steady placeholder: the app's wordmark on its own background. */
  placeholder: ReactNode;
  /** The app's sign-in screen, which uses `useSignIn`. */
  signedOut: ReactNode;
  /**
   * What to draw while the provider loads in a browser that was signed in last time. The placeholder unless the app
   * says otherwise, as when its own bar draws the wordmark in another place and the placeholder's would jump.
   */
  whileReturning?: ReactNode;
  /**
   * Show nothing of the app until it calls `useAppDrawn`'s function, with the placeholder held up meanwhile after a
   * sign-in, so the whole screen appears at once. Every screen calls it once its first data is in or has failed.
   */
  waitForFirstDraw?: boolean;
  callbackPath?: string;
  children: ReactNode;
}

/**
 * The app once someone is signed in, and the app's own sign-in screen until then, at whatever address the person asked
 * for, so a sign-in lands where they were. Signing in and out load no page beyond the provider's own trip to Google.
 * A request the server refuses brings sign-in up over the current address.
 */
export function SignInGate({ provider, ...props }: SignInGateProps) {
  const { Root } = provider;
  return (
    <Root>
      <Gate provider={provider} {...props} />
    </Root>
  );
}

function Gate({ provider, placeholder, signedOut, whileReturning = placeholder, waitForFirstDraw = false, callbackPath = GOOGLE_CALLBACK_PATH, children }: SignInGateProps) {
  const session = provider.useSession();
  const { loaded, person } = session;
  const { GoogleReturn } = provider;
  const [signingOut, setSigningOut] = useState(false);
  // Whether this page has shown the sign-in screen, and so holds the placeholder up until the app is drawn rather than going blank.
  const [cameThroughSignIn, setCameThroughSignIn] = useState(() => lastSignedIn() !== true);
  const [appDrawn, setAppDrawn] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [returningFromGoogle, setReturningFromGoogle] = useState(() => window.location.pathname === callbackPath);
  const markAppDrawn = useCallback(() => setAppDrawn(true), []);

  // The latest session, for the fetch wrapper, which holds on to one object across renders.
  const latest = useRef<ProviderSession>(session);
  latest.current = session;
  const signedInAt = useRef(0);
  const wasSignedOut = useRef<boolean | null>(null);

  const signOut = useCallback(() => {
    rememberSignedIn(false);
    setSigningOut(true);
    latest.current.signOut().catch(() => setSigningOut(false));
  }, []);

  // In a layout effect, which runs before any passive one: an app's first requests come from its own effects, and
  // children's effects run before their parent's, so a passive one here would let them go out without a token.
  useLayoutEffect(() => {
    setCurrentSession({
      token: (options) => latest.current.token(options),
      refused: () => {
        // Already signed out, as when a second request in flight is refused after the first: the sign-in screen is up.
        if (!latest.current.person) return;
        setNotice(SESSION_ENDED);
        signOut();
      },
      get signedInAt() {
        return signedInAt.current;
      },
    });
    return () => setCurrentSession(null);
  }, [signOut]);

  const personId = person?.id ?? null;
  const email = person?.email ?? null;
  useEffect(() => {
    if (!loaded) return;
    rememberSignedIn(personId !== null);
    if (personId !== null) {
      if (wasSignedOut.current) signedInAt.current = Date.now();
      if (email) rememberAccount(email);
      setReturningFromGoogle(false);
    } else {
      // Signed out here, in another tab or by the session ending: the sign-in screen is next, and a later sign-in
      // holds the placeholder up again until the app has drawn.
      setCameThroughSignIn(true);
      setSigningOut(false);
      setAppDrawn(false);
    }
    wasSignedOut.current = personId === null;
  }, [loaded, personId, email]);

  // Read again on each sign-in screen, since a sign-in on this page may have changed it.
  const remembered = personId === null ? lastAccount() : null;
  const signIn = useMemo<SignIn>(
    () => ({
      lastAccount: remembered,
      notice,
      google: (account) => {
        setNotice(null);
        rememberReturn(currentAddress());
        return latest.current.google({ callbackPath, account: accountFor(account, lastAccount()) });
      },
      sendEmailCode: (address) => {
        setNotice(null);
        return latest.current.sendEmailCode(address);
      },
      checkEmailCode: (code, address) => latest.current.checkEmailCode(code, address),
    }),
    [remembered, notice, callbackPath],
  );

  if (signingOut || !loaded) return <>{signingOut || lastSignedIn() !== true ? placeholder : whileReturning}</>;

  if (!person) {
    if (returningFromGoogle) {
      return (
        <>
          {placeholder}
          <GoogleReturn
            onUnfinished={() => {
              window.history.replaceState(null, '', takeReturn());
              setNotice(GOOGLE_UNFINISHED);
              setReturningFromGoogle(false);
            }}
          />
        </>
      );
    }
    return <SignInContext.Provider value={signIn}>{signedOut}</SignInContext.Provider>;
  }

  // Back from Google and signed in: on to the address the person asked for, before the app reads where it is.
  if (window.location.pathname === callbackPath) window.history.replaceState(null, '', takeReturn());

  // Until the app has drawn its first data, it renders, so its requests go out, but nothing of it shows: the whole
  // screen appears at once. The wrapper is always there, with no box of its own, so drawing the app never remounts it.
  const holding = waitForFirstDraw && !appDrawn;
  return (
    <PersonContext.Provider value={person}>
      <AppDrawnContext.Provider value={markAppDrawn}>
        {holding && cameThroughSignIn && placeholder}
        <div style={{ display: 'contents', visibility: holding ? 'hidden' : undefined }} aria-hidden={holding || undefined}>
          <SignOutContext.Provider value={signOut}>{children}</SignOutContext.Provider>
        </div>
      </AppDrawnContext.Provider>
    </PersonContext.Provider>
  );
}
