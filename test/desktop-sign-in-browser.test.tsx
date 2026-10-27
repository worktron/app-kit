import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { desktopSignInRequest, startGoogleHere, useDesktopSignInBrowserPage } from '../tauri/sign-in';
import { GOOGLE_CALLBACK_PATH, SignInGate, useSignIn } from '../web/sign-in/SignInGate';
import { standInSignIn, type StandInSignIn } from '../authentication/stand-in';
import { fingerprint, randomHex } from '../tauri/sign-in/fingerprint';
import { serveDesktopSignIn } from './desktop-sign-in-server';

const realFetch = globalThis.fetch;
const realClose = window.close;
let closed = 0;

/** happy-dom moves to whatever address the page sets, the app's own link included; each test starts back on the site. */
const goTo = (address: string) => (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`http://localhost:5173${address}`);

const NONCE = fingerprint(randomHex());
const PAGE = `/desktop-sign-in?nonce=${NONCE}&account=ana%40example.com`;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  goTo('/');
  closed = 0;
  window.close = () => void closed++;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  window.close = realClose;
  setSystemTime();
});

/** The app's signed-out sign-in screen on the browser page: straight to Google for the account the window asked for. */
function SignInScreen() {
  const signIn = useSignIn();
  useEffect(() => {
    const asked = desktopSignInRequest();
    if (asked && startGoogleHere()) void signIn.google(asked.account ?? 'choose');
  }, [signIn]);
  return <h1>Sign in</h1>;
}

/** The browser page once signed in, drawing only what the hook says. */
function HandOver({ provider }: { provider: StandInSignIn }) {
  const session = provider.useSession();
  const page = useDesktopSignInBrowserPage({ session, scheme: 'example-app' });
  return (
    <main>
      <h1>{page.state}</h1>
      {page.state === 'ready' && <button onClick={page.handOver}>Sign in to the app</button>}
      <button onClick={page.again}>Open the app again</button>
    </main>
  );
}

function draw(provider: StandInSignIn) {
  return render(
    <SignInGate provider={provider} placeholder={<div role="progressbar" />} signedOut={<SignInScreen />}>
      <HandOver provider={provider} />
    </SignInGate>,
  );
}

const heading = () => screen.getByRole('heading').textContent;

/** The person's click on the ready page. */
async function click() {
  await waitFor(() => expect(heading()).toBe('ready'));
  await act(async () => screen.getByRole('button', { name: 'Sign in to the app' }).click());
}

/** The code the link the page opened carries, in the field installed shells call `ticket`. */
const codeInLink = () => new URL(window.location.href).searchParams.get('ticket');

test('signed out, the page goes to Google once for the account the window asked for, and Back from Google stays on it', async () => {
  goTo(PAGE);
  const provider = standInSignIn({ leaveForGoogle: () => {} });
  const first = draw(provider);
  expect(provider.calls.google).toEqual([{ callbackPath: GOOGLE_CALLBACK_PATH, account: 'ana@example.com' }]);
  first.unmount();

  // Back from Google's page, the same tab draws the page again.
  draw(provider);
  expect(heading()).toBe('Sign in');
  expect(provider.calls.google).toHaveLength(1);
});

test('signed in as the account asked, the page waits for the click, hands the app a code for its fingerprint, then closes once the app has taken it', async () => {
  goTo(PAGE);
  const { sent } = serveDesktopSignIn(() => 'ana@example.com');
  draw(standInSignIn({ person: { id: 'p1', email: 'Ana@example.com' } }));
  await click();
  await waitFor(() => expect(heading()).toBe('sent'));
  const code = codeInLink()!;
  expect(code).toMatch(/^[0-9a-f]{64}$/);
  expect(window.location.href).toBe(`example-app://sign-in?${new URLSearchParams({ ticket: code, nonce: NONCE })}`);
  expect(sent[0]).toEqual({ path: '/api/desktop-sign-in/code', authorization: 'Bearer stand-in-token-0', body: { fingerprint: NONCE } });

  // The app's window, signed in with it, tells the server.
  goTo(PAGE);
  await act(async () => void (await fetch('/api/desktop-sign-in/taken', { method: 'POST', body: JSON.stringify({ code }) })));
  await waitFor(() => expect(heading()).toBe('taken'));
  expect(closed).toBe(1);
});

test('signed in as another account, the page signs out, goes to Google once for the one asked, and hands over whoever comes back', async () => {
  goTo(PAGE);
  const store = sessionStorage;
  const leaving = standInSignIn({ person: { id: 'p2', email: 'bo@example.com' }, store, leaveForGoogle: () => {} });
  const first = draw(leaving);
  await waitFor(() => expect(heading()).toBe('Sign in'));
  expect(leaving.calls.signOut).toBe(1);
  expect(leaving.calls.google).toEqual([{ callbackPath: GOOGLE_CALLBACK_PATH, account: 'ana@example.com' }]);
  first.unmount();

  // Google comes back with an account picked there, other than the one asked: it is the person's choice, so it goes over.
  store.setItem('stand-in.google', 'bo@example.com');
  goTo(GOOGLE_CALLBACK_PATH);
  serveDesktopSignIn(() => 'bo@example.com');
  const back = standInSignIn({ store });
  draw(back);
  await click();
  await waitFor(() => expect(heading()).toBe('sent'));
  expect(back.calls.signOut).toBe(0);
  expect(codeInLink()).toMatch(/^[0-9a-f]{64}$/);
});

