import { chromium, expect, test, webkit, type Browser, type BrowserContext, type BrowserType, type Page } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { offlineAudio, testWithOfflineAudio } from '../playwright-offline-audio.js';
import { webkitWithoutDockIcon } from '../playwright-webkit.js';

// A page's Web Audio run through the kit, in Chromium and in the kit's WebKit, with macOS's audio service recorded by
// audio-output.swift, which reports each process that opens an output device. Other sessions on the Mac may play sound
// at the same time, so a process counts as this test's only when it descends from this test's own process, as
// Chromium's audio process does, or runs from this test's own copy of WebKit, as WebKit's GPU process does, which macOS
// starts with no parent but itself. Every page here plays through a gain of zero, so a browser that does open the
// speakers plays silence into them, never sound.

// Resolved, since macOS names a process's executable by its real path, under /private.
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'app-kit-offline-audio-')));
const recorderProgram = join(scratch, 'audio-output');
test.beforeAll(() => {
  if (process.platform === 'darwin') execFileSync('swiftc', [join(import.meta.dirname, 'audio-output.swift'), '-o', recorderProgram], { stdio: ['ignore', 'ignore', 'pipe'] });
});
test.afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// The page, served by the test itself: each tap makes a context and starts it, as an iPhone needs.
const ADDRESS = 'https://audio.example.com/';
// A context the page makes as it loads, with no tap, tries to start at once: Playwright runs page.evaluate as a gesture,
// so only the page's own script can try outside one.
const PAGE = `<!doctype html><button>Play</button><script>
  window.early = new AudioContext();
  window.earlyStart = window.early.resume().then(() => 'started', (error) => error.name);
  window.contexts = [];
  window.states = [];
  document.querySelector('button').addEventListener('click', () => {
    const context = new AudioContext();
    const states = [];
    context.addEventListener('statechange', () => states.push(context.state));
    window.contexts.push(context);
    window.states.push(states);
    context.resume();
  });
  // Two sources through a filter, a gain on a scheduled ramp and an analyser, then a gain of zero before the speakers,
  // and a tone that stops on its own. Resolves with what the graph did once the audio clock has run a second and a half.
  window.play = (context) => new Promise((resolve) => {
    const start = context.currentTime;
    const clockAt = performance.now();
    const filter = new BiquadFilterNode(context, { type: 'lowpass', frequency: 2000 });
    const swell = context.createGain();
    swell.gain.setValueAtTime(0, start);
    swell.gain.linearRampToValueAtTime(1, start + 0.5);
    const analyser = context.createAnalyser();
    const silent = context.createGain();
    silent.gain.value = 0;
    filter.connect(swell).connect(analyser).connect(silent).connect(context.destination);
    const tone = context.createOscillator();
    tone.connect(filter);
    tone.start();
    const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    noise.getChannelData(0).forEach((_, i, data) => (data[i] = Math.random() * 2 - 1));
    const sea = context.createBufferSource();
    sea.buffer = noise;
    sea.loop = true;
    sea.connect(filter);
    sea.start();
    const chime = context.createOscillator();
    chime.connect(silent);
    let ended = false;
    chime.onended = () => (ended = true);
    chime.start();
    chime.stop(start + 0.3);
    const check = () => {
      if (context.currentTime - start < 1.5) return setTimeout(check, 10);
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      resolve({
        audio: context.currentTime - start,
        clock: (performance.now() - clockAt) / 1000,
        peak: Math.max(...samples.map(Math.abs)),
        swell: swell.gain.value,
        ended,
      });
    };
    check();
  });
</script>`;

/** Playwright's browser types, which a fixture is given as `playwright`. */
type BrowserTypes = { chromium: BrowserType; webkit: BrowserType };
const BROWSERS = {
  chromium: (types: BrowserTypes = { chromium, webkit }) => types.chromium.launch(),
  webkit: (types: BrowserTypes = { chromium, webkit }) => types.webkit.launch(webkitWithoutDockIcon(join(scratch, 'webkit'))),
} satisfies Record<string, (types?: BrowserTypes) => Promise<Browser>>;

/** A page of `browser` on the test's own page, with the kit's offline audio when `options` are given. */
async function openPage(browser: Browser, options?: Parameters<typeof offlineAudio>[1]): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  if (options) await offlineAudio(context, options);
  await context.route(ADDRESS, (route) => route.fulfill({ contentType: 'text/html', body: PAGE }));
  const page = await context.newPage();
  await page.goto(ADDRESS);
  return { context, page };
}

