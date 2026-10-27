import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import {
  desktopSignInAddress,
  listenForDesktopSignIn,
  NOT_FROM_THIS_WINDOW,
  resetDesktopSignIn,
  takeDesktopSignIn,
  useDesktopSignInWindow,
  type DesktopSignInLink,
} from '../tauri/sign-in';
import { DESKTOP_SIGN_IN_EVENT, DESKTOP_SIGN_IN_LISTENING, NONCE_PARAM, TICKET_PARAM } from '../tauri/sign-in/names';
import { TICKET_FAILED } from '../web/sign-in/provider';
import type { ProviderSession } from '../web/sign-in/provider';
import { standInSignIn, standInTicket, type StandInSignIn } from '../authentication/stand-in';
import { randomHex } from '../tauri/sign-in/fingerprint';
import { serveDesktopSignIn } from './desktop-sign-in-server';

const realFetch = globalThis.fetch;

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  resetDesktopSignIn();
  listenForDesktopSignIn();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

/** The app's window, drawing only what the hook says. */
function Window({ provider }: { provider: StandInSignIn }) {
  const session = provider.useSession();
  const signIn = useDesktopSignInWindow(session);
  return (
    <main>
      <h1>{session.person ? `Signed in as ${session.person.email}` : 'Signed out'}</h1>
      <p role="status">{signIn.state}</p>
      {signIn.state === 'failed' && <p role="alert">{signIn.message}</p>}
    </main>
  );
}

/** The nonce the browser page was opened with: the fingerprint of the window's secret. */
const nonceIn = (address: string) => new URL(address).searchParams.get('nonce')!;

/** As the shell does for a page that listens: the link's code, in its `ticket` field, and nonce as the window event's detail. */
const handOver = (link: DesktopSignInLink) => act(async () => void window.dispatchEvent(new CustomEvent(DESKTOP_SIGN_IN_EVENT, { detail: link })));

const heading = () => screen.getByRole('heading').textContent;

test("the browser page's address is a full one, naming the account chosen in the window, Google's list, or neither", () => {
  const named = new URL(desktopSignInAddress({ account: 'ana@example.com' }));
  expect(named.origin).toBe(window.location.origin);
  expect(named.pathname).toBe('/desktop-sign-in');
  expect(named.searchParams.get('account')).toBe('ana@example.com');
  expect(nonceIn(named.href)).toMatch(/^[0-9a-f]{64}$/);
  expect(new URL(desktopSignInAddress('choose')).searchParams.get('account')).toBe('choose');
  expect(new URL(desktopSignInAddress(null)).searchParams.has('account')).toBe(false);
});

test('the address carries only the fingerprint of the secret the window keeps, never the secret', () => {
  const nonce = nonceIn(desktopSignInAddress(null));
  const kept = Object.values(sessionStorage).filter((value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value));
  expect(kept).toHaveLength(1);
  expect(kept[0]).not.toBe(nonce);
  expect(desktopSignInAddress(null)).not.toContain(kept[0]!);
});

test('the page tells the shell it takes a link where it is', () => {
  expect((window as unknown as Record<string, unknown>)[DESKTOP_SIGN_IN_LISTENING]).toBe(true);
});

test("a link with this window's fingerprint turns its code into a ticket with the window's secret, signs in where it is, and the server hears it was taken", async () => {
  const { sent, codeFor } = serveDesktopSignIn(() => 'ana@example.com');
  const nonce = nonceIn(desktopSignInAddress({ account: 'ana@example.com' }));
  const provider = standInSignIn();
  render(<Window provider={provider} />);
  const code = await codeFor(nonce);
  await handOver({ ticket: code, nonce });
  await waitFor(() => expect(heading()).toBe('Signed in as ana@example.com'));
  expect(provider.calls.tickets).toEqual([standInTicket('ana@example.com')]);
  await waitFor(() => expect(sent.map((r) => r.path)).toEqual(['/api/desktop-sign-in/redeem', '/api/desktop-sign-in/taken']));
  // Signed out, the window has no token for the redeem; the code and secret go in the body only.
  expect(sent[0]).toEqual({ path: '/api/desktop-sign-in/redeem', authorization: null, body: { code, secret: expect.stringMatching(/^[0-9a-f]{64}$/) } });
  expect(sent[1]).toEqual({ path: '/api/desktop-sign-in/taken', authorization: 'Bearer stand-in-token-0', body: { code } });
});

