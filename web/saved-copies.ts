import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ApiError, request } from './fetch';
import { onReconnect } from './connection';
import { runningEntry } from './new-build';
import { onPageReturn } from './page-return';
import { onSignedOut } from './sign-in/current';
import { usePerson } from './sign-in/SignInGate';
import { local } from './storage';

/** A screen's data as the server last sent it, and when. */
export type SavedCopy<T> = { data: T; fetchedAt: number };

/** The parts of `Storage` saved copies use: what the kit's other storage uses, and the listing that finds copies to delete. */
export type CopyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/**
 * One app's saved copies, made once by savedCopies and passed to useScreenData, useSavedCopy and useSaveAfterDraw,
 * the only ways in: each reads and writes the copies of the person signed in.
 */
export interface SavedCopies {
  readonly name: string;
}

type Kept = {
  /** Every copy of the app's starts with this. */
  all: string;
  /** This build's copies start with this; null on the dev server, where nothing is kept. */
  mine: string | null;
  store: () => CopyStore;
  /** The person whose copies are the only ones left under `mine`, once they have been read or saved for. */
  clearedFor: string | null;
};

const kept = new WeakMap<SavedCopies, Kept>();

/** The person a copy belongs to: who is signed in, or `anyone` in an app without the sign-in gate. */
const useOwner = () => usePerson()?.id ?? 'anyone';

/** The build this page is, named by its built entry without the folder and extension; null on the dev server, which has none. */
export function thisBuild(doc: Document = document): string | null {
  return runningEntry(doc)?.replace(/^\/assets\/|\.js$/g, '') ?? null;
}

function removeWhere(store: () => CopyStore, test: (key: string) => boolean) {
  try {
    const storage = store();
    const found: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null && test(key)) found.push(key);
    }
    for (const key of found) storage.removeItem(key);
  } catch {
    // Storage blocked: nothing was kept.
  }
}

/**
 * An app's saved copies of its screens, so a screen seen before paints at once on the next load while the fresh data
 * comes. Copies are kept per build of the page and per person, under `<name>:copy:<build>:<person>:<key>`, so a copy
 * saved by another build, in a shape this one may not draw, is never read, and neither is one saved for someone else.
 * Other builds' copies are deleted as this is made, others' copies the first time a person's are read, and every copy
 * when the sign-in gate learns nobody is signed in. The dev server has no build to tell one version of the code from
 * the next, so there nothing is kept. Only keys under `<name>:copy:` are touched, so the app's other storage under its
 * name is left alone. Made once, when the app's code loads.
 */
export function savedCopies(name: string, { build = thisBuild(), store = local }: { build?: string | null; store?: () => CopyStore } = {}): SavedCopies {
  const all = `${name}:copy:`;
  const mine = build === null ? null : `${all}${build}:`;
  removeWhere(store, (key) => key.startsWith(all) && (mine === null || !key.startsWith(mine)));
  const copies: SavedCopies = { name };
  const held: Kept = { all, mine, store, clearedFor: null };
  kept.set(copies, held);
  onSignedOut(() => {
    removeWhere(store, (key) => key.startsWith(all));
    held.clearedFor = null;
  });
  return copies;
}

/** Where `owner`'s copy under `key` is stored, or null when nothing is kept. Others' copies go the first time. */
function storageKey(copies: SavedCopies, owner: string, key: string): { store: () => CopyStore; at: string } | null {
  const held = kept.get(copies);
  if (!held?.mine) return null;
  const { mine, store } = held;
  // Encoded, so one id that holds a colon cannot read as the start of another's keys.
  const theirs = `${mine}${encodeURIComponent(owner)}:`;
  if (held.clearedFor !== owner) {
    held.clearedFor = owner;
    removeWhere(store, (k) => k.startsWith(mine) && !k.startsWith(theirs));
  }
  return { store, at: theirs + key };
}

function readCopy<T>(copies: SavedCopies, owner: string, key: string): SavedCopy<T> | null {
  const where = storageKey(copies, owner, key);
  if (!where) return null;
  try {
    const raw = where.store().getItem(where.at);
    return raw ? (JSON.parse(raw) as SavedCopy<T>) : null;
  } catch {
    return null;
  }
}

/** Saves a copy, or deletes it given null. */
function writeCopy(copies: SavedCopies, owner: string, key: string, copy: SavedCopy<unknown> | null) {
  const where = storageKey(copies, owner, key);
  if (!where) return;
  try {
    if (copy) where.store().setItem(where.at, JSON.stringify(copy));
    else where.store().removeItem(where.at);
  } catch {
    // Storage full or blocked: the screen still works, it only paints from the server next time.
  }
}

