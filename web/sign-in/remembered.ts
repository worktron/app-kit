import { local, read, session, write, type KeyValueStore } from '../storage';
import { SIGNED_IN_KEY } from './names.js';

const ACCOUNT_KEY = 'app-kit.lastAccount';
const RETURN_KEY = 'app-kit.returnTo';
const BACK_FROM_GOOGLE_KEY = 'app-kit.backFromGoogle';

/**
 * The field of Google's return address that carries where the person was, so a return Chrome moves into another of
 * its profiles, whose tab storage is empty, still goes back there.
 */
export const RETURN_PARAM = 'return_to';

/** Whether this browser was signed in when it last looked, so the page drawn while the provider loads matches the next. */
export function lastSignedIn(store: () => KeyValueStore = local): boolean | null {
  const value = read(store, SIGNED_IN_KEY);
  return value === null ? null : value === '1';
}

export function rememberSignedIn(signedIn: boolean, store: () => KeyValueStore = local): void {
  write(store, SIGNED_IN_KEY, signedIn ? '1' : '0');
}

/**
 * The email this app last signed in with on this device, offered as Continue as that account, until the person signs
 * out. Google does not tell an app which accounts the browser holds, so this is the best guess there is.
 */
export function lastAccount(store: () => KeyValueStore = local): string | null {
  return read(store, ACCOUNT_KEY);
}

export function rememberAccount(email: string, store: () => KeyValueStore = local): void {
  write(store, ACCOUNT_KEY, email);
}

/** The person signed out: the next sign-in screen offers no account by name. */
export function forgetAccount(store: () => KeyValueStore = local): void {
  write(store, ACCOUNT_KEY, null);
}

/** The address the person was at, as a path with its query and fragment. */
export function currentAddress(): string {
  return window.location.pathname + window.location.search + window.location.hash;
}

/**
 * The address Google returns to, `callbackPath` with where the person was: its path and query only, since the part
 * after `#` can hold what never leaves the browser, and the same tab gets it whole from its own storage.
 */
export function googleCallback(callbackPath: string, address: string): string {
  const withoutFragment = address.split('#')[0] ?? '';
  return `${callbackPath}?${new URLSearchParams({ [RETURN_PARAM]: withoutFragment })}`;
}

/** Kept for the trip to Google and back, in this tab only. */
export function rememberReturn(address: string, store: () => KeyValueStore = session): void {
  write(store, RETURN_KEY, address);
}

/**
 * Only a path on this site, never another site's address: resolved as the browser would, since it reads `/\host` as
 * `//host`, another site, which the page cannot move to.
 */
function onThisSite(address: string | null): address is string {
  if (!address?.startsWith('/')) return false;
  try {
    return new URL(address, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * The address kept before the trip to Google: this tab's own, removed as it is read, or, in a tab that kept none, as
 * when Chrome moved Google's return into another profile, the one Google's return address carries; the root when
 * neither is on this site.
 */
export function takeReturn(store: () => KeyValueStore = session, search: string = window.location.search): string {
  const kept = read(store, RETURN_KEY);
  write(store, RETURN_KEY, null);
  if (onThisSite(kept)) return kept;
  const carried = new URLSearchParams(search).get(RETURN_PARAM);
  return onThisSite(carried) ? carried : '/';
}

/**
 * This tab finished Google's return and signed `personId` in, going on to `address`: that person is the account picked
 * at Google. Never noted for a tab that was signed in already, where no return was finished.
 */
export function noteBackFromGoogle(address: string, personId: string, store: () => KeyValueStore = session): void {
  write(store, BACK_FROM_GOOGLE_KEY, JSON.stringify({ address, personId }));
}

/** Signed out in this tab: a later sign-in here came from wherever it comes from, not the return noted before. */
export function forgetBackFromGoogle(store: () => KeyValueStore = session): void {
  write(store, BACK_FROM_GOOGLE_KEY, null);
}

/**
 * The address this tab last went on to after finishing Google's return, while `personId` is the person that return
 * signed in; null for anyone else, however the account changed, or with nothing noted.
 */
export function cameBackFromGoogleTo(personId: string | null, store: () => KeyValueStore = session): string | null {
  const noted = read(store, BACK_FROM_GOOGLE_KEY);
  if (!noted || personId === null) return null;
  try {
    const back = JSON.parse(noted) as { address?: unknown; personId?: unknown };
    return back.personId === personId && typeof back.address === 'string' ? back.address : null;
  } catch {
    return null;
  }
}
