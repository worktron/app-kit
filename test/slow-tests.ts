// A test that takes over 2 seconds says where its time went, in app-kit's own tests only (bunfig.toml's preload): its
// own CPU, the child processes it started and the rest, which is a timer it waited on or the Mac holding it off the CPU,
// with the Mac's load. Tests that timed out on busy landings once looked frozen, and recording them showed the time was
// dozens of child processes each slowed by the load; the next slow test says which it is without a recorder.
import { afterEach, beforeEach } from 'bun:test';
import { loadavg } from 'node:os';

const SLOW_MS = 2_000;

type Children = { count: number; ms: number };
let children: Children = { count: 0, ms: 0 };
let started = 0;
let before = process.resourceUsage();

const spawnSync = Bun.spawnSync;
Bun.spawnSync = ((...args: Parameters<typeof Bun.spawnSync>) => {
  const mine = children;
  const at = performance.now();
  try {
    return spawnSync(...args);
  } finally {
    mine.count++;
    mine.ms += performance.now() - at;
  }
}) as typeof Bun.spawnSync;

const spawn = Bun.spawn;
Bun.spawn = ((...args: Parameters<typeof Bun.spawn>) => {
  const mine = children;
  const at = performance.now();
  const child = spawn(...args);
  mine.count++;
  child.exited.then(
    () => (mine.ms += performance.now() - at),
    () => {},
  );
  return child;
}) as typeof Bun.spawn;

beforeEach(() => {
  children = { count: 0, ms: 0 };
  before = process.resourceUsage();
  started = performance.now();
});

afterEach(() => {
  const wall = performance.now() - started;
  if (wall <= SLOW_MS) return;
  const after = process.resourceUsage();
  const cpu = (after.userCPUTime - before.userCPUTime + after.systemCPUTime - before.systemCPUTime) / 1000;
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  console.warn(
    `slow test: ${seconds(wall)}, of which its own CPU ${seconds(cpu)}, ${children.count} child processes ${seconds(children.ms)} (summed, so ` +
      `ones that ran at once count twice), the rest ${seconds(Math.max(0, wall - cpu - children.ms))}; ` +
      `${after.involuntaryContextSwitches - before.involuntaryContextSwitches} times taken off the CPU, ` +
      `${after.majorPageFault - before.majorPageFault} pages read back from disk, load ${loadavg()[0]!.toFixed(0)}`,
  );
});
