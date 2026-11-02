import { useSyncExternalStore } from 'react';
import { onPageReturn } from './page-return';
import { local, read as readStored, write as writeStored } from './storage';

/*
 * The page's text size: the one chosen on this device, or else the phone's Text Size, which an iPhone's web view ignores unless the page asks for it (WebKit bug 187013, closed as
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

/**
 * The sizes a person can choose, as scales: the Mac window's View > Zoom steps from 85% to 200%
 * (tauri/window/plugin/src/mac.rs, ZOOM_LEVELS), shown as percentages.
 */
export const TEXT_SIZES = [0.85, 1, 1.15, 1.25, 1.5, 1.75, 2] as const;

export type TextSize = (typeof TEXT_SIZES)[number];

/** Where this device keeps the chosen size, in the browser's own storage, apart from any account. */
const CHOICE_KEY = 'app-kit:text-size';

/**
 * The page's text size: `scale`, what the page draws at; `choice`, the size chosen on this device, or null to follow
 * the phone; and `phone`, the phone's own Text Size as a scale, or null where there is none to follow, as on a Mac.
 */
export type TextSizeState = { scale: number; choice: TextSize | null; phone: number | null };

type Listener = () => void;

const listeners = new Set<Listener>();
let state: TextSizeState | null = null;
let stopReturn: (() => void) | null = null;
/** The root's inline font size before the kit first set it, often none. */
let appRootSize: string | null = null;

/**
 * The phone's Text Size as a scale: 1 at the default, about 0.82 at the smallest, about 3.12 at the largest
 * accessibility size. Null off an iPhone or iPad: the style is Apple's, and a Mac answers a size of its own.
 */
function readScale(): number | null {
  if (!hasPhoneSize()) return null;
  const kept = watched?.probe;
  const probe = kept ?? placeProbe();
  const px = parseFloat(getComputedStyle(probe).fontSize);
  if (!kept) probe.remove();
  if (!(px >= SMALLEST_BODY_PX)) return null;
  return Math.round((px / DEFAULT_BODY_PX) * 100) / 100;
}

/** Whether this is a touch device that knows Apple's body text style, and so may have a Text Size to follow. */
const hasPhoneSize = () => CSS.supports('font', '-apple-system-body') && navigator.maxTouchPoints > 0;

/** A hidden element in Apple's body text style, put in the page, which the setting sizes. */
function placeProbe(): HTMLElement {
  const probe = document.createElement('span');
  probe.style.setProperty('font', '-apple-system-body', 'important');
  // Fixed at the top corner, so a probe kept in the page never adds to what scrolls below a full-height app.
  probe.style.position = 'fixed';
  probe.style.top = '0';
  probe.style.left = '0';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.setAttribute('aria-hidden', 'true');
  probe.textContent = 'x';
  (document.body ?? document.documentElement).append(probe);
  return probe;
}

/**
 * The probe kept in the page while the kit follows, and what watches it. Text Size changed from Control Center's
 * slider leaves the app in front, so no page event says so; the probe changes size at once, and a resize observer sees
 * it (recorded on a simulated iPhone's Safari, 2026-11-02: the observer fired with the change, and no focus,
 * visibility or pageshow event did).
 */
let watched: { probe: HTMLElement; observer: ResizeObserver } | null = null;

function watchPhoneSize() {
  if (watched || !hasPhoneSize() || typeof ResizeObserver === 'undefined') return;
  const probe = placeProbe();
  const observer = new ResizeObserver(() => read());
  observer.observe(probe);
  watched = { probe, observer };
}

/** The size chosen on this device, or null for none: blocked storage, or a value that is not one of the sizes. */
function readChoice(): TextSize | null {
  const stored = Number(readStored(local, CHOICE_KEY));
  return TEXT_SIZES.find((size) => size === stored) ?? null;
}

/** Reads the choice and the phone, and sets the root's size when the scale they give has changed. */
function read() {
  const choice = readChoice();
  const phone = readScale();
  const next = choice ?? phone ?? 1;
  if (state && state.scale === next && state.choice === choice && state.phone === phone) return;
  const scaleChanged = state?.scale !== next;
  state = { scale: next, choice, phone };
  if (scaleChanged) setRoot(next);
  for (const listener of listeners) listener();
}

function setRoot(next: number) {
  const html = document.documentElement;
  html.style.setProperty('--text-scale', String(next));
  // The app's own root size, inline or from its styles, is what the scale multiplies, and what a scale of 1 leaves.
  appRootSize ??= html.style.fontSize;
  html.style.fontSize = appRootSize;
  if (next !== 1) html.style.fontSize = `${parseFloat(getComputedStyle(html).fontSize) * next}px`;
}

/**
 * Makes the page's text follow the size chosen on this device, or else the phone's Text Size: multiplies the root font
 * size, the app's own or the browser's, so every size in rem follows, and sets the `--text-scale` variable, for a size
 * in pixels as `calc(14px * var(--text-scale, 1))`. Reads both again each time the page comes back in front, as after
 * the size was chosen in another tab, and watches for a change of the phone's setting, which can be made with the app
 * still in front, from Control Center. Called once at start; later calls do nothing.
 */
export function followTextSize(): void {
  if (stopReturn) return;
  read();
  stopReturn = onPageReturn(read);
  watchPhoneSize();
}

/**
 * Sets the size on this device, one of TEXT_SIZES, or null to follow the phone again, and draws the page at it at
 * once. It replaces the phone's size rather than multiplying it.
 */
export function chooseTextSize(size: TextSize | null): void {
  writeStored(local, CHOICE_KEY, size === null ? null : String(size));
  followTextSize();
  read();
}

/** Re-renders with the page's text size as a scale, for a layout that changes at large sizes. Follows it too. */
export function useTextScale(): number {
  return useSyncExternalStore(subscribe, currentScale, () => 1);
}

/** Re-renders with the page's text size, the choice and the phone's, for a setting that shows them. Follows it too. */
export function useTextSize(): TextSizeState {
  return useSyncExternalStore(subscribe, current, () => SERVER_STATE);
}

const SERVER_STATE: TextSizeState = { scale: 1, choice: null, phone: null };

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  followTextSize();
  return () => listeners.delete(listener);
}

function current(): TextSizeState {
  if (state === null) read();
  return state ?? SERVER_STATE;
}

const currentScale = () => current().scale;

/** Back to nothing read and nothing listening, with the root as it was, between tests. */
export function resetTextSize(): void {
  stopReturn?.();
  stopReturn = null;
  watched?.observer.disconnect();
  watched?.probe.remove();
  watched = null;
  state = null;
  listeners.clear();
  document.documentElement.style.removeProperty('--text-scale');
  document.documentElement.style.fontSize = appRootSize ?? document.documentElement.style.fontSize;
  appRootSize = null;
}
