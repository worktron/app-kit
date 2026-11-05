import { useEffect, useRef } from 'react';

/**
 * When the pointer may act without a click. Every surface where the pointer lights, selects or focuses something goes
 * through this one rule, so they all answer the same hand the same way. The menu bar theme's `PointerIntent`
 * (swift/menu-bar) is the same rule in Swift, held to these numbers by `test/hover-intent-swift.test.ts`.
 *
 * 1. A pointer that has not moved does nothing. Its first report after a key, or after the window lost the keyboard,
 *    only marks where it rests.
 * 2. Once it has travelled TRAVEL_PX in a straight line from there, it has reached: `onOver` hears the target under it
 *    at once and on every change, so a row lights as the pointer enters it and goes dark as it leaves, as a menu's
 *    highlight does. A hand on the mouse nudges it a pixel or a few, back and forth, which never adds up to a travel:
 *    the distance is from one point, not summed.
 * 3. What it selects, opens or focuses waits for a hold: within HOLD_PX for the surface's wait (LIST_WAIT_MS in a
 *    list, FOCUS_WAIT_MS for focus), then `onHold`. A sweep on the way somewhere else opens nothing.
 * 4. A key pressed and the window losing the keyboard put it back to 1: the keyboard's choice stands until the pointer
 *    travels again. A click always acts, at once; that is the surface's own.
 *
 * Why not the movement a mouse event reports: WebKit reports the hardware's own delta, and a one-count report from a
 * resting hand passes a "moved at all" check (a command palette opened on a middle row, 2026-10-05). Headless UI,
 * Radix, React Aria, cmdk, Downshift and MUI's Autocomplete all take any real move. Radix Select's 10px release and
 * jQuery hoverIntent's settle (under 6px per 100ms) are the two rules this follows.
 *
 * Points are any one coordinate space per instance: screen coordinates for the page's own mouse events
 * (`screenPointOf`), which do not change when a list scrolls under a still pointer.
 */

/** How far the pointer must travel from where it rested before it lights anything. */
export const TRAVEL_PX = 16;
/** How still a holding pointer stays: a resting hand's drift, short of a move. */
export const HOLD_PX = 6;
/** A list selects or opens what the pointer holds on this long. */
export const LIST_WAIT_MS = 100;
/** Focus follows the pointer into a pane or a window once it holds this long. */
export const FOCUS_WAIT_MS = 250;

export interface Point {
  x: number;
  y: number;
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Where a page mouse event says the pointer is, on the screen. */
export const screenPointOf = (e: { screenX: number; screenY: number }): Point => ({ x: e.screenX, y: e.screenY });

export interface HoverIntentOptions<T> {
  /** How long the pointer holds before `onHold`: LIST_WAIT_MS or FOCUS_WAIT_MS. */
  waitMs: number;
  /** The pointer held on `target`: select, open or focus it. */
  onHold: (target: T, at: Point) => void;
  /** The pointer, having travelled, is over `target` now, or over nothing (null): light it. */
  onOver?: (target: T | null) => void;
  /** The pointer travelled, `moved` px from where it rested. */
  onTravel?: (moved: number) => void;
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}

export class HoverIntent<T> {
  /** Where the pointer rested; null until its next report says. */
  private rest: Point | null = null;
  private travelled = false;
  /** The last point heard: a report at the same spot is no move at all. */
  private last: Point | null = null;
  /** Where the hold being timed started, and what is under the pointer now. */
  private still: Point | null = null;
  private target: { value: T; at: Point } | null = null;
  /** What `onOver` last heard, so it hears each change once. */
  private over: T | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: HoverIntentOptions<T>) {}

  /** The pointer is at `p`, over `target`. */
  move(p: Point, target: T): void {
    if (this.last && this.last.x === p.x && this.last.y === p.y) {
      // The list moved under a still pointer, as a wheel scrolls it: what is lit follows, and a hold being timed comes
      // to nothing, since the pointer never moved to what is under it now.
      if (this.travelled && !Object.is(target, this.over)) {
        this.stopTimer();
        this.still = null;
        this.target = null;
        this.light(target);
      }
      return;
    }
    this.last = p;
    if (!this.rest) {
      this.rest = p;
      return;
    }
    if (!this.travelled) {
      const moved = distance(p, this.rest);
      if (moved < TRAVEL_PX) return;
      this.travelled = true;
      this.options.onTravel?.(moved);
    }
    this.target = { value: target, at: p };
    this.light(target);
    // Within the hold being timed, or the one already answered: a drift there is the same pause, never a second one.
    if (this.still && distance(p, this.still) <= HOLD_PX) return;
    this.still = p;
    this.stopTimer();
    const schedule = this.options.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    this.timer = schedule(() => {
      this.timer = undefined;
      const t = this.target;
      if (t) this.options.onHold(t.value, t.at);
    }, this.options.waitMs);
  }

  /** The pointer left the surface: whatever it was holding on comes to nothing, and nothing stays lit. */
  leave(): void {
    this.stopTimer();
    this.still = null;
    this.target = null;
    if (this.travelled) this.light(null);
  }

  /**
   * A key, or the keyboard going elsewhere: what the pointer lit goes dark, so only the keyboard's choice shows, and
   * the next report marks a new rest.
   */
  restart(): void {
    this.stopTimer();
    this.still = null;
    this.target = null;
    this.light(null);
    this.rest = null;
    this.last = null;
    this.travelled = false;
  }

  /** Has the pointer travelled since it last rested? */
  get hasTravelled(): boolean {
    return this.travelled;
  }

  private light(target: T | null): void {
    if (Object.is(target, this.over)) return;
    this.over = target;
    this.options.onOver?.(target);
  }

  private stopTimer(): void {
    if (this.timer !== undefined) (this.options.cancel ?? clearTimeout)(this.timer);
    this.timer = undefined;
  }
}

/**
 * A surface's hover intent in the page: restarted by every key pressed in this window and by the window losing the
 * keyboard (its blur, and `onKeyboardLeft` where the app knows better, as a desktop app told by macOS does), and
 * stopped with the surface. The callbacks are read fresh each time they fire.
 */
export function useHoverIntent<T>(
  waitMs: number,
  onHold: (target: T, at: Point) => void,
  options: {
    onOver?: (target: T | null) => void;
    /** Calls back each time the window loses the keyboard; returns how to stop. */
    onKeyboardLeft?: (left: () => void) => () => void;
  } = {},
): HoverIntent<T> {
  const hold = useRef(onHold);
  hold.current = onHold;
  const over = useRef(options.onOver);
  over.current = options.onOver;
  const keyboardLeft = useRef(options.onKeyboardLeft);
  const ref = useRef<HoverIntent<T> | null>(null);
  if (!ref.current) {
    ref.current = new HoverIntent<T>({
      waitMs,
      onHold: (t, at) => hold.current(t, at),
      onOver: (t) => over.current?.(t),
    });
  }
  useEffect(() => {
    const intent = ref.current!;
    const restart = () => intent.restart();
    // Window, capture phase: ahead of every key handler that stops a key, which cannot stop another listener here.
    window.addEventListener('keydown', restart, true);
    window.addEventListener('blur', restart);
    const stopLeft = keyboardLeft.current?.(restart);
    return () => {
      intent.restart();
      window.removeEventListener('keydown', restart, true);
      window.removeEventListener('blur', restart);
      stopLeft?.();
    };
  }, []);
  return ref.current;
}
