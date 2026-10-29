// Web Audio for an app's browser tests that never opens a speaker. A gain of zero before the destination is not enough:
// the browser still opens the Mac's output device for a running AudioContext, and what reaches it is heard. Every
// AudioContext a page makes is instead an OfflineAudioContext, the browser's engine that renders into memory, paced to
// the clock: it renders a little ahead, suspends itself, and goes on once the clock catches up, so sources, gains,
// filters and scheduled ramps all run, currentTime moves with time, and no audio device is ever opened.
// web/e2e/offline-audio.e2e.ts records macOS's audio service to show it. Plain JavaScript, typed by
// playwright-offline-audio.d.ts, since Playwright's test runner loads nothing written in TypeScript from inside
// node_modules, where an app has the kit.

import { test as playwrightTest } from '@playwright/test';

/** @type {typeof import('./playwright-offline-audio').offlineAudio} */
export async function offlineAudio(target, options = {}) {
  await target.addInitScript(installOfflineAudio, { startsOnTap: options.startsOnTap === true });
}

/**
 * Playwright's test with offlineAudio on every browser context it gives a test, and so on its `page`: a test file that
 * imports it has no step of its own to forget.
 * @type {typeof import('./playwright-offline-audio').testWithOfflineAudio}
 */
export function testWithOfflineAudio(options = {}) {
  return playwrightTest.extend({
    context: async ({ context }, use) => {
      await offlineAudio(context, options);
      await use(context);
    },
  });
}

/**
 * Runs in the page, before its own scripts, so is written without class fields or anything else a compiler would turn
 * into helpers that exist only in this file: Playwright sends the function's source alone.
 * @param {{ startsOnTap: boolean }} options
 */
