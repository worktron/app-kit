import { afterEach, expect, spyOn, test } from 'bun:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import { followTextSize, resetTextSize, useTextScale } from '../src/text-size';
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

const comeBack = () => window.dispatchEvent(new Event('focus'));
const root = () => document.documentElement.style;
const iPhone = (where: string) => readings.find((r) => r.where === where)!;

afterEach(() => {
  cleanup();
  resetTextSize();
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
