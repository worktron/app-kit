import { local, read, session, write, type KeyValueStore } from '../storage';

const SIGNED_IN_KEY = 'app-kit.signedIn';
const ACCOUNT_KEY = 'app-kit.lastAccount';
const RETURN_KEY = 'app-kit.returnTo';

/** Whether this browser was signed in when it last looked, so the page drawn while the provider loads matches the next. */
export function lastSignedIn(store: () => KeyValueStore = local): boolean | null {
  const value = read(store, SIGNED_IN_KEY);
  return value === null ? null : value === '1';
}

export function rememberSignedIn(signedIn: boolean, store: () => KeyValueStore = local): void {
  write(store, SIGNED_IN_KEY, signedIn ? '1' : '0');
}

/**
 * The email this app last signed in with on this device, offered as Continue as that account. Google does not tell
 * an app which accounts the browser holds, so this is the best guess there is.
 */
export function lastAccount(store: () => KeyValueStore = local): string | null {
  return read(store, ACCOUNT_KEY);
}

export function rememberAccount(email: string, store: () => KeyValueStore = local): void {
  write(store, ACCOUNT_KEY, email);
}

/** The address the person was at, as a path with its query and fragment. */
export function currentAddress(): string {
  return window.location.pathname + window.location.search + window.location.hash;
}

/** Kept for the trip to Google and back, in this tab only. */
export function rememberReturn(address: string, store: () => KeyValueStore = session): void {
  write(store, RETURN_KEY, address);
}

/** The address kept before the trip to Google, removed as it is read; the root when none was kept. */
export function takeReturn(store: () => KeyValueStore = session): string {
  const address = read(store, RETURN_KEY);
  write(store, RETURN_KEY, null);
  // Only a path on this site, never another site's address.
  return address && address.startsWith('/') && !address.startsWith('//') ? address : '/';
}
