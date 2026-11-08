/*
 * One reading of one macOS process's CPU time, memory and disk (app-kit/server/process-usage), and in window.ts the cores
 * each process used between two readings of the machine. Sampling and who owns a process stay in the app. What this
 * reading has that `ps` and every other reader lack is
 * finishedChildrenCpuSeconds: the kernel adds a child's own and child time to its parent's child total when the child is
 * reaped, so a process that lived too short for any sample to see it still shows, in its parent.
 *
 * bun:ffi is experimental, so an app may run this in a process of its own, where a crash costs one reading and never the
 * server. Importing this file loads nothing: bun:ffi and the two libraries are opened at the first reading on a Mac.
 */
import type { dlopen as bunDlopen, FFIType as BunFFIType } from 'bun:ffi';

export {
  coresBetween,
  parseCpuTime,
  parsePs,
  psArguments,
  type MachineReading,
  type ProcessCores,
  type ProcessCpu,
  type ProcessRow,
} from './window';

export type ProcessUsage = {
  pid: number;
  /** Only for comparing: the same pid and the same startedAt is the same process, since macOS reuses a pid. */
  startedAt: bigint;
  ownCpuSeconds: number;
  /** All the CPU time of this process's reaped children, and of theirs. */
  finishedChildrenCpuSeconds: number;
  residentBytes: number;
  footprintBytes: number;
  diskReadBytes: number;
  diskWriteBytes: number;
};

// struct rusage_info_v2 in the macOS SDK's sys/resource.h. The kernel writes all 160 bytes whatever the buffer's size.
const RUSAGE_INFO_V2 = 2;
const RUSAGE_INFO_V2_BYTES = 160;
const USER_TIME = 16;
const SYSTEM_TIME = 24;
const RESIDENT_SIZE = 64;
const PHYSICAL_FOOTPRINT = 72;
const PROCESS_START_TIME = 80;
const CHILD_USER_TIME = 96;
const CHILD_SYSTEM_TIME = 104;
const DISK_BYTES_READ = 144;
const DISK_BYTES_WRITTEN = 152;

/** A pid is a C int: a larger number would reach the kernel cut short, and read some other process. */
const LARGEST_PID = 2 ** 31 - 1;

type MacOS = {
  procPidRusage: (pid: number, flavor: number, buffer: Uint8Array) => number;
  /** The times are in mach absolute units, which this fraction turns into nanoseconds: 125/3 on Apple silicon, 1/1 on Intel. */
  timebase: { numerator: bigint; denominator: bigint };
};

let opened: MacOS | undefined;

function macOS(): MacOS | null {
  if (opened) return opened;
  const { dlopen, FFIType } = require('bun:ffi') as { dlopen: typeof bunDlopen; FFIType: typeof BunFFIType };
  const { symbols: libproc } = dlopen('/usr/lib/libproc.dylib', {
    proc_pid_rusage: { args: [FFIType.i32, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
  });
  const { symbols: libSystem } = dlopen('/usr/lib/libSystem.B.dylib', {
    mach_timebase_info: { args: [FFIType.ptr], returns: FFIType.i32 },
  });
  const fraction = new Uint32Array(2);
  if (libSystem.mach_timebase_info(fraction) !== 0 || fraction[1] === 0) return null;
  opened = {
    procPidRusage: (pid, flavor, buffer) => libproc.proc_pid_rusage(pid, flavor, buffer),
    timebase: { numerator: BigInt(fraction[0]!), denominator: BigInt(fraction[1]!) },
  };
  return opened;
}

/** One reading of `pid`, or null when macOS will not say: another user's process, a process gone, or not macOS. */
export function readProcessUsage(pid: number): ProcessUsage | null {
  if (process.platform !== 'darwin' || !Number.isInteger(pid) || pid < 0 || pid > LARGEST_PID) return null;
  const mac = macOS();
  if (!mac) return null;
  const buffer = new Uint8Array(RUSAGE_INFO_V2_BYTES);
  if (mac.procPidRusage(pid, RUSAGE_INFO_V2, buffer) !== 0) return null;
  const view = new DataView(buffer.buffer);
  const field = (offset: number) => view.getBigUint64(offset, true);
  // Multiplied before it is divided: 125/3 in whole numbers is 41, which would read every time on Apple silicon 1.6% low.
  const seconds = (ticks: bigint) => Number((ticks * mac.timebase.numerator) / mac.timebase.denominator) / 1e9;
  return {
    pid,
    startedAt: field(PROCESS_START_TIME),
    ownCpuSeconds: seconds(field(USER_TIME) + field(SYSTEM_TIME)),
    finishedChildrenCpuSeconds: seconds(field(CHILD_USER_TIME) + field(CHILD_SYSTEM_TIME)),
    residentBytes: Number(field(RESIDENT_SIZE)),
    footprintBytes: Number(field(PHYSICAL_FOOTPRINT)),
    diskReadBytes: Number(field(DISK_BYTES_READ)),
    diskWriteBytes: Number(field(DISK_BYTES_WRITTEN)),
  };
}
