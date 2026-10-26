import { afterEach, expect, test } from 'bun:test';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterCrash, crashReload } from '../web/crash-reload';
import { ErrorBoundary } from '../web/ErrorBoundary';
import { RELOAD_GUARD_MS } from '../web/preload';
import type { KeyValueStore } from '../web/storage';

afterEach(() => {
  cleanup();
  for (const script of document.querySelectorAll('script')) script.remove();
});

function memory(): KeyValueStore {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

/** Storage as some private windows have it: every write refused. */
const blocked: KeyValueStore = {
  getItem: () => null,
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {},
};

const OLDER = '/assets/index-older.js';
const NEWER = '/assets/index-newer.js';
const LATER = '/assets/index-later.js';

/** Makes the simulated page a built one, running `entry`. */
function runBuild(entry: string) {
  const script = document.createElement('script');
  script.type = 'module';
  script.src = entry;
  document.head.append(script);
}

test('a crash on an older build reloads once toward the newer one, and a second crash with it served does not', () => {
  const store = memory();
  const at = 1_000_000;
  expect(crashReload({ running: OLDER, served: NEWER, typed: false, store: () => store, now: at }).reload).toBe(true);
  // A cache answered the reload with the older page, which crashes again, long after.
  const again = crashReload({ running: OLDER, served: NEWER, typed: false, store: () => store, now: at + 10 * RELOAD_GUARD_MS });
  expect(again).toEqual({ reload: false, reason: `the page already reloaded once toward ${NEWER}` });
});

test('the server serving the running build, or a page from the dev server, never reloads', () => {
  const store = () => memory();
  expect(crashReload({ running: NEWER, served: NEWER, typed: false, store }).reload).toBe(false);
  expect(crashReload({ running: null, served: NEWER, typed: false, store }).reload).toBe(false);
  expect(crashReload({ running: OLDER, served: null, typed: false, store }).reload).toBe(false);
});

test('two builds answering in turn reload once, then show the crash within the guard', () => {
  const store = memory();
  const at = 1_000_000;
  expect(crashReload({ running: OLDER, served: NEWER, typed: false, store: () => store, now: at }).reload).toBe(true);
  // The reload landed on the newer build, which crashes on the older server's answer moments later.
  expect(crashReload({ running: NEWER, served: OLDER, typed: false, store: () => store, now: at + 1_000 }).reload).toBe(false);
  // A deploy after the guard is a deploy: one more reload.
  expect(crashReload({ running: NEWER, served: LATER, typed: false, store: () => store, now: at + RELOAD_GUARD_MS + 1 }).reload).toBe(true);
});

test('with storage blocked the reload could not be remembered, so it is not made', () => {
  const decision = crashReload({ running: OLDER, served: NEWER, typed: false, store: () => blocked });
  expect(decision).toEqual({ reload: false, reason: 'storage is blocked, so a reload could not be remembered' });
});

test('a remembered reload that is not what was written counts as none', () => {
  const store = memory();
  store.setItem('app-kit.crashReload', 'null');
  expect(crashReload({ running: OLDER, served: NEWER, typed: false, store: () => store }).reload).toBe(true);
  store.setItem('app-kit.crashReload', '{"to":3}');
  expect(crashReload({ running: OLDER, served: LATER, typed: false, store: () => store, now: Date.now() + 2 * RELOAD_GUARD_MS }).reload).toBe(true);
});

test('typed text outside the part that crashed holds the reload back', () => {
  expect(crashReload({ running: OLDER, served: NEWER, typed: true, store: () => memory() })).toEqual({
    reload: false,
    reason: 'the page holds typed text a reload would lose',
  });
});

test('a server that never says which build it serves is given up on at the deadline', async () => {
  runBuild(OLDER);
  let reloads = 0;
  let aborted = false;
  const never = (signal: AbortSignal) =>
    new Promise<string | null>(() => {
      signal.addEventListener('abort', () => (aborted = true));
    });
  const quiet = console.info;
  console.info = () => {};
  try {
    expect(await afterCrash({ look: never, reload: () => reloads++, waitMs: 5, store: () => memory() })).toBe(false);
  } finally {
    console.info = quiet;
  }
  expect(reloads).toBe(0);
  expect(aborted).toBe(true);
});

function Broken(): never {
  throw new Error('Cannot read properties of undefined');
}

test('a built page draws the placeholder while it asks, never the crash, then the crash when the build is the same', async () => {
  runBuild(OLDER);
  const quiet = [console.error, console.info];
  const realFetch = globalThis.fetch;
  let answer: (html: string) => void = () => {};
  // The server's index page, held until the test lets it go, then naming the running build.
  globalThis.fetch = Object.assign(() => new Promise<Response>((resolve) => (answer = (html) => resolve(new Response(html)))), {
    preconnect: realFetch.preconnect,
  });
  console.error = () => {};
  console.info = () => {};
  try {
    render(
      <ErrorBoundary placeholder={<p>fixture</p>}>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByText('fixture')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    answer(`<script type="module" crossorigin src="${OLDER}"></script>`);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Cannot read properties of undefined'));
    expect(screen.queryByText('fixture')).toBeNull();
  } finally {
    globalThis.fetch = realFetch;
    [console.error, console.info] = quiet;
  }
});
