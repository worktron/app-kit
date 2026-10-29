import { afterEach, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { folderProblem, projectName, sweepEnded } from '../testing/start-up';

const kit = resolve(import.meta.dir, '..');
const made: string[] = [];
afterEach(() => {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A project of its own with the kit installed, as bun installs it, and one test that prints where it may write. */
function project(packageJson: object | null): string {
  const folder = mkdtempSync(join(tmpdir(), 'start-up-'));
  if (packageJson) writeFileSync(join(folder, 'package.json'), JSON.stringify(packageJson));
  mkdirSync(join(folder, 'node_modules'));
  symlinkSync(kit, join(folder, 'node_modules', 'app-kit'));
  writeFileSync(join(folder, 'bunfig.toml'), '[test]\npreload = ["app-kit/testing/start-up"]\n');
  writeFileSync(
    join(folder, 'where.test.ts'),
    "import { test } from 'bun:test';\nimport { tmpdir } from 'node:os';\ntest('where', () => console.log(`TMPDIR=${process.env.TMPDIR} tmpdir=${tmpdir()} pid=${process.pid}`));\n",
  );
  return folder;
}

function runTests(folder: string): { code: number; output: string } {
  const done = Bun.spawnSync(['bun', 'test'], { cwd: folder, env: process.env, stdout: 'pipe', stderr: 'pipe' });
  return { code: done.exitCode, output: done.stdout.toString() + done.stderr.toString() };
}

const unique = () => `start-up-probe-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

test("a project's tests write in /tmp/<its name>-tests/<their pid>, named in bunfig.toml by the kit's export", () => {
  const name = unique();
  made.push(`/tmp/${name}-tests`);
  const { code, output } = runTests(project({ name }));
  expect(code).toBe(0);
  const [, folder, pid] = /TMPDIR=(\S+) tmpdir=\S+ pid=(\d+)/.exec(output) ?? [];
  expect(folder).toBe(`/tmp/${name}-tests/${pid}`);
  // os.tmpdir() reads TMPDIR, so every mkdtempSync(join(tmpdir(), ...)) lands there.
  expect(output).toContain(`tmpdir=/tmp/${name}-tests/${pid}`);
});

test('a scoped name is one folder, and a project with no name takes its folder name', () => {
  const name = unique();
  made.push(`/tmp/${name}-server-tests`);
  const scoped = runTests(project({ name: `@${name}/server` }));
  expect(scoped.code).toBe(0);
  expect(scoped.output).toMatch(new RegExp(`TMPDIR=/tmp/${name}-server-tests/\\d+ `));

  expect(projectName(join(tmpdir(), 'no-such-project'))).toBe('no-such-project');
});

test('a folder another user could write to is refused with its reason, and the tests do not run', () => {
  const name = unique();
  const root = `/tmp/${name}-tests`;
  made.push(root);
  mkdirSync(root);
  chmodSync(root, 0o777);
  const { code, output } = runTests(project({ name }));
  expect(code).not.toBe(0);
  expect(output).toContain(`the tests keep their temporary files in ${root}, and others can write to it (mode 777)`);
  expect(output).not.toContain('TMPDIR=');
});

test('a link, a file, or a folder of another owner is refused, each with its reason', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'start-up-'));
  made.push(scratch);
  const real = join(scratch, 'real');
  mkdirSync(real, { mode: 0o700 });
  symlinkSync(real, join(scratch, 'link'));
  writeFileSync(join(scratch, 'file'), '');
  expect(folderProblem(join(scratch, 'link'))).toBe('it is a symlink');
  expect(folderProblem(join(scratch, 'file'))).toBe('it is not a folder');
  expect(folderProblem(real, process.getuid!() + 1)).toBe(`it belongs to uid ${process.getuid!()}, not ${process.getuid!() + 1}`);
  expect(folderProblem(real)).toBeNull();
});

test("the sweep removes an ended process's folder, keeps a running one's, and says what it could not remove", () => {
  const root = mkdtempSync(join(tmpdir(), 'start-up-'));
  made.push(root);
  // A pid no process has: far past any the system hands out.
  mkdirSync(join(root, '99999999'));
  mkdirSync(join(root, String(process.pid)));
  // A folder whose insides cannot be removed, as a test that took away its own write permission leaves one.
  mkdirSync(join(root, '99999998', 'held'), { recursive: true });
  chmodSync(join(root, '99999998'), 0o500);
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (line: string) => warned.push(line);
  try {
    sweepEnded(root);
  } finally {
    console.warn = warn;
    chmodSync(join(root, '99999998'), 0o700);
  }
  expect(readdirSync(root).sort()).toEqual([String(process.pid), '99999998'].sort());
  expect(warned).toHaveLength(1);
  expect(warned[0]).toContain(`could not remove ${join(root, '99999998')}, left by a test process that ended`);
});