/** A process the audio service saw running output, as audio-output.swift reports it. */
type Output = { pid: number; executable: string; parents: number[] };

/** Starts the recorder; resolves once it has read macOS's list of audio processes. */
async function recordOutputs() {
  const recorder = spawn(recorderProgram, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  const outputs: Output[] = [];
  /** Each mark asked of the recorder and not yet answered, oldest first, resolved with how many outputs came before its answer. */
  const marks: ((before: number) => void)[] = [];
  let heard = () => {};
  let rest = '';
  const ready = new Promise<void>((resolve, reject) => {
    recorder.on('exit', (code, signal) => reject(new Error(`audio-output ended (${code ?? signal}) before it was ready`)));
    recorder.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop()!;
      for (const line of lines) {
        if (line === 'ready') resolve();
        else if (line === 'mark') marks.shift()?.(outputs.length);
        else if (line) outputs.push(JSON.parse(line) as Output);
      }
      heard();
    });
  });
  await ready;
  return {
    outputs,
    /** Resolves with how many outputs the recorder has reported once it has polled after this call. */
    mark: () =>
      new Promise<number>((resolve) => {
        marks.push(resolve);
        recorder.stdin.write('mark\n');
      }),
    /** Resolves with the first output after the first `after` that `matches`. */
    next: (after: number, matches: (output: Output) => boolean) =>
      new Promise<Output>((resolve) => {
        heard = () => {
          const found = outputs.slice(after).find(matches);
          if (found) resolve(found);
        };
        heard();
      }),
    stop: () => {
      recorder.stdin.end();
      recorder.kill();
    },
  };
}

/** This test's own browser processes, told from every other process on the Mac. */
const ours = (output: Output) => output.parents.includes(process.pid) || output.executable.startsWith(scratch);

