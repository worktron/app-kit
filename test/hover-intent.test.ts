// When the pointer may act without a click (app-kit/web's HoverIntent), on a clock the test turns by hand.
import { describe, expect, test } from 'bun:test';
import { renderHook } from '@testing-library/react';
import { HOLD_PX, HoverIntent, LIST_WAIT_MS, TRAVEL_PX, useHoverIntent, type Point } from '../web/hover-intent.ts';
import * as web from '../web/index.ts';

function harness() {
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const held: { target: string; at: Point }[] = [];
  const lit: (string | null)[] = [];
  const travels: number[] = [];
  const intent = new HoverIntent<string>({
    waitMs: LIST_WAIT_MS,
    onHold: (target, at) => held.push({ target, at }),
    onOver: (target) => lit.push(target),
    onTravel: (moved) => travels.push(moved),
    schedule: (fn, ms) => {
      timers.push({ fn, ms, live: true });
      return (timers.length - 1) as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: (t) => {
      timers[t as unknown as number]!.live = false;
    },
  });
  const elapse = () => {
    for (const t of timers.filter((t) => t.live)) {
      t.live = false;
      t.fn();
    }
  };
  const live = () => timers.filter((t) => t.live).length;
  return { intent, held, lit, travels, elapse, live, timers };
}

describe('a pointer that has not travelled does nothing', () => {
  test('a list opening under a resting pointer: its first report only marks where it rests', () => {
    const h = harness();
    h.intent.move({ x: 500, y: 300 }, 'row 5');
    h.elapse();
    expect(h.held).toEqual([]);
    expect(h.lit).toEqual([]);
  });

  test('a resting hand that jitters a few pixels back and forth never adds up to a travel', () => {
    const h = harness();
    h.intent.move({ x: 500, y: 300 }, 'row 5');
    for (let i = 0; i < 40; i++) h.intent.move({ x: 500 + (i % 2 ? 3 : -3), y: 300 + (i % 3) }, 'row 5');
    h.intent.move({ x: 500 + TRAVEL_PX - 1, y: 300 }, 'row 5');
    h.elapse();
    expect(h.live()).toBe(0);
    expect(h.held).toEqual([]);
    expect(h.lit).toEqual([]);
  });
});

describe('a pointer that has travelled lights at once and acts on a hold', () => {
  test('the row under it lights the moment it travels, and is held after the wait', () => {
    const h = harness();
    h.intent.move({ x: 500, y: 300 }, 'row 5');
    h.intent.move({ x: 500, y: 300 + TRAVEL_PX }, 'row 6');
    expect(h.travels).toEqual([TRAVEL_PX]);
    expect(h.lit).toEqual(['row 6']);
    expect(h.held).toEqual([]);
    expect(h.timers.at(-1)!.ms).toBe(LIST_WAIT_MS);
    h.elapse();
    expect(h.held).toEqual([{ target: 'row 6', at: { x: 500, y: 300 + TRAVEL_PX } }]);
  });

  test('a sweep lights each row it crosses, once each, and holds on none until it stops', () => {
    const h = harness();
    h.intent.move({ x: 500, y: 100 }, 'row 1');
    for (let y = 130; y <= 400; y += 30) h.intent.move({ x: 500, y }, `row at ${Math.floor(y / 60)}`);
    expect(h.lit).toEqual(['row at 2', 'row at 3', 'row at 4', 'row at 5', 'row at 6']);
    // Each move past HOLD_PX starts the wait over; only the last is live.
    expect(h.live()).toBe(1);
    h.intent.leave(); // and it went on out of the list
    expect(h.lit.at(-1)).toBeNull();
    h.elapse();
    expect(h.held).toEqual([]);
  });

  test('once travelled it stays travelled: the next row lights with no second travel', () => {
    const h = harness();
    h.intent.move({ x: 500, y: 300 }, 'row 5');
    h.intent.move({ x: 500, y: 340 }, 'row 6');
    h.elapse();
    h.intent.move({ x: 500, y: 350 }, 'row 7');
    expect(h.lit).toEqual(['row 6', 'row 7']);
    h.elapse();
    expect(h.held.map((s) => s.target)).toEqual(['row 6', 'row 7']);
  });

  test('a drift within HOLD_PX is the same wait, and holds on the row under it when it ends', () => {
    const h = harness();
    h.intent.move({ x: 500, y: 300 }, 'row 5');
    h.intent.move({ x: 500, y: 340 }, 'row 6');
    h.intent.move({ x: 500, y: 340 + HOLD_PX }, 'row 7'); // over a row's edge
    expect(h.live()).toBe(1);
    expect(h.lit).toEqual(['row 6', 'row 7']);
    h.elapse();
    expect(h.held.map((s) => s.target)).toEqual(['row 7']);
  });

  test('a jitter after a hold does not hold again; a real move does', () => {
    const h = harness();
    h.intent.move({ x: 500, y: 300 }, 'row 5');
    h.intent.move({ x: 500, y: 340 }, 'row 6');
    h.elapse();
    h.intent.move({ x: 502, y: 341 }, 'row 6');
    expect(h.live()).toBe(0);
    h.intent.move({ x: 500, y: 370 }, 'row 7');
    h.elapse();
    expect(h.held.map((s) => s.target)).toEqual(['row 6', 'row 7']);
  });

  test('a list scrolled under a still pointer moves what is lit, and holds on nothing the pointer never moved to', () => {
    const h = harness();
    h.intent.move({ x: 500, y: 300 }, 'row 5');
    h.intent.move({ x: 500, y: 330 }, 'row 6');
    h.intent.move({ x: 500, y: 330 }, 'row 9'); // the wheel moved the list, not the pointer
    expect(h.lit).toEqual(['row 6', 'row 9']);
    h.elapse();
    expect(h.held).toEqual([]);
  });

  test('before it travels, a list scrolled under it lights nothing', () => {
    const h = harness();
    h.intent.move({ x: 500, y: 300 }, 'row 5');
    h.intent.move({ x: 500, y: 300 }, 'row 9');
    expect(h.lit).toEqual([]);
  });
});

describe('the keyboard puts the pointer back to rest', () => {
  test("after a key, a bump neither lights nor holds: the arrows' choice stands", () => {
    const h = harness();
    h.intent.move({ x: 500, y: 300 }, 'row 5');
    h.intent.move({ x: 500, y: 340 }, 'row 6');
    h.elapse();
    h.intent.restart(); // the arrow key moved the selection elsewhere
    h.intent.move({ x: 501, y: 340 }, 'row 6');
    h.intent.move({ x: 503, y: 345 }, 'row 7');
    h.elapse();
    expect(h.lit).toEqual(['row 6']);
    expect(h.held.map((s) => s.target)).toEqual(['row 6']);
  });

  test('a key mid-wait cancels it', () => {
    const h = harness();
    h.intent.move({ x: 500, y: 300 }, 'row 5');
    h.intent.move({ x: 500, y: 340 }, 'row 6');
    h.intent.restart();
    h.elapse();
    expect(h.held).toEqual([]);
  });

  test('after a key, a real travel counts from where the pointer then rested, and lights the row it is over again', () => {
    const h = harness();
    h.intent.move({ x: 500, y: 300 }, 'row 5');
    h.intent.move({ x: 500, y: 340 }, 'row 6');
    h.intent.restart();
    h.intent.move({ x: 500, y: 341 }, 'row 6');
    h.intent.move({ x: 500, y: 341 + TRAVEL_PX }, 'row 6');
    expect(h.lit).toEqual(['row 6', 'row 6']);
    h.elapse();
    expect(h.held.map((s) => s.target)).toEqual(['row 6']);
  });
});

test('useHoverIntent restarts on a key anywhere in the window and on the window losing the keyboard', () => {
  let left: (() => void) | undefined;
  const { result, unmount } = renderHook(() =>
    useHoverIntent<string>(LIST_WAIT_MS, () => {}, {
      onKeyboardLeft: (callback) => {
        left = callback;
        return () => (left = undefined);
      },
    }),
  );
  const intent = result.current;
  const travel = () => {
    intent.move({ x: 0, y: 0 }, 'row');
    intent.move({ x: 0, y: TRAVEL_PX }, 'row');
    expect(intent.hasTravelled).toBe(true);
  };
  travel();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
  expect(intent.hasTravelled).toBe(false);
  travel();
  window.dispatchEvent(new Event('blur'));
  expect(intent.hasTravelled).toBe(false);
  travel();
  left!();
  expect(intent.hasTravelled).toBe(false);
  unmount();
  expect(left).toBeUndefined();
});

test('app-kit/web gives the hover intent', () => {
  expect(web.HoverIntent).toBe(HoverIntent);
  expect(web.useHoverIntent).toBe(useHoverIntent);
  expect(web.TRAVEL_PX).toBe(TRAVEL_PX);
});
