import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useLayoutEffect, useState, type ReactElement } from 'react';
import { request } from '../web/fetch';
import { resetConnection } from '../web/connection';
import {
  GATE_SHOWS_ATTRIBUTE,
  GOOGLE_CALLBACK_PATH,
  PROVIDER_LOAD_WAIT_MS,
  SESSION_ENDED,
  SIGN_IN_NOT_LOADED,
  SignInGate,
  useAppDrawn,
  usePerson,
  useSignIn,
  useSignOut,
} from '../web/sign-in/SignInGate';
import { rememberSignedIn } from '../web/sign-in/remembered';
import { STAND_IN_CODE, standInSignIn, type StandInSignIn } from '../authentication/stand-in';
import type { IphoneSignIn, IphoneSignInWindow } from '../web/sign-in/iphone-sign-in';

// The gate's open mode: the app drawn for people who are not signed in, with its own sign-in screen at its own address.

const realFetch = globalThis.fetch;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  resetConnection();
});

/** The app's own sign-in screen, as the gate draws it when the server ends a session. */
function SignInScreen() {
  const signIn = useSignIn();
  return (
    <main>
      <h1>Sign in</h1>
      {signIn.notice && <p role="alert">{signIn.notice}</p>}
      {signIn.continueSignedOut && <button onClick={signIn.continueSignedOut}>Continue signed out</button>}
    </main>
  );
}

let mounts = 0;

/** An open app: its own Sign in, a person's data kept in a screen's state, and a request. */
function App({ drawn = true }: { drawn?: boolean }) {
  const person = usePerson();
  const signIn = useSignIn();
  const signOut = useSignOut();
  const appDrawn = useAppDrawn();
  const [kept] = useState(() => (person ? `kept by ${person.email}` : 'nothing kept'));
  const [message, setMessage] = useState<string>();
  useEffect(() => {
    mounts++;
  }, []);
  useLayoutEffect(() => {
    if (drawn) appDrawn();
  }, [drawn, appDrawn]);
  return (
    <main>
      <h1>{person ? `The app for ${person.email}` : 'The app, signed out'}</h1>
      <p>{kept}</p>
      {message && <p role="status">{message}</p>}
      {signOut && <button onClick={signOut}>Sign out</button>}
      {!person && (
        <button
          onClick={async () => {
            await signIn.sendEmailCode('ana@example.com');
            const outcome = await signIn.checkEmailCode(STAND_IN_CODE, 'ana@example.com');
            if (!outcome.ok) setMessage(outcome.message);
          }}
        >
          Email code
        </button>
      )}
      {!person && (
        <button
          onClick={async () => {
            const outcome = await signIn.google('choose');
            if (!outcome.ok) setMessage(outcome.message);
          }}
        >
          Google
        </button>
      )}
      <button onClick={() => void request('/api/tasks').catch(() => undefined)}>Load tasks</button>
    </main>
  );
}

function draw(provider: StandInSignIn, { app = <App />, waitForFirstDraw = false, iphoneSignIn }: { app?: ReactElement; waitForFirstDraw?: boolean; iphoneSignIn?: IphoneSignIn } = {}) {
  const placeholders = iphoneSignIn ? { iphoneSignIn, placeholderWithLine: (line: string) => <div role="progressbar">fixture {line}</div> } : {};
  return render(
    <SignInGate
      provider={provider}
      placeholder={<div role="progressbar">fixture</div>}
      signedOut={<SignInScreen />}
      waitForFirstDraw={waitForFirstDraw}
      open
      {...placeholders}
    >
      {app}
    </SignInGate>,
  );
}

const heading = () => screen.queryByRole('heading')?.textContent ?? null;
const shows = () => document.documentElement.getAttribute(GATE_SHOWS_ATTRIBUTE);
const press = (name: string | RegExp) => act(async () => screen.getByRole('button', { name }).click());
const ana = { id: 'p1', email: 'ana@example.com' };

