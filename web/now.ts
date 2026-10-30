import { useEffect, useState } from 'react';
import { onPageReturn } from './page-return';

/** How often `useNow` reads the clock while the page is in view: ages written in minutes move on time. */
export const NOW_TICK_MS = 60_000;

/**
 * The time now, read again once a minute while the page is in view and the moment it comes back in front
 * (`onPageReturn`), so a screen that writes ages with `age(when, now)` keeps them moving with no timer of its own, its
 * draw stays pure, and a page back from a locked phone never shows the ages it was left with. While the page is hidden
 * it reads nothing.
 */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const follow = () => {
      stop();
      if (document.visibilityState === 'hidden') return;
      setNow(Date.now());
      timer = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') stop();
    };
    follow();
    const stopReturns = onPageReturn(follow);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      stop();
      stopReturns();
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  return now;
}