for (const [name, launch] of Object.entries(BROWSERS)) {
  // An app's test, as a spec gets it from the one file that makes it: no step of its own, on this file's browser.
  const appTest = testWithOfflineAudio({ startsOnTap: true }).extend<object, { browser: Browser }>({
    browser: [
      async ({ playwright }, use) => {
        const browser = await launch(playwright);
        await use(browser);
        await browser.close();
      },
      { scope: 'worker' },
    ],
  });

  test.describe(name, () => {
    appTest("a test from testWithOfflineAudio plays through the kit with no step of its own, and a context it makes by hand, which it does not cover, opens a device", async ({ browser, context, page }) => {
      appTest.skip(process.platform !== 'darwin', "the recorder reads macOS's audio service");
      const recorder = await recordOutputs();
      try {
        await context.route(ADDRESS, (route) => route.fulfill({ contentType: 'text/html', body: PAGE }));
        await page.goto(ADDRESS);
        expect(await page.evaluate(() => window.early instanceof OfflineAudioContext)).toBe(true);
        // The options reach the page: made outside a tap, a context refuses to start.
        expect(await page.evaluate(() => window.earlyStart)).toBe('NotAllowedError');
        await page.getByRole('button', { name: 'Play' }).click();
        await expect.poll(() => page.evaluate(() => window.contexts[0]!.state)).toBe('running');
        const played = await page.evaluate(() => window.play(window.contexts[0]!));
        expect(played.peak).toBeGreaterThan(0.1);
        // The context still runs, so a device it had opened would still be open when the mark is answered.
        const before = await recorder.mark();
        expect(recorder.outputs.slice(0, before).filter(ours)).toEqual([]);

        const byHand = await browser.newContext();
        try {
          await byHand.route(ADDRESS, (route) => route.fulfill({ contentType: 'text/html', body: PAGE }));
          const plain = await byHand.newPage();
          await plain.goto(ADDRESS);
          await plain.getByRole('button', { name: 'Play' }).click();
          await recorder.next(before, ours);
        } finally {
          await byHand.close();
        }
      } finally {
        recorder.stop();
      }
    });

    test('a page plays its whole graph through the kit and no output device opens, which it does without the kit', async () => {
      test.skip(process.platform !== 'darwin', "the recorder reads macOS's audio service");
      const recorder = await recordOutputs();
      try {
        // Through the kit: the browser is closed before the next starts.
        const withKit = await launch();
        const { page } = await openPage(withKit, { startsOnTap: true });
        await page.getByRole('button', { name: 'Play' }).click();
        await expect.poll(() => page.evaluate(() => window.contexts[0]!.state)).toBe('running');
        const played = await page.evaluate(() => window.play(window.contexts[0]!));
        await withKit.close();
        // Everything the recorder saw while that browser ran is reported before the answer to a mark sent after it closed.
        const before = await recorder.mark();
        // The graph ran: the analyser heard the sources through the filter at full swell, and the tone ended on time.
        expect(played.peak).toBeGreaterThan(0.1);
        expect(played.swell).toBe(1);
        expect(played.ended).toBe(true);
        // Paced to the clock: the engine renders a step of 20ms ahead at most, never the whole sound at once.
        expect(played.audio).toBeLessThan(played.clock + 0.03);

        // The same page with the browser's own audio, which opens the output device, and the record sees it.
        const withoutKit = await launch();
        try {
          const plain = await openPage(withoutKit);
          await plain.page.getByRole('button', { name: 'Play' }).click();
          await recorder.next(before, ours);
        } finally {
          await withoutKit.close();
        }
        expect(recorder.outputs.slice(0, before).filter(ours)).toEqual([]);
      } finally {
        recorder.stop();
      }
    });

    test('with startsOnTap a context starts only on a tap until it has started once, and reports each state', async () => {
      const browser = await launch();
      try {
        const { page } = await openPage(browser, { startsOnTap: true });
        // Made outside a tap, a context stays suspended and refuses to start.
        expect(await page.evaluate(async () => ({ refused: await window.earlyStart, state: window.early.state }))).toEqual({
          refused: 'NotAllowedError',
          state: 'suspended',
        });

        const play = page.getByRole('button', { name: 'Play' });
        await play.click();
        await expect.poll(() => page.evaluate(() => window.contexts[0]!.state)).toBe('running');
        await page.evaluate(() => new Promise<void>((resolve) => (function moved() {
          if (window.contexts[0]!.currentTime > 0.1) resolve();
          else setTimeout(moved, 10);
        })()));

        // Suspended, its clock holds while a second context, started by a second tap, runs a third of a second.
        const held = await page.evaluate(() => window.contexts[0]!.suspend().then(() => window.contexts[0]!.currentTime));
        await play.click();
        await page.evaluate(() => new Promise<void>((resolve) => (function moved() {
          if (window.contexts[1]?.state === 'running' && window.contexts[1].currentTime > 0.3) resolve();
          else setTimeout(moved, 10);
        })()));
        expect(await page.evaluate(() => window.contexts[0]!.currentTime)).toBeLessThan(held + 0.03);

        // Started once, it starts again with no tap, and closes for good.
        expect(
          await page.evaluate(async () => {
            const context = window.contexts[0]!;
            await context.resume();
            const resumed = context.state;
            await context.close();
            const again = await context.resume().then(() => 'started', (error: DOMException) => error.name);
            return { resumed, closed: context.state, again, states: window.states[0] };
          }),
        ).toEqual({ resumed: 'running', closed: 'closed', again: 'InvalidStateError', states: ['running', 'suspended', 'running', 'closed'] });
      } finally {
        await browser.close();
      }
    });

    test('without startsOnTap a context starts on its own, as in a browser that lets a page play sound', async () => {
      const browser = await launch();
      try {
        const { page } = await openPage(browser, {});
        expect(
          await page.evaluate(
            () =>
              new Promise((resolve) => {
                const context = new AudioContext();
                const made = context.state;
                context.addEventListener('statechange', () => {
                  (function moved() {
                    if (context.currentTime > 0.1) resolve({ made, state: context.state, isAudioContext: context instanceof AudioContext });
                    else setTimeout(moved, 10);
                  })();
                });
              }),
          ),
        ).toEqual({ made: 'suspended', state: 'running', isAudioContext: true });
      } finally {
        await browser.close();
      }
    });

    test("under Playwright's paused clock a context still starts, suspends, resumes and closes, as a browser's does whatever the page's timers do", async () => {
      const browser = await launch();
      try {
        const paused = async (options: Parameters<typeof offlineAudio>[1]) => {
          const { page } = await openPage(browser, options);
          await page.clock.install({ time: new Date('2026-01-01T09:00:00') });
          await page.clock.pauseAt(new Date('2026-01-01T09:00:10'));
          return page;
        };
        // Each promise records when it settles, so a promise that never does fails the poll rather than hanging the test.
        const page = await paused({ startsOnTap: true });
        await page.getByRole('button', { name: 'Play' }).click();
        const seen = () => page.evaluate(() => ({ states: window.states[0], settled: window.settled }));
        await page.evaluate(() => (window.settled = []));
        await expect.poll(seen).toEqual({ states: ['running'], settled: [] });
        for (const [step, states] of [
          ['suspend', ['running', 'suspended']],
          ['resume', ['running', 'suspended', 'running']],
          ['close', ['running', 'suspended', 'running', 'closed']],
        ] as const) {
          await page.evaluate((step) => void window.contexts[0]![step]().then(() => window.settled.push(step)), step);
          await expect.poll(seen).toEqual({ states, settled: states.slice(1).map((_, i) => (['suspend', 'resume', 'close'] as const)[i]) });
        }

        const onItsOwn = await paused({});
        await onItsOwn.evaluate(() => (window.contexts = [new AudioContext()]));
        await expect.poll(() => onItsOwn.evaluate(() => window.contexts[0]!.state)).toBe('running');
      } finally {
        await browser.close();
      }
    });

    test("after the clock jumps while sound plays, the sound catches up to the clock at once, not 20 ms a step", async () => {
      const browser = await launch();
      try {
        const { page } = await openPage(browser, { startsOnTap: true });
        await page.clock.install({ time: new Date('2026-01-01T09:00:00') });
        await page.clock.pauseAt(new Date('2026-01-01T09:00:10'));
        // Each step the kit takes sets one timer, so the timers set from the jump on count its steps. Sound a minute behind
        // caught up 20 ms at a time is 3,000 steps, each a timer Playwright's runFor follows with a real wait
        // of its own, as a test timed out on; caught up at once, it is one.
        await page.evaluate(() => {
          const set = window.setTimeout;
          window.timersSet = 0;
          window.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
            window.timersSet++;
            return set(...args);
          }) as typeof setTimeout;
        });
        await page.getByRole('button', { name: 'Play' }).click();
        // The first step's timer set, which the jump fires: a jump before it has nothing to fire, and the paused clock
        // never would.
        await expect.poll(() => page.evaluate(() => window.timersSet)).toBe(1);
        await page.evaluate(() => (window.timersSet = 0));
        await page.clock.fastForward('01:00');
        // The engine renders the minute in real time, so the test waits for the sound to reach the clock.
        await expect.poll(() => page.evaluate(() => window.contexts[0]!.currentTime)).toBeGreaterThan(60);
        expect(await page.evaluate(() => window.timersSet)).toBeLessThan(5);
      } finally {
        await browser.close();
      }
    });

    test("a page left while its sound plays under Playwright's clock never crashes, and the next page plays", async () => {
      const browser = await launch();
      try {
        // Moving the clock and then leaving the page runs the kit's step in the page that was left, where WebKit has
        // already torn the audio down; resuming the engine there crashed WebKit's page within a few pages, most often
        // early in a browser context.
        const now = Date.now();
        for (let round = 0; round < 6; round++) {
          const { context, page } = await openPage(browser, { startsOnTap: true });
          let crashed = false;
          page.on('crash', () => (crashed = true));
          try {
            for (let hour = 1; hour <= 10; hour++) {
              await page.getByRole('button', { name: 'Play' }).click();
              await page.clock.pauseAt(new Date(now + (round * 10 + hour) * 3_600_000));
              await page.clock.resume();
              await page.goto(ADDRESS);
            }
            await page.getByRole('button', { name: 'Play' }).click();
            await page.evaluate(() => new Promise<void>((resolve) => (function moved() {
              if (window.contexts[0]!.state === 'running' && window.contexts[0]!.currentTime > 0.1) resolve();
              else setTimeout(moved, 10);
            })()));
          } catch (error) {
            expect(crashed, 'the page crashed').toBe(false);
            throw error;
          }
          expect(crashed, 'the page crashed').toBe(false);
          await context.close();
        }
      } finally {
        await browser.close();
      }
    });
  });
}

declare global {
  interface Window {
    early: AudioContext;
    earlyStart: Promise<string>;
    contexts: AudioContext[];
    states: AudioContextState[][];
    settled: string[];
    timersSet: number;
    play: (context: AudioContext) => Promise<{ audio: number; clock: number; peak: number; swell: number; ended: boolean }>;
  }
}
