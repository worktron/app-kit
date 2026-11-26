import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { announceSignedOut, setCurrentSession } from './current';
import type { IphoneSignIn } from './iphone-sign-in';
import type { Outcome, ProviderSession, SignedInPerson, SignInProvider, SignInWith } from './provider';
import {
  currentAddress,
  forgetAccount,
  googleCallback,
  lastAccount,
  lastAccountWith,
  lastSignedIn,
  noteTripWith,
  rememberAccount,
  rememberAccountWith,
  rememberReturn,
  rememberSignedIn,
  takeReturn,
  tripWith,
} from './remembered';

/** Where Google and Microsoft send the browser back to, unless the gate is told another. The server must answer it with the app. */
export const GOOGLE_CALLBACK_PATH = '/sso-callback';

export const GOOGLE_UNFINISHED = 'Signing in with Google did not finish. Try again, or use an emailed code.';
export const MICROSOFT_UNFINISHED = 'Signing in with Microsoft did not finish. Try again, or use an emailed code.';
export const SESSION_ENDED = 'Your session ended. Sign in again to carry on where you were.';
/** What a sign-in pressed in an open app says when the provider has not loaded within `PROVIDER_LOAD_WAIT_MS`. */
export const SIGN_IN_NOT_LOADED = 'Sign-in could not load. Check your connection and try again.';
/** How long a sign-in pressed in an open app before the provider has loaded waits for it. */
export const PROVIDER_LOAD_WAIT_MS = 20_000;

/** The line under the wordmark on the page Apple's sheet opens, while it goes to Google, unless the app gives its own. */
export const OPENING_GOOGLE = 'Opening Google.';
/** The line under the wordmark in the iPhone app, from the tap until the app's screen, unless the app gives its own. */
export const SIGNING_IN_WITH_GOOGLE = 'Signing in with Google.';
/** The same two lines for Microsoft. */
export const OPENING_MICROSOFT = 'Opening Microsoft.';
export const SIGNING_IN_WITH_MICROSOFT = 'Signing in with Microsoft.';

/**
 * The attribute the gate puts on `<html>` saying what it shows: `placeholder`, `placeholder-with-line`, `sign-in` (the
 * app's sign-in screen), `app` (the app, drawn, someone signed in) or `app-signed-out` (an open gate's app, drawn with
 * nobody signed in). `expectQuietSignIn` in `app-kit/web/playwright` reads it.
 */
export const GATE_SHOWS_ATTRIBUTE = 'data-sign-in-gate';
type GateShows = 'placeholder' | 'placeholder-with-line' | 'sign-in' | 'app' | 'app-signed-out';

/** Which account a sign-in asks Google or Microsoft for. Named for Google, which it was written for first. */
export type GoogleAccount = 'remembered' | 'choose' | { account: string };

/** The account to name to Google or Microsoft, or null for its list. */
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
  /** Which provider `lastAccount` signed in with, so Continue as goes back to it: Google unless it was Microsoft. */
  lastAccountWith: SignInWith;
  /** Something to say above the buttons: Google or Microsoft did not finish, or the server ended the session. */
  notice: string | null;
  /**
   * In an open gate, while it draws this screen because the server ended the session: puts the app back, signed out.
   * Null otherwise, so the screen offers it only then.
   */
  continueSignedOut: (() => void) | null;
  /**
   * Google, returning to this address. `remembered` names the last account to Google, so it shows no page while it is
   * still signed in to it; `choose` has Google list its accounts, as does `remembered` with no account remembered. An
   * account named outright is for a choice made elsewhere, as in a desktop app's window that hands sign-in to the browser.
   */
  google(account: GoogleAccount): Promise<Outcome>;
  /**
   * Microsoft, as `google` is Google: work, school and personal accounts. Microsoft fills a named account in on its own
   * page, so Continue as may still show that page where Google would not.
   */
  microsoft(account: GoogleAccount): Promise<Outcome>;
  /** Emails the address a code; with the gate's `signUp`, an address with no account gets one too, to make it. */
  sendEmailCode(email: string): Promise<Outcome>;
  checkEmailCode(code: string, email: string): Promise<Outcome>;
}