test("asked for Google's list, as by Use a different account, a signed-in page signs out and goes to Google's list", async () => {
  goTo(`/desktop-sign-in?nonce=${NONCE}&account=choose`);
  const { sent } = serveDesktopSignIn(() => 'ana@example.com');
  const provider = standInSignIn({ person: { id: 'p1', email: 'ana@example.com' }, leaveForGoogle: () => {} });
  draw(provider);
  await waitFor(() => expect(heading()).toBe('Sign in'));
  expect(provider.calls.signOut).toBe(1);
  expect(provider.calls.google).toEqual([{ callbackPath: GOOGLE_CALLBACK_PATH, account: null }]);
  expect(sent).toEqual([]);
});

test('asked for no account in particular, a signed-in page hands over whoever it is signed in as', async () => {
  goTo(`/desktop-sign-in?nonce=${NONCE}`);
  serveDesktopSignIn(() => 'bo@example.com');
  const provider = standInSignIn({ person: { id: 'p2', email: 'bo@example.com' } });
  draw(provider);
  await click();
  await waitFor(() => expect(heading()).toBe('sent'));
  expect(provider.calls.signOut).toBe(0);
});

test('a sign-out that fails, as on a network failure, says so, and Open the app again tries it again', async () => {
  goTo(PAGE);
  serveDesktopSignIn(() => 'bo@example.com');
  const provider = standInSignIn({ person: { id: 'p2', email: 'bo@example.com' }, leaveForGoogle: () => {} });
  let refuse = true;
  const failing: StandInSignIn = {
    ...provider,
    useSession: () => {
      const session = provider.useSession();
      return { ...session, signOut: () => (refuse ? Promise.reject(new Error('offline')) : session.signOut()) };
    },
  };
  draw(failing);
  await waitFor(() => expect(heading()).toBe('failed'));
  refuse = false;
  await act(async () => screen.getByRole('button', { name: 'Open the app again' }).click());
  await waitFor(() => expect(heading()).toBe('Sign in'));
  expect(provider.calls.google).toEqual([{ callbackPath: GOOGLE_CALLBACK_PATH, account: 'ana@example.com' }]);
});

test("signed in as the account asked, whose email the provider has not loaded yet, the page waits for it rather than signing out", async () => {
  goTo(PAGE);
  serveDesktopSignIn(() => 'ana@example.com');
  const provider = standInSignIn({ person: { id: 'p1', email: null } });
  draw(provider);
  await act(async () => {});
  expect(heading()).toBe('asking');
  act(() => provider.signInAs({ id: 'p1', email: 'ana@example.com' }));
  await waitFor(() => expect(heading()).toBe('ready'));
  expect(provider.calls.signOut).toBe(0);
});

test('a page the window did not open, with no nonce, hands nothing over', async () => {
  goTo('/desktop-sign-in?account=ana%40example.com');
  const { sent } = serveDesktopSignIn(() => 'ana@example.com');
  draw(standInSignIn({ person: { id: 'p1', email: 'ana@example.com' } }));
  expect(heading()).toBe('not-from-app');
  expect(sent).toEqual([]);
});

test('a code the server would not make says so, and Open the app again asks once more', async () => {
  goTo(PAGE);
  let signedIn: string | null = null;
  serveDesktopSignIn(() => signedIn);
  draw(standInSignIn({ person: { id: 'p1', email: 'ana@example.com' } }));
  await click();
  await waitFor(() => expect(heading()).toBe('failed'));
  signedIn = 'ana@example.com';
  await act(async () => screen.getByRole('button', { name: 'Open the app again' }).click());
  await waitFor(() => expect(heading()).toBe('sent'));
});

test('an app that never takes the code leaves the page saying so once its link has expired', async () => {
  goTo(PAGE);
  serveDesktopSignIn(() => 'ana@example.com');
  draw(standInSignIn({ person: { id: 'p1', email: 'ana@example.com' } }));
  await click();
  await waitFor(() => expect(heading()).toBe('sent'));
  goTo(PAGE);
  setSystemTime(new Date(Date.now() + 91_000));
  await waitFor(() => expect(heading()).toBe('expired'));
  expect(closed).toBe(0);
});

test('a forged address, signed in, makes no code and opens no link until the person clicks', async () => {
  // Any app can open the page with the fingerprint of a secret it keeps: nothing in the address tells the window from it.
  const forged = fingerprint(randomHex());
  goTo(`/desktop-sign-in?nonce=${forged}`);
  const { sent } = serveDesktopSignIn(() => 'ana@example.com');
  const provider = standInSignIn({ person: { id: 'p1', email: 'ana@example.com' } });
  draw(provider);
  await waitFor(() => expect(heading()).toBe('ready'));
  // Signed in with the provider's token loaded, a later render still hands nothing over by itself.
  act(() => provider.signInAs({ id: 'p1', email: 'ana@example.com' }));
  await act(async () => {});
  expect(heading()).toBe('ready');
  expect(sent).toEqual([]);
  expect(window.location.pathname).toBe('/desktop-sign-in');
});

test("in another site's frame, the page never offers to hand over, and goes to Google for nobody", async () => {
  goTo(PAGE);
  const { sent } = serveDesktopSignIn(() => 'ana@example.com');
  const top = Object.getOwnPropertyDescriptor(window, 'top');
  Object.defineProperty(window, 'top', { configurable: true, get: () => ({}) });
  try {
    draw(standInSignIn({ person: { id: 'p1', email: 'ana@example.com' } }));
    expect(heading()).toBe('not-from-app');
    expect(desktopSignInRequest()).toBeNull();
    await act(async () => screen.getByRole('button', { name: 'Open the app again' }).click());
    expect(heading()).toBe('not-from-app');
    expect(startGoogleHere()).toBe(false);
    expect(sent).toEqual([]);
  } finally {
    if (top) Object.defineProperty(window, 'top', top);
    else delete (window as { top?: unknown }).top;
  }
});
