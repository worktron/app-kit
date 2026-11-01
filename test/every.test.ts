// A job on a clock (app-kit/server/every), on Bun's fake clock: never two runs at once, a failure written and the
// next run still made, and a stop that waits for the run in progress.
import { afterEach, beforeEach, expect, jest, test } from 'bun:test';
import { every, LONGEST_DELAY_MS } from '../server/every';

const INTERVAL = 1_000;

let printed: string[];
beforeEach(() => {
  printed = [];
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

/** Lets every promise already settled go on: the real setImmediate, which the fake clock leaves alone, runs after them. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Lets a run that just ended set its next timer, moves the fake clock on, then lets what the timers started settle:
 * Bun's fake timers have no async step. A timer's least delay is 1ms, as in Node, so "at once" is a step of 1.
 */
async function advance(ms: number) {
  await settle();
  jest.advanceTimersByTime(ms);
  await settle();
}

/** A job whose runs the test ends, one at a time. */
function heldJob() {
  const runs: { end: () => void; fail: (error: Error) => void }[] = [];
  const job = () =>
    new Promise<void>((end, fail) => {
      runs.push({ end: () => end(), fail });
    });
  return { runs, job };
}

test('a run slower than its interval is never overlapped: the next starts once it settles, and a quick one keeps the clock', async () => {
  const { runs, job } = heldJob();
  const stop = every('mailbox triage', INTERVAL, job, { print: (line) => printed.push(line) });
  await advance(INTERVAL - 1);
  expect(runs).toHaveLength(0);
  await advance(1);
  expect(runs).toHaveLength(1);
  // Three intervals pass with the first run still going: setInterval would have started three more.
  await advance(3 * INTERVAL);
  expect(runs).toHaveLength(1);
  runs[0]!.end();
  await advance(1);
  // It was due long ago, so it starts at once rather than an interval on.
  expect(runs).toHaveLength(2);
  await advance(INTERVAL / 4);
  runs[1]!.end();
  await settle();
  // A run that ends well inside its interval leaves the next one interval after it started, not after it ended.
  await advance(INTERVAL - INTERVAL / 4 - 1);
  expect(runs).toHaveLength(2);
  await advance(1);
  expect(runs).toHaveLength(3);
  expect(printed).toEqual([]);
  runs[2]!.end();
  await stop();
});

test('a run that throws, at once or later, is written with the job name and the next run still happens', async () => {
  let run = 0;
  const job = async () => {
    run += 1;
    if (run === 1) throw new Error('the mail server refused');
    if (run === 2) {
      await Promise.resolve();
      throw 'no answer';
    }
  };
  const stop = every('alarm check', INTERVAL, job, { print: (line) => printed.push(line) });
  await advance(INTERVAL);
  await advance(INTERVAL);
  await advance(INTERVAL);
  expect(run).toBe(3);
  expect(printed).toHaveLength(2);
  expect(printed[0]).toStartWith('alarm check failed: Error: the mail server refused');
  expect(printed[1]).toBe('alarm check failed: no answer');
  await stop();
});

test('runAtStart runs it at once, then once an interval', async () => {
  let runs = 0;
  const stop = every('refresh', INTERVAL, () => void (runs += 1), { runAtStart: true });
  await advance(1);
  expect(runs).toBe(1);
  await advance(INTERVAL - 1);
  expect(runs).toBe(1);
  await advance(1);
  expect(runs).toBe(2);
  await stop();
});

test('stop waits for a run in progress, and no run follows it', async () => {
  const { runs, job } = heldJob();
  const stop = every('mailbox triage', INTERVAL, job);
  await advance(INTERVAL);
  expect(runs).toHaveLength(1);
  let stopped = false;
  const stopping = stop().then(() => (stopped = true));
  await advance(1);
  expect(stopped).toBe(false);
  runs[0]!.end();
  await stopping;
  expect(stopped).toBe(true);
  await advance(10 * INTERVAL);
  expect(runs).toHaveLength(1);
});

test('stopped before its first run, it never runs, and stop gives back at once', async () => {
  let runs = 0;
  const stop = every('refresh', INTERVAL, () => void (runs += 1));
  await stop();
  await advance(10 * INTERVAL);
  expect(runs).toBe(0);
});

test('an interval of 0, below it, past the longest delay a timer holds or no number at all is refused, since the job would run back to back', () => {
  expect(() => every('refresh', LONGEST_DELAY_MS, () => undefined)()).not.toThrow();
  for (const interval of [0, -5, LONGEST_DELAY_MS + 1, 30 * 24 * 60 * 60_000, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => every('refresh', interval, () => undefined)).toThrow(RangeError);
  }
});

test('a worker with no web server imports it by app-kit/server/every with nothing else coming with it', async () => {
  const source = await Bun.file(new URL('../server/every/index.ts', import.meta.url)).text();
  expect(source).not.toMatch(/^\s*import\s/m);
  const { exports } = (await import('../package.json')).default as { exports: Record<string, string> };
  expect(exports['./server/every']).toBe('./server/every/index.ts');
});
