// The app-kit command: its usage on no arguments or asking for help, wrong usage exiting 2, and its version with the
// commit it runs from. The extension commands themselves are tested beside the extension part.
import { expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import packageJson from '../package.json';

const run = (...args: string[]) => runFrom(join(import.meta.dir, '..'), ...args);
const runFrom = (kit: string, ...args: string[]) => {
  const done = Bun.spawnSync(['bun', join(kit, 'bin/app-kit.ts'), ...args], { stdout: 'pipe', stderr: 'pipe' });
  return { code: done.exitCode, out: done.stdout.toString(), err: done.stderr.toString() };
};

test('no arguments, help, -h and --help print the usage with its exit codes, and exit 0', () => {
  for (const args of [[], ['help'], ['-h'], ['--help']]) {
    const { code, out } = run(...args);
    expect(code).toBe(0);
    expect(out).toContain('extension copy <folder>');
    expect(out).toContain('Exit codes: 0 done; 1 the command failed; 2 wrong usage');
  }
});

test('an unknown part, a part with no command, a command missing its argument or given one too many prints the usage to stderr and exits 2', () => {
  for (const args of [['bogus'], ['extension'], ['extension', 'bogus'], ['extension', 'copy'], ['extension', 'copy', 'kit', 'extra'], ['extension', 'id', '.', 'extra'], ['--version', 'extra'], ['help', 'extra']]) {
    const { code, out, err } = run(...args);
    expect(code).toBe(2);
    expect(out).toBe('');
    expect(err).toContain('app-kit <part> <command>');
  }
});

test('--version prints the version and the commit this checkout is at', () => {
  const head = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD'], { stdout: 'pipe' }).stdout.toString().trim();
  expect(run('--version')).toEqual({ code: 0, out: `app-kit ${packageJson.version} (${head})\n`, err: '' });
});

test("installed in an app's checkout, --version names the commit the app's bun.lock pinned, never the app's own", () => {
  // An app's checkout holding the kit as GitHub installs it: the files, with no checkout of the kit's own, and the
  // lockfile line Bun writes for it. It is made under node_modules/.cache, never the system temp folder: Bun looks in
  // every folder above a script it runs, and a temp folder holding enough entries made that look take minutes.
  const cache = join(import.meta.dir, '../node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const app = mkdtempSync(join(cache, 'app-kit-command-'));
  try {
    const git = (...args: string[]) => Bun.spawnSync(['git', '-c', 'user.name=app', '-c', 'user.email=app@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: app });
    git('init', '-q');
    git('commit', '-q', '--allow-empty', '-m', 'the app');
    const kit = join(app, 'node_modules/app-kit');
    for (const path of ['bin', 'extension', 'package.json']) cpSync(join(import.meta.dir, '..', path), join(kit, path), { recursive: true });
    expect(runFrom(kit, '--version').out).toBe(`app-kit ${packageJson.version} (commit unknown: no checkout of its own and no bun.lock naming it)\n`);
    writeFileSync(join(app, 'bun.lock'), `{\n  "packages": {\n    "app-kit": ["app-kit@github:worktron/app-kit#1ce3152", {}, "worktron-app-kit-1ce3152", "sha512-x"],\n  }\n}\n`);
    expect(runFrom(kit, '--version')).toEqual({ code: 0, out: `app-kit ${packageJson.version} (1ce3152)\n`, err: '' });
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});
