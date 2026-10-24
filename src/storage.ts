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
