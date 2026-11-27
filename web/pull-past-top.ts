import { useEffect, useRef, useState, type RefObject } from 'react';

/*
 * A pull down past the top of a page opens what is above it, such as a conversation's earlier messages, which sit closed
 * above the newest one. The app says whether a pull would do anything now (`on`) and what it does (`act`); the hook says
 * whether a drag under way would act on release, for the app's line to say "Release for earlier messages".
 *
 * Counted in finger travel from where, in the same touch, the page first reaches its top, so one drag from inside the
 * newest message that runs on past the top counts, and a flick that reaches the top only after the finger lifts never
 * does. One finger only; the drag's way is decided once it has gone `LOCK` points, and a sideways one (a swipe back, a
 * row's swipe) is never a pull. A drag that starts in a dialog, a menu or a list scrolled inside the page is never one
 * either. Nothing is prevented and every listener is passive, so iOS draws its own stretch past the top.
 *
 * Released past the pull, it acts once the page has come to rest at its top or below: iOS springs back from its
 * stretch, its scroll reading below zero until the spring ends, and Chromium applies what is left of the drag once there
 * is room above to scroll into, so what is drawn above while the page still moves would carry it off the newest
 * message (the iPhone Simulator, 2026-11-27: a box pulled 130 points read -60 at lift and 0 half a second later, and
 * opened during that half second, the page ended at the oldest earlier message).
 *
 * While a pull would act, `pullPastTopTakes` answers true for a touch it would count, and the kit's pull to refresh
 * stands aside, as an app's own pull to reload does by asking it.
 */

/** Finger travel past the top that acts, in CSS points. */
export const PULL_PAST = 70;
/** Travel before a drag's way is decided. */
const LOCK = 8;
/** Frames the page holds still before a released pull acts. */
const REST_FRAMES = 3;

/** Where a drag never pulls the page: a dialog, a sheet or a menu over it. */
const NOT_PULLED = '.MuiModal-root, [role="dialog"], [role="menu"]';

/**
 * Whether `target` is in an element matching `selector`, or in an element scrolled from its top, below `stop`: the
 * scroll the pull watches, which is never counted itself (for the page's own scroll, `<html>`, whose scrollTop is the
 * page's). With `stop` null the walk goes to the root.
 */
export function heldBelow(target: EventTarget | null, selector: string, stop: Element | null): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== stop; el = el.parentElement) {
    if (el.matches(selector)) return true;
    if (el.scrollTop > 0) return true;
  }
  return false;
}

/** A mounted pull: what it listens on now (null while its element is not drawn), and whether a pull would act. */
interface Mounted {
  listening: () => HTMLElement | Window | null;
  on: () => boolean;
}

const mounted = new Set<Mounted>();

/** Whether a touch on `scroll` from `target` would count as a pull: on the scroll, outside a dialog, menu or scrolled list. */
function counts(scroll: HTMLElement | Window, target: EventTarget | null): boolean {
  if (scroll !== window && !(target instanceof Node && (scroll as HTMLElement).contains(target))) return false;
  return !heldBelow(target, NOT_PULLED, scroll === window ? document.documentElement : (scroll as HTMLElement));
}

/**
 * Whether a pull past the top mounted now would take a touch that starts on `target`: one is on, it listens on a scroll
 * that holds the target, and the target is outside a dialog, a menu or a scrolled list. An app's own pull to reload asks
 * it as a touch starts, and stands aside while it answers true; the kit's PullToRefresh does by itself.
 */
export function pullPastTopTakes(target: EventTarget | null): boolean {
  for (const pull of mounted) {
    const scroll = pull.listening();
    if (scroll && pull.on() && counts(scroll, target)) return true;
  }
  return false;
}

export interface PullPastTopOptions {
  /** Whether a pull would do anything now: false once everything above is open, or while it is being read. */
  on: boolean;
  /** What a pull does, run once the page has come to rest after the finger lifts past the pull. */
  act: () => void;
  /**
   * The element that scrolls, for a page that scrolls inside a box of its own. Without it the pull watches the page's
   * own scroll. While the ref is empty nothing is watched, and the pull takes nothing.
   */
  scroller?: RefObject<HTMLElement | null>;
}

