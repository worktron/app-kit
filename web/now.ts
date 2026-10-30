import { useEffect, useState } from 'react';

/** How often `useNow` reads the clock while the page is in view: ages written in minutes move on time. */
export const NOW_TICK_MS = 60_000;

/**
 * The time now, read again once a minute while the page is in view and the moment it comes back into view, so a
 * screen that writes ages with `age(when, now)` keeps them moving with no timer of its own, its draw stays pure, and a
 * page back from a locked phone never shows the ages it was left with. While the page is hidden it reads nothing.
 */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const follow = () => {
      clearInterval(timer);
      timer = undefined;
      if (document.visibilityState === 'hidden') return;
      setNow(Date.now());
      timer = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    };
    follow();
    document.addEventListener('visibilitychange', follow);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', follow);
    };
  }, []);
  return now;
}
