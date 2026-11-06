// The sign-in gate running iPhone Google sign-in's in-between steps itself: on the page Apple's sheet opens, and in the
// app from the tap until the app's screen. Every screen between is the wordmark with at most one line, never the app's
// sign-in screen; that comes back, ready, only when the person closes the sheet, comes back from Google, or a step fails.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode, useLayoutEffect, useSyncExternalStore } from 'react';
import { GATE_SHOWS_ATTRIBUTE, OPENING_GOOGLE, SESSION_ENDED, SIGNING_IN_WITH_GOOGLE, SignInGate, useAppDrawn, useSignIn, useSignOut, type GoogleAccount } from '../web/sign-in/SignInGate';
import type { IphoneSignIn, IphoneSignInWindow } from '../web/sign-in/iphone-sign-in';
import { takeReturn } from '../web/sign-in/remembered';
import { currentSession } from '../web/sign-in/current';
import { standInSignIn, type StandInSignIn } from '../authentication/stand-in';

const SHEET_PAGE = '/desktop-sign-in?nonce=abc&account=choose';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => cleanup());

/** The app's own sign-in screen: whatever it draws, the in-between steps should never show it. */
function SignInScreen() {
  const signIn = useSignIn();
  return (
    <main>
      <h1>Sign in</h1>
      {signIn.notice && <p role="alert">{signIn.notice}</p>}
      <button onClick={() => void signIn.google('choose')}>Continue with Google</button>
    </main>
  );
}

function App({ drawn = true }: { drawn?: boolean }) {
  const appDrawn = useAppDrawn();
  const signOut = useSignOut();
  useLayoutEffect(() => {
    if (drawn) appDrawn();
  }, [drawn, appDrawn]);
  return (
    <main>
      <h1>The app</h1>
      <button onClick={() => signOut?.()}>Sign out</button>
    </main>
  );
}

/**
 * iPhone sign-in as the gate takes it, with each part in the test's hands: the page's request, whether storage holds
 * the note that it went to Google, whether this is the iPhone app, the sheet, and the window's sign-in.
 */
