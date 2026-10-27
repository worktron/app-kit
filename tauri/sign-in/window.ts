import { useEffect, useRef, useState } from 'react';
import { TICKET_FAILED, type Outcome, type ProviderSession } from '../../web/sign-in/provider';
import { read, session as thisTab, write, type KeyValueStore } from '../../web/storage';
import { DESKTOP_SIGN_IN_EVENT, DESKTOP_SIGN_IN_LISTENING, DESKTOP_SIGN_IN_PATH, NONCE_PARAM, TICKET_PARAM } from './names';
import { fingerprint, HEX_32, randomHex } from './fingerprint';
import { post } from './requests';

/*
 * The desktop app's window. Google refuses to sign in inside an app's web view, so the window opens the browser on the
 * app's sign-in page, with the fingerprint of a secret it keeps in its own storage. The browser, signed in, hands back
 * a one-time code through the app's own link; the shell passes it to the page, which takes it only when the link
 * carries its own fingerprint, and turns it into a ticket at the server with its secret. Any other app can claim the
 * link, but the code is worth nothing to it without the secret, which never leaves the window.
 *
 * The window's page is the app's own site, served by the server that mounts the routes, as a Tauri window onto the
 * hosted app is: the browser page's address and the routes are both on the page's origin.
 */

const SECRET_KEY = 'app-kit.desktopSignInSecret';

export const NOT_FROM_THIS_WINDOW = 'This sign-in did not come from this window. Sign in again.';

/**
 * Which Google account the window asks the browser for: the one named; Google's list, even when the browser is
 * already signed in, as for Use a different account; or null, whoever the browser is signed in as, and Google's list
 * when nobody is.
 */
export type DesktopSignInAccount = { account: string } | 'choose' | null;

/**
 * What the browser hands the app, in the fields installed shells name: `ticket` is the server's one-time code, and
 * `nonce` the fingerprint of the secret the window asked with.
 */
export interface DesktopSignInLink {
  ticket: string;
  nonce: string;
}

/**
 * The browser page to open for Google, as a full address, since the iPhone's sign-in sheet takes only one, asking for
 * the account chosen in the window, with the fingerprint of the window's secret as its nonce. A secret already kept and
 * not yet used is asked with again, so a second click leaves the first browser tab's sign-in good.
 */
export function desktopSignInAddress(account: DesktopSignInAccount, store: () => KeyValueStore = thisTab): string {
  let secret = read(store, SECRET_KEY);
  if (!secret || !HEX_32.test(secret)) {
    secret = randomHex();
    write(store, SECRET_KEY, secret);
  }
  const query = new URLSearchParams({ nonce: fingerprint(secret) });
  if (account) query.set('account', account === 'choose' ? 'choose' : account.account);
  return `${window.location.origin}${DESKTOP_SIGN_IN_PATH}?${query}`;
}

/** A link as the shell or the iPhone's sheet passes it, or null when it is not one. */
export function desktopSignInLink(value: unknown): DesktopSignInLink | null {
  if (typeof value !== 'object' || value === null) return null;
  const { ticket, nonce } = value as { ticket?: unknown; nonce?: unknown };
  return typeof ticket === 'string' && ticket && typeof nonce === 'string' && nonce ? { ticket, nonce } : null;
}

/** The ticket the server makes for the browser's code and this window's secret, or null when it makes none. */
async function redeem(session: Pick<ProviderSession, 'token'>, code: string, secret: string): Promise<string | null> {
  const answer = await post(session, '/redeem', { code, secret }).catch(() => null);
  const body = answer?.ok ? ((await answer.json().catch(() => null)) as { ticket?: unknown } | null) : null;
  return typeof body?.ticket === 'string' && body.ticket ? body.ticket : null;
}

/**
 * Signs in with a link from the browser when it carries this window's fingerprint: the server turns its code into a
 * ticket for the window's secret, and the provider signs in with that. The secret is used up only once the ticket has
 * worked, so a code that expired while the browser asked whether to open the app can be followed by a fresh one. Then
 * the server hears it was taken, for the browser tab that handed it over.
 */
export async function takeDesktopSignIn(
  session: Pick<ProviderSession, 'ticket' | 'token'>,
  link: DesktopSignInLink,
  store: () => KeyValueStore = thisTab,
): Promise<Outcome> {
  const secret = read(store, SECRET_KEY);
  if (!secret || !HEX_32.test(link.nonce) || fingerprint(secret) !== link.nonce) return { ok: false, message: NOT_FROM_THIS_WINDOW };
  const ticket = await redeem(session, link.ticket, secret);
  if (!ticket) return { ok: false, message: TICKET_FAILED };
  // A provider that throws, as on a network failure, fails like one that says no, so the window never stays signing in.
  const outcome = await session.ticket(ticket).catch((): Outcome => ({ ok: false, message: TICKET_FAILED }));
  if (!outcome.ok) return outcome;
  write(store, SECRET_KEY, null);
  await post(session, '/taken', { code: link.ticket }).catch(() => undefined);
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
 * address, so a reload never tries a used code, and listens for the ones it dispatches, telling the shell so. The
 * shell puts a link in the address's fragment, which the browser never sends, so the code reaches no server's log.
 */
export function listenForDesktopSignIn(): void {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const ticket = fragment.get(TICKET_PARAM);
  const nonce = fragment.get(NONCE_PARAM);
  if (ticket !== null || nonce !== null) {
    fragment.delete(TICKET_PARAM);
    fragment.delete(NONCE_PARAM);
    url.hash = fragment.toString();
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
export function useDesktopSignInWindow(session: Pick<ProviderSession, 'loaded' | 'person' | 'ticket' | 'token'>): DesktopSignInWindow {
  const [now, setNow] = useState<DesktopSignInWindow>({ state: 'waiting' });
  const latest = useRef(session);
  latest.current = session;
  const taking = useRef(false);

  // Until the provider knows who is signed in, a link stays held: an app without the sign-in gate draws this before
  // then, when a signed-in person still reads as nobody and the provider cannot take a ticket yet.
  const loaded = session.loaded;
  useEffect(() => {
    if (!loaded) return;
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
  }, [loaded]);

  return now;
}
