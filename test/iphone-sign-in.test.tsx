import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { signInInSheet as openSheet, type Invoke, type SheetSignInOptions } from '../tauri/iphone-sign-in';
import { appLink, desktopSignInAddress, listenForDesktopSignIn, resetDesktopSignIn, useDesktopSignInWindow } from '../tauri/sign-in';
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
  serveDesktopSignIn(() => null);
  const provider = standInSignIn();
  render(<Window provider={provider} />);
  const address = desktopSignInAddress({ account: 'ana@example.com' });
  const ticket = standInTicket('ana@example.com');
  const s = sheet((asked) => ({ callbackUrl: appLink(SCHEME, ticket, nonceOf(asked)) }));
  expect(await signInInSheet(address, { scheme: SCHEME, invoke: s.invoke })).toBe(true);
  expect(s.calls).toEqual([{ command: 'plugin:web-auth|authenticate', args: { payload: { url: address, callbackScheme: SCHEME } } }]);
  await waitFor(() => expect(screen.getByRole('heading').textContent).toBe('Signed in as ana@example.com'));
  expect(lines).toContain('[iphone-sign-in] sheet returned a sign-in link: handed to the window');
});

test('a scheme with capitals still matches its link, which iOS hands back in any case', async () => {
  serveDesktopSignIn(() => null);
  const provider = standInSignIn();
  render(<Window provider={provider} />);
  const address = desktopSignInAddress(null);
  const s = sheet((asked) => ({ callbackUrl: appLink('com.example.myapp', standInTicket('ana@example.com'), nonceOf(asked)) }));
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