function fakeIphone({ asked = null, storage = true, inApp = false }: { asked?: GoogleAccount | null; storage?: boolean; inApp?: boolean } = {}) {
  let noted = false;
  let state: IphoneSignInWindow = { state: 'waiting' };
  const listeners = new Set<() => void>();
  const sheets: { choice: GoogleAccount; close: (handed: boolean) => void }[] = [];
  const iphone: IphoneSignIn = {
    asked: () => asked,
    wentToGoogle: () => noted,
    noteGoingToGoogle: () => {
      if (!storage || noted) return false;
      noted = true;
      return true;
    },
    opensSheet: () => inApp,
    open: (choice) => new Promise<boolean>((close) => sheets.push({ choice, close })),
    useWindow: () =>
      useSyncExternalStore(
        (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => state,
      ),
  };
  const setWindow = (next: IphoneSignInWindow) =>
    act(() => {
      state = next;
      for (const listener of listeners) listener();
    });
  return { iphone, sheets, setWindow, back: () => (noted = true) };
}

function draw(provider: StandInSignIn, iphone: IphoneSignIn, { strict = false, drawn = true } = {}) {
  const gate = (
    <SignInGate
      provider={provider}
      placeholder={<div role="progressbar">wordmark</div>}
      placeholderWithLine={(line) => (
        <div role="progressbar">
          wordmark <p role="status">{line}</p>
        </div>
      )}
      iphoneSignIn={iphone}
      signedOut={<SignInScreen />}
      waitForFirstDraw
    >
      <App drawn={drawn} />
    </SignInGate>
  );
  return render(strict ? <StrictMode>{gate}</StrictMode> : gate);
}

const line = () => screen.queryByRole('status')?.textContent ?? null;
const signInScreen = () => screen.queryByRole('heading', { name: 'Sign in' });
const shows = () => document.documentElement.getAttribute(GATE_SHOWS_ATTRIBUTE);

/** A stand-in whose Google trip stays on the page, as the real one leaves it, answering what the test says. */
function provider(google: 'leaves' | { refused: string } = 'leaves') {
  const p = standInSignIn({ leaveForGoogle: () => {} });
  if (google !== 'leaves') {
    const session = p.useSession;
    p.useSession = () => ({ ...session(), google: async () => ({ ok: false, message: google.refused }) });
  }
  return p;
}

test('on the page Apple’s sheet opens, signed out, the gate goes to Google once, showing only the wordmark and its line', async () => {
  window.history.replaceState(null, '', SHEET_PAGE);
  const p = provider();
  draw(p, fakeIphone({ asked: 'choose' }).iphone);
  await act(async () => {});
  expect(line()).toBe(OPENING_GOOGLE);
  expect(signInScreen()).toBeNull();
  expect(shows()).toBe('placeholder-with-line');
  expect(p.calls.google).toEqual([{ callbackPath: '/sso-callback', account: null }]);
  // Google comes back to the callback, which then returns to this page, where the hand-over happens.
  expect(takeReturn()).toBe(SHEET_PAGE);
});

test('the account the app asked for goes to Google by name', async () => {
  window.history.replaceState(null, '', SHEET_PAGE);
  const p = provider();
  draw(p, fakeIphone({ asked: { account: 'ana@example.com' } }).iphone);
  await act(async () => {});
  expect(p.calls.google).toEqual([{ callbackPath: '/sso-callback', account: 'ana@example.com' }]);
});

test('in React’s development mode, which runs each effect twice, the gate goes to Google once and never draws the sign-in screen', async () => {
  window.history.replaceState(null, '', SHEET_PAGE);
  const p = provider();
  draw(p, fakeIphone({ asked: 'choose' }).iphone, { strict: true });
  await act(async () => {});
  expect(p.calls.google).toHaveLength(1);
  expect(line()).toBe(OPENING_GOOGLE);
  expect(signInScreen()).toBeNull();
});

test('in React’s development mode, a trip Google refuses shows the sign-in screen with the reason', async () => {
  window.history.replaceState(null, '', SHEET_PAGE);
  draw(provider({ refused: 'Google could not be reached.' }), fakeIphone({ asked: 'choose' }).iphone, { strict: true });
  await act(async () => {});
  expect(signInScreen()).not.toBeNull();
  expect(screen.getByRole('alert').textContent).toBe('Google could not be reached.');
  expect(shows()).toBe('sign-in');
});

test('with storage blocked the page cannot note the trip, so it shows the sign-in screen and waits for a click', async () => {
  window.history.replaceState(null, '', SHEET_PAGE);
  const p = provider();
  draw(p, fakeIphone({ asked: 'choose', storage: false }).iphone);
  await act(async () => {});
  expect(signInScreen()).not.toBeNull();
  expect(p.calls.google).toEqual([]);
});

test('a load after Back from Google shows the sign-in screen at once, and does not go again', async () => {
  window.history.replaceState(null, '', SHEET_PAGE);
  const p = provider();
  const fake = fakeIphone({ asked: 'choose' });
  fake.back();
  draw(p, fake.iphone);
  expect(signInScreen()).not.toBeNull();
  await act(async () => {});
  expect(p.calls.google).toEqual([]);
});

test('a page the browser kept as it was, back from Google, shows the sign-in screen rather than its line', async () => {
  window.history.replaceState(null, '', SHEET_PAGE);
  draw(provider(), fakeIphone({ asked: 'choose' }).iphone);
  await act(async () => {});
  expect(line()).toBe(OPENING_GOOGLE);
  act(() => void window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true })));
  expect(signInScreen()).not.toBeNull();
  expect(line()).toBeNull();
});

test('away from the page the sheet opens, the gate draws the sign-in screen as always', async () => {
  const p = provider();
  draw(p, fakeIphone().iphone);
  await act(async () => {});
  expect(signInScreen()).not.toBeNull();
  expect(shows()).toBe('sign-in');
  expect(p.calls.google).toEqual([]);
});

const tap = () => act(async () => screen.getByRole('button', { name: 'Continue with Google' }).click());

