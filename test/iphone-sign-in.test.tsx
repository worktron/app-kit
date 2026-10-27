import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { signInInSheet as openSheet, type Invoke, type SheetSignInOptions } from '../tauri/iphone-sign-in';
import { appLink, backLink, desktopSignInAddress, listenForDesktopSignIn, resetDesktopSignIn, useDesktopSignInWindow, type DesktopSignInAccount } from '../tauri/sign-in';
import { standInSignIn, standInTicket, type StandInSignIn } from '../authentication/stand-in';
import { serveDesktopSignIn } from './desktop-sign-in-server';

const SCHEME = 'com.example.app';
const realFetch = globalThis.fetch;
const realConsole = { log: console.log, warn: console.warn };
let lines: string[] = [];

beforeEach(() => {
  sessionStorage.clear();
  resetDesktopSignIn();
  listenForDesktopSignIn();
  lines = [];
  console.log = console.warn = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  Object.assign(console, realConsole);
});

/** The app's window, drawing only what the desktop sign-in says. */
function Window({ provider }: { provider: StandInSignIn }) {
  const session = provider.useSession();
  useDesktopSignInWindow(session);
  return <h1>{session.person ? `Signed in as ${session.person.email}` : 'Signed out'}</h1>;
}

/** Apple's sheet, as the plugin answers: what `close` makes of the page it was asked to open, and every call made. */
function sheet(close: (asked: URL) => unknown) {
  const calls: { command: string; args?: Record<string, unknown> }[] = [];
  const invoke: Invoke = async (command, args) => {
    calls.push({ command, args });
    const { url } = (args as { payload: { url: string } }).payload;
    return close(new URL(url));
  };
  return { invoke, calls };
}

const nonceOf = (asked: URL) => asked.searchParams.get('nonce')!;

/** The page call, with the window's updates inside act. */
async function signInInSheet(address: string, options: SheetSignInOptions) {
  let handed!: boolean;
  await act(async () => {
    handed = await openSheet(address, options);
  });
  return handed;
}

test('the sheet opens the browser page, and the sign-in link it closes on signs the window in where it is', async () => {
  const { codeFor } = serveDesktopSignIn(() => 'ana@example.com');
  const provider = standInSignIn();
  render(<Window provider={provider} />);
  const address = desktopSignInAddress({ account: 'ana@example.com' });
  const code = await codeFor(nonceOf(new URL(address)));
  const s = sheet((asked) => ({ callbackUrl: appLink(SCHEME, code, nonceOf(asked)) }));
  expect(await signInInSheet(address, { scheme: SCHEME, invoke: s.invoke })).toBe(true);
  expect(s.calls).toEqual([{ command: 'plugin:web-auth|authenticate', args: { payload: { url: address, callbackScheme: SCHEME } } }]);
  await waitFor(() => expect(screen.getByRole('heading').textContent).toBe('Signed in as ana@example.com'));
  expect(lines).toContain('[iphone-sign-in] sheet returned a sign-in link: handed to the window');
});

test('a scheme with capitals still matches its link, which iOS hands back in any case', async () => {
  const { codeFor } = serveDesktopSignIn(() => 'ana@example.com');
  const provider = standInSignIn();
  render(<Window provider={provider} />);
  const address = desktopSignInAddress(null);
  const code = await codeFor(nonceOf(new URL(address)));
  const s = sheet((asked) => ({ callbackUrl: appLink('com.example.myapp', code, nonceOf(asked)) }));
  expect(await signInInSheet(address, { scheme: 'com.example.MyApp', invoke: s.invoke })).toBe(true);
  await waitFor(() => expect(screen.getByRole('heading').textContent).toBe('Signed in as ana@example.com'));
});

test('a link that is not this app’s sign-in hands nothing over, and says so', async () => {
  const provider = standInSignIn();
  render(<Window provider={provider} />);
  const ticket = standInTicket('mallory@example.com');
  for (const make of [
    (nonce: string) => appLink('other.example.app', ticket, nonce),
    (nonce: string) => `${SCHEME}://elsewhere?${new URLSearchParams({ ticket, nonce })}`,
    () => `${SCHEME}://sign-in?ticket=${ticket}`,
    (nonce: string) => `${SCHEME}://sign-in?nonce=${nonce}`,
    (nonce: string) => `${SCHEME}://sign-in?ticket=&nonce=${nonce}`,
    (nonce: string) => `https://evil.example.com/sign-in?${new URLSearchParams({ ticket, nonce })}`,
    () => '',
  ]) {
    lines = [];
    const s = sheet((asked) => ({ callbackUrl: make(nonceOf(asked)) }));
    expect(await signInInSheet(desktopSignInAddress(null), { scheme: SCHEME, invoke: s.invoke })).toBe(false);
    expect(lines).toEqual(["[iphone-sign-in] sheet returned a link that is not this app's sign-in: nothing handed over"]);
  }
  for (const answer of [null, {}, { callbackUrl: 3 }]) {
    expect(await signInInSheet(desktopSignInAddress(null), { scheme: SCHEME, invoke: sheet(() => answer).invoke })).toBe(false);
  }
  expect(provider.calls.tickets).toEqual([]);
  expect(screen.getByRole('heading').textContent).toBe('Signed out');
});

test('a sheet closed without signing in, or one that fails, hands nothing over, and says so', async () => {
  const provider = standInSignIn();
  render(<Window provider={provider} />);
  const s = sheet(() => {
    throw new Error('The operation couldn’t be completed. (com.apple.AuthenticationServices.WebAuthenticationSession error 1.)');
  });
  expect(await signInInSheet(desktopSignInAddress(null), { scheme: SCHEME, invoke: s.invoke })).toBe(false);
  expect(lines[0]).toStartWith('[iphone-sign-in] sheet closed without signing in Error: The operation');
  expect(provider.calls.tickets).toEqual([]);
});

