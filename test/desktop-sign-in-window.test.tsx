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
} from '../desktop-sign-in';
import { DESKTOP_SIGN_IN_EVENT, DESKTOP_SIGN_IN_LISTENING, NONCE_PARAM, TICKET_PARAM } from '../desktop-sign-in/names';
import { TICKET_FAILED } from '../src/sign-in/SignInGate';
import type { ProviderSession } from '../src/sign-in/provider';
import { standInSignIn, standInTicket, type StandInSignIn } from '../testing';
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

/** The nonce the browser page was opened with. */
const nonceIn = (address: string) => new URL(address).searchParams.get('nonce')!;

/** As the shell does for a page that listens: the link's ticket and nonce as the window event's detail. */
const handOver = (link: DesktopSignInLink) => act(async () => void window.dispatchEvent(new CustomEvent(DESKTOP_SIGN_IN_EVENT, { detail: link })));

const heading = () => screen.getByRole('heading').textContent;

test("the browser page's address is a full one, naming the account chosen in the window, Google's list, or neither", () => {
  const named = new URL(desktopSignInAddress({ account: 'ana@example.com' }));
  expect(named.origin).toBe(window.location.origin);
  expect(named.pathname).toBe('/desktop-sign-in');
  expect(named.searchParams.get('account')).toBe('ana@example.com');
  expect(nonceIn(named.href)).toMatch(/^[0-9a-f-]{36}$/);
  expect(new URL(desktopSignInAddress('choose')).searchParams.get('account')).toBe('choose');
  expect(new URL(desktopSignInAddress(null)).searchParams.has('account')).toBe(false);
});

test('the page tells the shell it takes a link where it is', () => {
  expect((window as unknown as Record<string, unknown>)[DESKTOP_SIGN_IN_LISTENING]).toBe(true);
});

test('a link with the nonce this window asked with signs it in where it is, and the server hears it was taken', async () => {
  const { sent } = serveDesktopSignIn(() => null);
  const nonce = nonceIn(desktopSignInAddress({ account: 'ana@example.com' }));
  const provider = standInSignIn();
  render(<Window provider={provider} />);
  const ticket = standInTicket('ana@example.com');
  await handOver({ ticket, nonce });
  await waitFor(() => expect(heading()).toBe('Signed in as ana@example.com'));
  await waitFor(() => expect(sent.map((r) => r.path)).toEqual(['/api/desktop-sign-in/taken']));
  // With the session's own token, not a cookie, and the ticket in the body only.
  expect(sent[0]).toEqual({ path: '/api/desktop-sign-in/taken', authorization: 'Bearer stand-in-token-0', body: { ticket } });
});

test('a link the window did not ask for is refused, and its ticket never tried', async () => {
  desktopSignInAddress({ account: 'ana@example.com' });
  const provider = standInSignIn();
  render(<Window provider={provider} />);
  await handOver({ ticket: standInTicket('mallory@example.com'), nonce: crypto.randomUUID() });
  expect(screen.getByRole('alert').textContent).toBe(NOT_FROM_THIS_WINDOW);
  expect(heading()).toBe('Signed out');
  expect(provider.calls.tickets).toEqual([]);
});

