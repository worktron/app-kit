import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProviderSession } from '../../web/sign-in/provider';
import { read, session as thisTab, write, type KeyValueStore } from '../../web/storage';
import { DESKTOP_SIGN_IN_PATH, LINK_HOST } from './names';
import { HEX_32 } from './fingerprint';
import { post } from './requests';
import type { DesktopSignInAccount } from './window';

/*
 * The browser end: the app's sign-in page in the default browser, opened by the app's window. Signed in there as the
 * account the window asked for, it waits for the person's click, then asks the server for a one-time code made for the
 * window's fingerprint and opens the app's own link with it; signed in as another, or asked for Google's list, it signs
 * out, and the app's sign-in screen goes to Google. Once the app has signed in with the code, which the server says,
 * the tab closes.
 *
 * The click is what keeps another app out: anything on the computer can open this page with a fingerprint of its own
 * secret, and nothing in the address tells the app's window from it, so the page never hands over until the person says
 * so. In another site's frame it never offers to, so the click cannot be lured out of a page laid over it.
 */

const STARTED_KEY = 'app-kit.desktopSignInGoogleStarted';

/** How often the tab asks whether the app has signed in, and for how long: past the ticket's minute, its link is dead. */
export const ASK_TAKEN_EVERY_MS = 500;
export const ASK_TAKEN_FOR_MS = 90_000;

/** What the app's window asked the browser for: the fingerprint of its secret, and the Google account chosen there. */
export interface DesktopSignInRequest {
  nonce: string;
  account: DesktopSignInAccount;
}

/** On the browser's sign-in page with a well-formed nonce, outside any frame, the window's request; otherwise null. */
export function desktopSignInRequest(location: Pick<Location, 'pathname' | 'search'> = window.location): DesktopSignInRequest | null {
  if (location.pathname !== DESKTOP_SIGN_IN_PATH || window.top !== window.self) return null;
  const query = new URLSearchParams(location.search);
  const nonce = query.get('nonce');
  if (!nonce || !HEX_32.test(nonce)) return null;
  const account = query.get('account');
  return { nonce, account: !account ? null : account === 'choose' ? 'choose' : { account } };
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

/**
 * The link that hands a code to the app: its own scheme, with the nonce the window asked with. The code goes in the
 * field installed shells call `ticket`.
 */
export function appLink(scheme: string, code: string, nonce: string): string {
  return `${scheme}://${LINK_HOST}?${new URLSearchParams({ ticket: code, nonce })}`;
}

export type DesktopSignInBrowserPage =
  | { state: 'not-from-app' }
  | { state: 'signing-out' }
  | { state: 'ready' }
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
 * The browser's sign-in page once signed in. Signed in as an account other than the one the window asked for, or asked
 * for Google's list, and not back from Google, it only signs out: the app's sign-in screen then goes to Google for the
 * account asked, through `startGoogleHere`. Otherwise it is `ready`: the app draws which account goes to the app and a
 * button that calls `handOver`, with words such as "only if you just chose Continue with Google in the app", and the
 * state says where the hand-over stands for the app to draw. `again` decides again, for a link the browser did not
 * open or that expired, or a sign-out that failed; it is the person's click too, so it hands over without `ready`.
 */
export function useDesktopSignInBrowserPage({
  session,
  scheme,
}: DesktopSignInBrowserPageOptions): DesktopSignInBrowserPage & { handOver(): void; again(): void } {
  const [now, setNow] = useState<DesktopSignInBrowserPage>(() => (desktopSignInRequest() ? { state: 'asking' } : { state: 'not-from-app' }));
  const latest = useRef(session);
  latest.current = session;
  const started = useRef(false);
  const code = useRef('');

  const send = useCallback(async () => {
    const asked = desktopSignInRequest();
    if (!asked) return setNow({ state: 'not-from-app' });
    setNow({ state: 'asking' });
    const answer = await post(latest.current, '/code', { fingerprint: asked.nonce }).catch(() => null);
    const body = answer?.ok ? ((await answer.json().catch(() => null)) as { code?: unknown } | null) : null;
    if (typeof body?.code !== 'string' || !body.code) return setNow({ state: 'failed' });
    code.current = body.code;
    const link = appLink(scheme, body.code, asked.nonce);
    setNow({ state: 'sent', link });
    window.location.href = link;
  }, [scheme]);

  // `clicked` is the person's say-so: without it, a request that would hand over stops at `ready`.
  const decide = useCallback((clicked: boolean) => {
    const asked = desktopSignInRequest();
    if (!asked) return setNow({ state: 'not-from-app' });
    const email = latest.current.person?.email?.toLowerCase() ?? null;
    const notAsked = asked.account === 'choose' || (asked.account !== null && asked.account.account.toLowerCase() !== email);
    if (notAsked && !googleStartedHere()) {
      setNow({ state: 'signing-out' });
      latest.current.signOut().catch(() => setNow({ state: 'failed' }));
      return;
    }
    if (clicked) void send();
    else setNow({ state: 'ready' });
  }, [send]);

  // A named account is compared once the person's email is known: a provider can know who is signed in a moment before
  // it has their email, and comparing then would sign out the very account the window asked for.
  const email = session.person?.email ?? null;
  useEffect(() => {
    if (started.current) return;
    const asked = desktopSignInRequest();
    if (asked && asked.account !== null && asked.account !== 'choose' && email === null) return;
    started.current = true;
    decide(false);
  }, [decide, email]);

  // Once the link is out: asks whether the app has signed in with it, and closes the tab when it has. The browser
  // closes only a tab with no pages behind it, so after a trip to Google the tab stays, saying the app is signed in.
  const sent = now.state === 'sent' ? now.link : null;
  useEffect(() => {
    if (!sent) return;
    const asked = code.current;
    let stopped = false;
    const until = Date.now() + ASK_TAKEN_FOR_MS;
    const ask = async () => {
      const answer = await post(latest.current, '/status', { code: asked }).catch(() => null);
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

  const clicked = useCallback(() => decide(true), [decide]);
  return { ...now, handOver: clicked, again: clicked };
}
