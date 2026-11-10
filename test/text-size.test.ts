import { afterEach, expect, spyOn, test } from 'bun:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import { chooseTextSize, followTextSize, resetTextSize, TEXT_SIZES, textSizeScript, useTextScale, useTextSize } from '../web/text-size';
import readings from './fixtures/text-size-readings.json';

// Each place's answer, recorded: on a simulated iPhone's Safari at three Text Sizes, the scale being what the kit read
// there; and in Playwright's browsers on a Mac, where it reads 1. happy-dom answers none of it, so each test plays one.

type Place = { where: string; supports: boolean; touchPoints: number; bodyPx: number; scale: number };

const realCSS = Object.getOwnPropertyDescriptor(globalThis, 'CSS')!;
const realTouchPoints = Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints');
let computed: ReturnType<typeof spyOn> | null = null;

/** Makes the page answer as `place` did. happy-dom's CSS is a getter that returns a new object on every read. */
function playPlace(place: Pick<Place, 'supports' | 'touchPoints' | 'bodyPx'>) {
  Object.defineProperty(globalThis, 'CSS', { value: { supports: () => place.supports }, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: place.touchPoints, configurable: true });
  computed?.mockRestore();
  computed = spyOn(globalThis, 'getComputedStyle').mockImplementation(
    (element: Element) => ({ fontSize: element === document.documentElement ? rootSize() : `${place.bodyPx}px` }) as CSSStyleDeclaration,
  );
}

/** The root's size as a browser computes it: the app's inline size if it set one, else the 16px default. */
const rootSize = () => document.documentElement.style.fontSize || '16px';
/** The root size the kit sets at `scale` from a root of `px`. */
const scaled = (scale: number, px = 16) => (scale === 1 ? '' : `${px * scale}px`);

/** Where the kit keeps the size chosen on this device. */
const CHOICE_KEY = 'app-kit:text-size';

const comeBack = () => window.dispatchEvent(new Event('focus'));
const root = () => document.documentElement.style;
const iPhone = (where: string) => readings.find((r) => r.where === where)!;

afterEach(() => {
  cleanup();
  resetTextSize();
  // A root size a test set as the app's own, which resetTextSize puts back as it found it.
  document.documentElement.style.fontSize = '';
  localStorage.removeItem(CHOICE_KEY);
  computed?.mockRestore();
  computed = null;
  Object.defineProperty(globalThis, 'CSS', realCSS);
  if (realTouchPoints) Object.defineProperty(navigator, 'maxTouchPoints', realTouchPoints);
  else delete (navigator as { maxTouchPoints?: number }).maxTouchPoints;
});

test.each(readings as Place[])('$where reads $scale', (place) => {
  playPlace(place);
  followTextSize();
  expect(Number(root().getPropertyValue('--text-scale'))).toBe(place.scale);
  expect(root().fontSize).toBe(scaled(place.scale));
});

test('the recorded places include the smallest, the default and the largest iPhone sizes, and a Mac that reads 1', () => {
  expect(readings.map((r) => [r.where, r.scale])).toEqual(
    expect.arrayContaining([
      ['iPhone Safari, extra-small', expect.any(Number)],
      ['iPhone Safari, large', 1],
      ['iPhone Safari, accessibility-extra-extra-extra-large', expect.any(Number)],
      ['Mac WebKit', 1],
    ]),
  );
});

test('a change made away from the page is read when it comes back in front', () => {
  playPlace(iPhone('iPhone Safari, large'));
  followTextSize();
  expect(root().fontSize).toBe('');

  const largest = iPhone('iPhone Safari, accessibility-extra-extra-extra-large');
  playPlace(largest);
  comeBack();
  expect(root().getPropertyValue('--text-scale')).toBe(String(largest.scale));
  expect(root().fontSize).toBe(scaled(largest.scale));

  // And back to the default, which leaves the root to the app again.
  playPlace(iPhone('iPhone Safari, large'));
  comeBack();
  expect(root().fontSize).toBe('');
});

test("the app's own root size is what the scale multiplies, and a scale of 1 leaves it as the app set it", () => {
  root().fontSize = '18px';
  playPlace(iPhone('Mac WebKit'));
  followTextSize();
  expect(root().fontSize).toBe('18px');

  const largest = iPhone('iPhone Safari, accessibility-extra-extra-extra-large');
  playPlace(largest);
  comeBack();
  expect(parseFloat(root().fontSize)).toBeCloseTo(18 * largest.scale);

  playPlace(iPhone('iPhone Safari, large'));
  comeBack();
  expect(root().fontSize).toBe('18px');
  // A second change multiplies the app's size again, never the size the kit set.
  playPlace(largest);
  comeBack();
  expect(parseFloat(root().fontSize)).toBeCloseTo(18 * largest.scale);
});