/** The copy saved under `key` for the person signed in, or null when there is none or storage is blocked. */
export function useSavedCopy<T>(copies: SavedCopies, key: string): SavedCopy<T> | null {
  const owner = useOwner();
  return useMemo(() => readCopy<T>(copies, owner, key), [copies, owner, key]);
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
  const owner = useOwner();
  // Whose the copy is: the person signed in when it was passed. One person's data still held as another signs in is theirs.
  const last = useRef<{ copy: SavedCopy<T> | null; owner: string }>({ copy: null, owner });
  useEffect(() => {
    const arrivedFor = copy === last.current.copy ? last.current.owner : owner;
    last.current = { copy, owner: arrivedFor };
    if (copy && arrivedFor === owner) writeCopy(copies, owner, key, copy);
  }, [copies, owner, key, copy]);
}

export type ScreenData<T> = {
  /** Only ever the data for the address asked for now, from its saved copy or the server; null until it is in. */
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

/** `copy` is set only for data the server just sent, which is saved once it has drawn. `owner` is whose data it is. */
type Held<T> = { path: string; owner: string; data: T | null; fetchedAt: number | null; failure: string | null; missing: boolean; copy: SavedCopy<T> | null };

/** A screen's state as it opens: the address's copy for the person, when there is one. */
function fromCopy<T>(copies: SavedCopies, path: string, owner: string): Held<T> {
  const copy = readCopy<T>(copies, owner, path);
  return { path, owner, data: copy?.data ?? null, fetchedAt: copy?.fetchedAt ?? null, failure: null, missing: false, copy: null };
}

/**
 * One screen's data from the server, through `request`, with its saved copy. The copy paints at once, and the screen
 * loads on open, again whenever the page comes back in front or the server can be reached again, keeping what is
 * shown while it loads. When the address changes, the new address's copy paints at once. Only the latest load's
 * answer counts: one for an address no longer shown, or overtaken by a later load, is dropped. A 404 deletes the
 * address's copy. An answer is saved as the copy only after it has drawn (useSaveAfterDraw), so call this in the
 * component that draws the data. When someone else signs in while the screen stays up, nothing of the last person's
 * is shown, kept as previous or saved: the screen starts again from the new person's copy.
 */
export function useScreenData<T>(copies: SavedCopies, path: string): ScreenData<T> {
  const owner = useOwner();
  const [state, setState] = useState<Held<T>>(() => fromCopy<T>(copies, path, owner));
  const shown = useRef({ path, owner });
  const latest = useRef(0);

  useLayoutEffect(() => {
    if (shown.current.path === path && shown.current.owner === owner) return;
    const samePerson = shown.current.owner === owner;
    shown.current = { path, owner };
    const next = fromCopy<T>(copies, path, owner);
    if (next.data !== null || !samePerson) setState(next);
    else setState((s) => ({ ...s, failure: null, missing: false }));
  }, [copies, owner, path]);

  const load = useCallback(async () => {
    const asked = ++latest.current;
    const counts = () => asked === latest.current && shown.current.path === path && shown.current.owner === owner;
    try {
      const data = await request<T>(path);
      if (!counts()) return;
      const copy = { data, fetchedAt: Date.now() };
      setState({ path, owner, ...copy, failure: null, missing: false, copy });
    } catch (e) {
      if (!counts()) return;
      if (e instanceof ApiError && e.status === 404) {
        writeCopy(copies, owner, path, null);
        setState({ path, owner, data: null, fetchedAt: null, failure: null, missing: true, copy: null });
      } else setState((s) => ({ ...s, failure: e instanceof Error ? e.message : String(e) }));
    }
  }, [copies, owner, path]);

  const theirs = state.owner === owner;
  useSaveAfterDraw(copies, state.path, theirs ? state.copy : null);

  useEffect(() => {
    void load();
    const stopReturn = onPageReturn(() => void load());
    const stopReconnect = onReconnect(() => void load());
    return () => {
      stopReturn();
      stopReconnect();
    };
  }, [load]);

  const current = theirs && state.path === path;
  return {
    data: current ? state.data : null,
    fetchedAt: current ? state.fetchedAt : null,
    failure: theirs ? state.failure : null,
    missing: current && state.missing,
    previous: theirs && !current ? state.data : null,
    reload: () => void load(),
  };
}
