import { useEffect, useRef, useState } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { isInstalledApp } from './installed-app';
import { lookForNewBuild, unsavedInput } from './new-build';

/*
 * Pull down from the top of the page and let go to reload it, in an installed app only: the iPhone app or a web app
 * opened from the home screen, which have no browser controls, so without it a stuck page or a new deploy means killing
 * the app. A browser tab keeps its own reload and Safari's own pull.
 *
 * Touch events, not pointer events: once the browser takes a vertical drag as a scroll it cancels the pointer, but touch
 * events keep coming. The listeners are passive and take nothing from the page, so iOS's own bounce draws the pull. A
 * pull starts only with the page at its top, outside a scrolled element, a field, a menu or a dialog, and only when the
 * finger moves down more than sideways, so a row swipe never turns into one.
 */

/** Finger travel is halved, so the mark lags the finger. */
const RESISTANCE = 0.5;
/** Mark travel at which letting go refreshes: 128 pixels of finger. */
export const PULL_DISTANCE = 64;
const MAX_PULL = 96;
/** How far the finger moves before its direction is told. */
const DIRECTION_PX = 8;

const NOT_PULLED_IN = '.MuiModal-root, [role="dialog"], [role="menu"], input, textarea, select, [contenteditable="true"]';

/** Whether a touch on `target` may start a pull: the page at its top, and nothing under the finger scrolled or open. */
export function pullMayStart(target: EventTarget | null): boolean {
  if ((document.scrollingElement?.scrollTop ?? 0) > 0) return false;
  for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
    if (el.matches(NOT_PULLED_IN)) return false;
    if (el.scrollTop > 0) return false;
  }
  return true;
}

export interface PullToRefreshProps {
  /**
   * What a pull does instead of reloading the page, for an app that fetches everything again in place. The mark spins
   * until a promise it returns settles, and the page is looked at for a newer deploy at once. A second pull while it
   * has not settled reloads, so a refresh that hangs never leaves the page without one.
   */
  onPull?: () => unknown;
  /** Where the mark sits below the top of the page: the height of the app's bar. The top safe area is added. */
  top?: number | string;
  /** A pull neither starts nor goes on while this answers true, as during a drag of the app's own. */
  ignoreWhile?: () => boolean;
}

type Shown = { pull: number; state: 'pulling' | 'refreshing' | 'reloading' | 'kept' };

/**
 * Pull to refresh for an installed app. Mount it once, outside the app's ErrorBoundary, so a crashed page can still be
 * pulled. Anywhere but an installed app it draws nothing and listens to nothing. A pull never reloads over text typed
 * into a field: the mark says so and nothing happens.
 */
export function PullToRefresh({ onPull, top = 0, ignoreWhile }: PullToRefreshProps) {
  const [shown, setShown] = useState<Shown | null>(null);
  const latest = useRef({ onPull, ignoreWhile });
  latest.current = { onPull, ignoreWhile };

  useEffect(() => {
    if (!isInstalledApp()) return;
    let start: { x: number; y: number } | null = null;
    // null until the finger has moved far enough to tell its direction.
    let pulling: boolean | null = null;
    let travel = 0;
    let refreshing = false;
    let keptTimer: ReturnType<typeof setTimeout> | undefined;

    const reset = () => {
      start = null;
      pulling = null;
      travel = 0;
      if (!refreshing) setShown(null);
    };
    const reload = () => {
      if (unsavedInput()) {
        console.log('[app-kit] pull: released past the line, not reloaded, since a field holds typed text');
        setShown({ pull: PULL_DISTANCE, state: 'kept' });
        clearTimeout(keptTimer);
        keptTimer = setTimeout(() => setShown(null), 2_000);
        return;
      }
      console.log('[app-kit] pull: released past the line, reloading');
      setShown({ pull: PULL_DISTANCE, state: 'reloading' });
      window.location.reload();
    };
    const refresh = (onPull: () => unknown) => {
      console.log('[app-kit] pull: released past the line, refreshing in place');
      refreshing = true;
      setShown({ pull: PULL_DISTANCE, state: 'refreshing' });
      lookForNewBuild();
      // Run in the promise's executor, so the app's refresh starts at once and a throw from it is a failure like any other.
      void new Promise((resolve) => resolve(onPull()))
        .catch((error: unknown) => console.log('[app-kit] pull: the refresh failed', error))
        .finally(() => {
          refreshing = false;
          setShown(null);
        });
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || latest.current.ignoreWhile?.() || !pullMayStart(e.target)) {
        reset();
        return;
      }
      start = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
      pulling = null;
    };
    const onMove = (e: TouchEvent) => {
      if (!start || pulling === false) return;
      if (latest.current.ignoreWhile?.()) {
        if (pulling) console.log('[app-kit] pull: let go of, the app started a drag');
        reset();
        return;
      }
      const dx = e.touches[0]!.clientX - start.x;
      const dy = e.touches[0]!.clientY - start.y;
      if (pulling === null) {
        if (Math.abs(dx) < DIRECTION_PX && Math.abs(dy) < DIRECTION_PX) return;
        pulling = dy > Math.abs(dx);
        if (!pulling) return;
      }
      travel = Math.min(MAX_PULL, Math.max(0, dy * RESISTANCE));
      if (!refreshing) setShown({ pull: travel, state: 'pulling' });
    };
    const onEnd = () => {
      const past = pulling === true && travel >= PULL_DISTANCE;
      if (pulling && !past) console.log('[app-kit] pull: let go short of the line');
      reset();
      if (!past) return;
      const { onPull } = latest.current;
      if (!onPull || refreshing) reload();
      else refresh(onPull);
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', reset);
    return () => {
      clearTimeout(keptTimer);
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', reset);
    };
  }, []);

  if (!shown) return null;
  const { pull, state } = shown;
  const armed = state !== 'pulling' || pull >= PULL_DISTANCE;
  const label = {
    pulling: armed ? 'Release to refresh' : 'Pull to refresh',
    refreshing: 'Refreshing',
    reloading: 'Reloading',
    kept: 'Not reloaded: a field holds typed text',
  }[state];
  return (
    <Box
      role="status"
      aria-label={label}
      title={label}
      sx={{
        position: 'fixed',
        top: `calc(env(safe-area-inset-top, 0px) + ${typeof top === 'number' ? `${top}px` : top})`,
        left: '50%',
        zIndex: 1200,
        width: 32,
        height: 32,
        display: 'grid',
        placeItems: 'center',
        borderRadius: '50%',
        bgcolor: 'background.paper',
        border: 1,
        // Past the line the ring turns to the text's color: letting go refreshes.
        borderColor: armed ? 'text.primary' : 'divider',
        transform: `translate(-50%, ${pull - 24}px)`,
        opacity: Math.min(1, pull / PULL_DISTANCE),
        pointerEvents: 'none',
      }}
    >
      <CircularProgress
        size={16}
        thickness={5}
        variant={state === 'refreshing' || state === 'reloading' ? 'indeterminate' : 'determinate'}
        value={Math.min(100, (pull / PULL_DISTANCE) * 100)}
        sx={{ color: armed ? 'text.primary' : 'text.secondary' }}
      />
    </Box>
  );
}
