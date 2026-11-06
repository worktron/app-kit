import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { announceSignedOut, setCurrentSession } from './current';
import type { IphoneSignIn } from './iphone-sign-in';
import type { Outcome, ProviderSession, SignedInPerson, SignInProvider } from './provider';
import { currentAddress, forgetAccount, lastAccount, lastSignedIn, rememberAccount, rememberReturn, rememberSignedIn, takeReturn } from './remembered';

/** Where Google sends the browser back to, unless the gate is told another. The server must answer it with the app. */
export const GOOGLE_CALLBACK_PATH = '/sso-callback';

export const GOOGLE_UNFINISHED = 'Signing in with Google did not finish. Try again, or use an emailed code.';
export const SESSION_ENDED = 'Your session ended. Sign in again to carry on where you were.';

/** The line under the wordmark on the page Apple's sheet opens, while it goes to Google, unless the app gives its own. */
export const OPENING_GOOGLE = 'Opening Google.';
/** The line under the wordmark in the iPhone app, from the tap until the app's screen, unless the app gives its own. */
export const SIGNING_IN_WITH_GOOGLE = 'Signing in with Google.';

/**
 * The attribute the gate puts on `<html>` saying what it shows: `placeholder`, `placeholder-with-line`, `sign-in` (the
 * app's sign-in screen) or `app` (the app, drawn). `expectQuietSignIn` in `app-kit/web/playwright` reads it.
 */
export const GATE_SHOWS_ATTRIBUTE = 'data-sign-in-gate';
type GateShows = 'placeholder' | 'placeholder-with-line' | 'sign-in' | 'app';

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
  /**
   * The account this app last signed in with on this device, for Continue as that account, or null. The person's own
   * Sign out forgets it; a session the server ended keeps it.
   */
  lastAccount: string | null;
  /** Something to say above the buttons: Google did not finish, or the server ended the session. */
  notice: string | null;
  /**
   * Google, returning to this address. `remembered` names the last account to Google, so it shows no page while it is
   * still signed in to it; `choose` has Google list its accounts, as does `remembered` with no account remembered. An
   * account named outright is for a choice made elsewhere, as in a desktop app's window that hands sign-in to the browser.
   */
  google(account: GoogleAccount): Promise<Outcome>;
  /** Emails the address a code; with the gate's `signUp`, an address with no account gets one too, to make it. */
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

/**
 * Signs out with no page load, straight to the sign-in screen, and forgets the account, so that screen offers no
 * Continue as. Null outside the gate, so the app draws no Sign out there.
 */
export const useSignOut = () => useContext(SignOutContext);

/** Who is signed in, or null outside the gate. */
export const usePerson = () => useContext(PersonContext);

/** Tells the gate the app has drawn its first screen with its first data, so the placeholder goes in the same frame. */
export const useAppDrawn = () => useContext(AppDrawnContext);

interface GateProps {
  /** Null draws the app with no sign-in, for a server that runs open on this machine: `signInFromEnvironment` gives it. */
  provider: SignInProvider | null;
  /** The one steady placeholder: the app's wordmark on its own background. */
  placeholder: ReactNode;
  /** The app's sign-in screen, which uses `useSignIn`. */
  signedOut: ReactNode;
  /**
   * What to draw while the provider loads in a browser that was signed in last time, and, with `waitForFirstDraw`,
   * until the app is drawn. The placeholder unless the app says otherwise, as when its own bar draws the wordmark in
   * another place and the placeholder's would jump.
   */
  whileReturning?: ReactNode;
  /**
   * Show nothing of the app until it calls `useAppDrawn`'s function, with the placeholder held up meanwhile after a
   * sign-in, so the whole screen appears at once. Every screen calls it once its first data is in or has failed.
   */
  waitForFirstDraw?: boolean;
  /**
   * An emailed code to an address with no account makes the account once the code is checked. Off, such an address is
   * told it has none, as an app that serves only its owner wants.
   */
  signUp?: boolean;
  callbackPath?: string;
  /** The lines under the wordmark in iPhone Google sign-in's in-between steps, in place of the gate's own. */
  lines?: { openingGoogle?: string; signingInWithGoogle?: string };
  children: ReactNode;
}

/**
 * Given, the gate runs iPhone Google sign-in's in-between steps itself, and every screen from the tap to the app's is
 * the app's wordmark with at most one line, never its sign-in screen. In the iPhone app, `useSignIn().google` opens
 * Apple's sheet, and the gate takes the sign-in it hands back, so the app's screen calls neither `signInInSheet` nor
 * `useDesktopSignInWindow`. On the page the sheet opens, signed out, the gate goes to Google without drawing the app's
 * sign-in screen, which shows only after Back from Google, or when the trip cannot start, with the reason as `notice`.
 */
type IphoneProps =
  | { iphoneSignIn?: undefined; placeholderWithLine?: undefined }
  | {
      /** From `iphoneSignInForGate` in `app-kit/tauri/iphone-sign-in`. */
      iphoneSignIn: IphoneSignIn;
      /** The placeholder with one line under the wordmark, for the in-between steps: how the app draws it. */
      placeholderWithLine: (line: string) => ReactNode;
    };

