import { useEffect, useRef, useState } from 'react';
import type { Outcome, ProviderSession } from '../src/sign-in/provider';
import { read, session as thisTab, write, type KeyValueStore } from '../src/storage';
import { DESKTOP_SIGN_IN_EVENT, DESKTOP_SIGN_IN_LISTENING, DESKTOP_SIGN_IN_PATH, NONCE_PARAM, TICKET_PARAM } from './names';
import { NONCE, post } from './requests';

/*
 * The desktop app's window. Google refuses to sign in inside an app's web view, so the window opens the browser on the
 * app's sign-in page, with a nonce it keeps in its own storage. The browser, signed in, hands back a one-time ticket
 * through the app's own link; the shell passes it to the page, which signs in with it only when the nonce is the one
 * it asked with, so a link the window did not ask for, made by any other app on the Mac, never signs it in.
 */

const NONCE_KEY = 'app-kit.desktopSignInNonce';

export const NOT_FROM_THIS_WINDOW = 'This sign-in did not come from this window. Sign in again.';

/** What the browser hands the app: the ticket, and the nonce the window asked with. */
export interface DesktopSignInLink {
  ticket: string;
  nonce: string;
}

/**
 * The browser page to open for Google, as a full address, since the iPhone's sign-in sheet takes only one. `account`
 * is the Google account chosen in the window, or null for Google's list. A nonce already kept and not yet used is
 * asked with again, so a second click leaves the first browser tab's sign-in good.
 */
export function desktopSignInAddress(account: string | null, store: () => KeyValueStore = thisTab): string {
  let nonce = read(store, NONCE_KEY);
  if (!nonce || !NONCE.test(nonce)) {
    nonce = crypto.randomUUID();
    write(store, NONCE_KEY, nonce);
  }
  const query = new URLSearchParams({ nonce, account: account ?? 'choose' });
  return `${window.location.origin}${DESKTOP_SIGN_IN_PATH}?${query}`;
}

/** A link as the shell or the iPhone's sheet passes it, or null when it is not one. */
export function desktopSignInLink(value: unknown): DesktopSignInLink | null {
  if (typeof value !== 'object' || value === null) return null;
  const { ticket, nonce } = value as { ticket?: unknown; nonce?: unknown };
  return typeof ticket === 'string' && ticket && typeof nonce === 'string' && nonce ? { ticket, nonce } : null;
}

/**
 * Signs in with a link from the browser when its nonce is the one this window asked with. The nonce is used up only
 * once the ticket has worked, so a ticket that expired while the browser asked whether to open the app can be
 * followed by a fresh one. Then the server hears it was taken, for the browser tab that handed it over.
 */
export async function takeDesktopSignIn(
  session: Pick<ProviderSession, 'ticket' | 'token'>,
  link: DesktopSignInLink,
  store: () => KeyValueStore = thisTab,
): Promise<Outcome> {
  if (!NONCE.test(link.nonce) || read(store, NONCE_KEY) !== link.nonce) return { ok: false, message: NOT_FROM_THIS_WINDOW };
  const outcome = await session.ticket(link.ticket);
  if (!outcome.ok) return outcome;
  write(store, NONCE_KEY, null);
  await post(session, '/taken', { ticket: link.ticket }).catch(() => undefined);
  return outcome;
}

// A link the shell hands over before the page is ready for it is held for the hook, which takes each one after.
let held: DesktopSignInLink | null = null;
let take: ((link: DesktopSignInLink) => void) | null = null;
let listening = false;

function arrived(link: DesktopSignInLink) {
  if (take) take(link);
  else held = link;
}

/**
 * In the desktop app's window, from the page's first script: takes a link the shell loaded the page with off the
 * address, so a reload never tries a used ticket, and listens for the ones it dispatches, telling the shell so.
 */
export function listenForDesktopSignIn(): void {
  const url = new URL(window.location.href);
  const ticket = url.searchParams.get(TICKET_PARAM);
  const nonce = url.searchParams.get(NONCE_PARAM);
  if (ticket !== null || nonce !== null) {
    url.searchParams.delete(TICKET_PARAM);
    url.searchParams.delete(NONCE_PARAM);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    const link = desktopSignInLink({ ticket, nonce });
    if (link) arrived(link);
  }
  // Once per page, however often it is called.
  if (listening) return;
  listening = true;
  window.addEventListener(DESKTOP_SIGN_IN_EVENT, (event) => {
    const link = desktopSignInLink((event as CustomEvent<unknown>).detail);
    if (link) arrived(link);
  });
  (window as unknown as Record<string, boolean>)[DESKTOP_SIGN_IN_LISTENING] = true;
}

/** Hands `link` to the window as the shell would, for the iPhone's sheet, which returns it to the page directly. */
export function desktopSignInArrived(link: DesktopSignInLink): void {
  arrived(link);
}

/** For tests: forgets any held link and listener, as a fresh page. */
export function resetDesktopSignIn(): void {
  held = null;
  take = null;
}

export type DesktopSignInWindow = { state: 'waiting' } | { state: 'signing-in' } | { state: 'signed-in' } | { state: 'failed'; message: string };

/**
 * In the desktop app's window: signs in with each link the browser hands over. The first is taken; any that come while
 * it is being taken, as from a second click on the browser's Open the app, are dropped. Signed in already, a link is
 * dropped rather than held, so it is never tried after a later sign-out. The app draws what the state says: a quiet
 * line while signing in, and its sign-in screen with the message after a failure.
 */
export function useDesktopSignInWindow(session: Pick<ProviderSession, 'person' | 'ticket' | 'token'>): DesktopSignInWindow {
  const [now, setNow] = useState<DesktopSignInWindow>({ state: 'waiting' });
  const latest = useRef(session);
  latest.current = session;
  const taking = useRef(false);

  useEffect(() => {
    const listener = (link: DesktopSignInLink) => {
      if (latest.current.person || taking.current) return;
      taking.current = true;
      setNow({ state: 'signing-in' });
      void takeDesktopSignIn(latest.current, link).then((outcome) => {
        taking.current = false;
        setNow(outcome.ok ? { state: 'signed-in' } : { state: 'failed', message: outcome.message });
      });
    };
    take = listener;
    const waiting = held;
    held = null;
    if (waiting) listener(waiting);
    return () => {
      if (take === listener) take = null;
    };
  }, []);

  return now;
}
