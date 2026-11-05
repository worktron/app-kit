// One reading of a macOS process (app-kit/server/process-usage), held against the real thing: real processes read by the
// real calls and compared with `ps`, the point being a reaped child's CPU time, which `ps` never shows. What macOS cannot
// be made to answer on demand, a stand-in for bun:ffi answers, in a process of its own.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readProcessUsage } from '../server/process-usage';
import packageJson from '../package.json';

const CHILD = join(import.meta.dir, 'process-usage-child.ts');
const STAND_IN_CHILD = join(import.meta.dir, 'process-usage-stand-in-child.ts');

/** CPU a test's process burns, in seconds of CPU time, so the amount holds however busy the machine is. */
const BURN_SECONDS = 0.2;
/** How far a reading and `ps`, taken a moment apart of a process that has gone idle, may differ. */
const CPU_MARGIN_SECONDS = 0.1;
/** These tests wait on CPU time, which a machine busy with other work hands out slowly. */
const WAITS_ON_CPU_MS = 15_000;

/** Every process a test started, stopped here too, since a test that fails or times out never reaches its own stop. */
const started: (() => Promise<void>)[] = [];
afterAll(async () => {
  await Promise.all(started.map((stop) => stop()));
});

function runToReady(mode: string, amount: string | number, depth: number) {
  const running = Bun.spawn([process.execPath, CHILD, mode, String(amount), String(depth), 'stay'], { stdin: 'pipe', stdout: 'pipe' });
  const stop = async () => {
    void running.stdin.end();
    await running.exited;
  };
  started.push(stop);
  const ready = (async () => {
    let said = '';
    for await (const piece of running.stdout) {
      said += Buffer.from(piece).toString();
      if (said.includes('ready')) return;
    }
    throw new Error(`the process ended before it was ready, having said: ${said}`);
  })();
  return { pid: running.pid, ready, stop };
}

const ps = (pid: number, column: string) => Bun.spawnSync(['ps', '-o', `${column}=`, '-p', String(pid)]).stdout.toString().trim();

/** `ps -o time=` in seconds: minutes:seconds.hundredths, as 1:02.34. */
function psCpuSeconds(pid: number) {
  const [minutes, seconds] = ps(pid, 'time').split(':');
  return Number(minutes) * 60 + Number(seconds);
}

/** The pids `ps` lists with this parent: a reaped child is on no list `ps` can make. */
const psChildren = (pid: number) =>
  Bun.spawnSync(['ps', '-A', '-o', 'pid=', '-o', 'ppid='])
    .stdout.toString()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([, parent]) => parent === pid);

describe.if(process.platform === 'darwin')('a real process on this Mac', () => {
  test.concurrent(
    "a process's own CPU time matches ps for it",
    async () => {
      const burner = runToReady('burn', BURN_SECONDS, 0);
      await burner.ready;
      const usage = readProcessUsage(burner.pid)!;
      const seen = psCpuSeconds(burner.pid);
      await burner.stop();

      expect(usage.pid).toBe(burner.pid);
      expect(usage.ownCpuSeconds).toBeGreaterThanOrEqual(BURN_SECONDS);
      expect(Math.abs(usage.ownCpuSeconds - seen)).toBeLessThan(CPU_MARGIN_SECONDS);
      expect(usage.finishedChildrenCpuSeconds).toBe(0);
    },
    WAITS_ON_CPU_MS,
  );

  test.concurrent(
    'a parent whose child burned CPU and was reaped shows that time, where ps shows none',
    async () => {
      // The child burns far more than the parent's own start-up costs, so ps cannot be mistaken for having counted it.
      const burn = BURN_SECONDS * 3;
      const parent = runToReady('burn', burn, 1);
      await parent.ready;
      const usage = readProcessUsage(parent.pid)!;
      const seen = psCpuSeconds(parent.pid);
      const children = psChildren(parent.pid);
      await parent.stop();

      expect(usage.finishedChildrenCpuSeconds).toBeGreaterThanOrEqual(burn);
      // ps has only the parent's own small time, no sign of the burn, and no child to look at.
      expect(seen).toBeLessThan(burn);
      expect(children).toEqual([]);
      expect(Math.abs(usage.ownCpuSeconds - seen)).toBeLessThan(CPU_MARGIN_SECONDS);
    },
    WAITS_ON_CPU_MS,
  );

  test.concurrent(
    'ps lists a child still running under its parent, and that child is not yet in the finished total',
    async () => {
      const parent = runToReady('hold', BURN_SECONDS, 0);
      await parent.ready;
      const children = psChildren(parent.pid);
      const usage = readProcessUsage(parent.pid)!;
      const childUsage = readProcessUsage(children[0]![0]!)!;
      await parent.stop();

      // The check the reaped test relies on: with a child to find, ps finds it.
      expect(children.length).toBe(1);
      expect(childUsage.ownCpuSeconds).toBeGreaterThanOrEqual(BURN_SECONDS);
      expect(usage.finishedChildrenCpuSeconds).toBe(0);
    },
    WAITS_ON_CPU_MS,
  );

  test.concurrent(
    "a grandchild's CPU time reaches the top, once each level has been reaped",
    async () => {
      const top = runToReady('burn', BURN_SECONDS, 2);
      await top.ready;
      const usage = readProcessUsage(top.pid)!;
      await top.stop();

      expect(usage.finishedChildrenCpuSeconds).toBeGreaterThanOrEqual(BURN_SECONDS);
    },
    WAITS_ON_CPU_MS,
  );

  test.concurrent(
    'memory matches what ps says for it, and the footprint is there',
    async () => {
      const idle = runToReady('burn', 0, 0);
      await idle.ready;
      const usage = readProcessUsage(idle.pid)!;
      const residentKilobytes = Number(ps(idle.pid, 'rss'));
      await idle.stop();

      expect(Math.abs(usage.residentBytes - residentKilobytes * 1024)).toBeLessThan(16 * 1024 * 1024);
      expect(usage.footprintBytes).toBeGreaterThan(0);
    },
    WAITS_ON_CPU_MS,
  );

  test.concurrent(
    'what a process wrote and synced to disk shows in its bytes written',
    async () => {
      const bytes = 8 * 1024 * 1024;
      const writer = runToReady('write', join(mkdtempSync(join(tmpdir(), 'process-usage-')), 'written'), bytes);
      await writer.ready;
      const usage = readProcessUsage(writer.pid)!;
      await writer.stop();

      expect(usage.diskWriteBytes).toBeGreaterThanOrEqual(bytes);
    },
    WAITS_ON_CPU_MS,
  );

  test.concurrent(
    'the same process reads the same startedAt, another process another, so a reused pid can be told',
    async () => {
      const first = runToReady('burn', 0, 0);
      const second = runToReady('burn', 0, 0);
      await Promise.all([first.ready, second.ready]);
      const readings = [readProcessUsage(first.pid)!, readProcessUsage(first.pid)!, readProcessUsage(second.pid)!];
      await Promise.all([first.stop(), second.stop()]);

      expect(typeof readings[0]!.startedAt).toBe('bigint');
      expect(readings[1]!.startedAt).toBe(readings[0]!.startedAt);
      expect(readings[2]!.startedAt).not.toBe(readings[0]!.startedAt);
    },
    WAITS_ON_CPU_MS,
  );

  test('a process gone reads as null', async () => {
    const gone = Bun.spawn(['true']);
    await gone.exited;
    expect(readProcessUsage(gone.pid)).toBeNull();
  });

  test.skipIf(process.getuid?.() === 0)("another user's process reads as null", () => {
    expect(ps(1, 'user')).toBe('root');
    expect(readProcessUsage(1)).toBeNull();
  });
});

