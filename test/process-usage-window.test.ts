// The cores each process used between two readings of the machine (app-kit/server/process-usage, window.ts): made-up
// readings for what a real machine cannot be made to do on demand (pid reuse, a whole tree ending, an orphan), the
// `ps` parser against what `ps` prints, and one window on this Mac around a child that lives and ends inside it.
import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import {
  coresBetween,
  parseCpuTime,
  parsePs,
  psArguments,
  readProcessUsage,
  type MachineReading,
  type ProcessCpu,
  type ProcessRow,
} from '../server/process-usage';

const ME = 501;
const ROOT = 0;
const row = (pid: number, ppid: number, cpuSeconds = 0, uid = ME): ProcessRow => ({
  pid,
  ppid,
  uid,
  cpuSeconds,
  cpuPercent: 0,
  residentBytes: 0,
  program: '/bin/x',
});
const use = (own: number, child = 0, startedAt = 1n): ProcessCpu => ({
  startedAt,
  ownCpuSeconds: own,
  finishedChildrenCpuSeconds: child,
});
const reading = (at: number, rows: ProcessRow[], usage: [number, ProcessCpu][]): MachineReading => ({
  at,
  rows,
  usage: new Map(usage),
});
const cores = (ownCores: number, finishedChildrenCores: number) => ({ ownCores, finishedChildrenCores });
const WINDOW = 3000;

describe('what a process used between two readings, in cores', () => {
  test('a process alive at both: the change in its own time and its child time, over the seconds between the readings', () => {
    const c = coresBetween(
      reading(0, [row(10, 1)], [[10, use(100, 50)]]),
      reading(WINDOW, [row(10, 1)], [[10, use(103, 56)]]),
      ME,
    );
    expect(c.get(10)).toEqual(cores(1, 2));
  });

  test('a child that started and finished between the readings shows in its parent, where ps shows nothing', () => {
    const c = coresBetween(
      reading(0, [row(10, 1)], [[10, use(5, 0)]]),
      reading(WINDOW, [row(10, 1)], [[10, use(5, 12)]]),
      ME,
    );
    expect(c.get(10)).toEqual(cores(0, 4));
  });

  test('a child alive at the first reading and gone at the second: only what it used inside the window counts', () => {
    // The child had used 100 seconds before the window and 3 inside it: its parent's child time rises by 103.
    const c = coresBetween(
      reading(0, [row(10, 1), row(11, 10)], [[10, use(1, 0)], [11, use(100, 0)]]),
      reading(WINDOW, [row(10, 1)], [[10, use(1, 103)]]),
      ME,
    );
    expect(c.get(10)).toEqual(cores(0, 1));
    expect(c.has(11)).toBe(false);
  });

  test('a whole tree gone inside the window: each gone process is taken from its nearest ancestor alive at both, at any depth', () => {
    // A runner (10), its worker (11), the worker's browser (12), the browser's renderer (13), each with history
    // from before the window; the three below the runner finish inside it, 6 seconds of new work among them.
    const c = coresBetween(
      reading(
        0,
        [row(10, 1), row(11, 10), row(12, 11), row(13, 12)],
        [[10, use(1, 0)], [11, use(50, 0)], [12, use(200, 0)], [13, use(300, 20)]],
      ),
      reading(WINDOW, [row(10, 1)], [[10, use(1, 576)]]),
      ME,
    );
    expect(c.get(10)).toEqual(cores(0, 2));
  });

  test('a child orphaned before it ended leaves its time with launchd: the ancestor owed it never goes under zero', () => {
    const c = coresBetween(
      reading(0, [row(10, 1), row(11, 10)], [[10, use(1, 0)], [11, use(100, 0)]]),
      reading(WINDOW, [row(10, 1)], [[10, use(1, 0)]]),
      ME,
    );
    expect(c.get(10)).toEqual(cores(0, 0));
  });

  test('a process new at the second reading counts whole, and one on a reused pid counts as new, with the old one taken from its parent', () => {
    const c = coresBetween(
      reading(0, [row(10, 1), row(20, 10)], [[10, use(0, 0)], [20, use(900, 0, 1n)]]),
      reading(
        WINDOW,
        [row(10, 1), row(20, 10), row(30, 10)],
        [[10, use(0, 903)], [20, use(3, 0, 2n)], [30, use(6, 3)]],
      ),
      ME,
    );
    expect(c.get(20)).toEqual(cores(1, 0));
    expect(c.get(30)).toEqual(cores(2, 1));
    expect(c.get(10)).toEqual(cores(0, 1));
  });

  test("another user's process counts the change in ps's time, never its whole life, and a gone one under launchd owes nothing", () => {
    const c = coresBetween(
      reading(0, [row(30, 1, 46278.84, ROOT), row(31, 1, 500, ROOT)], []),
      reading(WINDOW, [row(30, 1, 46281.84, ROOT), row(40, 1, 6, ROOT)], []),
      ME,
    );
    expect(c.get(30)).toEqual(cores(1, 0));
    expect(c.get(40)).toEqual(cores(2, 0));
    expect(c.has(31)).toBe(false);
  });
});