const SITE = 'https://app.example.com';

/** The browser page's address on the hosted site, as `desktopSignInAddress` writes it there. */
const hostedAddress = (account: DesktopSignInAccount) => desktopSignInAddress(account).replace(window.location.origin, SITE);

test('asked to hand back over https, the sheet waits for the page’s own site, and the address it closes on signs the window in', async () => {
  const { codeFor } = serveDesktopSignIn(() => 'ana@example.com');
  const provider = standInSignIn();
  render(<Window provider={provider} />);
  const address = hostedAddress({ account: 'ana@example.com' });
  const code = await codeFor(nonceOf(new URL(address)));
  const s = sheet((asked) => ({ callbackUrl: backLink(code, nonceOf(asked), SITE) }));
  expect(await signInInSheet(address, { scheme: SCHEME, handBackOverHttps: true, invoke: s.invoke })).toBe(true);
  expect(s.calls).toEqual([
    {
      command: 'plugin:web-auth|authenticate',
      args: { payload: { url: address, callbackScheme: SCHEME, callbackHost: 'app.example.com', callbackPath: '/desktop-sign-in/back' } },
    },
  ]);
  await waitFor(() => expect(screen.getByRole('heading').textContent).toBe('Signed in as ana@example.com'));
});

test('asked to hand back over https, the app’s link still signs in, as from a plugin before it or a hand-back iOS refused', async () => {
  const { codeFor } = serveDesktopSignIn(() => 'ana@example.com');
  const provider = standInSignIn();
  render(<Window provider={provider} />);
  const address = hostedAddress(null);
  const code = await codeFor(nonceOf(new URL(address)));
  const s = sheet((asked) => ({ callbackUrl: appLink(SCHEME, code, nonceOf(asked)) }));
  expect(await signInInSheet(address, { scheme: SCHEME, handBackOverHttps: true, invoke: s.invoke })).toBe(true);
  await waitFor(() => expect(screen.getByRole('heading').textContent).toBe('Signed in as ana@example.com'));
});

test('over https, only the page’s own hand-back address exactly is taken, though iOS matches more loosely', async () => {
  const provider = standInSignIn();
  render(<Window provider={provider} />);
  const ticket = standInTicket('mallory@example.com');
  const fields = (nonce: string) => new URLSearchParams({ ticket, nonce });
  for (const make of [
    (nonce: string) => `http://app.example.com/desktop-sign-in/back#${fields(nonce)}`,
    (nonce: string) => `https://app.example.com:8443/desktop-sign-in/back#${fields(nonce)}`,
    (nonce: string) => `https://app.example.com/desktop-sign-in/back/#${fields(nonce)}`,
    (nonce: string) => `https://app.example.com/Desktop-Sign-In/back#${fields(nonce)}`,
    (nonce: string) => `https://app.example.com/desktop-sign-in/%62ack#${fields(nonce)}`,
    (nonce: string) => Object.assign(new URL(`https://app.example.com/desktop-sign-in/back#${fields(nonce)}`), { username: 'someone' }).href,
    (nonce: string) => `https://evil.example.com/desktop-sign-in/back#${fields(nonce)}`,
    (nonce: string) => `https://app.example.com/desktop-sign-in/back?x=1#${fields(nonce)}`,
    (nonce: string) => `https://app.example.com/desktop-sign-in/back?${fields(nonce)}`,
    (nonce: string) => `https://app.example.com/desktop-sign-in/back#nonce=${nonce}`,
  ]) {
    lines = [];
    const s = sheet((asked) => ({ callbackUrl: make(nonceOf(asked)) }));
    expect(await signInInSheet(hostedAddress(null), { scheme: SCHEME, handBackOverHttps: true, invoke: s.invoke })).toBe(false);
    expect(lines).toEqual(["[iphone-sign-in] sheet returned a link that is not this app's sign-in: nothing handed over"]);
  }
  expect(provider.calls.tickets).toEqual([]);
});

test('not asked to hand back over https, or on a page that is not https, the sheet waits for the app’s link alone', async () => {
  const provider = standInSignIn();
  render(<Window provider={provider} />);
  const ticket = standInTicket('mallory@example.com');
  for (const [address, handBackOverHttps] of [
    [hostedAddress(null), false],
    [desktopSignInAddress(null).replace(window.location.origin, 'http://app.example.com'), true],
  ] as const) {
    const s = sheet((asked) => ({ callbackUrl: backLink(ticket, nonceOf(asked), new URL(address).origin) }));
    expect(await signInInSheet(address, { scheme: SCHEME, handBackOverHttps, invoke: s.invoke })).toBe(false);
    expect(s.calls[0]?.args).toEqual({ payload: { url: address, callbackScheme: SCHEME } });
  }
  expect(provider.calls.tickets).toEqual([]);
});

test('asked to hand back over https on a browser engine without URL.canParse, as iOS 16’s, the sheet still opens', async () => {
  // Shadowed rather than deleted, since the page's URL inherits it from the engine's own.
  const canParse = Object.getOwnPropertyDescriptor(URL, 'canParse');
  Object.defineProperty(URL, 'canParse', { configurable: true, value: undefined });
  try {
    const s = sheet(() => {
      throw new Error('cancelled');
    });
    expect(await signInInSheet(hostedAddress(null), { scheme: SCHEME, handBackOverHttps: true, invoke: s.invoke })).toBe(false);
    expect(s.calls).toHaveLength(1);
  } finally {
    if (canParse) Object.defineProperty(URL, 'canParse', canParse);
    else delete (URL as { canParse?: unknown }).canParse;
  }
});