test('a link the window did not ask for is refused, and its code never redeemed', async () => {
  const { sent } = serveDesktopSignIn(() => 'mallory@example.com');
  desktopSignInAddress({ account: 'ana@example.com' });
  const provider = standInSignIn();
  render(<Window provider={provider} />);
  await handOver({ ticket: randomHex(), nonce: randomHex() });
  expect(screen.getByRole('alert').textContent).toBe(NOT_FROM_THIS_WINDOW);
  expect(heading()).toBe('Signed out');
  expect(provider.calls.tickets).toEqual([]);
  expect(sent).toEqual([]);
});

test('a window that asked for no sign-in takes none', async () => {
  const provider = standInSignIn();
  render(<Window provider={provider} />);
  await handOver({ ticket: randomHex(), nonce: randomHex() });
  expect(screen.getByRole('alert').textContent).toBe(NOT_FROM_THIS_WINDOW);
  expect(provider.calls.tickets).toEqual([]);
});

/** The session outside React, for the steps that need no screen. */
function sessionOf(provider: StandInSignIn): ProviderSession {
  let session!: ProviderSession;
  function Read() {
    session = provider.useSession();
    return null;
  }
  render(<Read />);
  return session;
}

/** Takes a link as the hook would, with the screen's updates inside act. */
async function take(session: ProviderSession, link: DesktopSignInLink) {
  let outcome!: Awaited<ReturnType<typeof takeDesktopSignIn>>;
  await act(async () => {
    outcome = await takeDesktopSignIn(session, link);
  });
  return outcome;
}

test('a secret works once: after a sign-in, the same link or a fresh code with its fingerprint is refused', async () => {
  const { codeFor } = serveDesktopSignIn(() => 'ana@example.com');
  const provider = standInSignIn();
  const session = sessionOf(provider);
  const nonce = nonceIn(desktopSignInAddress({ account: 'ana@example.com' }));
  const code = await codeFor(nonce);
  expect(await take(session, { ticket: code, nonce })).toEqual({ ok: true });
  act(() => provider.endSession());
  expect(await take(session, { ticket: code, nonce })).toEqual({ ok: false, message: NOT_FROM_THIS_WINDOW });
  expect(await take(session, { ticket: await codeFor(nonce), nonce })).toEqual({ ok: false, message: NOT_FROM_THIS_WINDOW });
});

test('a second Continue with Google asks with the same fingerprint, so the first browser tab still signs in; a new one follows a sign-in', async () => {
  const { codeFor } = serveDesktopSignIn(() => 'ana@example.com');
  const first = nonceIn(desktopSignInAddress({ account: 'ana@example.com' }));
  expect(nonceIn(desktopSignInAddress(null))).toBe(first);
  const session = sessionOf(standInSignIn());
  expect(await take(session, { ticket: await codeFor(first), nonce: first })).toEqual({ ok: true });
  expect(nonceIn(desktopSignInAddress(null))).not.toBe(first);
});

test('a code that gets no ticket, as one expired while the browser asked to open the app, leaves the secret for a fresh code', async () => {
  const { codeFor } = serveDesktopSignIn(() => 'ana@example.com');
  const nonce = nonceIn(desktopSignInAddress({ account: 'ana@example.com' }));
  const provider = standInSignIn();
  render(<Window provider={provider} />);
  await handOver({ ticket: randomHex(), nonce });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(TICKET_FAILED));
  expect(provider.calls.tickets).toEqual([]);
  await handOver({ ticket: await codeFor(nonce), nonce });
  await waitFor(() => expect(heading()).toBe('Signed in as ana@example.com'));
});

test('a server that cannot be reached for the redeem fails the sign-in, and a fresh code still works', async () => {
  const { codeFor } = serveDesktopSignIn(() => 'ana@example.com');
  const nonce = nonceIn(desktopSignInAddress({ account: 'ana@example.com' }));
  const serving = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch;
  const provider = standInSignIn();
  render(<Window provider={provider} />);
  await handOver({ ticket: await codeFor(nonce), nonce });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(TICKET_FAILED));
  globalThis.fetch = serving;
  await handOver({ ticket: await codeFor(nonce), nonce });
  await waitFor(() => expect(heading()).toBe('Signed in as ana@example.com'));
});

