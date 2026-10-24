import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProviderSession } from '../src/sign-in/provider';
import { read, session as thisTab, write, type KeyValueStore } from '../src/storage';
import { DESKTOP_SIGN_IN_PATH, LINK_HOST } from './names';
import { NONCE, post } from './requests';

/*
 * The browser end: the app's sign-in page in the default browser, opened by the app's window. Signed in there as the
 * account the window asked for, it asks the server for a one-time ticket and opens the app's own link with it; signed
 * in as another, it signs out, and the app's sign-in screen goes to Google for the one asked. Once the app has signed
 * in with the ticket, which the server says, the tab closes.
 */

const STARTED_KEY = 'app-kit.desktopSignInGoogleStarted';

/** How often the tab asks whether the app has signed in, and for how long: past the ticket's minute, its link is dead. */
export const ASK_TAKEN_EVERY_MS = 500;
export const ASK_TAKEN_FOR_MS = 90_000;

/** What the app's window asked the browser for: its nonce, and the Google account chosen there, or null for Google's list. */
export interface DesktopSignInRequest {
  nonce: string;
  account: string | null;
}

/** On the browser's sign-in page with a well-formed nonce, the window's request; on any other page, null. */
export function desktopSignInRequest(location: Pick<Location, 'pathname' | 'search'> = window.location): DesktopSignInRequest | null {
  if (location.pathname !== DESKTOP_SIGN_IN_PATH) return null;
  const query = new URLSearchParams(location.search);
  const nonce = query.get('nonce');
  if (!nonce || !NONCE.test(nonce)) return null;
  const account = query.get('account');
  return { nonce, account: account && account !== 'choose' ? account : null };
}

/**
 * Whether the app's signed-out sign-in screen, on this page, goes to Google by itself now: only the first time in this
 * tab for this request, so Back from Google stays on the page, and it notes that it has. With storage blocked it cannot
 * tell, so it waits for a click.
 */
export function startGoogleHere(store: () => KeyValueStore = thisTab): boolean {
  const asked = desktopSignInRequest();
  if (!asked || read(store, STARTED_KEY) === asked.nonce) return false;
  write(store, STARTED_KEY, asked.nonce);
  return read(store, STARTED_KEY) === asked.nonce;
}

/** Whether this tab has gone to Google for this request, so the account it came back with is the one picked there. */
export function googleStartedHere(store: () => KeyValueStore = thisTab): boolean {
  const asked = desktopSignInRequest();
  return asked !== null && read(store, STARTED_KEY) === asked.nonce;
}

/** The link that hands a ticket to the app: its own scheme, with the nonce the window asked with. */
export function appLink(scheme: string, ticket: string, nonce: string): string {
  return `${scheme}://${LINK_HOST}?${new URLSearchParams({ ticket, nonce })}`;
}

export type DesktopSignInBrowserPage =
  | { state: 'not-from-app' }
  | { state: 'signing-out' }
  | { state: 'asking' }
  | { state: 'sent'; link: string }
  | { state: 'taken'; link: string }
  | { state: 'expired' }
  | { state: 'failed' };

export interface DesktopSignInBrowserPageOptions {
  /** The session signed in on this page. */
  session: Pick<ProviderSession, 'person' | 'token' | 'signOut'>;
  /** The app's own link scheme, as its shell registers it. */
  scheme: string;
}

/**
 * The browser's sign-in page once signed in. Signed in as an account other than the one the window asked for, and not
 * back from Google, it only signs out: the app's sign-in screen then goes to Google for the account asked, through
 * `startGoogleHere`. Otherwise it hands the account to the app, and the state says where that stands for the app to
 * draw. `again` asks for a new ticket and opens the app again, for a link the browser did not open or that expired.
 */
export function useDesktopSignInBrowserPage({ session, scheme }: DesktopSignInBrowserPageOptions): DesktopSignInBrowserPage & { again(): void } {
  const [now, setNow] = useState<DesktopSignInBrowserPage>(() => (desktopSignInRequest() ? { state: 'asking' } : { state: 'not-from-app' }));
  const latest = useRef(session);
  latest.current = session;
  const started = useRef(false);
  const ticket = useRef('');

  const handOver = useCallback(async () => {
    const asked = desktopSignInRequest();
    if (!asked) return setNow({ state: 'not-from-app' });
    setNow({ state: 'asking' });
    const answer = await post(latest.current, '/ticket').catch(() => null);
    const body = answer?.ok ? ((await answer.json().catch(() => null)) as { ticket?: unknown } | null) : null;
    if (typeof body?.ticket !== 'string' || !body.ticket) return setNow({ state: 'failed' });
    ticket.current = body.ticket;
    const link = appLink(scheme, body.ticket, asked.nonce);
    setNow({ state: 'sent', link });
    window.location.href = link;
  }, [scheme]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const asked = desktopSignInRequest();
    if (!asked) return;
    const email = latest.current.person?.email?.toLowerCase() ?? null;
    if (asked.account && asked.account.toLowerCase() !== email && !googleStartedHere()) {
      setNow({ state: 'signing-out' });
      void latest.current.signOut();
      return;
    }
    void handOver();
  }, [handOver]);

  // Once the link is out: asks whether the app has signed in with it, and closes the tab when it has. The browser
  // closes only a tab with no pages behind it, so after a trip to Google the tab stays, saying the app is signed in.
  const sent = now.state === 'sent' ? now.link : null;
  useEffect(() => {
    if (!sent) return;
    const asked = ticket.current;
    let stopped = false;
    const until = Date.now() + ASK_TAKEN_FOR_MS;
    const ask = async () => {
      const answer = await post(latest.current, '/status', { ticket: asked }).catch(() => null);
      const body = answer?.ok ? ((await answer.json().catch(() => null)) as { taken?: unknown } | null) : null;
      if (stopped) return;
      if (body?.taken === true) {
        setNow({ state: 'taken', link: sent });
        window.close();
      } else if (Date.now() < until) {
        setTimeout(() => void ask(), ASK_TAKEN_EVERY_MS);
      } else {
        setNow({ state: 'expired' });
      }
    };
    void ask();
    return () => {
      stopped = true;
    };
  }, [sent]);

  return { ...now, again: () => void handOver() };
}
