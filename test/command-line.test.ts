// What every command-line tool ships (app-kit/command-line): the version line, help and wrong usage, color, the
// browser's off switch, the worktree warning, the 1Password read, and the runner's time limit.
import { expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  answerHelpOrVersion,
  type CommandOutput,
  helpAsked,
  openInBrowser,
  opRead,
  readArguments,
  runCommand,
  useColor,
  versionLine,
  warnIfWorktree,
  wrongUsage,
} from '../command-line/index.ts';
import { scratch } from './testflight-stand-in.ts';

const USAGE = 'tool <command>\n\nExit codes: 0 done; 1 the command failed; 2 wrong usage';

/** A command's output kept, and its exit thrown, so a test sees where it would have stopped. */
class Exited extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}
function kept() {
  const said = { out: [] as string[], err: [] as string[] };
  const output: CommandOutput = {
    out: (text) => said.out.push(text),
    err: (text) => said.err.push(text),
    exit: (code) => {
      throw new Error('', { cause: new Exited(code) });
    },
  };
  const exitOf = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      if ((error as Error).cause instanceof Exited) return ((error as Error).cause as Exited).code;
      throw error;
    }
    return null;
  };
  return { said, output, exitOf };
}

const git = (cwd: string, ...args: string[]) => {
  const done = Bun.spawnSync(['git', '-c', 'user.name=app', '-c', 'user.email=app@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, stderr: 'pipe' });
  if (done.exitCode !== 0) throw new Error(done.stderr.toString());
  return done.stdout.toString().trim();
};

test("the version line names the tool's own checkout's commit, the one an app's bun.lock pinned, or says it is unknown", () => {
  const kit = join(import.meta.dir, '..');
  expect(versionLine({ name: 'app-kit', version: '1.2.3' }, kit)).toBe(`app-kit 1.2.3 (${git(kit, 'rev-parse', '--short', 'HEAD')})`);
  const place = scratch('command-line-version-');
  try {
    git(place.folder, 'init', '-q');
    git(place.folder, 'commit', '-q', '--allow-empty', '-m', 'the app');
    const tool = join(place.folder, 'node_modules', 'some-tool');
    mkdirSync(tool, { recursive: true });
    expect(versionLine({ name: 'some-tool', version: '0.4.0' }, tool)).toBe('some-tool 0.4.0 (commit unknown: no checkout of its own and no bun.lock naming it)');
    writeFileSync(join(place.folder, 'bun.lock'), '{\n  "packages": {\n    "some-tool": ["some-tool@github:example/some-tool#9ab12cd", {}, "example-some-tool-9ab12cd", "sha512-x"],\n  }\n}\n');
    expect(versionLine({ name: 'some-tool', version: '0.4.0' }, tool)).toBe('some-tool 0.4.0 (9ab12cd)');
  } finally {
    place.done();
  }
});

test('no arguments, help, -h and --help print the usage on stdout, and --version alone the version', () => {
  for (const args of [[], ['help'], ['-h'], ['--help'], ['copy', '--help'], ['copy', 'folder', '-h']]) {
    const { said, output } = kept();
    expect(helpAsked(args)).toBe(true);
    expect(answerHelpOrVersion(args, { usage: USAGE, version: () => 'tool 1.0.0 (abc1234)' }, output)).toBe(true);
    expect(said.out).toEqual([USAGE]);
  }
  const { said, output } = kept();
  expect(answerHelpOrVersion(['--version'], { usage: USAGE, version: () => 'tool 1.0.0 (abc1234)' }, output)).toBe(true);
  expect(said.out).toEqual(['tool 1.0.0 (abc1234)']);
  // After `--` the arguments are another program's: `tool exec -- ls -h` runs ls.
  for (const args of [['help', 'extra'], ['--version', 'extra'], ['copy', 'folder'], ['exec', '--', 'ls', '-h'], ['exec', '--', '--help']]) expect(answerHelpOrVersion(args, { usage: USAGE }, kept().output)).toBe(false);
});

test('wrong usage, an unknown flag and a flag missing its value print what was wrong and the usage on stderr, and exit 2', () => {
  const wrong = kept();
  expect(wrong.exitOf(() => wrongUsage(USAGE, 'no such command: bogus', wrong.output))).toBe(2);
  expect(wrong.said).toEqual({ out: [], err: [`no such command: bogus\n\n${USAGE}`] });
  const options = { json: { type: 'boolean' }, limit: { type: 'string' } } as const;
  for (const args of [['--bogus'], ['--limit']]) {
    const { said, output, exitOf } = kept();
    expect(exitOf(() => readArguments(args, { usage: USAGE, options }, output))).toBe(2);
    expect(said.out).toEqual([]);
    expect(said.err[0]).toEndWith(USAGE);
    expect(said.err[0]).toContain(args[0]);
  }
  const help = kept();
  expect(help.exitOf(() => readArguments(['--help'], { usage: USAGE, options }, help.output))).toBe(0);
  expect(help.said.out).toEqual([USAGE]);
  const read = readArguments(['--json', '--limit', '5', 'folder'], { usage: USAGE, options, allowPositionals: true }, kept().output);
  expect(read.values).toEqual({ json: true, limit: '5' });
  expect(read.positionals).toEqual(['folder']);
});

test('color only on a terminal with NO_COLOR unset or empty, whatever FORCE_COLOR says', () => {
  expect(useColor({ isTTY: true }, {})).toBe(true);
  expect(useColor({ isTTY: true }, { NO_COLOR: '' })).toBe(true);
  expect(useColor({ isTTY: true }, { NO_COLOR: '1' })).toBe(false);
  expect(useColor({ isTTY: true }, { NO_COLOR: '1', FORCE_COLOR: '3' })).toBe(false);
  // Agents' shells set FORCE_COLOR=3, and their output is piped.
  expect(useColor({ isTTY: false }, { FORCE_COLOR: '3' })).toBe(false);
  expect(useColor({}, {})).toBe(false);
});

test('the browser opens with the full address printed, and stays closed under its off switch and in a test', () => {
  const opened: string[] = [];
  const printed: string[] = [];
  const options = { offSwitch: 'TOOL_NO_OPEN', print: (line: string) => printed.push(line), open: (url: string) => opened.push(url) };
  expect(openInBrowser('https://example.com/sign-in?code=1', { ...options, env: {} })).toBe(true);
  expect(opened).toEqual(['https://example.com/sign-in?code=1']);
  expect(printed).toEqual(['Opening https://example.com/sign-in?code=1']);
  expect(openInBrowser('http://localhost:4000', { ...options, env: { TOOL_NO_OPEN: '1' } })).toBe(false);
  expect(openInBrowser('http://localhost:4000', { ...options, env: { TOOL_NO_OPEN: '' } })).toBe(true);
  // The test's own environment, which bun test marks with NODE_ENV, so nothing opens. The opener is still a stand-in,
  // so a broken check fails here instead of opening a browser on the screen.
  expect(process.env.NODE_ENV).toBe('test');
  expect(openInBrowser('http://localhost:4000', options)).toBe(false);
  expect(opened).toEqual(['https://example.com/sign-in?code=1', 'http://localhost:4000/']);
  expect(printed.slice(1)).toEqual([
    'Open http://localhost:4000/ in your browser (TOOL_NO_OPEN is set).',
    'Opening http://localhost:4000/',
    'Open http://localhost:4000/ in your browser (a test never opens it).',
  ]);
  expect(() => openInBrowser('/sign-in', { ...options, env: {} })).toThrow();
});

test('with no opener on the machine, the tool goes on with the address printed', () => {
  const place = scratch('command-line-no-opener-');
  try {
    // PATH is an empty folder, so neither open nor xdg-open is there to find, and nothing can reach the screen.
    const empty = join(place.folder, 'bin');
    mkdirSync(empty);
    const tool = join(place.folder, 'tool.ts');
    writeFileSync(
      tool,
      `import { openInBrowser } from ${JSON.stringify(join(import.meta.dir, '../command-line/index.ts'))};\nimport { spawn } from 'node:child_process';\nopenInBrowser('http://localhost:4000', { offSwitch: 'TOOL_NO_OPEN', env: {} });\n// A second missing program, started after the opener: its failure comes after the opener's, so the line it prints\n// shows the tool lived through the opener's.\nspawn('no-such-program', []).on('error', () => console.log('went on'));\n`,
    );
    const ran = Bun.spawnSync([process.execPath, tool], { env: { PATH: empty, HOME: place.folder }, stdout: 'pipe', stderr: 'pipe' });
    expect({ code: ran.exitCode, out: ran.stdout.toString() }).toEqual({ code: 0, out: 'Opening http://localhost:4000/\nwent on\n' });
  } finally {
    place.done();
  }
});

test('an install run from a worktree is warned, naming the main checkout, and one from the main checkout is not', () => {
  const place = scratch('command-line-worktree-');
  try {
    const main = join(place.folder, 'tool');
    mkdirSync(main);
    git(main, 'init', '-q');
    git(main, 'commit', '-q', '--allow-empty', '-m', 'the tool');
    git(main, 'worktree', 'add', '-q', join(place.folder, 'feature'));
    const printed: string[] = [];
    expect(warnIfWorktree(main, (line) => printed.push(line))).toBeNull();
    const warning = warnIfWorktree(join(place.folder, 'feature'), (line) => printed.push(line));
    expect(warning).toContain('goes away when its work lands');
    expect(warning).toContain(`main checkout, ${git(main, 'rev-parse', '--show-toplevel')},`);
    expect(printed).toEqual([warning!]);
  } finally {
    place.done();
  }
});

test("a 1Password reference is read as it is, and a failure names the reference and op's own words, never the secret", async () => {
  const place = scratch('command-line-op-');
  try {
    const op = join(place.folder, 'op');
    writeFileSync(
      op,
      [
        '#!/bin/sh',
        '[ "$1 $2" = "read --no-newline" ] || { echo "[ERROR] called wrongly: $*" >&2; exit 1; }',
        'case "$3" in',
        '  op://Personal/Tool/credential) printf "s3cret value" ;;',
        '  op://Personal/Slow/credential) exec sleep 600 ;;',
        '  *) echo "[ERROR] 2026/10/30 12:00:00 could not find item in vault Personal" >&2; exit 1 ;;',
        'esac',
      ].join('\n'),
    );
    chmodSync(op, 0o755);
    expect(await opRead('op://Personal/Tool/credential', { program: op })).toBe('s3cret value');
    await expect(opRead('op://Personal/Missing/credential', { program: op })).rejects.toThrow(
      'op read op://Personal/Missing/credential failed: [ERROR] 2026/10/30 12:00:00 could not find item in vault Personal',
    );
    await expect(opRead('op://Personal/Slow/credential', { program: op, timeoutMs: 200 })).rejects.toThrow('gave no answer within 0.2s');
    const raw = await opRead('s3cret-pasted-by-mistake', { program: op }).catch((error: Error) => error.message);
    expect(raw).toStartWith('Not a 1Password reference');
    expect(raw).not.toContain('s3cret');
  } finally {
    place.done();
  }
});

test("a program's output and its errors come back apart as well as together, so a warning is never parsed as output", async () => {
  const result = await runCommand(['sh', '-c', 'echo 12 /a; echo "du: /b: Permission denied" >&2; echo 34 /c']);
  expect(result.stdout).toBe('12 /a\n34 /c\n');
  expect(result.stderr).toBe('du: /b: Permission denied\n');
  expect(result.out.split('\n').sort()).toEqual(['', '12 /a', '34 /c', 'du: /b: Permission denied']);
  const missing = await runCommand(['no-such-program-anywhere']);
  expect(missing).toMatchObject({ code: 127, stdout: '' });
  expect(missing.stderr).toContain('no-such-program-anywhere');
});

test('a character whose bytes arrive in two reads comes through whole', async () => {
  const place = scratch('command-line-split-');
  try {
    // The program writes é's first byte, then waits until the runner has passed on what came before it, and only
    // then writes the second, so the two bytes are certain to arrive in separate reads.
    const go = join(place.folder, 'go');
    Bun.spawnSync(['mkfifo', go]);
    let told = false;
    const result = await runCommand(['sh', '-c', `printf 'caf\\303'; read x < '${go}'; printf '\\251 /a\\n'`], {
      output: () => {
        if (!told) writeFileSync(go, 'go\n');
        told = true;
      },
    });
    expect(result).toMatchObject({ code: 0, stdout: 'café /a\n', out: 'café /a\n' });
  } finally {
    place.done();
  }
});

test('a program past its time limit is stopped with everything it started, and one that ends takes its leftovers with it', async () => {
  const place = scratch('command-line-run-');
  try {
    const marker = join(place.folder, 'outlived');
    const stopped = await runCommand(['sh', '-c', `echo started; (sleep 2; touch ${marker}) & sleep 600`], { timeoutMs: 200 });
    expect(stopped).toEqual({ code: -1, out: 'started\n', stdout: 'started\n', stderr: '', timedOut: true });
    const ended = await runCommand(['sh', '-c', `(sleep 2; touch ${marker}) & echo done`]);
    expect(ended).toEqual({ code: 0, out: 'done\n', stdout: 'done\n', stderr: '', timedOut: false });
    // Neither group's sleeper is left to touch the marker.
    expect(Bun.spawnSync(['pgrep', '-f', `touch ${marker}`]).stdout.toString()).toBe('');
    expect(existsSync(marker)).toBe(false);
  } finally {
    place.done();
  }
});

test('a program in a stopped group that ignores the polite signal is forced to stop after the grace period', async () => {
  const marker = `ignores-term-${process.pid}-${Date.now()}`;
  // The first program ends on the polite signal; the one it started ignores it and holds the output open.
  const stopped = await runCommand(['sh', '-c', `(trap '' TERM; while :; do sleep 1; : ${marker}; done) & echo started; sleep 600`], {
    output: (chunk) => (chunk.includes('started') ? 0 : undefined),
  });
  expect(stopped).toMatchObject({ code: -1, timedOut: true });
  expect(Bun.spawnSync(['pgrep', '-f', marker]).stdout.toString()).toBe('');
}, 15_000);

test('a time limit can be replaced as the output comes', async () => {
  const result = await runCommand(['sh', '-c', 'echo building; sleep 0.5; echo uploading; sleep 600'], {
    timeoutMs: 600_000,
    output: (chunk) => (chunk.includes('uploading') ? 100 : undefined),
  });
  expect(result).toMatchObject({ code: -1, timedOut: true });
  expect(result.out).toBe('building\nuploading\n');
});