test('a provider that throws on a ticket, as on a network failure, fails the sign-in, and a fresh code still works', async () => {
  const { codeFor } = serveDesktopSignIn(() => 'ana@example.com');
  const nonce = nonceIn(desktopSignInAddress({ account: 'ana@example.com' }));
  const provider = standInSignIn();
  let reachable = false;
  const throwing: StandInSignIn = {
    ...provider,
    useSession: () => {
      const session = provider.useSession();
      return { ...session, ticket: (ticket) => (reachable ? session.ticket(ticket) : Promise.reject(new Error('offline'))) };
    },
  };
  render(<Window provider={throwing} />);
  await handOver({ ticket: await codeFor(nonce), nonce });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(TICKET_FAILED));
  reachable = true;
  await handOver({ ticket: await codeFor(nonce), nonce });
  await waitFor(() => expect(heading()).toBe('Signed in as ana@example.com'));
});

test('a second link while the first is being taken, as from a second Open the app, is dropped and shows no failure', async () => {
  const { codeFor } = serveDesktopSignIn(() => 'ana@example.com');
  const nonce = nonceIn(desktopSignInAddress({ account: 'ana@example.com' }));
  const provider = standInSignIn();
  render(<Window provider={provider} />);
  const code = await codeFor(nonce);
  await act(async () => {
    window.dispatchEvent(new CustomEvent(DESKTOP_SIGN_IN_EVENT, { detail: { ticket: code, nonce } }));
    window.dispatchEvent(new CustomEvent(DESKTOP_SIGN_IN_EVENT, { detail: { ticket: code, nonce } }));
  });
  await waitFor(() => expect(heading()).toBe('Signed in as ana@example.com'));
  expect(provider.calls.tickets).toEqual([standInTicket('ana@example.com')]);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a link that comes while the provider is still loading is held until it has loaded, then taken', async () => {
  const { codeFor } = serveDesktopSignIn(() => 'ana@example.com');
  const nonce = nonceIn(desktopSignInAddress({ account: 'ana@example.com' }));
  const provider = standInSignIn({ loaded: false });
  render(<Window provider={provider} />);
  await handOver({ ticket: await codeFor(nonce), nonce });
  expect(provider.calls.tickets).toEqual([]);
  act(() => provider.finishLoading());
  await waitFor(() => expect(heading()).toBe('Signed in as ana@example.com'));
});

test('a link that comes before the page is ready for it is held, then taken', async () => {
  const { codeFor } = serveDesktopSignIn(() => 'ana@example.com');
  const nonce = nonceIn(desktopSignInAddress({ account: 'ana@example.com' }));
  window.dispatchEvent(new CustomEvent(DESKTOP_SIGN_IN_EVENT, { detail: { ticket: await codeFor(nonce), nonce } }));
  render(<Window provider={standInSignIn()} />);
  await waitFor(() => expect(heading()).toBe('Signed in as ana@example.com'));
});

test('a page loaded with a link, by a shell whose page could not take it where it was, takes it off the address and signs in', async () => {
  const { codeFor } = serveDesktopSignIn(() => 'ana@example.com');
  const nonce = nonceIn(desktopSignInAddress({ account: 'ana@example.com' }));
  // In the fragment, which the browser never sends, so the code is in no request the server could log.
  window.history.replaceState(null, '', `/week?day=3#${new URLSearchParams({ [TICKET_PARAM]: await codeFor(nonce), [NONCE_PARAM]: nonce })}`);
  listenForDesktopSignIn();
  expect(window.location.pathname + window.location.search + window.location.hash).toBe('/week?day=3');
  render(<Window provider={standInSignIn()} />);
  await waitFor(() => expect(heading()).toBe('Signed in as ana@example.com'));
});

test('signed in already, a link is dropped, and never tried after a later sign-out', async () => {
  const { sent } = serveDesktopSignIn(() => 'bo@example.com');
  const nonce = nonceIn(desktopSignInAddress({ account: 'ana@example.com' }));
  const provider = standInSignIn({ person: { id: 'p1', email: 'ana@example.com' } });
  render(<Window provider={provider} />);
  await handOver({ ticket: randomHex(), nonce });
  act(() => provider.endSession());
  expect(heading()).toBe('Signed out');
  expect(provider.calls.tickets).toEqual([]);
  expect(sent).toEqual([]);
});
