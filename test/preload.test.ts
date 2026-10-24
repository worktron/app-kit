import { expect, test } from 'bun:test';
import { reloadOnFailedLoad, RELOAD_GUARD_MS } from '../src/preload';
import type { KeyValueStore } from '../src/storage';

function memory(): KeyValueStore {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

const failedLoad = () => new Event('vite:preloadError', { cancelable: true });

test('a screen whose code fails to load reloads the page once, and a second failure right after shows instead', () => {
  const win = new EventTarget();
  const store = memory();
  let reloads = 0;
  reloadOnFailedLoad({ win, store: () => store, reload: () => reloads++ });

  const first = failedLoad();
  win.dispatchEvent(first);
  expect(reloads).toBe(1);
  expect(first.defaultPrevented).toBe(true);

  // The same tab after the reload, still failing: not a deploy, so the error goes on to the error boundary.
  const second = failedLoad();
  win.dispatchEvent(second);
  expect(reloads).toBe(1);
  expect(second.defaultPrevented).toBe(false);
});

test('a failure long after the last reload reloads again', () => {
  const win = new EventTarget();
  const store = memory();
  store.setItem('app-kit.preloadReloadAt', String(Date.now() - RELOAD_GUARD_MS - 1));
  let reloads = 0;
  reloadOnFailedLoad({ win, store: () => store, reload: () => reloads++ });
  win.dispatchEvent(failedLoad());
  expect(reloads).toBe(1);
});