function installOfflineAudio({ startsOnTap }) {
  const Offline = window.OfflineAudioContext;
  if (!Offline) return;
  /** How far ahead of the clock the engine renders, in seconds. */
  const AHEAD = 0.02;
  /** How much sound a context holds, in seconds; past it the graph stops and currentTime holds. */
  const LENGTH = 600;
  /** One render quantum, the step every suspension is rounded to. */
  const QUANTUM = 128;
  const native = Offline.prototype;
  /**
   * What each context is as the page sees it, apart from the engine's own state, which goes from running to suspended
   * at every step.
   * @type {WeakMap<OfflineAudioContext, { state: AudioContextState, started: boolean, rendering: boolean, waiting: boolean, timer: ReturnType<typeof setTimeout> | undefined, clockAt: number, audioAt: number, event: Event | null }>}
   */
  const contexts = new WeakMap();

  /** @param {OfflineAudioContext} context */
  const record = (context) => {
    const found = contexts.get(context);
    if (!found) throw new TypeError('Illegal invocation');
    return found;
  };

  /**
   * Sets the page's state and sends statechange, before the page's own callbacks on the promise run.
   * @param {OfflineAudioContext} context
   * @param {AudioContextState} state
   */
  const become = (context, state) => {
    const own = record(context);
    if (own.state === state) return;
    own.state = state;
    own.event = new Event('statechange');
    context.dispatchEvent(own.event);
    own.event = null;
  };

  /**
   * Renders the next step: up to AHEAD past the clock, then the engine suspends itself and waits for the clock.
   * @param {OfflineAudioContext} context
   */
  const step = (context) => {
    const own = record(context);
    own.waiting = false;
    if (own.state !== 'running') return;
    // A page that has left its frame, navigated away from or reloaded, can still run this for a moment, as it does
    // under Playwright's clock. WebKit has torn its audio down by then, and its engine resumed there starts a render that
    // fails a release assertion, which crashes the page.
    if (!document.defaultView) return;
    // Up to the clock, and past wherever the engine stopped: after Playwright's clock jumps, sound that fell behind
    // catches up in this one step, never 20 ms at a time, each with a timer runFor follows with a real wait.
    const clock = own.audioAt + (performance.now() - own.clockAt) / 1000;
    const frame = Math.ceil(((Math.max(context.currentTime, clock) + AHEAD) * context.sampleRate) / QUANTUM) * QUANTUM;
    // The last step renders to the end, which an engine cannot be suspended at.
    if (frame < context.length) native.suspend.call(context, frame / context.sampleRate).then(() => arrived(context), () => {});
    if (own.rendering) native.resume.call(context).catch(() => {});
    else {
      own.rendering = true;
      native.startRendering.call(context).catch(() => {});
    }
  };

  /**
   * The engine has suspended itself: it goes on once the clock reaches where it is, if the page still has it running.
   * The clock is the page's own, so under Playwright's clock the sound moves only as that clock does.
   * @param {OfflineAudioContext} context
   */
  const arrived = (context) => {
    const own = record(context);
    own.waiting = true;
    if (own.state !== 'running') return;
    const clock = own.audioAt + (performance.now() - own.clockAt) / 1000;
    own.timer = setTimeout(() => step(context), Math.max(0, (context.currentTime - clock) * 1000));
  };

  /**
   * Starts the engine, or starts it again where it stopped, with the clock measured from now.
   * @param {OfflineAudioContext} context
   */
  const play = (context) => {
    const own = record(context);
    own.clockAt = performance.now();
    own.audioAt = context.currentTime;
    if (!own.rendering || own.waiting) step(context);
  };

  /** @param {OfflineAudioContext} context */
  const pause = (context) => {
    const own = record(context);
    clearTimeout(own.timer);
    own.timer = undefined;
  };

  /**
   * Settles soon after the call, with the state set before the page's own callbacks run. In a microtask, not a timer:
   * a browser settles these whatever the page's timers do, and Playwright's clock, installed and paused, holds every
   * timer the page sets.
   * @param {() => void} change
   */
  const later = (change) => Promise.resolve().then(change);

  const AudioContext = class AudioContext extends Offline {
    /** @param {AudioContextOptions} [options] */
    constructor(options = {}) {
      const sampleRate = options.sampleRate ?? 48000;
      super({ numberOfChannels: 2, length: Math.round(LENGTH * sampleRate), sampleRate });
      contexts.set(this, { state: 'suspended', started: false, rendering: false, waiting: false, timer: undefined, clockAt: 0, audioAt: 0, event: null });
      // The engine's own statechange, sent at every step, never reaches the page; registered first, it runs first.
      native.addEventListener.call(this, 'statechange', (event) => {
        if (event !== record(this).event) event.stopImmediatePropagation();
      });
      // A browser that lets a page play sound starts the context on its own, a moment after it is made, whatever the
      // page's timers do.
      if (!startsOnTap) {
        queueMicrotask(() => {
          const own = record(this);
          if (own.state !== 'suspended' || own.started) return;
          own.started = true;
          become(this, 'running');
          play(this);
        });
      }
    }

    /**
     * @override
     * @returns {AudioContextState}
     */
    get state() {
      return record(this).state;
    }

    get baseLatency() {
      return 0;
    }

    get outputLatency() {
      return 0;
    }

    get sinkId() {
      return '';
    }

    getOutputTimestamp() {
      return { contextTime: this.currentTime, performanceTime: performance.now() };
    }

    /**
     * @override
     * @returns {Promise<void>}
     */
    resume() {
      const own = record(this);
      if (own.state === 'closed') return Promise.reject(new DOMException('The context is closed.', 'InvalidStateError'));
      // An iPhone starts a context only during a tap, until it has started once.
      if (startsOnTap && !own.started && navigator.userActivation && !navigator.userActivation.isActive) {
        return Promise.reject(new DOMException('A tap is needed to start sound.', 'NotAllowedError'));
      }
      own.started = true;
      return later(() => {
        if (record(this).state !== 'suspended') return;
        become(this, 'running');
        play(this);
      });
    }

    /**
     * @override
     * @returns {Promise<void>}
     */
    suspend() {
      if (record(this).state === 'closed') return Promise.reject(new DOMException('The context is closed.', 'InvalidStateError'));
      return later(() => {
        if (record(this).state !== 'running') return;
        pause(this);
        become(this, 'suspended');
      });
    }

    close() {
      if (record(this).state === 'closed') return Promise.reject(new DOMException('The context is closed.', 'InvalidStateError'));
      return later(() => {
        pause(this);
        become(this, 'closed');
      });
    }

    setSinkId() {
      return Promise.resolve();
    }
  };

  Object.defineProperty(window, 'AudioContext', { value: AudioContext, writable: true, configurable: true });
  if ('webkitAudioContext' in window) Object.defineProperty(window, 'webkitAudioContext', { value: AudioContext, writable: true, configurable: true });
}
