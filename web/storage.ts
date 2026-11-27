import { isAndroidApp } from './installed-app';

/** The parts of `Storage` the kit uses, so tests can pass stand-ins. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** A store's value, or null when there is none or storage is blocked, as in some private windows. */
export function read(store: () => KeyValueStore, key: string): string | null {
  try {
    return store().getItem(key);
  } catch {
    return null;
  }
}

/** Sets or, given null, removes a value. Blocked storage is ignored: every caller works without it, only less well. */
export function write(store: () => KeyValueStore, key: string, value: string | null): void {
  try {
    if (value === null) store().removeItem(key);
    else store().setItem(key, value);
  } catch {
    // Storage blocked: nothing is remembered.
  }
}

export const local = () => window.localStorage;
export const session = () => window.sessionStorage;

/**
 * The storage that lasts as long as this window: its tab's, except in the Android app, where Android ends an app it
 * keeps behind the browser, its tab's storage with it, and the browser's link back starts it afresh. There it is the
 * app's own lasting storage, which no other app or site reads, so a sign-in the window asked for still finds its note.
 */
export const thisWindow = (): KeyValueStore => (isAndroidApp() ? local() : session());
