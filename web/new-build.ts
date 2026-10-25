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
 * page is being used. A pull to refresh also looks, at once, through lookForNewBuild. Once one is waiting, the page
 * loads it by itself where nobody loses anything, unless `reloadsItself` is false: for an app whose view holds
 * something only in memory that a reload would lose, so only the person's Reload loads it.
 */
export function useNewBuild({ reloadsItself = true }: { reloadsItself?: boolean } = {}): boolean {
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
    const stopWatching = watchChoices();
    return () => {
      lookNow.delete(atOnce);
      stop();
      stopWatching();
    };
  }, []);

  useReloadWhileAway(newBuild && reloadsItself);
  return newBuild;
}

/** Fields a person types into: every input but those that are clicked or chosen, every textarea, and editable text. */
const NOT_TYPED = ['checkbox', 'radio', 'hidden', 'button', 'submit', 'reset', 'image', 'file', 'range', 'color'];
const TEXT_FIELDS = `textarea, input${NOT_TYPED.map((t) => `:not([type="${t}"])`).join('')}, [contenteditable="true"]`;

/** Controls a person chooses with, whose state no attribute shows once React controls them. */
const CHOICES = 'select, input[type="checkbox"], input[type="radio"]';

/**
 * The choices the person has changed since the page loaded. Whether a change was saved cannot be told from the page,
 * so a changed choice still on the page holds back the reload until the person reloads with the line's Reload.
 */
const changedChoices = new WeakSet<EventTarget>();
const noteChoice = (event: Event) => {
  if (event.target instanceof Element && event.target.matches(CHOICES)) changedChoices.add(event.target);
};

/** Notes each choice the person changes on the page, from now until the returned function stops it. */
export function watchChoices(doc: Document = document): () => void {
  doc.addEventListener('change', noteChoice, true);
  return () => doc.removeEventListener('change', noteChoice, true);
}

/** Whether the page holds something the person entered that a reload would lose: text in a field, or a choice they changed. */
export function unsavedInput(doc: Document = document): boolean {
  for (const field of doc.querySelectorAll<HTMLElement>(TEXT_FIELDS)) {
    const text = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.value : field.textContent;
    if (text && text.trim()) return true;
  }
  for (const choice of doc.querySelectorAll(CHOICES)) if (changedChoices.has(choice)) return true;
  return false;
}

/**
 * Once a newer build is waiting, the page loads it by itself only where nobody loses anything: as soon as it is
 * hidden, or after IDLE_MS with nothing touched, and either way only with nothing entered (unsavedInput). Otherwise the line's Reload
 * is the way.
 */
function useReloadWhileAway(newBuild: boolean) {
  useEffect(() => {
    if (!newBuild) return;
    const reload = () => window.location.reload();
    const hidden = () => {
      if (document.visibilityState === 'hidden' && !unsavedInput()) reload();
    };
    let idle: ReturnType<typeof setTimeout>;
    const wait = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        if (!unsavedInput()) reload();
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
