// The app-kit command: its usage on no arguments or asking for help, wrong usage exiting 2, and its version with the
// commit it runs from. The extension commands themselves are tested beside the extension part.
import { expect, test } from 'bun:test';
import { join } from 'path';
import packageJson from '../package.json';

const run = (...args: string[]) => {
  const done = Bun.spawnSync(['bun', join(import.meta.dir, '../bin/app-kit.ts'), ...args], { stdout: 'pipe', stderr: 'pipe' });
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

test('an unknown part, a part with no command, or a command missing its argument prints the usage to stderr and exits 2', () => {
  for (const args of [['bogus'], ['extension'], ['extension', 'bogus'], ['extension', 'copy']]) {
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
