import { useEffect, useState } from 'react';
import { onPageReturn } from './page-return';

/** The least time between two looks at the index page, counted from when the page loaded. */
export const BUILD_CHECK_MS = 60_000;

/** How long with no key, pointer or scroll before a page with a newer build waiting reloads by itself. */
export const IDLE_MS = 10 * 60_000;

/*
 * Which build of the client a page is, told by its entry script. Vite names the built entry after a hash of what it
 * holds, so a deploy that changes the client changes the name, and one that changes only the server does not. The dev
 * server serves its sources rather than a built entry, so there a page has no build and never sees a newer one.
 */
const BUILT_ENTRY = /<script\b[^>]*\btype="module"[^>]*\bsrc="(\/assets\/[^"]+\.js)"/;

/** The built entry an index page names, or null when it names none. */
export function builtEntry(html: string): string | null {
  return BUILT_ENTRY.exec(html)?.[1] ?? null;
}

/** The built entry this page is running, read from its own script tag. */
export function runningEntry(doc: Document = document): string | null {
  for (const script of doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')) {
    const path = new URL(script.src, doc.baseURI).pathname;
    if (path.startsWith('/assets/') && path.endsWith('.js')) return path;
  }
  return null;
}

/** Whether the index page now names a different build than the one running. Both must be built ones. */
export function isNewBuild(running: string | null, served: string | null): boolean {
  return running !== null && served !== null && running !== served;
}

/** The looks of every page using useNewBuild, for lookForNewBuild. */
const lookNow = new Set<() => void>();

/** Looks for a newer build at once, without the minute's wait, as a pull to refresh asks. */
export function lookForNewBuild() {
  for (const look of lookNow) look();
}

/**
 * Whether a newer build of the client has been deployed since this page loaded. It looks when the page comes back in
 * front, a minute or more after it last looked, and never on a timer, so the line it brings never appears while the
 * page is being used. A pull to refresh also looks, at once, through lookForNewBuild.
 */
export function useNewBuild(): boolean {
  const [newBuild, setNewBuild] = useState(false);

  useEffect(() => {
    const running = runningEntry();
    if (!running) return;
    let lastLook = Date.now();
    const look = (now = false) => {
      if (!now && Date.now() - lastLook < BUILD_CHECK_MS) return;
      lastLook = Date.now();
      fetch('/', { cache: 'no-store' })
        .then((res) => (res.ok ? res.text() : ''))
        .then((html) => {
          if (isNewBuild(running, builtEntry(html))) setNewBuild(true);
        })
        // Offline, or the server is mid-deploy: the next return looks again.
        .catch(() => undefined);
    };
    const atOnce = () => look(true);
    lookNow.add(atOnce);
    const stop = onPageReturn(() => look());
    return () => {
      lookNow.delete(atOnce);
      stop();
    };
  }, []);

  useReloadWhileAway(newBuild);
  return newBuild;
}

const TEXT_FIELDS = 'textarea, input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], [contenteditable="true"]';

/** Whether a field on the page holds text, which a reload would lose. */
export function somethingTyped(doc: Document = document): boolean {
  for (const field of doc.querySelectorAll<HTMLElement>(TEXT_FIELDS)) {
    const text = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.value : field.textContent;
    if (text && text.trim()) return true;
  }
  return false;
}

/**
 * Once a newer build is waiting, the page loads it by itself only where nobody loses anything: as soon as it is
 * hidden, or after IDLE_MS with nothing touched and nothing typed. Otherwise the line's Reload is the way.
 */
function useReloadWhileAway(newBuild: boolean) {
  useEffect(() => {
    if (!newBuild) return;
    const reload = () => window.location.reload();
    const hidden = () => {
      if (document.visibilityState === 'hidden') reload();
    };
    let idle: ReturnType<typeof setTimeout>;
    const wait = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        if (!somethingTyped()) reload();
        else wait();
      }, IDLE_MS);
    };
    const touched = ['keydown', 'pointerdown', 'wheel', 'touchstart'];
    hidden();
    wait();
    document.addEventListener('visibilitychange', hidden);
    for (const name of touched) window.addEventListener(name, wait, { passive: true });
    return () => {
      clearTimeout(idle);
      document.removeEventListener('visibilitychange', hidden);
      for (const name of touched) window.removeEventListener(name, wait);
    };
  }, [newBuild]);
}
