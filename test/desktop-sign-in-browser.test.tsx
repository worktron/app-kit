import { afterEach, beforeEach, expect, jest, setSystemTime, test } from 'bun:test';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { ASK_TAKEN_EVERY_MS, backLink, desktopSignInRequest, startGoogleHere, useDesktopSignInBrowserPage } from '../tauri/sign-in';
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
/** The page as the iPhone's sheet opens it when it waits for the hand-back over https. */
const OVER_HTTPS = `${PAGE}&back=https`;

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const MAC_FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:157.0) Gecko/20100101 Firefox/157.0';
const realNavigator = { userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints };

/** The browser the page runs in, as it reads it: its user agent, its touch points, and Chromium's userAgentData. */
function inBrowser(userAgent: string, maxTouchPoints: number, userAgentData = false) {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => userAgent });
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => maxTouchPoints });
  if (userAgentData) Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: { brands: [] } });
  else delete (navigator as { userAgentData?: unknown }).userAgentData;
}

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
  inBrowser(realNavigator.userAgent, realNavigator.maxTouchPoints);
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

/** The code the address the page went to over https carries, after its `#`. */
const codeInBackLink = () => new URLSearchParams(new URL(window.location.href).hash.slice(1)).get('ticket');

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

test("in the iPhone's sheet waiting over https, signed in as the account asked, the page hands over with no click, by going to its own site's address", async () => {
  inBrowser(IPHONE, 5);
  goTo(OVER_HTTPS);
  const { sent } = serveDesktopSignIn(() => 'ana@example.com');
  const pushed: unknown[] = [];
  const realPush = window.history.pushState;
  window.history.pushState = (...args: Parameters<History['pushState']>) => void pushed.push(args);
  try {
    draw(standInSignIn({ person: { id: 'p1', email: 'ana@example.com' } }));
    await waitFor(() => expect(heading()).toBe('sent'));
  } finally {
    window.history.pushState = realPush;
  }
  const code = codeInBackLink()!;
  expect(code).toMatch(/^[0-9a-f]{64}$/);
  expect(window.location.href).toBe(`http://localhost:5173/desktop-sign-in/back#${new URLSearchParams({ ticket: code, nonce: NONCE })}`);
  expect(backLink(code, NONCE)).toBe(window.location.href);
  // A page load, which the sheet catches, never a change of history alone, which it never sees.
  expect(pushed).toEqual([]);
  expect(sent[0]).toEqual({ path: '/api/desktop-sign-in/code', authorization: 'Bearer stand-in-token-0', body: { fingerprint: NONCE } });
});

test('in any browser but an iPhone\'s, a page asked for the hand-back over https still waits for the click, and then opens the app\'s link', async () => {
  // A program on a Mac could open the page asking for it, and read the code from the browser's history.
  for (const [agent, touch, userAgentData] of [
    [MAC_SAFARI, 0, false],
    [MAC_FIREFOX, 0, false],
    // Chrome or Edge made to look like an iPhone, as its device mode does, still has userAgentData.
    [IPHONE, 5, true],
    // An iPhone's user agent with no touch is a desktop browser pretending.
    [IPHONE, 0, false],
  ] as const) {
    cleanup();
    inBrowser(agent, touch, userAgentData);
    goTo(OVER_HTTPS);
    const { sent } = serveDesktopSignIn(() => 'ana@example.com');
    draw(standInSignIn({ person: { id: 'p1', email: 'ana@example.com' } }));
    await waitFor(() => expect(heading()).toBe('ready'));
    expect(desktopSignInRequest()?.overHttps).toBe(false);
    expect(sent).toEqual([]);
    await click();
    await waitFor(() => expect(heading()).toBe('sent'));
    expect(window.location.href).toStartWith('example-app://sign-in?');
  }
});

test("in the iPhone's sheet waiting over https, signed in as another account, the page still signs out first and makes no code", async () => {
  inBrowser(IPHONE, 5);
  goTo(OVER_HTTPS);
  const { sent } = serveDesktopSignIn(() => 'bo@example.com');
  const leaving = standInSignIn({ person: { id: 'p2', email: 'bo@example.com' }, store: sessionStorage, leaveForGoogle: () => {} });
  draw(leaving);
  await waitFor(() => expect(heading()).toBe('Sign in'));
  expect(leaving.calls.signOut).toBe(1);
  expect(leaving.calls.google).toEqual([{ callbackPath: GOOGLE_CALLBACK_PATH, account: 'ana@example.com' }]);
  expect(sent).toEqual([]);
});

test("an iPad's sheet, whose browser names a Mac, is told by touch and hands over over https too", async () => {
  inBrowser(MAC_SAFARI, 5);
  goTo(OVER_HTTPS);
  serveDesktopSignIn(() => 'ana@example.com');
  draw(standInSignIn({ person: { id: 'p1', email: 'ana@example.com' } }));
  await waitFor(() => expect(heading()).toBe('sent'));
  expect(codeInBackLink()).toMatch(/^[0-9a-f]{64}$/);
});

test('a page closed once its link is out asks the server nothing more', async () => {
  // Over https the page stays on its own site, where it can still ask; a page left on the app's link cannot.
  inBrowser(IPHONE, 5);
  goTo(OVER_HTTPS);
  const { sent } = serveDesktopSignIn(() => 'ana@example.com');
  const served = globalThis.fetch;
  let answered = 0;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    const answer = await served(...args);
    if (String(args[0]).endsWith('/status')) answered++;
    return answer;
  }) as typeof fetch;
  jest.useFakeTimers();
  try {
    const page = draw(standInSignIn({ person: { id: 'p1', email: 'ana@example.com' } }));
    // The server has answered the first ask, so the page has its next one waiting on the clock.
    for (let i = 0; i < 100 && answered === 0; i++) await act(async () => {});
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect(answered).toBe(1);
    page.unmount();
    const asked = sent.length;
    act(() => jest.advanceTimersByTime(ASK_TAKEN_EVERY_MS * 3));
    await act(async () => {});
    expect(sent).toHaveLength(asked);
  } finally {
    jest.useRealTimers();
  }
});
