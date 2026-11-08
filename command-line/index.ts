/*
 * What every command-line tool ships, so each answers the same way: `--version` with the commit it runs from, the usage
 * on help and on wrong usage with exit codes 0 and 2, color on a terminal only, a browser opened with an off switch and
 * never in a test, a warning when installed from a worktree, a secret read from 1Password, and the runner for outside
 * programs (run.ts). practices' rules/command-line.md says why each exists.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseArgs, type ParseArgsConfig } from 'node:util';

export { runCommand, STOP_SIGNALS, stopRunning, type Run, type RunOptions, type RunResult } from './run';

/** Where a command's answers go: the process's own unless a test stands in for them. */
export type CommandOutput = {
  out: (text: string) => void;
  err: (text: string) => void;
  exit: (code: number) => never;
};

const PROCESS: CommandOutput = {
  out: (text) => console.log(text),
  err: (text) => console.error(text),
  exit: (code) => process.exit(code),
};

/**
 * `<name> <version> (<commit>)`. The commit is the checkout's own when `folder`, the tool's own folder (where its
 * package.json is), is the top of a git checkout; else the one an app's bun.lock pinned when the tool was installed from
 * GitHub into the app's node_modules, never the app's own commit; else it says it is unknown.
 */
export function versionLine({ name, version }: { name: string; version: string }, folder: string): string {
  return `${name} ${version} (${commitOf(name, folder)})`;
}

function commitOf(name: string, folder: string): string {
  const own = realpathSync(folder);
  const git = (...args: string[]) => spawnSync('git', ['-C', own, ...args], { encoding: 'utf8' });
  const top = git('rev-parse', '--show-toplevel');
  if (top.status === 0 && realpathSync(top.stdout.trim()) === own) return git('rev-parse', '--short', 'HEAD').stdout.trim();
  const pin = new RegExp(`"${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@github:[^"#]+#([0-9a-f]+)"`);
  for (let above = dirname(own); above !== dirname(above); above = dirname(above)) {
    const lock = join(above, 'bun.lock');
    if (!existsSync(lock)) continue;
    const pinned = readFileSync(lock, 'utf8').match(pin);
    if (pinned) return pinned[1]!;
  }
  return 'commit unknown: no checkout of its own and no bun.lock naming it';
}

const HELP = ['help', '-h', '--help'];

/**
 * No arguments, or `help`, `-h` or `--help` alone, or `-h` or `--help` after a subcommand, but never after `--`, where
 * the arguments belong to another program (`tool exec -- ls -h`).
 */
export function helpAsked(args: readonly string[]): boolean {
  const own = args.includes('--') ? args.slice(0, args.indexOf('--')) : args;
  return args.length === 0 || (args.length === 1 && HELP.includes(args[0]!)) || own.includes('--help') || own.includes('-h');
}

/**
 * Answers help with the usage and `--version` alone with the version line, both on stdout, and says whether it
 * answered: the command then has nothing else to do and exits 0.
 */
export function answerHelpOrVersion(
  args: readonly string[],
  { usage, version }: { usage: string; version?: () => string },
  output: Pick<CommandOutput, 'out'> = PROCESS,
): boolean {
  if (version && args.length === 1 && args[0] === '--version') output.out(version());
  else if (helpAsked(args)) output.out(usage);
  else return false;
  return true;
}

/** Wrong usage: what was wrong, when known, and the usage, on stderr, and exit 2. */
export function wrongUsage(usage: string, reason?: string, output: CommandOutput = PROCESS): never {
  output.err(reason ? `${reason}\n\n${usage}` : usage);
  return output.exit(2);
}

/**
 * The arguments read by util.parseArgs in its strict mode, so an unknown flag or a flag missing its value is wrong
 * usage (exit 2) rather than ignored. Help and `--version` are answered first, exiting 0.
 */
export function readArguments<const T extends Omit<ParseArgsConfig, 'args' | 'strict'>>(
  args: string[],
  config: T & { usage: string; version?: () => string },
  output: CommandOutput = PROCESS,
): ReturnType<typeof parseArgs<T & { args: string[]; strict: true }>> {
  const { usage, version, ...parse } = config;
  if (answerHelpOrVersion(args, { usage, version }, output)) return output.exit(0);
  try {
    return parseArgs({ ...(parse as unknown as T), args, strict: true }) as ReturnType<typeof parseArgs<T & { args: string[]; strict: true }>>;
  } catch (error) {
    return wrongUsage(usage, error instanceof Error ? error.message : String(error), output);
  }
}

/**
 * Whether to color the output: only when it goes to a terminal and NO_COLOR is unset or empty. FORCE_COLOR is not
 * looked at: agents' shells set it, and Bun's own styleText then colors output piped to a file.
 */
export function useColor(stream: { isTTY?: boolean } = process.stdout, env: Record<string, string | undefined> = process.env): boolean {
  return stream.isTTY === true && !env.NO_COLOR;
}