test('signed out, the app is drawn, with its own sign-in', () => {
  draw(standInSignIn());
  expect(heading()).toBe('The app, signed out');
  expect(shows()).toBe('app-signed-out');
  // No Sign out for nobody.
  expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
});

test('a browser not signed in last time draws the app before the provider loads, and its requests go at once without a token', async () => {
  const sent: (string | null)[] = [];
  globalThis.fetch = mock(async (_path: string, init: RequestInit) => {
    sent.push(new Headers(init.headers).get('Authorization'));
    return Response.json({ tasks: [] });
  }) as unknown as typeof fetch;
  const provider = standInSignIn({ loaded: false });
  draw(provider);
  expect(heading()).toBe('The app, signed out');
  await press('Load tasks');
  // The stand-in's own token waits for it to load, as Clerk's does: the gate answers for it.
  await waitFor(() => expect(sent).toEqual([null]));
  expect(provider.calls.tokens).toEqual([]);
});

test('a browser signed in last time holds the placeholder until the provider loads, as a closed gate does', () => {
  rememberSignedIn(true);
  const provider = standInSignIn({ loaded: false });
  draw(provider);
  expect(screen.getByRole('progressbar')).toBeTruthy();
  expect(heading()).toBeNull();
  act(() => provider.finishLoading());
  expect(heading()).toBe('The app, signed out');
});

test("the return from Google holds the placeholder while the provider loads, never the app's own page there", () => {
  window.history.replaceState(null, '', `${GOOGLE_CALLBACK_PATH}?return_to=%2F`);
  draw(standInSignIn({ loaded: false }));
  expect(shows()).toBe('placeholder');
  expect(heading()).toBeNull();
});

test("the page Apple's sheet opens holds the placeholder while the provider loads", () => {
  draw(standInSignIn({ loaded: false }), { iphoneSignIn: iphone({ asked: 'choose' }) });
  expect(shows()).toBe('placeholder');
  expect(heading()).toBeNull();
});

test('an app drawn before the provider loaded stays drawn once it loads, and after a sign-in and a sign-out', async () => {
  const provider = standInSignIn({ loaded: false });
  draw(provider, { waitForFirstDraw: true });
  expect(shows()).toBe('app-signed-out');
  act(() => provider.finishLoading());
  expect(shows()).toBe('app-signed-out');
  expect(screen.getByRole('heading').closest('[aria-hidden]')).toBeNull();

  await press('Email code');
  expect(heading()).toBe('The app for ana@example.com');
  expect(shows()).toBe('app');
  await press('Sign out');
  expect(heading()).toBe('The app, signed out');
  expect(shows()).toBe('app-signed-out');
});

test("the app starts again whenever the person changes, so one person's data never shows signed out or to the next", async () => {
  window.history.replaceState(null, '', '/notes/3');
  const provider = standInSignIn({ person: ana });
  draw(provider);
  expect(screen.getByText('kept by ana@example.com')).toBeTruthy();
  const before = mounts;

  await press('Sign out');
  expect(heading()).toBe('The app, signed out');
  expect(screen.queryByText('kept by ana@example.com')).toBeNull();
  expect(screen.getByText('nothing kept')).toBeTruthy();
  expect(window.location.pathname).toBe('/notes/3');

  act(() => provider.signInAs({ id: 'p2', email: 'bo@example.com' }));
  expect(heading()).toBe('The app for bo@example.com');
  expect(screen.queryByText('kept by ana@example.com')).toBeNull();
  expect(screen.getByText('kept by bo@example.com')).toBeTruthy();
  expect(mounts).toBe(before + 2);
});

test('the server ending a session draws the sign-in screen over the address, and Continue signed out puts the app back', async () => {
  window.history.replaceState(null, '', '/notes/3');
  globalThis.fetch = mock(async () => new Response('', { status: 401 })) as unknown as typeof fetch;
  draw(standInSignIn({ person: ana }));
  await press('Load tasks');
  await waitFor(() => expect(heading()).toBe('Sign in'));
  expect(shows()).toBe('sign-in');
  expect(screen.getByRole('alert').textContent).toBe(SESSION_ENDED);
  expect(window.location.pathname).toBe('/notes/3');

  await press('Continue signed out');
  expect(heading()).toBe('The app, signed out');
  expect(window.location.pathname).toBe('/notes/3');
});

