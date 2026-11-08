// The app-kit command: its usage on no arguments or asking for help, wrong usage exiting 2, and its version with the
// commit it runs from. The extension commands themselves are tested beside the extension part.
import { expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
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

test('an unknown part, a part with no command, a command missing its argument or given one too many prints the usage to stderr and exits 2, loading no part', () => {
  // Run from a kit that holds only the command and its shared command-line file: wrong usage that loaded any part
  // would fail to find it and exit 1. Each run is then about as quick as Bun's own start, which on a busy machine is
  // what keeps these runs inside the test's time.
  const cache = join(import.meta.dir, '../node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const kit = mkdtempSync(join(cache, 'app-kit-usage-'));
  try {
    for (const path of ['bin', 'command-line', 'package.json']) cpSync(join(import.meta.dir, '..', path), join(kit, path), { recursive: true });
    wrongUsage(kit);
  } finally {
    rmSync(kit, { recursive: true, force: true });
  }
});

const wrongUsage = (kit: string) => {
  for (const args of [['bogus'], ['extension'], ['extension', 'bogus'], ['extension', 'copy'], ['extension', 'copy', 'kit', 'extra'], ['extension', 'id', '.', 'extra'], ['extension', 'listing', 'a', 'b'], ['extension', 'listing', '--bogus'], ['--version', 'extra'], ['help', 'extra'], ['iphone'], ['iphone', 'run'], ['iphone', 'run', 'tablet'], ['iphone', 'run', 'sim', 'udid', 'extra'], ['iphone', 'run', 'phone', '--udid'], ['iphone-simulator'], ['iphone-simulator', 'quiet'], ['iphone-simulator', 'quiet', 'udid', 'extra'], ['iphone-simulator', 'keep'], ['iphone-simulator', 'keep', 'udid', '0'], ['iphone-simulator', 'keep', 'udid', 'ten'], ['iphone-simulator', 'keep', 'udid', '5', 'extra'], ['iphone-simulator', 'watch', 'udid', '--every'], ['icons'], ['icons', 'draw', '--web', 'public'], ['icons', 'render'], ['icons', 'render', 'design/icon'], ['icons', 'render', '--web'], ['icons', 'render', 'a', 'b', '--web', 'public'], ['icons', 'render', '--web', 'public', '--web', 'other'], ['icons', 'render', '--extension', 'icons', '--toolbar-color', 'grey'], ['icons', 'render', '--web', 'public', '--toolbar-color', '#1f1f1f'], ['icons', 'render', '--web', 'public', '--size', '64']]) {
    const { code, out, err } = runFrom(kit, ...args);
    expect({ args, code, out }).toEqual({ args, code: 2, out: '' });
    expect(err).toContain('app-kit <part> <command>');
  }
};

test('keep for a Simulator app-kit holds no time for says so and exits 1', () => {
  const cache = join(import.meta.dir, '../node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const state = mkdtempSync(join(cache, 'app-kit-keep-'));
  try {
    const done = Bun.spawnSync(['bun', join(import.meta.dir, '../bin/app-kit.ts'), 'iphone-simulator', 'keep', 'NO-SUCH-UDID'], {
      env: { ...process.env, XDG_STATE_HOME: state },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(done.exitCode).toBe(1);
    // A terminal's FORCE_COLOR can color the line; the words are what is checked.
    expect(done.stderr.toString()).toContain('[iphone-simulator] app-kit holds no shut-down time for NO-SUCH-UDID: app-kit iphone run sim did not boot it, or it has shut down already');
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test('keep moves the shut-down time of a Simulator app-kit holds, and says when', () => {
  const cache = join(import.meta.dir, '../node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const state = mkdtempSync(join(cache, 'app-kit-keep-'));
  try {
    const folder = join(state, 'app-kit/simulators');
    mkdirSync(folder, { recursive: true });
    // This test's own process stands for the watcher, alive, so the command starts no other.
    const held = { udid: 'HELD-UDID', name: 'Sample App', checkout: state, until: Date.now(), runPid: process.pid, watcherPid: process.pid, booted: true };
    writeFileSync(join(folder, 'HELD-UDID.json'), JSON.stringify(held));
    const before = Date.now();
    const done = Bun.spawnSync(['bun', join(import.meta.dir, '../bin/app-kit.ts'), 'iphone-simulator', 'keep', 'HELD-UDID', '5'], {
      env: { ...process.env, XDG_STATE_HOME: state },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(done.exitCode).toBe(0);
    expect(done.stdout.toString()).toMatch(/^\[iphone-simulator\] "Sample App" \(HELD-UDID\) shuts down at \d\d:\d\d, in 5 minutes\n$/);
    const until = (JSON.parse(readFileSync(join(folder, 'HELD-UDID.json'), 'utf8')) as { until: number }).until;
    expect(until).toBeGreaterThanOrEqual(before + 5 * 60_000);
    expect(until).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
  } finally {
    rmSync(state, { recursive: true, force: true });
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
    for (const path of ['bin', 'command-line', 'extension', 'look', 'icons', 'tauri/iphone-run', 'tauri/iphone-simulator', 'tauri/mac-release', 'tauri/testflight', 'tauri/apple-token.ts', 'tauri/build-env.ts', 'tauri/state.ts', 'web/drive.ts', 'server/google', 'package.json']) cpSync(join(import.meta.dir, '..', path), join(kit, path), { recursive: true });
    expect(runFrom(kit, '--version').out).toBe(`app-kit ${packageJson.version} (commit unknown: no checkout of its own and no bun.lock naming it)\n`);
    writeFileSync(join(app, 'bun.lock'), `{\n  "packages": {\n    "app-kit": ["app-kit@github:worktron/app-kit#1ce3152", {}, "worktron-app-kit-1ce3152", "sha512-x"],\n  }\n}\n`);
    expect(runFrom(kit, '--version')).toEqual({ code: 0, out: `app-kit ${packageJson.version} (1ce3152)\n`, err: '' });
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});
