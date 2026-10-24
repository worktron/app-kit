import { read, session, write, type KeyValueStore } from './storage';

const KEY = 'web-client-kit.preloadReloadAt';

/** A second failure this soon after the reload is not a deploy, so the page shows the failure instead of reloading again. */
export const RELOAD_GUARD_MS = 30_000;

/**
 * A tab open across a deploy asks for screen code that no longer exists, and Vite says so with `vite:preloadError`.
 * The page then reloads once, onto the new build. Call it once, before the app renders.
 * Returns the function that stops listening.
 */
export function reloadOnFailedLoad(
  { win = window, store = session, reload = () => window.location.reload() }: { win?: EventTarget; store?: () => KeyValueStore; reload?: () => void } = {},
): () => void {
  const failed = (event: Event) => {
    const last = Number(read(store, KEY) ?? 0);
    if (Date.now() - last < RELOAD_GUARD_MS) return;
    write(store, KEY, String(Date.now()));
    // Stops Vite throwing the error, since the page is going.
    event.preventDefault();
    reload();
  };
  win.addEventListener('vite:preloadError', failed);
  return () => win.removeEventListener('vite:preloadError', failed);
}