test('a window that asked for no sign-in takes none', async () => {
  const provider = standInSignIn();
  render(<Window provider={provider} />);
  await handOver({ ticket: standInTicket('mallory@example.com'), nonce: crypto.randomUUID() });
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

test('a nonce works once: after a sign-in, the same link or a fresh ticket with it is refused', async () => {
  serveDesktopSignIn(() => null);
  const provider = standInSignIn();
  const session = sessionOf(provider);
  const nonce = nonceIn(desktopSignInAddress({ account: 'ana@example.com' }));
  expect(await take(session, { ticket: standInTicket('ana@example.com'), nonce })).toEqual({ ok: true });
  act(() => provider.endSession());
  expect(await take(session, { ticket: 'stand-in-ticket:ana+again@example.com', nonce })).toEqual({ ok: false, message: NOT_FROM_THIS_WINDOW });
});

test('a second Continue with Google asks with the same nonce, so the first browser tab still signs in; a new one follows a sign-in', async () => {
  serveDesktopSignIn(() => null);
  const first = nonceIn(desktopSignInAddress({ account: 'ana@example.com' }));
  expect(nonceIn(desktopSignInAddress(null))).toBe(first);
  const session = sessionOf(standInSignIn());
  expect(await take(session, { ticket: standInTicket('ana@example.com'), nonce: first })).toEqual({ ok: true });
  expect(nonceIn(desktopSignInAddress(null))).not.toBe(first);
});

test('a ticket that fails, as one expired while the browser asked to open the app, leaves the nonce for a fresh ticket', async () => {
  serveDesktopSignIn(() => null);
  const nonce = nonceIn(desktopSignInAddress({ account: 'ana@example.com' }));
  const provider = standInSignIn();
  render(<Window provider={provider} />);
  await handOver({ ticket: 'expired-ticket', nonce });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(TICKET_FAILED));
  await handOver({ ticket: standInTicket('ana@example.com'), nonce });
  await waitFor(() => expect(heading()).toBe('Signed in as ana@example.com'));
});

test('a provider that throws on a ticket, as on a network failure, fails the sign-in, and a fresh ticket still works', async () => {
  serveDesktopSignIn(() => null);
  const nonce = nonceIn(desktopSignInAddress({ account: 'ana@example.com' }));
  const provider = standInSignIn();
  const throwing: StandInSignIn = {
    ...provider,
    useSession: () => {
      const session = provider.useSession();
      return { ...session, ticket: (ticket) => (ticket === 'unreachable' ? Promise.reject(new Error('offline')) : session.ticket(ticket)) };
    },
  };
  render(<Window provider={throwing} />);
  await handOver({ ticket: 'unreachable', nonce });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(TICKET_FAILED));
  await handOver({ ticket: standInTicket('ana@example.com'), nonce });
  await waitFor(() => expect(heading()).toBe('Signed in as ana@example.com'));
});

test('a second link while the first is being taken, as from a second Open the app, is dropped and shows no failure', async () => {
  serveDesktopSignIn(() => null);
  const nonce = nonceIn(desktopSignInAddress({ account: 'ana@example.com' }));
  const provider = standInSignIn();
  render(<Window provider={provider} />);
  const ticket = standInTicket('ana@example.com');
  await act(async () => {
    window.dispatchEvent(new CustomEvent(DESKTOP_SIGN_IN_EVENT, { detail: { ticket, nonce } }));
    window.dispatchEvent(new CustomEvent(DESKTOP_SIGN_IN_EVENT, { detail: { ticket, nonce } }));
  });
  await waitFor(() => expect(heading()).toBe('Signed in as ana@example.com'));
  expect(provider.calls.tickets).toEqual([ticket]);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a link that comes before the page is ready for it is held, then taken', async () => {
  serveDesktopSignIn(() => null);
  const nonce = nonceIn(desktopSignInAddress({ account: 'ana@example.com' }));
  window.dispatchEvent(new CustomEvent(DESKTOP_SIGN_IN_EVENT, { detail: { ticket: standInTicket('ana@example.com'), nonce } }));
  render(<Window provider={standInSignIn()} />);
  await waitFor(() => expect(heading()).toBe('Signed in as ana@example.com'));
});

test('a page loaded with a link, by a shell whose page could not take it where it was, takes it off the address and signs in', async () => {
  serveDesktopSignIn(() => null);
  const nonce = nonceIn(desktopSignInAddress({ account: 'ana@example.com' }));
  window.history.replaceState(null, '', `/week?${new URLSearchParams({ [TICKET_PARAM]: standInTicket('ana@example.com'), [NONCE_PARAM]: nonce, day: '3' })}`);
  listenForDesktopSignIn();
  expect(window.location.pathname + window.location.search).toBe('/week?day=3');
  render(<Window provider={standInSignIn()} />);
  await waitFor(() => expect(heading()).toBe('Signed in as ana@example.com'));
});

test('signed in already, a link is dropped, and never tried after a later sign-out', async () => {
  const nonce = nonceIn(desktopSignInAddress({ account: 'ana@example.com' }));
  const provider = standInSignIn({ person: { id: 'p1', email: 'ana@example.com' } });
  render(<Window provider={provider} />);
  await handOver({ ticket: standInTicket('bo@example.com'), nonce });
  act(() => provider.endSession());
  expect(heading()).toBe('Signed out');
  expect(provider.calls.tickets).toEqual([]);
});
