// Steps for an app's Playwright tests that every app wrote for itself before the kit had them: counting page loads,
// frames that never go empty, a finger that swipes, no window opened onto the person's screen, sound kept silent, and
// the phone's largest Text Size with a check that the screen still fits. Plain JavaScript, typed by playwright.d.ts,
// since Playwright's test runner loads nothing written in TypeScript from inside node_modules, where an app has the kit.
// Every init script here is sent to the page as its source, so it uses nothing from this file, and no class fields,
// which Playwright's compiler turns into helpers that exist only in the test's own file.

import { expect } from '@playwright/test';

/** @type {typeof import('./playwright').countLoads} */
export function countLoads(page) {
  const count = { loads: 0 };
  page.on('load', () => count.loads++);
  return count;
}

/** @typedef {import('./playwright').Frame} Frame */

/** @type {typeof import('./playwright').watchFrames} */
export async function watchFrames(context, { root = '#root' } = {}) {
  await context.addInitScript((selector) => {
    /** @type {Frame[]} */
    const frames = [];
    Object.assign(window, { __appKitFrames: frames });
    const look = () => {
      if (document.body) {
        const text = (/** @type {HTMLElement | null} */ (document.querySelector(selector))?.innerText ?? '').trim();
        frames.push({ background: getComputedStyle(document.body).backgroundColor, drawn: text.length > 0, text });
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  }, root);
}

/** @type {typeof import('./playwright').takeFrames} */
export async function takeFrames(page) {
  return page.evaluate(() => /** @type {{ __appKitFrames: Frame[] }} */ (/** @type {unknown} */ (window)).__appKitFrames.splice(0));
}

/** @type {typeof import('./playwright').expectSteady} */
export function expectSteady(frames, background) {
  expect(frames.length, 'frames noted; was watchFrames called before the page loaded?').toBeGreaterThan(0);
  expect(frames.filter((frame) => !frame.drawn), 'frames with nothing drawn').toEqual([]);
  expect([...new Set(frames.map((frame) => frame.background))], 'the backgrounds the page showed').toEqual([background]);
}

/** @type {typeof import('./playwright').finger} */
export async function finger(page) {
  /** @type {import('@playwright/test').CDPSession} */
  let session;
  try {
    session = await page.context().newCDPSession(page);
  } catch (error) {
    throw new Error(`finger: touch goes through Chrome's debugging protocol, which only Chromium has (${/** @type {Error} */ (error).message})`);
  }
  /**
   * @param {'touchStart' | 'touchMove' | 'touchEnd'} type
   * @param {number} [x]
   * @param {number} [y]
   */
  const send = (type, x = 0, y = 0) => session.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  return {
    async slide(from, to, { holdMs = 0, steps = 20 } = {}) {
      /** @param {number} i */
      const at = (i) => /** @type {const} */ ([from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps]);
      let i = 1;
      if (holdMs) {
        await send('touchStart', from.x, from.y);
        await page.waitForTimeout(holdMs);
      } else {
        // The landing and the first moves past the browser's touch slop go together rather than a round trip apart: on
        // a busy machine a round trip can take a tenth of a second, and a finger still for a quarter second is a long
        // press, which stops the page from scrolling.
        await Promise.all([send('touchStart', from.x, from.y), send('touchMove', ...at(1)), send('touchMove', ...at(2))]);
        i = 3;
      }
      for (; i <= steps; i++) {
        await page.waitForTimeout(16);
        await send('touchMove', ...at(i));
      }
      // The finger settles before it lifts. A lift at full speed leaves Chromium a fling, which takes the next tap as
      // the fling's stop, so that tap makes no click.
      for (let still = 0; still < 4; still++) {
        await page.waitForTimeout(30);
        await send('touchMove', to.x, to.y);
      }
      await send('touchEnd');
    },
  };
}

/** The name of the binding through which the page reports a window it was asked to open. */
const OPENED_WINDOW = '__appKitOpenedWindow';

/** @type {typeof import('./playwright').noNewWindows} */
export const noNewWindows = [
  async ({ context }, use) => {
    /** @type {string[]} */
    const opened = [];
    await context.exposeBinding(OPENED_WINDOW, (_source, /** @type {string} */ url) => void opened.push(url));
    // Refused in the page, before the browser sees it: Playwright's WebKit hands a new window's link to macOS, which
    // opens it in the Mac's own app, such as Maps, in front of whatever the person is doing.
    await context.addInitScript((binding) => {
      const report = /** @type {(url: string) => void} */ (/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window))[binding]);
      /** A target that names this window or one holding it, which a page moves to rather than opening another. */
      const thisWindow = (/** @type {string} */ target) => ['_self', '_parent', '_top'].includes(target.toLowerCase());
      const open = window.open.bind(window);
      window.open = (url, target, features) => {
        if (target !== undefined && thisWindow(target)) return open(url, target, features);
        report(String(url ?? ''));
        return null;
      };
      /** @param {MouseEvent} event */
      const refuse = (event) => {
        const link = event.target instanceof Element ? event.target.closest('a[href], area[href]') : null;
        if (!(link instanceof HTMLAnchorElement || link instanceof HTMLAreaElement)) return;
        const newWindow = (link.target !== '' && !thisWindow(link.target)) || event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1;
        if (!newWindow) return;
        event.preventDefault();
        report(link.href);
      };
      document.addEventListener('click', refuse, true);
      document.addEventListener('auxclick', refuse, true);
    }, OPENED_WINDOW);
    // Anything that opened a window some other way still fails the test, though only after it opened.
    /** @param {import('@playwright/test').Page} page */
    const watch = (page) => page.on('popup', (popup) => opened.push(popup.url()));
    context.pages().forEach(watch);
    context.on('page', watch);
    await use();
    expect(opened, 'windows the test opened, which Playwright\'s WebKit hands to a Mac app such as Maps').toEqual([]);
  },
  { auto: true },
];

