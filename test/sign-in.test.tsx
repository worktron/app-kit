import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useLayoutEffect, useState } from 'react';
import { request } from '../src/fetch';
import { resetConnection } from '../src/connection';
import { accountFor, GOOGLE_CALLBACK_PATH, GOOGLE_UNFINISHED, SESSION_ENDED, SignInGate, useAppDrawn, useSignIn, useSignOut } from '../src/sign-in/SignInGate';
import { lastAccount, rememberAccount, rememberSignedIn } from '../src/sign-in/remembered';
import { STAND_IN_CODE, standInSignIn, type StandInSignIn } from '../testing';

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

/** The app's own sign-in screen, as small as can be. */
function SignInScreen() {
  const signIn = useSignIn();
  const [message, setMessage] = useState<string>();
  return (
    <main>
      <h1>Sign in</h1>
      {signIn.notice && <p role="alert">{signIn.notice}</p>}
      {message && <p>{message}</p>}
      {signIn.lastAccount && <button onClick={() => void signIn.google('remembered')}>Continue as {signIn.lastAccount}</button>}
      <button onClick={() => void signIn.google('choose')}>Use a different account</button>
      <button
        onClick={async () => {
          await signIn.sendEmailCode('ana@example.com');
          const outcome = await signIn.checkEmailCode(STAND_IN_CODE, 'ana@example.com');
          if (!outcome.ok) setMessage(outcome.message);
        }}
      >
        Email code
      </button>
      <button
        onClick={async () => {
          const outcome = await signIn.checkEmailCode('000000', 'ana@example.com');
          if (!outcome.ok) setMessage(outcome.message);
        }}
      >
        Wrong code
      </button>
    </main>
  );
}

function App({ drawn = true }: { drawn?: boolean }) {
  const signOut = useSignOut();
  const appDrawn = useAppDrawn();
  useLayoutEffect(() => {
    if (drawn) appDrawn();
  }, [drawn, appDrawn]);
  return (
    <main>
      <h1>The app at {window.location.pathname + window.location.search}</h1>
      <button onClick={() => signOut?.()}>Sign out</button>
      <button onClick={() => void request('/api/tasks').catch(() => undefined)}>Load tasks</button>
    </main>
  );
}

function draw(provider: StandInSignIn, app = <App />, waitForFirstDraw = false) {
  return render(
    <SignInGate provider={provider} placeholder={<div role="progressbar">timescale</div>} signedOut={<SignInScreen />} waitForFirstDraw={waitForFirstDraw}>
      {app}
    </SignInGate>,
  );
}

const heading = () => screen.getByRole('heading').textContent;
const press = (name: string | RegExp) => act(async () => screen.getByRole('button', { name }).click());

test('the placeholder holds while the provider loads, then the sign-in screen', async () => {
  const provider = standInSignIn({ loaded: false });
  draw(provider);
  expect(screen.getByRole('progressbar')).toBeTruthy();
  act(() => provider.finishLoading());
  expect(heading()).toBe('Sign in');
});

test('signing in by emailed code lands on the address the person asked for, and remembers the account', async () => {
  window.history.replaceState(null, '', '/week?category=work');
  const provider = standInSignIn();
  draw(provider);
  expect(heading()).toBe('Sign in');
  await press('Email code');
  expect(heading()).toBe('The app at /week?category=work');
  expect(provider.calls.sendEmailCode).toEqual(['ana@example.com']);
  expect(lastAccount()).toBe('ana@example.com');
});

test('a wrong code says so and stays on the sign-in screen', async () => {
  draw(standInSignIn());
  await press('Wrong code');
  expect(screen.getByText(/did not match/)).toBeTruthy();
  expect(heading()).toBe('Sign in');
});

test('signing out goes straight to the sign-in screen, at the same address', async () => {
  window.history.replaceState(null, '', '/week');
  const provider = standInSignIn({ person: { id: 'p1', email: 'ana@example.com' } });
  draw(provider);
  await press('Sign out');
  expect(heading()).toBe('Sign in');
  expect(provider.calls.signOut).toBe(1);
  expect(window.location.pathname).toBe('/week');
});