export type SignInGateProps = GateProps & IphoneProps;

/**
 * The app once someone is signed in, and the app's own sign-in screen until then, at whatever address the person asked
 * for, so a sign-in lands where they were. Signing in and out load no page beyond the provider's own trip to Google.
 * A request the server refuses brings sign-in up over the current address.
 */
export function SignInGate({ provider, ...props }: SignInGateProps) {
  if (!provider) return <>{props.children}</>;
  const { Root } = provider;
  return (
    <Root>
      <Gate provider={provider} {...props} />
    </Root>
  );
}

// With no iPhone sign-in, nothing is handed back.
const WAITING = { state: 'waiting' } as const;
const useNoWindow = () => WAITING;

function Gate({
  provider,
  placeholder,
  signedOut,
  whileReturning = placeholder,
  waitForFirstDraw = false,
  signUp = false,
  callbackPath = GOOGLE_CALLBACK_PATH,
  lines,
  iphoneSignIn,
  placeholderWithLine,
  children,
}: SignInGateProps & { provider: SignInProvider }) {
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
  // On the page Apple's sheet opens: whether it is leaving for Google, or shows the sign-in screen after all.
  const [googleStep, setGoogleStep] = useState<'undecided' | 'leaving' | 'form'>('undecided');
  // In the iPhone app: the sheet is open or its sign-in is being taken, and, once signed in, whether that is how.
  const [withGoogle, setWithGoogle] = useState(false);
  const [signedInWithGoogle, setSignedInWithGoogle] = useState(false);
  const withGoogleNow = useRef(false);
  withGoogleNow.current = withGoogle;

  // The latest session, for the fetch wrapper, which holds on to one object across renders.
  const latest = useRef<ProviderSession>(session);
  latest.current = session;
  const signedInAt = useRef(0);
  const wasSignedOut = useRef<boolean | null>(null);

  // The person's own Sign out forgets the account; a session the server ended keeps it, so signing back in is one tap.
  // Forgotten before the provider answers, since the sign-in screen reads it as it draws.
  const endSession = useCallback((forget: boolean) => {
    if (forget) forgetAccount();
    rememberSignedIn(false);
    setSigningOut(true);
    latest.current.signOut().catch(() => setSigningOut(false));
  }, []);
  const signOut = useCallback(() => endSession(true), [endSession]);

  // In a layout effect, which runs before any passive one: an app's first requests come from its own effects, and
  // children's effects run before their parent's, so a passive one here would let them go out without a token.
  useLayoutEffect(() => {
    setCurrentSession({
      token: (options) => latest.current.token(options),
      tokenNow: () => latest.current.tokenNow(),
      refused: () => {
        // Already signed out, as when a second request in flight is refused after the first: the sign-in screen is up.
        if (!latest.current.person) return;
        setNotice(SESSION_ENDED);
        endSession(false);
      },
      get signedInAt() {
        return signedInAt.current;
      },
    });
    return () => setCurrentSession(null);
  }, [endSession]);

  const personId = person?.id ?? null;
  const email = person?.email ?? null;
  useEffect(() => {
    if (!loaded) return;
    rememberSignedIn(personId !== null);
    if (personId !== null) {
      if (wasSignedOut.current) signedInAt.current = Date.now();
      if (email) rememberAccount(email);
      setReturningFromGoogle(false);
      // The line stays through the hold only for this sign-in: a later Sign out shows the sign-in screen.
      setSignedInWithGoogle(withGoogleNow.current);
      setWithGoogle(false);
    } else {
      // Signed out here, in another tab or by the session ending: the sign-in screen is next, and a later sign-in
      // holds the placeholder up again until the app has drawn. What the page kept for the person goes.
      announceSignedOut();
      setCameThroughSignIn(true);
      setSigningOut(false);
      setAppDrawn(false);
      setSignedInWithGoogle(false);
    }
    wasSignedOut.current = personId === null;
  }, [loaded, personId, email]);

  // Read again on each sign-in screen, since a sign-in on this page may have changed it.
  const remembered = personId === null ? lastAccount() : null;
  const signIn = useMemo<SignIn>(
    () => ({
      lastAccount: remembered,
      notice,
      google: async (account) => {
        setNotice(null);
        if (iphoneSignIn?.opensSheet()) {
          setWithGoogle(true);
          // Closed or failed: the sign-in screen again, ready. A refused hand-over says why, through the window's state.
          if (!(await iphoneSignIn.open(account, lastAccount()))) setWithGoogle(false);
          return { ok: true };
        }
        rememberReturn(currentAddress());
        return latest.current.google({ callbackPath, account: accountFor(account, lastAccount()) });
      },
      sendEmailCode: (address) => {
        setNotice(null);
        return latest.current.sendEmailCode(address, { signUp });
      },
      checkEmailCode: (code, address) => latest.current.checkEmailCode(code, address),
    }),
    [remembered, notice, callbackPath, signUp, iphoneSignIn],
  );

  // The sign-in the sheet hands back: the line while it is taken, and the sign-in screen with the reason if it fails.
  const useWindow = iphoneSignIn?.useWindow ?? useNoWindow;
  const handedBack = useWindow(session);
  useEffect(() => {
    if (handedBack.state === 'signing-in') setWithGoogle(true);
    if (handedBack.state === 'failed') {
      setWithGoogle(false);
      setNotice(handedBack.message);
    }
  }, [handedBack]);

  // On the page Apple's sheet opens, signed out: straight to Google, once per tab, so Back from Google shows the
  // sign-in screen. React's development mode runs this twice; the second run finds the note written and leaves the
  // first run's trip alone. With storage blocked nothing can be noted, so the sign-in screen waits for a click.
  const signedOutHere = loaded && !signingOut && personId === null && !returningFromGoogle;
  useEffect(() => {
    if (!iphoneSignIn || !signedOutHere || googleStep !== 'undecided') return;
    const asked = iphoneSignIn.asked();
    if (!asked) return;
    if (iphoneSignIn.noteGoingToGoogle()) {
      setGoogleStep('leaving');
      void signIn.google(asked).then((outcome) => {
        if (outcome.ok) return;
        setGoogleStep('form');
        setNotice(outcome.message);
      });
    } else if (!iphoneSignIn.wentToGoogle()) {
      setGoogleStep('form');
    }
  }, [iphoneSignIn, signedOutHere, googleStep, signIn]);

  // Back from Google, a page the browser kept as it was would still say it is opening Google.
  useEffect(() => {
    if (!iphoneSignIn) return;
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setGoogleStep('form');
    };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, [iphoneSignIn]);

  const withLine = (line: string): [GateShows, ReactNode] => ['placeholder-with-line', placeholderWithLine?.(line) ?? placeholder];
  const [shows, drawn] = ((): [GateShows, ReactNode] => {
    if (signingOut || !loaded) return ['placeholder', signingOut || lastSignedIn() !== true ? placeholder : whileReturning];

    if (!person) {
      if (returningFromGoogle) {
        return [
          'placeholder',
          <>
            {placeholder}
            <GoogleReturn
              onUnfinished={() => {
                window.history.replaceState(null, '', takeReturn());
                setNotice(GOOGLE_UNFINISHED);
                setReturningFromGoogle(false);
              }}
            />
          </>,
        ];
      }
      if (iphoneSignIn) {
        const leaving = googleStep === 'leaving' || (googleStep === 'undecided' && !iphoneSignIn.wentToGoogle());
        if (leaving && iphoneSignIn.asked()) return withLine(lines?.openingGoogle ?? OPENING_GOOGLE);
        if (withGoogle) return withLine(lines?.signingInWithGoogle ?? SIGNING_IN_WITH_GOOGLE);
      }
      return ['sign-in', <SignInContext.Provider value={signIn}>{signedOut}</SignInContext.Provider>];
    }

    // Back from Google and signed in: on to the address the person asked for, before the app reads where it is.
    if (window.location.pathname === callbackPath) window.history.replaceState(null, '', takeReturn());

    // Until the app has drawn its first data, it renders, so its requests go out, but nothing of it shows: the whole
    // screen appears at once. The wrapper is always there, with no box of its own, so drawing the app never remounts it.
    // Signed in through Apple's sheet, the line stays up until then, so it never drops away just before the app shows.
    const holding = waitForFirstDraw && !appDrawn;
    const throughGoogle = iphoneSignIn !== undefined && (withGoogle || signedInWithGoogle);
    const held: [GateShows, ReactNode] = throughGoogle
      ? withLine(lines?.signingInWithGoogle ?? SIGNING_IN_WITH_GOOGLE)
      : ['placeholder', cameThroughSignIn ? placeholder : whileReturning];
    return [
      holding ? held[0] : 'app',
      <PersonContext.Provider value={person}>
        <AppDrawnContext.Provider value={markAppDrawn}>
          {/* What stood while the provider loaded stays until the app is drawn: one steady thing, never a blank between. */}
          {holding && held[1]}
          <div style={{ display: 'contents', visibility: holding ? 'hidden' : undefined }} aria-hidden={holding || undefined}>
            <SignOutContext.Provider value={signOut}>{children}</SignOutContext.Provider>
          </div>
        </AppDrawnContext.Provider>
      </PersonContext.Provider>,
    ];
  })();

  // What the gate shows, for tests that hold the steps between a tap and the app to the wordmark and a line.
  useLayoutEffect(() => {
    document.documentElement.setAttribute(GATE_SHOWS_ATTRIBUTE, shows);
  }, [shows]);
  useLayoutEffect(() => () => document.documentElement.removeAttribute(GATE_SHOWS_ATTRIBUTE), []);

  return <>{drawn}</>;
}
