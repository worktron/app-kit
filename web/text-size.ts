import { useSyncExternalStore } from 'react';
import { onPageReturn } from './page-return';

/*
 * The phone's Text Size, which an iPhone's web view ignores unless the page asks for it (WebKit bug 187013, closed as
 * won't fix). An element in Apple's body text style, `font: -apple-system-body`, takes the size the person chose, in
 * Safari and in the web view a Tauri app runs in, so measuring one against the style's default gives the scale.
 *
 * test/fixtures/text-size-readings.json holds what each place answered, recorded on a simulated iPhone booted with
 * `xcrun simctl boot` alone, never the Simulator app: `xcrun simctl ui <udid> content_size <size>` sets Text Size,
 * `xcrun simctl openurl <udid> <url>` opens the page in Safari, `xcrun simctl io <udid> screenshot <file>` shows it,
 * with `xcrun simctl create`, `bootstatus -b`, `shutdown` and `delete` around them.
 */

/** What Apple's body text style answers at the default Text Size, Large. */
export const DEFAULT_BODY_PX = 17;

/** What it answers at the smallest Text Size. A Mac's Safari knows the style too and answers 13, its fixed size. */
export const SMALLEST_BODY_PX = 14;

type Listener = () => void;

const listeners = new Set<Listener>();
let scale: number | null = null;
let stopReturn: (() => void) | null = null;
/** The root's inline font size before the kit first set it, often none. */
let appRootSize: string | null = null;

/**
 * The phone's Text Size as a scale: 1 at the default, about 0.82 at the smallest, about 3.12 at the largest
 * accessibility size. Always 1 off an iPhone or iPad: the style is Apple's, and a Mac answers a size of its own.
 */
function readScale(): number {
  if (!CSS.supports('font', '-apple-system-body') || navigator.maxTouchPoints === 0) return 1;
  const probe = document.createElement('span');
  probe.style.setProperty('font', '-apple-system-body', 'important');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.textContent = 'x';
  (document.body ?? document.documentElement).append(probe);
  const px = parseFloat(getComputedStyle(probe).fontSize);
  probe.remove();
  if (!(px >= SMALLEST_BODY_PX)) return 1;
  return Math.round((px / DEFAULT_BODY_PX) * 100) / 100;
}

function read() {
  const next = readScale();
  if (next === scale) return;
  scale = next;
  const html = document.documentElement;
  html.style.setProperty('--text-scale', String(next));
  // The app's own root size, inline or from its styles, is what the scale multiplies, and what a scale of 1 leaves.
  appRootSize ??= html.style.fontSize;
  html.style.fontSize = appRootSize;
  if (next !== 1) html.style.fontSize = `${parseFloat(getComputedStyle(html).fontSize) * next}px`;
  for (const listener of listeners) listener();
}

/**
 * Makes the page's text follow the phone's Text Size: multiplies the root font size, the app's own or the browser's,
 * so every size in rem follows, and sets the `--text-scale` variable, for a size in pixels as
 * `calc(14px * var(--text-scale, 1))`. Reads it again each time the page comes back in front, since changing the
 * setting means leaving the app. Called once at start; later calls do nothing.
 */
export function followTextSize(): void {
  if (stopReturn) return;
  read();
  stopReturn = onPageReturn(read);
}

/** Re-renders with the phone's Text Size as a scale, for a layout that changes at large sizes. Follows it too. */
export function useTextScale(): number {
  return useSyncExternalStore(subscribe, currentScale, () => 1);
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  followTextSize();
  return () => listeners.delete(listener);
}

function currentScale(): number {
  if (scale === null) read();
  return scale ?? 1;
}

/** Back to nothing read and nothing listening, with the root as it was, between tests. */
export function resetTextSize(): void {
  stopReturn?.();
  stopReturn = null;
  scale = null;
  listeners.clear();
  document.documentElement.style.removeProperty('--text-scale');
  document.documentElement.style.fontSize = appRootSize ?? document.documentElement.style.fontSize;
  appRootSize = null;
}