test('following twice listens once', () => {
  playPlace(iPhone('iPhone Safari, large'));
  followTextSize();
  followTextSize();
  computed!.mockClear();
  comeBack();
  expect(computed!).toHaveBeenCalledTimes(1);
});

test('the hook draws at the phone\'s size from its first render, and again when it changes', () => {
  const smallest = iPhone('iPhone Safari, extra-small');
  playPlace(smallest);
  const renders: number[] = [];
  const { result } = renderHook(() => {
    const scale = useTextScale();
    renders.push(scale);
    return scale;
  });
  expect(renders[0]).toBe(smallest.scale);
  // The hook follows by itself, with no followTextSize call.
  expect(root().getPropertyValue('--text-scale')).toBe(String(smallest.scale));

  const largest = iPhone('iPhone Safari, accessibility-extra-extra-extra-large');
  playPlace(largest);
  act(comeBack);
  expect(result.current).toBe(largest.scale);
});

test('a page with no body yet still reads, and leaves nothing behind', () => {
  playPlace(iPhone('iPhone Safari, large'));
  const probes: Element[] = [];
  computed!.mockImplementation((element: Element) => {
    probes.push(element);
    expect(element.parentNode).toBe(document.documentElement);
    return { fontSize: '17px' } as CSSStyleDeclaration;
  });
  const body = document.body;
  body.remove();
  try {
    followTextSize();
  } finally {
    document.documentElement.append(body);
  }
  expect(probes).toHaveLength(1);
  expect(probes[0]!.isConnected).toBe(false);
});

test.each(readings as Place[])('a size chosen on this device replaces what $where reads', (place) => {
  playPlace(place);
  localStorage.setItem(CHOICE_KEY, '1.5');
  followTextSize();
  expect(root().getPropertyValue('--text-scale')).toBe('1.5');
  expect(root().fontSize).toBe('24px');
});

test('choosing a size draws the page at it at once, and choosing none follows the phone again', () => {
  const smallest = iPhone('iPhone Safari, extra-small');
  playPlace(smallest);
  followTextSize();
  chooseTextSize(2);
  expect(root().fontSize).toBe('32px');
  expect(localStorage.getItem(CHOICE_KEY)).toBe('2');
  chooseTextSize(null);
  expect(localStorage.getItem(CHOICE_KEY)).toBeNull();
  expect(root().getPropertyValue('--text-scale')).toBe(String(smallest.scale));
  expect(root().fontSize).toBe(scaled(smallest.scale));
  // The default size chosen on a phone set smaller holds the page at the default.
  chooseTextSize(1);
  expect(root().fontSize).toBe('');
  expect(root().getPropertyValue('--text-scale')).toBe('1');
});

test('choosing a size works with no followTextSize call before it', () => {
  playPlace(iPhone('Mac WebKit'));
  chooseTextSize(1.25);
  expect(root().fontSize).toBe('20px');
});

test('a size chosen in another tab is read when the page comes back in front', () => {
  playPlace(iPhone('iPhone Safari, large'));
  followTextSize();
  localStorage.setItem(CHOICE_KEY, '1.75');
  comeBack();
  expect(root().fontSize).toBe('28px');
});

test('a stored value that is not one of the sizes, and storage the browser blocks, both follow the phone', () => {
  const largest = iPhone('iPhone Safari, accessibility-extra-extra-extra-large');
  playPlace(largest);
  localStorage.setItem(CHOICE_KEY, '3');
  followTextSize();
  expect(root().getPropertyValue('--text-scale')).toBe(String(largest.scale));
  resetTextSize();

  const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
  Object.defineProperty(window, 'localStorage', { get: () => { throw new DOMException('blocked', 'SecurityError'); }, configurable: true });
  try {
    followTextSize();
    expect(root().getPropertyValue('--text-scale')).toBe(String(largest.scale));
    // Choosing with storage blocked changes nothing and throws nothing.
    chooseTextSize(1.5);
    expect(root().getPropertyValue('--text-scale')).toBe(String(largest.scale));
  } finally {
    Object.defineProperty(window, 'localStorage', real);
  }
});

