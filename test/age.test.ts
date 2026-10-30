// How long ago something happened (app-kit/web/age), on a fixed clock in named time zones, and useNow's ticking.
import { expect, jest, setSystemTime, spyOn, test } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { age } from '../web/age.ts';
import { NOW_TICK_MS, useNow } from '../web/now.ts';
import * as web from '../web/index.ts';

const NEW_YORK = { timeZone: 'America/New_York', locale: 'en-US' };
/** 3:00 in the afternoon in New York on Thursday 2026-10-29 (19:00 UTC). */
const NOW = Date.parse('2026-10-29T19:00:00Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

test('each threshold writes its own words, in minutes, hours, yesterday and days', () => {
  const ago = (ms: number) => age(NOW - ms, NOW, NEW_YORK);
  expect(ago(0)).toBe('just now');
  expect(ago(59_999)).toBe('just now');
  expect(ago(MINUTE)).toBe('1m ago');
  expect(ago(59 * MINUTE + 59_999)).toBe('59m ago');
  expect(ago(HOUR)).toBe('1h ago');
  expect(ago(14 * HOUR + 59 * MINUTE)).toBe('14h ago'); // 12:01 this morning
  expect(ago(15 * HOUR + MINUTE)).toBe('yesterday'); // 11:59 last night
  expect(ago(38 * HOUR)).toBe('yesterday'); // 1:00 yesterday morning
  expect(ago(40 * HOUR)).toBe('2d ago');
  expect(ago(6 * 24 * HOUR)).toBe('6d ago');
  expect(ago(7 * 24 * HOUR)).toBe('Oct 22');
  expect(age(Date.parse('2025-12-30T17:00:00Z'), NOW, NEW_YORK)).toBe('Dec 30, 2025');
  expect(age(new Date(NOW - 5 * MINUTE), new Date(NOW), NEW_YORK)).toBe('5m ago');
});

test("days are the reader's calendar days: late one evening read early two mornings later is 2d ago", () => {
  const lateMonday = Date.parse('2026-10-27T03:00:00Z'); // 11:00 at night on Monday in New York
  const earlyWednesday = Date.parse('2026-10-28T05:00:00Z'); // 1:00 on Wednesday morning, 26 hours on
  expect(age(lateMonday, earlyWednesday, NEW_YORK)).toBe('2d ago');
  // Twenty minutes across midnight is still minutes, and two hours across it is yesterday.
  expect(age(earlyWednesday - 20 * MINUTE, earlyWednesday, NEW_YORK)).toBe('20m ago');
  expect(age(earlyWednesday - 2 * HOUR, earlyWednesday, NEW_YORK)).toBe('yesterday');
});

test('midnight falls where the reader is: the same two moments are hours in one time zone and yesterday in another', () => {
  const evening = Date.parse('2026-10-29T21:00:00Z'); // 5pm in New York, 6am on the 30th in Tokyo
  const later = Date.parse('2026-10-30T02:00:00Z'); // 10pm in New York, 11am in Tokyo
  expect(age(evening, later, NEW_YORK)).toBe('5h ago');
  expect(age(evening, later, { timeZone: 'Asia/Tokyo' })).toBe('5h ago');
  const tokyoLate = Date.parse('2026-10-29T14:30:00Z'); // 11:30pm in Tokyo, 10:30am in New York
  expect(age(tokyoLate, later, { timeZone: 'Asia/Tokyo' })).toBe('yesterday');
  expect(age(tokyoLate, later, NEW_YORK)).toBe('11h ago');
});

test('a date that is no date, as new Date(undefined) makes, or past the times a date can hold, writes unknown rather than crashing the screen', () => {
  expect(age(new Date(Number.NaN), NOW, NEW_YORK)).toBe('unknown');
  expect(age(NOW - MINUTE, Number.NaN, NEW_YORK)).toBe('unknown');
  expect(age(Number.POSITIVE_INFINITY, NOW, NEW_YORK)).toBe('unknown');
  expect(age(9e15, NOW, NEW_YORK)).toBe('unknown');
  expect(age(-9e15, NOW, NEW_YORK)).toBe('unknown');
});

test('a time ahead of the clock is just now within a minute, as a server a little ahead gives, and the date past that', () => {
  expect(age(NOW + 30_000, NOW, NEW_YORK)).toBe('just now');
  expect(age(NOW + 2 * 24 * HOUR, NOW, NEW_YORK)).toBe('Oct 31');
});

test("the date past a week is written in the reader's locale", () => {
  expect(age(NOW - 10 * 24 * HOUR, NOW, { timeZone: 'America/New_York', locale: 'en-GB' })).toBe('19 Oct');
});

test('useNow reads the clock once a minute while the page is in view, not at all while it is hidden, and at once on its return', () => {
  jest.useFakeTimers();
  setSystemTime(NOW);
  const show = (state: DocumentVisibilityState) => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
  };
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  try {
    const { result, unmount } = renderHook(() => useNow());
    expect(result.current).toBe(NOW);
    // Bun's fake timers move Date.now() with them.
    const step = (ms: number) => act(() => void jest.advanceTimersByTime(ms));
    step(NOW_TICK_MS);
    expect(result.current).toBe(NOW + NOW_TICK_MS);
    expect(age(NOW - 5 * MINUTE, result.current, NEW_YORK)).toBe('6m ago');
    show('hidden');
    const reads = spyOn(Date, 'now');
    step(30 * NOW_TICK_MS);
    expect(reads).not.toHaveBeenCalled();
    reads.mockRestore();
    expect(result.current).toBe(NOW + NOW_TICK_MS);
    show('visible');
    expect(result.current).toBe(NOW + 31 * NOW_TICK_MS);
    step(NOW_TICK_MS);
    expect(result.current).toBe(NOW + 32 * NOW_TICK_MS);
    // A return that shows only as focus, as the sheet a phone's home-screen app opens Google in, or as a page brought
    // back from the back-forward cache, reads the clock at once too.
    step(NOW_TICK_MS / 2);
    act(() => void window.dispatchEvent(new Event('focus')));
    expect(result.current).toBe(NOW + 32.5 * NOW_TICK_MS);
    step(NOW_TICK_MS / 4);
    const restored = new Event('pageshow') as Event & { persisted: boolean };
    Object.defineProperty(restored, 'persisted', { value: true });
    act(() => void window.dispatchEvent(restored));
    expect(result.current).toBe(NOW + 32.75 * NOW_TICK_MS);
    unmount();
  } finally {
    jest.useRealTimers();
    setSystemTime();
    delete (document as { visibilityState?: unknown }).visibilityState;
  }
});

test('app-kit/web gives age and useNow too', () => {
  expect(web.age).toBe(age);
  expect(web.useNow).toBe(useNow);
});

test('a server imports age by app-kit/web/age with nothing else coming with it, React and MUI included', async () => {
  const source = await Bun.file(new URL('../web/age.ts', import.meta.url)).text();
  expect(source).not.toMatch(/^\s*import\s/m);
  const { exports } = (await import('../package.json')).default as { exports: Record<string, string> };
  expect(exports['./web/age']).toBe('./web/age.ts');
});
