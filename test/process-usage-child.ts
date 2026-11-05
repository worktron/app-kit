// A process for test/process-usage.test.ts to read. In `burn` with depth 0 it burns this much CPU time itself; with a
// depth above 0 it runs itself one level down and reaps it, so its own CPU stays small and its children's is the burn.
// In `hold` it keeps a child that has burned this much still running. In `write` it writes and syncs a file. Then it says
// `ready`, and with `stay` waits until its stdin closes, which the test's ending closes too, so none of these outlives it.
import { closeSync, fsyncSync, openSync, writeSync } from 'fs';

const [mode, amount, depth, then] = process.argv.slice(2) as [string, string, string, 'stay' | 'exit'];

const run = (...args: string[]) => Bun.spawn([process.execPath, import.meta.path, ...args], { stdin: 'pipe', stdout: 'pipe' });
const stdinCloses = async () => {
  for await (const _ of Bun.stdin.stream());
};

if (mode === 'write') {
  const file = openSync(amount, 'w');
  for (let written = 0; written < Number(depth); written += 1024 * 1024) writeSync(file, Buffer.alloc(1024 * 1024, 1));
  fsyncSync(file);
  closeSync(file);
} else if (mode === 'hold') {
  const child = run('burn', amount, '0', 'stay');
  let said = '';
  for await (const piece of child.stdout) {
    said += Buffer.from(piece).toString();
    if (said.includes('ready')) break;
  }
  console.log('ready');
  await stdinCloses();
  void child.stdin.end();
  await child.exited;
  process.exit(0);
} else if (Number(depth) === 0) {
  const cpuSeconds = () => {
    const { user, system } = process.cpuUsage();
    return (user + system) / 1e6;
  };
  while (cpuSeconds() < Number(amount));
} else {
  await run(mode, amount, String(Number(depth) - 1), 'exit').exited;
}

console.log('ready');
if (then === 'stay') await stdinCloses();