test("the setting's hook shows the choice and the phone's own size, re-rendering when either changes", () => {
  const smallest = iPhone('iPhone Safari, extra-small');
  playPlace(smallest);
  const { result } = renderHook(() => useTextSize());
  expect(result.current).toEqual({ scale: smallest.scale, choice: null, phone: smallest.scale });
  act(() => chooseTextSize(1.5));
  expect(result.current).toEqual({ scale: 1.5, choice: 1.5, phone: smallest.scale });
  // The scale is unchanged at 1.5, but the phone's size the setting shows still updates.
  const largest = iPhone('iPhone Safari, accessibility-extra-extra-extra-large');
  playPlace(largest);
  act(comeBack);
  expect(result.current).toEqual({ scale: 1.5, choice: 1.5, phone: largest.scale });
});

test('off an iPhone or iPad there is no phone size to follow, and the page draws at 1 until a size is chosen', () => {
  playPlace(iPhone('Mac WebKit'));
  const { result } = renderHook(() => useTextSize());
  expect(result.current).toEqual({ scale: 1, choice: null, phone: null });
  act(() => chooseTextSize(0.85));
  expect(result.current.scale).toBe(0.85);
  expect(TEXT_SIZES).toEqual([0.85, 1, 1.15, 1.25, 1.5, 1.75, 2]);
});

test('a change made with the page still in front, as from Control Center, is read when the kept probe resizes', () => {
  // happy-dom lays nothing out, so its observer never fires: this one fires when the test says the probe resized.
  const observers: { callback: () => void; watching: Element[] }[] = [];
  const realObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    watching: Element[] = [];
    constructor(public callback: () => void) {
      observers.push(this);
    }
    observe(element: Element) {
      this.watching.push(element);
    }
    unobserve() {}
    disconnect() {
      this.watching = [];
    }
  } as unknown as typeof ResizeObserver;
  try {
    playPlace(iPhone('iPhone Safari, large'));
    followTextSize();
    expect(observers).toHaveLength(1);
    const [probe] = observers[0]!.watching;
    expect(probe!.isConnected).toBe(true);
    expect(probe!.getAttribute('aria-hidden')).toBe('true');
    // Fixed at the top corner, so it adds nothing to what scrolls below a full-height app.
    const { position, top, left } = (probe as HTMLElement).style;
    expect({ position, top, left }).toEqual({ position: 'fixed', top: '0px', left: '0px' });

    const largest = iPhone('iPhone Safari, accessibility-extra-extra-extra-large');
    playPlace(largest);
    observers[0]!.callback();
    expect(root().getPropertyValue('--text-scale')).toBe(String(largest.scale));
    expect(root().fontSize).toBe(scaled(largest.scale));

    // Stopping takes the probe out of the page.
    resetTextSize();
    expect(probe!.isConnected).toBe(false);
    expect(observers[0]!.watching).toEqual([]);
  } finally {
    globalThis.ResizeObserver = realObserver;
  }
});

test('off an iPhone or iPad nothing is kept in the page to watch', () => {
  playPlace(iPhone('Chromium'));
  const before = document.querySelectorAll('[aria-hidden="true"]').length;
  followTextSize();
  expect(document.querySelectorAll('[aria-hidden="true"]').length).toBe(before);
});

// A public page carries none of the app's code, only this script (web/public-pages.tsx): it must land the root where
// followTextSize does, for every recorded place, with and without a size chosen on this device.
const runScript = () => new Function(textSizeScript())();

test.each(readings as Place[])("a public page's script reads $where as followTextSize does", (place) => {
  playPlace(place);
  runScript();
  const script = { scale: root().getPropertyValue('--text-scale'), size: root().fontSize };
  document.documentElement.style.removeProperty('--text-scale');
  document.documentElement.style.fontSize = '';
  followTextSize();
  expect(script).toEqual({ scale: root().getPropertyValue('--text-scale'), size: root().fontSize });
  expect(Number(script.scale)).toBe(place.scale);
});

test("a public page's script takes the size chosen on this device, and skips one that is not a size", () => {
  playPlace(iPhone(readings[0]!.where));
  localStorage.setItem(CHOICE_KEY, '1.5');
  runScript();
  expect(root().getPropertyValue('--text-scale')).toBe('1.5');
  expect(root().fontSize).toBe('24px');
  document.documentElement.style.fontSize = '';
  playPlace({ supports: false, touchPoints: 0, bodyPx: 13 });
  localStorage.setItem(CHOICE_KEY, '1.3');
  runScript();
  expect(root().getPropertyValue('--text-scale')).toBe('1');
  expect(root().fontSize).toBe('');
});