test('a sign-in screen drawn for an ended session goes once someone signs in', async () => {
  globalThis.fetch = mock(async () => new Response('', { status: 401 })) as unknown as typeof fetch;
  const provider = standInSignIn({ person: ana });
  draw(provider);
  await press('Load tasks');
  await waitFor(() => expect(heading()).toBe('Sign in'));
  act(() => provider.signInAs(ana));
  expect(heading()).toBe('The app for ana@example.com');
  // Signed out again later, the app is drawn, not the sign-in screen.
  await press('Sign out');
  expect(heading()).toBe('The app, signed out');
});

test('a refusal with nobody signed in changes nothing, and the request is not sent again without a token', async () => {
  const sent: (string | null)[] = [];
  globalThis.fetch = mock(async (_path: string, init: RequestInit) => {
    sent.push(new Headers(init.headers).get('Authorization'));
    return new Response('', { status: 401 });
  }) as unknown as typeof fetch;
  const provider = standInSignIn();
  draw(provider);
  await press('Load tasks');
  await waitFor(() => expect(sent).toEqual([null]));
  // The provider was asked once, for the first send, and never for a fresh token.
  expect(provider.calls.tokens).toEqual([{ fresh: false }]);
  expect(heading()).toBe('The app, signed out');
});

test('a sign-in pressed before the provider loads waits for it', async () => {
  const provider = standInSignIn({ loaded: false });
  draw(provider);
  await press('Email code');
  expect(provider.calls.sendEmailCode).toEqual([]);
  await act(async () => provider.finishLoading());
  await waitFor(() => expect(heading()).toBe('The app for ana@example.com'));
  expect(provider.calls.sendEmailCode).toEqual(['ana@example.com']);
});

test('a sign-in pressed while the provider never loads says so after the wait', async () => {
  const timers: { run: () => void; ms: number }[] = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((run: () => void, ms: number) => {
    if (ms === PROVIDER_LOAD_WAIT_MS) {
      timers.push({ run, ms });
      return 0;
    }
    return realSetTimeout(run, ms);
  }) as typeof setTimeout;
  try {
    const provider = standInSignIn({ loaded: false });
    draw(provider);
    await press('Google');
    expect(timers).toHaveLength(1);
    await act(async () => timers[0]!.run());
    expect(screen.getByRole('status').textContent).toBe(SIGN_IN_NOT_LOADED);
    expect(provider.calls.google).toEqual([]);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

/** iPhone sign-in as the gate takes it, with the sheet held open until the test closes it. */
function iphone({ asked = null, inApp = false }: { asked?: 'choose' | null; inApp?: boolean } = {}) {
  let close: (handedOver: boolean) => void = () => {};
  const sheet: IphoneSignIn & { close(handedOver: boolean): void } = {
    asked: () => asked,
    wentToGoogle: () => false,
    noteGoingToGoogle: () => true,
    opensSheet: () => inApp,
    open: () => new Promise<boolean>((resolve) => (close = resolve)),
    useWindow: (): IphoneSignInWindow => ({ state: 'waiting' }),
    close: (handedOver) => close(handedOver),
  };
  return sheet;
}

test("in the iPhone app, the sheet's line stands over the open app, and closing the sheet finds the app as it was", async () => {
  const sheet = iphone({ inApp: true });
  draw(standInSignIn(), { iphoneSignIn: sheet });
  const before = mounts;
  await press('Google');
  expect(shows()).toBe('placeholder-with-line');
  expect(screen.getByRole('progressbar').textContent).toBe('fixture Signing in with Google.');
  await act(async () => sheet.close(false));
  expect(shows()).toBe('app-signed-out');
  expect(heading()).toBe('The app, signed out');
  expect(mounts).toBe(before);
});
