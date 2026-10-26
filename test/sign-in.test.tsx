import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { request } from '../web/fetch';
import { resetConnection } from '../web/connection';
import { accountFor, GOOGLE_CALLBACK_PATH, GOOGLE_UNFINISHED, SESSION_ENDED, SignInGate, useAppDrawn, usePerson, useSignIn, useSignOut } from '../web/sign-in/SignInGate';
import { lastAccount, rememberAccount, rememberSignedIn } from '../web/sign-in/remembered';
import { STAND_IN_CODE, standInSignIn, type StandInSignIn } from '../authentication/stand-in';
import { noAccountFor } from '../web/sign-in/provider';

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

test('a request refused after the sign-out it caused leaves the sign-in screen up', async () => {
  globalThis.fetch = mock(async () => new Response('', { status: 401 })) as unknown as typeof fetch;
  draw(standInSignIn({ person: { id: 'p1', email: 'ana@example.com' } }));
  await press('Load tasks');
  await waitFor(() => expect(heading()).toBe('Sign in'));
  // A second request that was in flight comes back refused once the person is already signed out.
  await act(async () => void (await request('/api/events').catch(() => undefined)));
  expect(heading()).toBe('Sign in');
  expect(screen.queryByRole('progressbar')).toBeNull();
});

test("the app's first request, made from its own effect, carries the session's token", async () => {
  const sent: (string | null)[] = [];
  globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
    sent.push(new Headers(init?.headers).get('Authorization'));
    return new Response('[]');
  }) as unknown as typeof fetch;
  function LoadsAtOnce() {
    useEffect(() => void request('/api/tasks'), []);
    return <h1>The app</h1>;
  }
  draw(standInSignIn({ person: { id: 'p1', email: 'ana@example.com' } }), <LoadsAtOnce />);
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]).toStartWith('Bearer ');
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
  sessionStorage.setItem('app-kit.returnTo', '/week');
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
  // The app is there, so its requests go out, but none of it shows beside the placeholder.
  expect(screen.queryByRole('button', { name: 'Data arrives' })).toBeNull();
  await act(async () => screen.getByText('Data arrives').click());
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getByRole('heading').textContent).toStartWith('The app at');
});

test('a browser signed in last time keeps what it drew while loading, and nothing of the app, until the first data is drawn', async () => {
  rememberSignedIn(true);
  function Loading() {
    const [loaded, setLoaded] = useState(false);
    return (
      <>
        <h1>The bar alone</h1>
        <button onClick={() => setLoaded(true)}>Data arrives</button>
        {loaded && <App />}
      </>
    );
  }
  draw(standInSignIn({ person: { id: 'p1', email: 'ana@example.com' } }), <Loading />, true);
  expect(screen.queryByRole('heading')).toBeNull();
  expect(screen.getByRole('progressbar')).toBeTruthy();
  await act(async () => screen.getByText('Data arrives').click());
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['The bar alone', 'The app at /']);
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

describe('sign-up by emailed code', () => {
  const NEW = 'new@example.com';

  /** A sign-in screen that sends the code to an address with no account, then checks it. */
  function NewAddressScreen() {
    const signIn = useSignIn();
    const [message, setMessage] = useState<string>();
    return (
      <main>
        <h1>Sign in</h1>
        {message && <p role="alert">{message}</p>}
        <button
          onClick={async () => {
            const sent = await signIn.sendEmailCode(NEW);
            if (!sent.ok) return setMessage(sent.message);
            const checked = await signIn.checkEmailCode(STAND_IN_CODE, NEW);
            if (!checked.ok) setMessage(checked.message);
          }}
        >
          Email code
        </button>
      </main>
    );
  }

  function drawWith(provider: StandInSignIn, signUp: boolean) {
    return render(
      <SignInGate provider={provider} placeholder={<div role="progressbar" />} signedOut={<NewAddressScreen />} signUp={signUp}>
        <App />
      </SignInGate>,
    );
  }

  test("with the gate's sign-up on, an address with no account gets a code that makes the account and signs in", async () => {
    const provider = standInSignIn({ accounts: ['ana@example.com'] });
    drawWith(provider, true);
    await press('Email code');
    expect(heading()).toBe('The app at /');
    expect(provider.calls.signUps).toEqual([NEW]);
  });

  test('with it off, the address is told it has no account and nothing is made', async () => {
    const provider = standInSignIn({ accounts: ['ana@example.com'] });
    drawWith(provider, false);
    await press('Email code');
    expect(screen.getByRole('alert').textContent).toBe(noAccountFor(NEW));
    expect(provider.calls.signUps).toEqual([]);
  });

  test('the stand-in makes the account only when the code is checked, and a later send without sign-up does not', async () => {
    const provider = standInSignIn({ accounts: [] });
    let current: ReturnType<StandInSignIn['useSession']> | null = null;
    function Read() {
      current = provider.useSession();
      return null;
    }
    render(<Read />);
    expect(await current!.sendEmailCode(NEW, { signUp: true })).toEqual({ ok: true });
    expect(provider.calls.signUps).toEqual([]);
    // Abandoned: a send without sign-up drops the sign-up it had started.
    expect(await current!.sendEmailCode(NEW)).toEqual({ ok: false, message: noAccountFor(NEW) });
    expect(await current!.checkEmailCode(STAND_IN_CODE, NEW)).toEqual({ ok: false, message: noAccountFor(NEW) });
    expect(provider.calls.signUps).toEqual([]);
  });
});

test('with no provider, the gate draws the app with no sign-in, no sign-out and nobody signed in', () => {
  let person: unknown = 'unread';
  let signOut: unknown = 'unread';
  function Who() {
    person = usePerson();
    signOut = useSignOut();
    return null;
  }
  render(
    <SignInGate provider={null} placeholder={<div role="progressbar" />} signedOut={<SignInScreen />}>
      <App />
      <Who />
    </SignInGate>,
  );
  expect(heading()).toBe('The app at /');
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(person).toBeNull();
  expect(signOut).toBeNull();
});
