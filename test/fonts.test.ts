import { afterEach, beforeEach, expect, jest, test } from 'bun:test';
import { FONT_WAIT_MS, waitForFonts } from '../web/fonts';

type Load = { face: string; settle: (found: unknown[]) => void; fail: (error: Error) => void };
let loads: Load[];

/**
 * A document.fonts that holds each load until the test settles it. Like the browser's, its load fails when called
 * without its own object, and takes a second argument only as the text to load for.
 */
function fontSet() {
  const set = {
    load(this: unknown, face: string, text?: unknown) {
      if (this !== set) throw new TypeError('Illegal invocation');
      if (text !== undefined && typeof text !== 'string') throw new TypeError(`load was given ${String(text)} as its text`);
      return new Promise<unknown[]>((settle, fail) => loads.push({ face, settle, fail }));
    },
  };
  return set;
}

const realFonts = Object.getOwnPropertyDescriptor(document, 'fonts');

beforeEach(() => {
  loads = [];
  jest.useFakeTimers();
  Object.defineProperty(document, 'fonts', { value: fontSet(), configurable: true });
});

afterEach(() => {
  jest.useRealTimers();
  if (realFonts) Object.defineProperty(document, 'fonts', realFonts);
  else delete (document as { fonts?: unknown }).fonts;
});

/** Whether the promise has settled, once every microtask has run. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(() => (done = true));
  for (let i = 0; i < 10; i++) await Promise.resolve();
  return done;
}

test('waits for every face, and is done once all are in', async () => {
  const waited = waitForFonts(['500 1em "Display"', '400 1em "Body"']);
  expect(loads.map((l) => l.face)).toEqual(['500 1em "Display"', '400 1em "Body"']);
  loads[0]!.settle([{}]);
  expect(await settled(waited)).toBe(false);
  loads[1]!.settle([{}]);
  expect(await settled(waited)).toBe(true);
});

test('gives up after FONT_WAIT_MS, so a slow connection still gets the page', async () => {
  const waited = waitForFonts(['500 1em "Display"']);
  jest.advanceTimersByTime(FONT_WAIT_MS - 1);
  expect(await settled(waited)).toBe(false);
  jest.advanceTimersByTime(1);
  expect(await settled(waited)).toBe(true);
});

test('a face that fails to load draws in the fallbacks rather than failing', async () => {
  const waited = waitForFonts(['500 1em "Display"']);
  loads[0]!.fail(new Error('network'));
  expect(await settled(waited)).toBe(true);
});

test('a page with no font loading at all is done at once', async () => {
  Object.defineProperty(document, 'fonts', { value: undefined, configurable: true });
  expect(await settled(waitForFonts(['500 1em "Display"']))).toBe(true);
});