type StandInRun = {
  openedByImport: string[];
  opened: string[];
  bufferSizes: number[];
  flavors: number[];
  pids: number[];
  readings: (Record<string, number | string> | null)[];
};

/** Each answer from the stand-in once: what it did with an answer is only read, so the tests that ask the same share the run. */
const standInRuns = new Map<string, StandInRun>();

function standIn(numerator: number, denominator: number, answer: number, platform = 'darwin') {
  const args = [String(numerator), String(denominator), String(answer), platform];
  const kept = standInRuns.get(args.join(' '));
  if (kept) return kept;
  const run = Bun.spawnSync([process.execPath, STAND_IN_CHILD, ...args], { stderr: 'pipe', stdout: 'pipe' });
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  const result = JSON.parse(run.stdout.toString()) as StandInRun;
  standInRuns.set(args.join(' '), result);
  return result;
}

test('every field comes from its own place in what macOS writes, with the times in seconds on Apple silicon', () => {
  const { readings, bufferSizes, flavors } = standIn(125, 3, 0);
  expect(bufferSizes[0]).toBe(160);
  expect(flavors[0]).toBe(2);
  expect(readings[0]).toEqual({
    pid: 123,
    startedAt: (2n ** 60n + 1n).toString(),
    ownCpuSeconds: 1.5,
    finishedChildrenCpuSeconds: 3,
    residentBytes: 1_000,
    footprintBytes: 2_000,
    diskReadBytes: 3_000,
    diskWriteBytes: 4_000,
  });
});

test('on Intel a mach unit is a nanosecond', () => {
  const { readings } = standIn(1, 1, 0);
  expect(readings[0]!.ownCpuSeconds).toBe(0.036);
  expect(readings[0]!.finishedChildrenCpuSeconds).toBe(0.072);
});

test('when macOS refuses, the reading is null', () => {
  const { readings } = standIn(125, 3, -1);
  expect(readings[0]).toBeNull();
});

test('a timebase with no denominator is no reading, not a wrong one', () => {
  const { readings, bufferSizes } = standIn(125, 0, 0);
  expect(readings[0]).toBeNull();
  expect(bufferSizes).toEqual([]);
});

test('importing it opens nothing, and readings open each library once', () => {
  const { openedByImport, opened } = standIn(125, 3, 0);
  expect(openedByImport).toEqual([]);
  expect(opened).toEqual(['/usr/lib/libproc.dylib', '/usr/lib/libSystem.B.dylib']);
});

test('a pid that is no whole number a C int holds never reaches macOS, where it would read another process', () => {
  const { pids, readings } = standIn(125, 3, 0);
  expect(pids).toEqual([123, 456]);
  expect(readings.slice(2)).toEqual([null, null, null]);
});

test('off macOS the reading is null and no library is opened', () => {
  const { opened, readings } = standIn(125, 3, 0, 'linux');
  expect(opened).toEqual([]);
  expect(readings.every((reading) => reading === null)).toBe(true);
});

test('apps import it as app-kit/server/process-usage', () => {
  expect((packageJson.exports as Record<string, string>)['./server/process-usage']).toBe('./server/process-usage/index.ts');
});