test('a request the server refuses brings sign-in up over the current address, saying why', async () => {
  window.history.replaceState(null, '', '/events/42');
  globalThis.fetch = mock(async () => new Response('', { status: 401 })) as unknown as typeof fetch;
  const provider = standInSignIn({ person: { id: 'p1', email: 'ana@example.com' } });
  draw(provider);
  await press('Load tasks');
  await waitFor(() => expect(heading()).toBe('Sign in'));
  expect(screen.getByRole('alert').textContent).toBe(SESSION_ENDED);
  expect(window.location.pathname).toBe('/events/42');
  // Asked once more with a fresh token before giving up on the session.
  expect(provider.calls.tokens.map((t) => t.fresh)).toEqual([false, true]);

  // Signing in again lands back on the same item.
  await press('Email code');
  expect(heading()).toBe('The app at /events/42');
});

test('Continue as names the remembered account to Google, and a different account asks Google for its list', async () => {
  rememberAccount('ana@example.com');
  const provider = standInSignIn({ leaveForGoogle: () => {} });
  draw(provider);
  await press('Continue as ana@example.com');
  await press('Use a different account');
  expect(provider.calls.google).toEqual([
    { callbackPath: GOOGLE_CALLBACK_PATH, account: 'ana@example.com' },
    { callbackPath: GOOGLE_CALLBACK_PATH, account: null },
  ]);
});

test('after a sign-in and sign-out on the page, the sign-in screen offers the account just used', async () => {
  draw(standInSignIn());
  expect(screen.queryByRole('button', { name: /Continue as/ })).toBeNull();
  await press('Email code');
  await press('Sign out');
  expect(screen.getByRole('button', { name: 'Continue as ana@example.com' })).toBeTruthy();
});

test('an account named outright goes to Google as it is, for a choice made in another window', () => {
  expect(accountFor({ account: 'bo@example.com' }, 'ana@example.com')).toBe('bo@example.com');
  expect(accountFor('remembered', 'ana@example.com')).toBe('ana@example.com');
  expect(accountFor('remembered', null)).toBeNull();
  expect(accountFor('choose', 'ana@example.com')).toBeNull();
});

test('back from Google, the sign-in finishes in the page and lands on the address the trip started from', async () => {
  const store = sessionStorage;
  window.history.replaceState(null, '', '/week?category=work');
  const leaving = standInSignIn({ store, leaveForGoogle: () => {} });
  const first = draw(leaving);
  await press('Use a different account');
  first.unmount();

  // The page Google sends the browser back to.
  window.history.replaceState(null, '', GOOGLE_CALLBACK_PATH);
  draw(standInSignIn({ store }));
  await waitFor(() => expect(heading()).toBe('The app at /week?category=work'));
  expect(window.location.pathname).toBe('/week');
});

test('back from Google without a sign-in, the sign-in screen says so at the address the trip started from', async () => {
  window.history.replaceState(null, '', '/week');
  sessionStorage.setItem('web-client-kit.returnTo', '/week');
  window.history.replaceState(null, '', GOOGLE_CALLBACK_PATH);
  draw(standInSignIn({ store: sessionStorage }));
  await waitFor(() => expect(heading()).toBe('Sign in'));
  expect(screen.getByRole('alert').textContent).toBe(GOOGLE_UNFINISHED);
  expect(window.location.pathname).toBe('/week');
});

test('after a sign-in, the placeholder stays until the app has drawn its first data, so no empty screen shows', async () => {
  function Loading() {
    const [loaded, setLoaded] = useState(false);
    return (
      <>
        <button onClick={() => setLoaded(true)}>Data arrives</button>
        {loaded && <App />}
      </>
    );
  }
  draw(standInSignIn(), <Loading />, true);
  await press('Email code');
  expect(screen.getByRole('progressbar')).toBeTruthy();
  await press('Data arrives');
  expect(screen.queryByRole('progressbar')).toBeNull();
});

test('a browser that was signed in last time draws what the app asks while the provider loads', () => {
  rememberSignedIn(true);
  const provider = standInSignIn({ loaded: false, person: { id: 'p1', email: null } });
  render(
    <SignInGate provider={provider} placeholder={<div role="progressbar" />} whileReturning={<div role="banner" />} signedOut={<SignInScreen />}>
      <App />
    </SignInGate>,
  );
  expect(screen.getByRole('banner')).toBeTruthy();
  act(() => provider.finishLoading());
  expect(heading()).toBe('The app at /');
});

test('outside the gate there is no Sign out, so the app draws none', () => {
  function Bar() {
    return <p>{useSignOut() ? 'Sign out' : 'no sign-in here'}</p>;
  }
  render(<Bar />);
  expect(screen.getByText('no sign-in here')).toBeTruthy();
});