/** @type {typeof import('./playwright').muteAudio} */
export async function muteAudio(target, { startsOnTap = false } = {}) {
  await target.addInitScript((tapRule) => {
    const Native = window.AudioContext;
    // Applied once, however many times a test or its fixtures ask.
    if (!Native || /** @type {{ appKitMuted?: boolean }} */ (/** @type {unknown} */ (Native)).appKitMuted) return;
    // A media element is muted whenever it plays, by play() or by autoplay.
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      this.muted = true;
      return play.call(this);
    };
    document.addEventListener('play', (event) => {
      if (event.target instanceof HTMLMediaElement) event.target.muted = true;
    }, true);
    const Muted = class extends Native {
      /** @param {AudioContextOptions} [options] */
      constructor(options) {
        super(options);
        // Every sound runs its whole path and ends in a gain of zero before the speakers.
        const silent = super.createGain();
        silent.gain.value = 0;
        silent.connect(super.destination);
        Object.defineProperty(this, 'destination', { value: silent, configurable: true });
        if (!tapRule) return;
        // The iPhone's rule: sound starts paused, and asking it to play works only during a tap, until a tap has
        // started it once. The browser's own audio is started and paused along with it, without waiting on it.
        /** @type {AudioContextState} */
        let state = 'suspended';
        let started = false;
        /** @param {AudioContextState} next */
        const become = (next) => {
          if (state === next) return;
          state = next;
          this.dispatchEvent(new Event('statechange'));
        };
        const native = { resume: super.resume.bind(this), suspend: super.suspend.bind(this), close: super.close.bind(this) };
        Object.defineProperty(this, 'state', { get: () => state, configurable: true });
        Object.defineProperty(this, 'resume', {
          configurable: true,
          value: () => {
            if (state === 'closed') return Promise.reject(new DOMException('closed', 'InvalidStateError'));
            if (!started && !navigator.userActivation?.isActive) return Promise.reject(new DOMException('a tap is needed to start sound', 'NotAllowedError'));
            started = true;
            native.resume().catch(() => {});
            return Promise.resolve().then(() => become('running'));
          },
        });
        Object.defineProperty(this, 'suspend', {
          configurable: true,
          value: () => {
            native.suspend().catch(() => {});
            return Promise.resolve().then(() => become('suspended'));
          },
        });
        Object.defineProperty(this, 'close', { configurable: true, value: () => native.close().then(() => become('closed')) });
      }
    };
    Object.defineProperty(Muted, 'appKitMuted', { value: true });
    window.AudioContext = Muted;
  }, startsOnTap);
}

/** @type {typeof import('./playwright').largestTextSize} */
export async function largestTextSize(target) {
  await target.addInitScript(() => {
    // The answers an iPhone at its largest accessibility size gave the kit's reading (web/text-size.ts), recorded in
    // test/fixtures/text-size-readings.json: Apple's body style is known, the screen takes touch, and the style
    // measures 53 pixels. Nothing in a desktop browser gives those, so the reading would answer 1.
    const BODY = '-apple-system-body';
    const supports = CSS.supports.bind(CSS);
    CSS.supports = /** @type {typeof CSS.supports} */ ((/** @type {string} */ property, /** @type {string} */ value) =>
      (property === 'font' && value === BODY) || (value === undefined ? supports(property) : supports(property, value)));
    if (navigator.maxTouchPoints === 0) Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5, configurable: true });
    const setProperty = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (property, value, priority) {
      if (property === 'font' && value === BODY) return setProperty.call(this, 'font-size', '53px', priority);
      return setProperty.call(this, property, value, priority);
    };
  });
}

/** @type {typeof import('./playwright').expectFits} */
export async function expectFits(page) {
  const width = page.viewportSize()?.width;
  if (!width) throw new Error('expectFits: the page has no viewport size to measure against.');
  // Measured against the device's width, not innerWidth: a phone's browser widens the layout viewport to fit what
  // overflows, so innerWidth grows along with the fault.
  const found = await page.evaluate((deviceWidth) => {
    /** @param {Element} element */
    const inSidewaysBox = (element) => {
      for (let above = element.parentElement; above; above = above.parentElement) {
        if (['auto', 'scroll'].includes(getComputedStyle(above).overflowX)) return true;
      }
      return false;
    };
    const past = [...document.querySelectorAll('body *')]
      .filter((element) => element.getBoundingClientRect().right > deviceWidth + 1 && !inSidewaysBox(element))
      .map((element) => `${element.tagName.toLowerCase()} ${(element.textContent ?? '').trim().slice(0, 40)}`);
    return { past, pageWidth: document.documentElement.scrollWidth };
  }, width);
  expect(found.past, `elements past the right edge of a ${width}px screen, outside any box that scrolls sideways`).toEqual([]);
  expect(found.pageWidth, `the page's width on a ${width}px screen`).toBeLessThanOrEqual(width);
}
