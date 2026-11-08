/*
 * What each process used of the CPU between two readings of the machine, in cores, short-lived children included
 * (app-kit/server/process-usage). `ps`'s pcpu is a running average over the processes alive at that instant, so a process
 * that ran and finished between two looks never shows, and while tests run or a landing builds, those are most of the
 * load. The kernel's child time shows them: when a process is reaped, its own time and its child time roll up into its
 * parent's child time, recursively.
 *
 * Pure: no `ps`, no reader, no clock. The app runs `ps` with psArguments, reads each row's pid with readProcessUsage,
 * and hands two such readings here.
 */
import type { ProcessUsage } from './index';

/** One line of `ps`, run with psArguments. */
export type ProcessRow = {
  pid: number;
  ppid: number;
  uid: number;
  /** `ps`'s time: user and system CPU time, which `ps` reads for every user's process, being setuid root. */
  cpuSeconds: number;
  /** `ps`'s pcpu: a decaying average, for an app's first reading, which has no earlier one to take a difference from. */
  cpuPercent: number;
  /** `ps`'s rss, in bytes, for a process the reader cannot read. */
  residentBytes: number;
  /** The program's path, or with `psArguments('name')` its name alone; spaces and all. */
  program: string;
};

/** What coresBetween takes from a reading of readProcessUsage. */
export type ProcessCpu = Pick<ProcessUsage, 'startedAt' | 'ownCpuSeconds' | 'finishedChildrenCpuSeconds'>;

/** One look at the machine: `ps` for every process, and readProcessUsage for each pid it could read. */
export type MachineReading = {
  /** When it was read, in milliseconds. */
  at: number;
  rows: readonly ProcessRow[];
  usage: ReadonlyMap<number, ProcessCpu>;
};

export type ProcessCores = {
  ownCores: number;
  /** The CPU time of its children, and of theirs, reaped between the two readings, counting only what they used inside it. */
  finishedChildrenCores: number;
};

const COLUMNS = 'pid=,ppid=,uid=,time=,pcpu=,rss=,comm=';

/** The arguments to `ps` whose output parsePs reads: every process, with its program's path or, with 'name', its name. */
export function psArguments(program: 'path' | 'name' = 'path'): string[] {
  return program === 'name' ? ['-A', '-c', '-o', COLUMNS] : ['-A', '-o', COLUMNS];
}

/** `ps`'s time, [[dd-]hh:]mm:ss.cc such as 771:18.84, as seconds, or null for anything else (a zombie's `-`). */
export function parseCpuTime(text: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(text);
  if (!m) return null;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

/**
 * The output of `ps` run with psArguments. A line with no time, a zombie's, is left out. Under a locale such as de_DE
 * `ps` prints pcpu with a comma (22,1) and the time still with a point, so pcpu takes either.
 */
export function parsePs(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\d+(?:[.,]\d+)?)\s+(\d+)\s+(.+)$/.exec(line);
    const cpuSeconds = m ? parseCpuTime(m[4]!) : null;
    if (!m || cpuSeconds === null) continue;
    rows.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      uid: Number(m[3]),
      cpuSeconds,
      cpuPercent: Number(m[5]!.replace(',', '.')),
      residentBytes: Number(m[6]) * 1024,
      program: m[7]!.trim(),
    });
  }
  return rows;
}

/** How far up from a gone process the walk to its nearest ancestor alive at both readings goes. */
const DEEPEST_TREE = 64;

/**
 * Each process alive at the second reading, with the cores it used since the first.
 *
 * Per process alive at both readings: the change in its own time and its finished children's time. A parent's child
 * time also takes in what a child had used before the first reading, once that child ends inside the window, so every
 * process gone by the second reading has what it had used at the first, own and child, taken from its nearest ancestor
 * alive at both, at any depth, and a child figure never goes under zero. A process new at the second reading counts
 * whole. One macOS will not read (another user's) counts the change in `ps`'s time, and has no child time.
 *
 * A pid is the same process at both readings only when its startedAt matches: macOS reuses pids within minutes.
 *
 * `readableUid` is the uid the reader runs as, whose processes it can read; null when the reader failed and `ps` is all
 * there is. A process of that uid that `ps` listed and the reader then could not read ended between the two: it is
 * gone, never a process read by `ps` alone, so its whole life is never counted twice.
 *
 * What cannot be charged: a child orphaned to launchd before it ended (its time goes to launchd, which the reader
 * cannot read) and the kernel's own threads. Those are what is left between the sum of these and the machine's total.
 */
export function coresBetween(
  first: MachineReading,
  second: MachineReading,
  readableUid: number | null,
): Map<number, ProcessCores> {
  const seconds = Math.max(0.001, (second.at - first.at) / 1000);
  const readable = (r: ProcessRow) => readableUid !== null && r.uid === readableUid;
  const alive = (reading: MachineReading) => reading.rows.filter((r) => !readable(r) || reading.usage.has(r.pid));
  const before = new Map(first.rows.map((r) => [r.pid, r]));
  const now = alive(second);
  const after = new Set(now.map((r) => r.pid));
  const sameProcess = (pid: number) => {
    const a = first.usage.get(pid);
    const b = second.usage.get(pid);
    return !!a && !!b && a.startedAt === b.startedAt;
  };

  const own = new Map<number, number>();
  const child = new Map<number, number>();
  for (const r of now) {
    const a = first.usage.get(r.pid);
    const b = second.usage.get(r.pid);
    if (b) {
      const same = sameProcess(r.pid);
      own.set(r.pid, same ? b.ownCpuSeconds - a!.ownCpuSeconds : b.ownCpuSeconds);
      child.set(r.pid, same ? b.finishedChildrenCpuSeconds - a!.finishedChildrenCpuSeconds : b.finishedChildrenCpuSeconds);
    } else {
      const was = before.get(r.pid);
      own.set(r.pid, was ? Math.max(0, r.cpuSeconds - was.cpuSeconds) : r.cpuSeconds);
      child.set(r.pid, 0);
    }
  }

  // A readable process gone before the first reader read it is already in its parent's first reading: nothing is owed.
  for (const r of alive(first)) {
    const a = first.usage.get(r.pid);
    const reused = !!a && second.usage.has(r.pid) && !sameProcess(r.pid);
    if (after.has(r.pid) && !reused) continue;
    const used = a ? a.ownCpuSeconds + a.finishedChildrenCpuSeconds : r.cpuSeconds;
    // An ancestor alive that macOS will not read ends the walk, launchd say: its child time is not counted, so nothing is owed.
    let p: number | undefined = r.ppid;
    for (let n = 0; p && n < DEEPEST_TREE; p = before.get(p)?.ppid, n++) {
      if (sameProcess(p)) {
        child.set(p, (child.get(p) ?? 0) - used);
        break;
      }
      if (after.has(p)) break;
    }
  }

  const cores = new Map<number, ProcessCores>();
  for (const r of now) {
    cores.set(r.pid, {
      ownCores: Math.max(0, own.get(r.pid) ?? 0) / seconds,
      finishedChildrenCores: Math.max(0, child.get(r.pid) ?? 0) / seconds,
    });
  }
  return cores;
}