describe('a process that ends between ps and the reader', () => {
  test('listed by the second ps, gone before the second reader: it is gone, its old time taken from its parent, never counted again by ps', () => {
    // The child (11) had used 100 seconds before the window, 1 inside it, and ended after ps listed it.
    const c = coresBetween(
      reading(0, [row(10, 1), row(11, 10, 100)], [[10, use(1, 0)], [11, use(100, 0)]]),
      reading(WINDOW, [row(10, 1), row(11, 10, 101)], [[10, use(1, 101)]]),
      ME,
    );
    expect(c.get(10)).toEqual(cores(0, 1 / 3));
    expect(c.has(11)).toBe(false);
  });

  test('listed by the first ps, gone before the first reader: its time is in its parent at both readings, so nothing is taken', () => {
    const c = coresBetween(
      reading(0, [row(10, 1), row(11, 10, 100)], [[10, use(1, 100)]]),
      reading(WINDOW, [row(10, 1)], [[10, use(1, 103)]]),
      ME,
    );
    expect(c.get(10)).toEqual(cores(0, 1));
  });

  test('with the reader failed, ps is all there is, for every process', () => {
    const c = coresBetween(reading(0, [row(10, 1, 5)], []), reading(WINDOW, [row(10, 1, 8)], []), null);
    expect(c.get(10)).toEqual(cores(1, 0));
  });
});

describe('reading ps', () => {
  test("ps's time as seconds, in each form it prints", () => {
    expect(parseCpuTime('771:18.84')).toBeCloseTo(46278.84);
    expect(parseCpuTime('0:00.01')).toBeCloseTo(0.01);
    expect(parseCpuTime('1:02:03.50')).toBeCloseTo(3723.5);
    expect(parseCpuTime('2-01:00:00.00')).toBeCloseTo(176400);
    expect(parseCpuTime('-')).toBeNull();
  });

  test("ps's lines keep a program's spaces, turn rss into bytes, and skip a line with no time", () => {
    const text = [
      '  771     1    88 771:18.84  12.5 409600 /System/Library/WindowServer',
      '   12     1   501   0:00.01   0.0   2048 postgres: io worker 0',
      '   13     1   501         -   0.0      0 zombie',
      '',
    ].join('\n');
    expect(parsePs(text)).toEqual([
      {
        pid: 771,
        ppid: 1,
        uid: 88,
        cpuSeconds: 46278.84,
        cpuPercent: 12.5,
        residentBytes: 409600 * 1024,
        program: '/System/Library/WindowServer',
      },
      { pid: 12, ppid: 1, uid: 501, cpuSeconds: 0.01, cpuPercent: 0, residentBytes: 2048 * 1024, program: 'postgres: io worker 0' },
    ]);
  });

  test("the arguments ask every process for the parser's columns, with -c for the program's name alone", () => {
    expect(psArguments()).toEqual(['-A', '-o', 'pid=,ppid=,uid=,time=,pcpu=,rss=,comm=']);
    expect(psArguments('name')).toEqual(['-A', '-c', '-o', 'pid=,ppid=,uid=,time=,pcpu=,rss=,comm=']);
  });
});

/** CPU the child burns, in seconds of CPU time, so the amount holds however busy the machine is. */
const BURN_SECONDS = 0.3;
/** This test waits on CPU time, which a machine busy with other work hands out slowly. */
const WAITS_ON_CPU_MS = 15_000;

const ps = (program: 'path' | 'name') => parsePs(Bun.spawnSync(['ps', ...psArguments(program)]).stdout.toString());

/** This test's process as the app would read the machine, kept to that one process so the window is quick to read. */
function readThisProcess(): MachineReading {
  const rows = ps('path').filter((r) => r.pid === process.pid);
  const usage = new Map<number, ProcessCpu>();
  for (const r of rows) {
    const read = readProcessUsage(r.pid);
    if (read) usage.set(r.pid, read);
  }
  return { at: Date.now(), rows, usage };
}

describe.if(process.platform === 'darwin')('on this Mac', () => {
  test("every line of the real ps parses, a zombie's aside, by path and by name", () => {
    for (const program of ['path', 'name'] as const) {
      // One run of ps, read both ways: two runs list different processes on a machine that is starting and ending them.
      const text = Bun.spawnSync(['ps', ...psArguments(program)]).stdout.toString();
      const lines = text.split('\n').filter((l) => l.trim());
      const zombies = lines.filter((l) => /^\s*\d+\s+\d+\s+\d+\s+-\s/.test(l)).length;
      const rows = parsePs(text);
      expect(rows.length).toBe(lines.length - zombies);
      expect(rows.find((r) => r.pid === 1)?.program).toBe(program === 'path' ? '/sbin/launchd' : 'launchd');
    }
  });

  test(
    'a child that started, burned CPU and ended inside the window is charged to its parent, where ps shows no child',
    async () => {
      const first = readThisProcess();
      const child = Bun.spawn([process.execPath, join(import.meta.dir, 'process-usage-child.ts'), 'burn', String(BURN_SECONDS), '0', 'exit'], {
        stdout: 'ignore',
      });
      await child.exited;
      const second = readThisProcess();
      const seconds = (second.at - first.at) / 1000;

      const charged = coresBetween(first, second, process.getuid!());
      expect(charged.has(child.pid)).toBe(false);
      expect(charged.get(process.pid)!.finishedChildrenCores * seconds).toBeGreaterThanOrEqual(BURN_SECONDS);
      expect(ps('path').some((r) => r.pid === child.pid)).toBe(false);
    },
    WAITS_ON_CPU_MS,
  );
});