/**
 * The environment variable that says an agent's thread runs this command, or undefined when a person does: metamax
 * names its thread in METAMAX_JOB_ID, and Claude Code, like other agents, sets AI_AGENT. A command whose purpose is a
 * window for the owner refuses when one is set and prints the line for the owner to run in their own terminal.
 */
export function runByThread(env: Record<string, string | undefined> = process.env): string | undefined {
  return ['METAMAX_JOB_ID', 'AI_AGENT'].find((name) => env[name]);
}

export type OpenInBrowserOptions = {
  /** The environment variable that, set to anything but empty, keeps the browser closed: `DFRACT_NO_OPEN`. */
  offSwitch: string;
  env?: Record<string, string | undefined>;
  /** Where the command's output goes, `process.stdout` unless a test stands in for it: a browser opens only for a terminal. */
  stream?: { isTTY?: boolean };
  print?: (line: string) => void;
  /** How the address is opened; the system's `open` (`xdg-open` on Linux) unless a test stands in for it. */
  open?: (url: string) => void;
};

/**
 * Prints the full address, which a terminal makes clickable, and opens it in the browser only when a person runs the
 * command: its output goes to a terminal and no agent's thread is named in the environment (runByThread). It never
 * opens when the off switch is set or in a test (`bun test` sets NODE_ENV to test), and never from a script, a pipe or
 * a thread, which get the address to hand over instead. Says whether it opened.
 */
export function openInBrowser(
  url: string,
  { offSwitch, env = process.env, stream = process.stdout, print = console.log, open = openWithSystem }: OpenInBrowserOptions,
): boolean {
  const address = new URL(url).href;
  const thread = runByThread(env);
  const kept = env[offSwitch]
    ? `${offSwitch} is set`
    : env.NODE_ENV === 'test'
      ? 'a test never opens it'
      : thread
        ? `${thread} is set, so an agent's thread runs this and leaves the browser to you`
        : stream.isTTY !== true
          ? 'the output is not a terminal, so no one may be there to see it'
          : null;
  if (kept) {
    print(`Open ${address} in your browser (${kept}).`);
    return false;
  }
  print(`Opening ${address}`);
  open(address);
  return true;
}

function openWithSystem(url: string): void {
  const opener = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' });
  // With no opener on the machine (a Linux box without xdg-open), the address already printed is the way in.
  opener.on('error', () => undefined);
  opener.unref();
}

/**
 * The worktree `folder` sits in, and the main checkout it belongs to; null when it is in a main checkout or in no
 * checkout at all. Asks git for both folders as absolute paths, since in a subfolder git writes one of them relative.
 */
export function worktreeOf(folder: string): { worktree: string; main: string } | null {
  const run = spawnSync('git', ['-C', folder, 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-toplevel'], { encoding: 'utf8' });
  if (run.status !== 0) return null;
  const [gitDir, commonDir, top] = run.stdout.trim().split('\n');
  if (!gitDir || !commonDir || !top || gitDir === commonDir) return null;
  return { worktree: top, main: basename(commonDir) === '.git' ? dirname(commonDir) : commonDir };
}

/**
 * For an install command: a tool run from its checkout runs from the main one, which follows main, never from a
 * worktree, which goes away when its work lands. Prints the warning on stderr and returns it, or null from a main checkout.
 */
export function warnIfWorktree(folder: string, print: (line: string) => void = console.error): string | null {
  const found = worktreeOf(folder);
  if (!found) return null;
  const warning = `Installing from the worktree ${found.worktree}, which goes away when its work lands. Install from the main checkout, ${found.main}, instead.`;
  print(warning);
  return warning;
}

export type OpReadOptions = {
  /** The 1Password command, `op` on the PATH unless a test stands in for it. */
  program?: string;
  /** How long `op` may take, Touch ID's prompt included. */
  timeoutMs?: number;
};

/**
 * The secret an `op://` reference names, read by 1Password's `op read`, with nothing added. A failure throws with the
 * reference and op's own last line, never the secret.
 */
export async function opRead(reference: string, { program = 'op', timeoutMs = 60_000 }: OpReadOptions = {}): Promise<string> {
  if (!reference.startsWith('op://')) throw new Error('Not a 1Password reference: a reference starts op://, and what was given is not printed, since it may be the secret itself');
  const reading = Bun.spawn([program, 'read', '--no-newline', reference], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', timeout: timeoutMs });
  const [secret, said, code] = await Promise.all([new Response(reading.stdout).text(), new Response(reading.stderr).text(), reading.exited]);
  if (reading.signalCode) throw new Error(`op read ${reference} gave no answer within ${timeoutMs / 1000}s`);
  if (code !== 0) throw new Error(`op read ${reference} failed: ${said.trim().split('\n').at(-1) || `exit ${code}`}`);
  return secret;
}