test('in the iPhone app, the tap opens the sheet and shows the wordmark and its line until the app is drawn', async () => {
  const p = provider();
  const fake = fakeIphone({ inApp: true });
  const { rerender } = draw(p, fake.iphone, { drawn: false });
  await tap();
  expect(fake.sheets.map((sheet) => sheet.choice)).toEqual(['choose']);
  expect(line()).toBe(SIGNING_IN_WITH_GOOGLE);
  expect(signInScreen()).toBeNull();
  expect(p.calls.google).toEqual([]);

  // The sheet hands a sign-in back, the window takes it, and the person is in: the line holds until the app draws.
  fake.setWindow({ state: 'signing-in' });
  await act(async () => fake.sheets[0]!.close(true));
  expect(line()).toBe(SIGNING_IN_WITH_GOOGLE);
  act(() => p.signInAs({ id: 'p1', email: 'ana@example.com' }));
  fake.setWindow({ state: 'signed-in' });
  expect(line()).toBe(SIGNING_IN_WITH_GOOGLE);
  expect(shows()).toBe('placeholder-with-line');

  rerender(
    <SignInGate provider={p} placeholder={<div role="progressbar">wordmark</div>} placeholderWithLine={(l) => <p role="status">{l}</p>} iphoneSignIn={fake.iphone} signedOut={<SignInScreen />} waitForFirstDraw>
      <App />
    </SignInGate>,
  );
  expect(line()).toBeNull();
  expect(shows()).toBe('app');
});

test('in the iPhone app, the line stays while the app loads when the provider knows the person a moment before their email', async () => {
  const p = provider();
  const fake = fakeIphone({ inApp: true });
  draw(p, fake.iphone, { drawn: false });
  await tap();
  fake.setWindow({ state: 'signing-in' });
  await act(async () => fake.sheets[0]!.close(true));
  act(() => p.signInAs({ id: 'p1', email: null }));
  act(() => p.signInAs({ id: 'p1', email: 'ana@example.com' }));
  fake.setWindow({ state: 'signed-in' });
  expect(line()).toBe(SIGNING_IN_WITH_GOOGLE);
});

test('in the iPhone app, a sheet closed without signing in brings the sign-in screen back ready, with nothing to say', async () => {
  const fake = fakeIphone({ inApp: true });
  draw(provider(), fake.iphone);
  await tap();
  await act(async () => fake.sheets[0]!.close(false));
  expect(signInScreen()).not.toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect((screen.getByRole('button', { name: 'Continue with Google' }) as HTMLButtonElement).disabled).toBe(false);
});

test('in the iPhone app, a hand-over the window refuses brings the sign-in screen back with the reason', async () => {
  const fake = fakeIphone({ inApp: true });
  draw(provider(), fake.iphone);
  await tap();
  fake.setWindow({ state: 'signing-in' });
  await act(async () => fake.sheets[0]!.close(true));
  fake.setWindow({ state: 'failed', message: 'This sign-in did not come from this window. Sign in again.' });
  expect(signInScreen()).not.toBeNull();
  expect(screen.getByRole('alert').textContent).toBe('This sign-in did not come from this window. Sign in again.');

  // A later sheet closed without signing in does not bring the old reason back.
  await tap();
  await act(async () => fake.sheets[1]!.close(false));
  expect(screen.queryByRole('alert')).toBeNull();
});

/** Signed in through the sheet, with the app drawn. */
async function signedInThroughSheet(p: StandInSignIn) {
  const fake = fakeIphone({ inApp: true });
  draw(p, fake.iphone);
  await tap();
  fake.setWindow({ state: 'signing-in' });
  await act(async () => fake.sheets[0]!.close(true));
  act(() => p.signInAs({ id: 'p1', email: 'ana@example.com' }));
  fake.setWindow({ state: 'signed-in' });
  expect(shows()).toBe('app');
}

test('signed in through the sheet, Sign out shows the sign-in screen, not the line', async () => {
  const p = provider();
  await signedInThroughSheet(p);
  await act(async () => screen.getByRole('button', { name: 'Sign out' }).click());
  expect(signInScreen()).not.toBeNull();
  expect(line()).toBeNull();
});

test('signed in through the sheet, a session the server ends shows the sign-in screen with its reason', async () => {
  const p = provider();
  await signedInThroughSheet(p);
  // What the fetch wrapper calls on a 401.
  await act(async () => currentSession()?.refused());
  expect(signInScreen()).not.toBeNull();
  expect(screen.getByRole('alert').textContent).toBe(SESSION_ENDED);
});
