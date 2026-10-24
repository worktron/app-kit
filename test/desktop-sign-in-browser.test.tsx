import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { desktopSignInRequest, startGoogleHere, useDesktopSignInBrowserPage } from '../desktop-sign-in';
import { GOOGLE_CALLBACK_PATH, SignInGate, useSignIn } from '../src/sign-in/SignInGate';
import { standInSignIn, standInTicket, type StandInSignIn } from '../testing';
import { serveDesktopSignIn } from './desktop-sign-in-server';

const realFetch = globalThis.fetch;
const realClose = window.close;
let closed = 0;

/** happy-dom moves to whatever address the page sets, the app's own link included; each test starts back on the site. */
const goTo = (address: string) => (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`http://localhost:5173${address}`);

const NONCE = '0b6e2f5c-8d1a-4c3e-9f70-2a4b6c8d0e1f';
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
    if (asked && startGoogleHere()) void signIn.google(asked.account ? { account: asked.account } : 'choose');
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

test('signed in as the account asked, the page hands it to the app with the nonce, then closes once the app has taken it', async () => {
  goTo(PAGE);
  const { sent } = serveDesktopSignIn(() => 'ana@example.com');
  draw(standInSignIn({ person: { id: 'p1', email: 'Ana@example.com' } }));
  await waitFor(() => expect(heading()).toBe('sent'));
  const ticket = standInTicket('ana@example.com');
  expect(window.location.href).toBe(`example-app://sign-in?${new URLSearchParams({ ticket, nonce: NONCE })}`);
  expect(sent[0]).toEqual({ path: '/api/desktop-sign-in/ticket', authorization: 'Bearer stand-in-token-0', body: {} });

  // The app's window, signed in with it, tells the server.
  goTo(PAGE);
  await act(async () => void (await fetch('/api/desktop-sign-in/taken', { method: 'POST', body: JSON.stringify({ ticket }) })));
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
  await waitFor(() => expect(heading()).toBe('sent'));
  expect(back.calls.signOut).toBe(0);
  expect(new URLSearchParams(window.location.href.split('?')[1]).get('ticket')).toBe(standInTicket('bo@example.com'));
});

test('a page the window did not open, with no nonce, hands nothing over', async () => {
  goTo('/desktop-sign-in?account=ana%40example.com');
  const { sent } = serveDesktopSignIn(() => 'ana@example.com');
  draw(standInSignIn({ person: { id: 'p1', email: 'ana@example.com' } }));
  expect(heading()).toBe('not-from-app');
  expect(sent).toEqual([]);
});

test('a ticket the server would not make says so, and Open the app again asks once more', async () => {
  goTo(PAGE);
  let signedIn: string | null = null;
  serveDesktopSignIn(() => signedIn);
  draw(standInSignIn({ person: { id: 'p1', email: 'ana@example.com' } }));
  await waitFor(() => expect(heading()).toBe('failed'));
  signedIn = 'ana@example.com';
  await act(async () => screen.getByRole('button', { name: 'Open the app again' }).click());
  await waitFor(() => expect(heading()).toBe('sent'));
});

test('an app that never takes the ticket leaves the page saying so once its link has expired', async () => {
  goTo(PAGE);
  serveDesktopSignIn(() => 'ana@example.com');
  draw(standInSignIn({ person: { id: 'p1', email: 'ana@example.com' } }));
  await waitFor(() => expect(heading()).toBe('sent'));
  goTo(PAGE);
  setSystemTime(new Date(Date.now() + 91_000));
  await waitFor(() => expect(heading()).toBe('expired'));
  expect(closed).toBe(0);
});
