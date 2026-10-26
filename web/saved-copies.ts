import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError, request } from './fetch';
import { onReconnect } from './connection';
import { runningEntry } from './new-build';
import { onPageReturn } from './page-return';
import { local } from './storage';

/** A screen's data as the server last sent it, and when. */
export type SavedCopy<T> = { data: T; fetchedAt: number };

/** The parts of `Storage` saved copies use: what the kit's other storage uses, and the listing that finds other builds' copies. */
export type CopyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** One app's saved copies, made once by savedCopies and passed to useScreenData or useSaveAfterDraw. */
export interface SavedCopies {
  /** The copy saved under `key` by this build, or null when there is none or storage is blocked. */
  read<T>(key: string): SavedCopy<T> | null;
}

/** The writer behind each SavedCopies, kept out of its interface so a copy is saved only through useSaveAfterDraw. */
const writers = new WeakMap<SavedCopies, (key: string, copy: SavedCopy<unknown>) => void>();

/** The build this page is, named by its built entry without the folder and extension; `dev` on the dev server, which has none. */
export function thisBuild(doc: Document = document): string {
  return runningEntry(doc)?.replace(/^\/assets\/|\.js$/g, '') ?? 'dev';
}

/**
 * An app's saved copies of its screens, so a screen seen before paints at once on the next load while the fresh data
 * comes. Copies are kept per build of the page, under `<name>:copy:<build>:<key>`, so a copy saved by another build, in
 * a shape this one may not draw, is never read; the other builds' copies are deleted as this is made, since nothing
 * reads them again. Only keys under `<name>:copy:` are touched, so the app's other storage under its name is left
 * alone. Made once, when the app's code loads.
 */
export function savedCopies(name: string, { build = thisBuild(), store = local }: { build?: string; store?: () => CopyStore } = {}): SavedCopies {
  const all = `${name}:copy:`;
  const mine = `${all}${build}:`;
  try {
    const storage = store();
    const others: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(all) && !key.startsWith(mine)) others.push(key);
    }
    for (const key of others) storage.removeItem(key);
  } catch {
    // Storage blocked: nothing was kept.
  }
  const copies: SavedCopies = {
    read<T>(key: string) {
      try {
        const raw = store().getItem(mine + key);
        return raw ? (JSON.parse(raw) as SavedCopy<T>) : null;
      } catch {
        return null;
      }
    },
  };
  writers.set(copies, (key, copy) => {
    try {
      store().setItem(mine + key, JSON.stringify(copy));
    } catch {
      // Storage full or blocked: the screen still works, it only paints from the server next time.
    }
  });
  return copies;
}

/**
 * Saves `copy` under `key` once the component calling this has drawn it. Effects run only for a draw React committed,
 * and a draw that throws commits none, so data this build cannot draw, such as a newer server's answer while a deploy
 * goes out or is rolled back, crashes that one draw and is never saved to crash the next load. Pass a new object only
 * for data the server just sent, never one rebuilt on every draw: each new one is saved again. Call it in the component
 * that draws the data, inside the error boundary that would catch its crash: a boundary below the caller lets the
 * caller's draw commit, and the copy is saved though its screen crashed.
 */
export function useSaveAfterDraw<T>(copies: SavedCopies, key: string, copy: SavedCopy<T> | null): void {
  useEffect(() => {
    if (copy) writers.get(copies)?.(key, copy);
  }, [copies, key, copy]);
}

export type ScreenData<T> = {
  /** Only ever the data for the address asked for now, from this build's saved copy or the server; null until it is in. */
  data: T | null;
  /** When the data shown was fetched, so a copy from an earlier visit can show its age. */
  fetchedAt: number | null;
  /** Why the last load failed, kept beside the data still shown. */
  failure: string | null;
  /** The server answered 404 for this address. */
  missing: boolean;
  /**
   * The last data for another address, such as the previous choice on a screen, while this one loads. A screen may
   * keep its frame standing from it, never present it as this address's data.
   */
  previous: T | null;
  /** Loads the address again, keeping what is shown while it loads. */
  reload: () => void;
};

/** `copy` is set only for data the server just sent, which is saved once it has drawn. */
type Held<T> = { path: string; data: T | null; fetchedAt: number | null; failure: string | null; missing: boolean; copy: SavedCopy<T> | null };

/**
 * One screen's data from the server, through `request`, with its saved copy. The copy paints at once, and the screen
 * loads on open, again whenever the page comes back in front or the server can be reached again, keeping what is
 * shown while it loads. When the address changes, the new address's copy paints at once, and an answer for an address
 * no longer shown is dropped. An answer is saved as the copy only after it has drawn (useSaveAfterDraw), so call this
 * in the component that draws the data.
 */
export function useScreenData<T>(copies: SavedCopies, path: string): ScreenData<T> {
  const [state, setState] = useState<Held<T>>(() => {
    const copy = copies.read<T>(path);
    return { path, data: copy?.data ?? null, fetchedAt: copy?.fetchedAt ?? null, failure: null, missing: false, copy: null };
  });
  const shown = useRef(path);

  useLayoutEffect(() => {
    if (shown.current === path) return;
    shown.current = path;
    const copy = copies.read<T>(path);
    if (copy) setState({ path, data: copy.data, fetchedAt: copy.fetchedAt, failure: null, missing: false, copy: null });
    else setState((s) => ({ ...s, failure: null, missing: false }));
  }, [copies, path]);

  const load = useCallback(async () => {
    try {
      const data = await request<T>(path);
      if (shown.current !== path) return;
      const copy = { data, fetchedAt: Date.now() };
      setState({ path, ...copy, failure: null, missing: false, copy });
    } catch (e) {
      if (shown.current !== path) return;
      if (e instanceof ApiError && e.status === 404) setState({ path, data: null, fetchedAt: null, failure: null, missing: true, copy: null });
      else setState((s) => ({ ...s, failure: e instanceof Error ? e.message : String(e) }));
    }
  }, [path]);

  useSaveAfterDraw(copies, state.path, state.copy);

  useEffect(() => {
    void load();
    const stopReturn = onPageReturn(() => void load());
    const stopReconnect = onReconnect(() => void load());
    return () => {
      stopReturn();
      stopReconnect();
    };
  }, [load]);

  const current = state.path === path;
  return {
    data: current ? state.data : null,
    fetchedAt: current ? state.fetchedAt : null,
    failure: state.failure,
    missing: current && state.missing,
    previous: current ? null : state.data,
    reload: () => void load(),
  };
}
