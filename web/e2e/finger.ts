import type { Page } from '@playwright/test';

type Point = { x: number; y: number };

/**
 * Raw touch events through the Chrome DevTools Protocol, since Playwright's own touch input is taps alone. The same
 * step is coming to the kit as `finger` in app-kit/web/playwright; once it is there, these tests take it from there.
 */
export async function finger(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  return {
    /**
     * A finger landing at `from`, moving to `to` in 20 steps, and lifting. The landing and the first moves are sent
     * together rather than a round trip apart, since a finger still for a quarter second is a long press.
     */
    async slide(from: Point, to: Point) {
      const at = (i: number) => [from.x + ((to.x - from.x) * i) / 20, from.y + ((to.y - from.y) * i) / 20] as const;
      await Promise.all([send('touchStart', from.x, from.y), send('touchMove', ...at(1)), send('touchMove', ...at(2))]);
      for (let i = 3; i <= 20; i++) await send('touchMove', ...at(i));
      await send('touchEnd');
    },
  };
}