/**
 * A pull down past the top that runs `act`. Answers whether a drag under way would act on release, while `on`. Watched
 * from whenever the scroller is drawn, so a page that draws it later is watched from then.
 */
export function usePullPastTop({ on, act, scroller }: PullPastTopOptions): boolean {
  const [past, setPast] = useState(false);
  const now = useRef({ on, act });
  now.current = { on, act };
  useEffect(() => {
    if (!on) setPast(false);
  }, [on]);
  const watching = useRef<{ scroll: HTMLElement | Window; off: () => void } | null>(null);
  useEffect(() => {
    const pull: Mounted = { listening: () => watching.current?.scroll ?? null, on: () => now.current.on };
    mounted.add(pull);
    return () => {
      mounted.delete(pull);
      watching.current?.off();
      watching.current = null;
    };
  }, []);
  useEffect(() => {
    const scroll: HTMLElement | Window | null = scroller ? scroller.current : window;
    if (watching.current?.scroll === scroll) return;
    watching.current?.off();
    watching.current = null;
    if (!scroll) return;
    // The page's own scroll goes below zero in iOS's stretch, so a place under 1 is the top.
    const place = () => (scroll === window ? window.scrollY : (scroll as HTMLElement).scrollTop);
    const atTop = () => place() < 1;
    let drag: { x: number; y: number; way: 'down' | 'side' | null; from: number | null; past: boolean } | null = null;
    // A released pull waiting for the page to rest.
    let resting: number | null = null;
    const setPastTo = (p: boolean) => {
      if (drag && drag.past !== p) {
        drag.past = p;
        setPast(p);
      }
    };
    const end = () => {
      setPastTo(false);
      drag = null;
    };
    const actAtRest = () => {
      let still = 0;
      let last = place();
      const look = () => {
        if (Math.abs(place() - last) < 0.5) still += 1;
        else {
          still = 0;
          last = place();
        }
        // Still and back from the stretch: iOS reads below zero until its spring back ends, slowly enough near the end to
        // pass for still, and ends it at the old top over anything drawn above before then.
        if (still < REST_FRAMES || place() < 0) {
          resting = requestAnimationFrame(look);
          return;
        }
        resting = null;
        setPast(false);
        if (now.current.on) {
          console.log('[app-kit] pull past the top: released past the pull, acting');
          now.current.act();
        }
      };
      resting = requestAnimationFrame(look);
    };
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !now.current.on || !counts(scroll, e.target)) {
        end();
        return;
      }
      const t = e.touches[0]!;
      drag = { x: t.clientX, y: t.clientY, way: null, from: atTop() ? t.clientY : null, past: false };
    };
    const move = (e: TouchEvent) => {
      if (!drag) return;
      if (e.touches.length !== 1) {
        end();
        return;
      }
      const t = e.touches[0]!;
      const dx = Math.abs(t.clientX - drag.x);
      const dy = Math.abs(t.clientY - drag.y);
      if (drag.way === null && Math.max(dx, dy) >= LOCK) drag.way = dy > dx ? 'down' : 'side';
      if (drag.way === 'side') {
        end();
        return;
      }
      if (drag.from === null && atTop()) drag.from = t.clientY;
      if (drag.way === 'down' && drag.from !== null) setPastTo(t.clientY - drag.from >= PULL_PAST);
    };
    const release = () => {
      if (!drag?.past || !now.current.on || resting !== null) {
        end();
        return;
      }
      // Still saying a release acts, until it does.
      drag = null;
      actAtRest();
    };
    const listen = scroll as EventTarget;
    listen.addEventListener('touchstart', start as EventListener, { passive: true });
    listen.addEventListener('touchmove', move as EventListener, { passive: true });
    listen.addEventListener('touchend', release, { passive: true });
    listen.addEventListener('touchcancel', end, { passive: true });
    watching.current = {
      scroll,
      off: () => {
        if (resting !== null) cancelAnimationFrame(resting);
        listen.removeEventListener('touchstart', start as EventListener);
        listen.removeEventListener('touchmove', move as EventListener);
        listen.removeEventListener('touchend', release);
        listen.removeEventListener('touchcancel', end);
      },
    };
  });
  return past && on;
}