const SignInContext = createContext<SignIn | null>(null);
const SignOutContext = createContext<(() => void) | null>(null);
const AppDrawnContext = createContext<() => void>(() => {});
const PersonContext = createContext<SignedInPerson | null>(null);

/** For the app's sign-in screen: the one the gate draws while nobody is signed in, or, in an open gate, anywhere in the app. */
export function useSignIn(): SignIn {
  const signIn = useContext(SignInContext);
  if (!signIn) throw new Error('useSignIn is for the screen the sign-in gate draws while nobody is signed in, or for any screen inside an open gate.');
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
  /** The app's sign-in screen, which uses `useSignIn`: in an open gate, drawn only when the server ends the session. */
  signedOut: ReactNode;
  /**
   * The app is drawn for people who are not signed in too, with `usePerson()` null, and puts its own sign-in screen at
   * its own address, with `useSignIn`, which works anywhere inside the gate. A browser that was not signed in last time
   * draws the app at once, without waiting for the provider, and its requests go without a token until the provider
   * has loaded; one that was holds `whileReturning` until it has, as a closed gate does. The app starts again at the
   * same address whenever the person changes, so nothing of one person's stays on screen. The server ending a session
   * draws `signedOut` over the address, with `continueSignedOut` to put the app back.
   */
  open?: boolean;
  /**
   * What to draw while the provider loads in a browser that was signed in last time, and, with `waitForFirstDraw`,
   * until the app is drawn. The placeholder unless the app says otherwise, as when its own bar draws the wordmark in
   * another place and the placeholder's would jump: then the name in the bar alone, the React twin of index.html's
   * `html[data-signed-in-before] #root:empty::before` (README, "The name before the code, in one picture or two").
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
  /** The lines under the wordmark in iPhone sign-in's in-between steps, in place of the gate's own. */
  lines?: { openingGoogle?: string; signingInWithGoogle?: string; openingMicrosoft?: string; signingInWithMicrosoft?: string };
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

/** The provider by the name people know it by, for the console. */
const providerName = (signInWith: SignInWith) => (signInWith === 'microsoft' ? 'Microsoft' : 'Google');

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
  open = false,
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
  // Which app the app has drawn: in an open gate, the one for this person or for nobody, since it starts again on each
  // change; in a closed one there is only the signed-in app, and a sign-out forgets it was drawn.
  const drawnKey = open ? (person?.id ?? 'signed-out') : 'signed-in';
  const drawnKeyNow = useRef(drawnKey);
  drawnKeyNow.current = drawnKey;
  const [drawnFor, setDrawnFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // In an open gate: the server ended the session, so the app's sign-in screen stands over the address.
  const [signInAsked, setSignInAsked] = useState(false);
  const [returningFromGoogle, setReturningFromGoogle] = useState(() => window.location.pathname === callbackPath);
  const markAppDrawn = useCallback(() => setDrawnFor(drawnKeyNow.current), []);
  // On the page Apple's sheet opens: whether it is leaving for Google or Microsoft, or shows the sign-in screen after all.
  const [tripStep, setTripStep] = useState<'undecided' | 'leaving' | 'form'>('undecided');
  // In the iPhone app: the sheet is open or its sign-in is being taken, and, once signed in, whether that is how; and
  // which provider the sheet went to, for its line.
  const [inSheet, setInSheet] = useState(false);
  const [signedInThroughSheet, setSignedInThroughSheet] = useState(false);
  const [sheetWith, setSheetWith] = useState<SignInWith>('google');
  const inSheetNow = useRef(false);
  inSheetNow.current = inSheet;

  // The latest session, for the fetch wrapper, which holds on to one object across renders.
  const latest = useRef<ProviderSession>(session);
  latest.current = session;
  const signedInAt = useRef(0);
  const wasSignedOut = useRef<boolean | null>(null);
  const openNow = useRef(open);
  openNow.current = open;
  // In an open gate, a browser not signed in last time draws the app before the provider loads: its requests go
  // without a token then rather than wait on the provider's script, which may never come.
  const tokenWaits = () => !openNow.current || latest.current.loaded || lastSignedIn() === true;

  // Sign-ins pressed before the provider has loaded, as an open gate allows, waiting for it. Asked only then, so a
  // provider already in is called in the same turn as the press, as before open gates.
  const loadWaiters = useRef(new Set<() => void>());
  useEffect(() => {
    if (!loaded) return;
    for (const done of loadWaiters.current) done();
    loadWaiters.current.clear();
  }, [loaded]);
  const providerLoaded = useCallback((): Promise<boolean> => {
    if (latest.current.loaded) return Promise.resolve(true);
    console.log('[app-kit sign-in] sign-in pressed before the provider loaded: waiting for it');
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        loadWaiters.current.delete(done);
        console.warn(`[app-kit sign-in] the provider had not loaded ${PROVIDER_LOAD_WAIT_MS / 1000} s after sign-in was pressed: told the person to try again`);
        resolve(false);
      }, PROVIDER_LOAD_WAIT_MS);
      loadWaiters.current.add(done);
    });
  }, []);

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
      token: (options) => (tokenWaits() ? latest.current.token(options) : Promise.resolve(null)),
      tokenNow: () => (tokenWaits() ? latest.current.tokenNow() : null),
      refused: () => {
        // Already signed out, as when a second request in flight is refused after the first: the sign-in screen is up.
        if (!latest.current.person) return;
        setNotice(SESSION_ENDED);
        if (openNow.current) setSignInAsked(true);
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
      if (email) {
        rememberAccount(email);
        // The provider this tab's sign-in went to, noted as it left or as a desktop app's window asked the browser.
        const signedInWith = tripWith();
        if (signedInWith) {
          rememberAccountWith(signedInWith);
          noteTripWith(null);
        }
      }
      setReturningFromGoogle(false);
      setSignInAsked(false);
      // On the sign-in itself, not when the provider fills in the email after: the line stays through the hold only for
      // this sign-in, so a later Sign out shows the sign-in screen.
      if (wasSignedOut.current !== false) {
        setSignedInThroughSheet(inSheetNow.current);
        setInSheet(false);
      }
    } else {
      // Signed out here, in another tab or by the session ending: the sign-in screen is next, and a later sign-in
      // holds the placeholder up again until the app has drawn. What the page kept for the person goes.
      announceSignedOut();
      setCameThroughSignIn(true);
      setSigningOut(false);
      // An open gate's signed-out app is another app, drawn by itself; it may have drawn already, before the provider loaded.
      if (!openNow.current) setDrawnFor(null);
      setSignedInThroughSheet(false);
    }
    wasSignedOut.current = personId === null;
  }, [loaded, personId, email]);

  // Read again on each sign-in screen, since a sign-in on this page may have changed it.
  const remembered = personId === null ? lastAccount() : null;
  const rememberedWith = lastAccountWith();
  const signIn = useMemo<SignIn>(() => {
    // Google or Microsoft: the sheet in the iPhone app, else the provider's own trip, coming back to this address.
    const trip =
      (signInWith: SignInWith) =>
      async (account: GoogleAccount): Promise<Outcome> => {
        setNotice(null);
        // The sheet's address notes the provider itself, after deciding whether its secret can be asked with again.
        if (iphoneSignIn?.opensSheet()) {
          setSheetWith(signInWith);
          setInSheet(true);
          // Closed or failed: the sign-in screen again, ready. A refused hand-over says why, through the window's state.
          if (!(await iphoneSignIn.open(account, lastAccount(), signInWith))) setInSheet(false);
          return { ok: true };
        }
        noteTripWith(signInWith);
        const address = currentAddress();
        rememberReturn(address);
        if (!latest.current.loaded && !(await providerLoaded())) return { ok: false, message: SIGN_IN_NOT_LOADED };
        return latest.current[signInWith]({ callbackPath: googleCallback(callbackPath, address), account: accountFor(account, lastAccount()) });
      };
    return {
      lastAccount: remembered,
      lastAccountWith: rememberedWith,
      notice,
      continueSignedOut:
        open && signInAsked
          ? () => {
              setSignInAsked(false);
              setNotice(null);
            }
          : null,
      google: trip('google'),
      microsoft: trip('microsoft'),
      sendEmailCode: async (address) => {
        setNotice(null);
        // No provider's trip: an account signed in this way reads as Google's, as before the kit knew Microsoft.
        noteTripWith(null);
        if (!latest.current.loaded && !(await providerLoaded())) return { ok: false, message: SIGN_IN_NOT_LOADED };
        return latest.current.sendEmailCode(address, { signUp });
      },
      checkEmailCode: async (code, address) => {
        if (!latest.current.loaded && !(await providerLoaded())) return { ok: false, message: SIGN_IN_NOT_LOADED };
        const outcome = await latest.current.checkEmailCode(code, address);
        if (outcome.ok) rememberAccountWith(null);
        return outcome;
      },
    };
  }, [remembered, rememberedWith, notice, open, signInAsked, callbackPath, signUp, iphoneSignIn, providerLoaded]);

  // The sign-in the sheet hands back: the line while it is taken, and the sign-in screen with the reason if it fails.
  const useWindow = iphoneSignIn?.useWindow ?? useNoWindow;
  const handedBack = useWindow(session);
  useEffect(() => {
    if (handedBack.state === 'signing-in') setInSheet(true);
    if (handedBack.state === 'failed') {
      setInSheet(false);
      setNotice(handedBack.message);
    }
  }, [handedBack]);

  // On the page Apple's sheet opens, signed out: straight to Google, once per tab, so Back from Google shows the
  // sign-in screen. React's development mode runs this twice; the second run finds the note written and leaves the
  // first run's trip alone. With storage blocked nothing can be noted, so the sign-in screen waits for a click.
  const signedOutHere = loaded && !signingOut && personId === null && !returningFromGoogle;
  useEffect(() => {
    if (!iphoneSignIn || !signedOutHere || tripStep !== 'undecided') return;
    const asked = iphoneSignIn.asked();
    if (!asked) return;
    const askedWith = iphoneSignIn.askedWith?.() ?? 'google';
    if (iphoneSignIn.noteGoingToGoogle()) {
      console.log(`[app-kit sign-in] signed out on the page that hands sign-in to an app: going to ${providerName(askedWith)} for ${asked === 'choose' ? 'its list of accounts' : asked === 'remembered' ? 'the account last used' : asked.account}`);
      setTripStep('leaving');
      void signIn[askedWith](asked).then((outcome) => {
        if (outcome.ok) return;
        setTripStep('form');
        setNotice(outcome.message);
      });
    } else if (!iphoneSignIn.wentToGoogle()) {
      setTripStep('form');
    } else {
      console.log(`[app-kit sign-in] signed out on the page that hands sign-in to an app, back from ${providerName(askedWith)} already: not going again`);
    }
  }, [iphoneSignIn, signedOutHere, tripStep, signIn]);

  // Back from Google, a page the browser kept as it was would still say it is opening Google.
  useEffect(() => {
    if (!iphoneSignIn) return;
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setTripStep('form');
    };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, [iphoneSignIn]);

  const withLine = (line: string): [GateShows, ReactNode] => ['placeholder-with-line', placeholderWithLine?.(line) ?? placeholder];
  const signingInLine = () =>
    withLine(sheetWith === 'microsoft' ? (lines?.signingInWithMicrosoft ?? SIGNING_IN_WITH_MICROSOFT) : (lines?.signingInWithGoogle ?? SIGNING_IN_WITH_GOOGLE));
  // Signed in through Apple's sheet, the line stays up until the app is drawn, so it never drops away just before.
  const throughSheet = iphoneSignIn !== undefined && (inSheet || signedInThroughSheet);
  const signInScreen: [GateShows, ReactNode] = ['sign-in', <SignInContext.Provider value={signIn}>{signedOut}</SignInContext.Provider>];

  /**
   * An open gate's app, for the person or for nobody, with what stands over it while it is hidden: the line while
   * Apple's sheet is up, or, until the app is drawn, what stood before. It starts again whenever the person changes,
   * and stays mounted under the sheet's line, so closing the sheet finds it as it was.
   */
  const openApp = (line: [GateShows, ReactNode] | null): [GateShows, ReactNode] => {
    const holding = waitForFirstDraw && drawnFor !== drawnKey;
    const over = line ?? (holding ? (person && throughSheet ? signingInLine() : (['placeholder', person && !cameThroughSignIn ? whileReturning : placeholder] as [GateShows, ReactNode])) : null);
    return [
      over ? over[0] : person ? 'app' : 'app-signed-out',
      <PersonContext.Provider value={person}>
        <AppDrawnContext.Provider value={markAppDrawn}>
          <SignInContext.Provider value={signIn}>
            {over?.[1]}
            <div key={drawnKey} style={{ display: 'contents', visibility: over ? 'hidden' : undefined }} aria-hidden={over ? true : undefined}>
              <SignOutContext.Provider value={person ? signOut : null}>{children}</SignOutContext.Provider>
            </div>
          </SignInContext.Provider>
        </AppDrawnContext.Provider>
      </PersonContext.Provider>,
    ];
  };

  const [shows, drawn] = ((): [GateShows, ReactNode] => {
    if (signingOut) return ['placeholder', placeholder];
    if (!loaded) {
      // An open gate draws the app at once for a browser that was not signed in last time, but not on a page where the
      // gate itself has a step to run once the provider is in: the return from Google, and the page Apple's sheet opens.
      if (open && lastSignedIn() !== true && !returningFromGoogle && !iphoneSignIn?.asked()) return openApp(null);
      return ['placeholder', lastSignedIn() !== true ? placeholder : whileReturning];
    }

    if (!person) {
      if (returningFromGoogle) {
        return [
          'placeholder',
          <>
            {placeholder}
            <GoogleReturn
              onUnfinished={() => {
                const back = takeReturn();
                console.log(`[app-kit sign-in] back from Google: the sign-in did not finish in this tab, back to ${new URL(back, window.location.origin).pathname}`);
                window.history.replaceState(null, '', back);
                setNotice(tripWith() === 'microsoft' ? MICROSOFT_UNFINISHED : GOOGLE_UNFINISHED);
                setReturningFromGoogle(false);
              }}
            />
          </>,
        ];
      }
      if (iphoneSignIn) {
        const leaving = tripStep === 'leaving' || (tripStep === 'undecided' && !iphoneSignIn.wentToGoogle());
        if (leaving && iphoneSignIn.asked()) {
          return withLine(iphoneSignIn.askedWith?.() === 'microsoft' ? (lines?.openingMicrosoft ?? OPENING_MICROSOFT) : (lines?.openingGoogle ?? OPENING_GOOGLE));
        }
        if (inSheet) return open ? openApp(signingInLine()) : signingInLine();
      }
      if (open && !signInAsked) return openApp(null);
      return signInScreen;
    }

    // Back from Google and signed in: on to the address the person asked for, before the app reads where it is.
    if (window.location.pathname === callbackPath) window.history.replaceState(null, '', takeReturn());
    if (open) return openApp(null);

    // Until the app has drawn its first data, it renders, so its requests go out, but nothing of it shows: the whole
    // screen appears at once. The wrapper is always there, with no box of its own, so drawing the app never remounts it.
    const holding = waitForFirstDraw && drawnFor !== drawnKey;
    const held: [GateShows, ReactNode] = throughSheet ? signingInLine() : ['placeholder', cameThroughSignIn ? placeholder : whileReturning];
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
