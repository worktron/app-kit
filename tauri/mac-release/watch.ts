/*
 * `app-kit mac watch [--gh-user <login>] <git url>[#<folder>]...`: one pass over each Mac app's main, which a background
 * job runs every five minutes. When an app's main has moved and the change since its last release touches the app, it
 * checks out main's exact commit in a clone of its own and runs the app's own `bun run app-kit mac release --token-only`
 * there, so the app's pinned kit decides how it is built, signed, notarized and published. An app whose Tauri project is
 * in a subfolder of its repository names it after a `#`, and everything runs in that folder. Every decision is one line
 * in mac-release.log, with its reason.
 *
 * What was released last is read from the app's releases repository, the one its updater asks, never kept here: the
 * release's notes say which commit it was built from, so a release by hand is never repeated and never causes a skip.
 * A last release whose notes name no commit on main holds the app until one release by hand from main names one, so
 * starting the watcher never publishes on its own. The record kept per app holds only the last main commit judged and
 * the last failure, so a pass on an unmoved main asks nothing and writes no line.
 *
 * gh is given the token of the account `--gh-user` names, rather than whichever account another session last made
 * active on this Mac.
 *
 * Files, under $XDG_STATE_HOME/app-kit/mac-release (~/.local/state/app-kit/mac-release by default):
 *   mac-release.log        one line per decision, rotated to mac-release.log.1 at 1 MB
 *   <app>/checkout/        the clone it builds in, which nobody works in
 *   <app>/build-<n>.log    the install's and release's output for main's commit number n
 *   <app>/record.json      the main commit last judged and the last failure (commit, step, time)
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG, readConfig, releasesRepository } from './app.ts';
import { lastLine } from '../testflight/key.ts';
import { runCommand, type Run } from '../../command-line/run.ts';
import { appendLog, stateFolder } from '../state.ts';
import {
  appAddress,
  appKind,
  appName,
  buildLog,
  checkOutMain,
  cloneGit,
  countsAsApp,
  fetchMain,
  minutes,
  passOverApps,
  readRecord,
  retryDue,
  saveRecord,
  watcherChildEnv,
  type AppKind,
  type Env,
  type Failure,
  type MainRecord,
} from '../watch-main.ts';

/** How long each step may run before it is stopped with everything it started, in milliseconds. */
export type Limits = { fetch: number; install: number; release: number };
/** The release's limit holds the build and Apple's notarization, which Tauri waits on with no limit of its own. */
export const LIMITS: Limits = { fetch: 2 * 60_000, install: 10 * 60_000, release: 75 * 60_000 };

/**
 * Whether a changed file is part of the Mac app: the iPhone watcher's rule (watch-main.ts), and also Rust test modules,
 * which never reach the built app, folders named `test-` something, such as Messages Service's check server and test
 * app, and Playwright's config. A release that changes nothing would have every installed copy offer an empty update.
 */
export function countsAsMacApp(path: string, kind: AppKind, folder = ''): boolean {
  if (!countsAsApp(path, kind, folder)) return false;
  const parts = path.split('/');
  const name = parts[parts.length - 1]!;
  if (/_tests?\.rs$/.test(name) || /^test_.*\.rs$/.test(name) || name.startsWith('playwright.config.')) return false;
  return !parts.slice(0, -1).some((part) => part.startsWith('test-'));
}

/** The commit a release's notes say it was built from, the full one when they give it: "built from 1a2b3c4 (<sha>)." */
export function builtFrom(notes: string): string | null {
  const match = /built from ([0-9a-f]{7,40})(?: \(([0-9a-f]{40})\))?/.exec(notes);
  return match ? (match[2] ?? match[1]!) : null;
}

export type Decision = { release: boolean; reason: string; held?: boolean };

/**
 * Whether main's head is released. `lastTag` is the releases repository's latest release, or null when it has none;
 * `lastCommit` the commit on main its notes name, or null; `changed` the files changed from that commit to main's head,
 * so landings since the last release are judged together.
 */
export function decide(input: { lastTag: string | null; lastCommit: string | null; head: string; changed: string[]; kind: AppKind; folder?: string }): Decision {
  const short = input.head.slice(0, 7);
  if (input.lastTag === null) return { release: true, reason: `releasing ${short}: the releases repository has no release yet` };
  if (!input.lastCommit) {
    return {
      release: false,
      held: true,
      reason: `held: the last release ${input.lastTag} names no commit on main; release once by hand from main, and the next landing is judged from it`,
    };
  }
  const since = `${input.lastTag} (${input.lastCommit.slice(0, 7)})`;
  if (input.lastCommit === input.head) return { release: false, reason: `skipped: ${short} is already released as ${input.lastTag}` };
  const changed = input.changed.filter((path) => countsAsMacApp(path, input.kind, input.folder));
  if (!changed.length) return { release: false, reason: `skipped: no app files changed since ${since}` };
  const named = changed.slice(0, 3).join(', ') + (changed.length > 3 ? ` and ${changed.length - 3} more` : '');
  return { release: true, reason: `releasing ${short}: app files changed since ${since} (${named})` };
}

export type WatchOptions = {
  urls: string[];
  /** The gh account whose token publishes, by its login; whichever account gh has active when left out. */
  ghUser?: string;
  run?: Run;
  env?: Env;
  home?: string;
  now?: () => number;
  limits?: Partial<Limits>;
};

/** One pass over every app; gives how many of them had a step fail in it, each failure logged. */
export async function watch(options: WatchOptions): Promise<number> {
  const state = stateFolder('mac-release', options.env ?? process.env, options.home);
  return passOverApps({
    urls: options.urls,
    lockFile: join(state, 'mac-release.lock'),
    logFile: join(state, 'mac-release.log'),
    now: options.now ?? Date.now,
    app: (url) => watchApp(url, state, options),
  });
}

/** One app's pass; gives true when a step failed. */
async function watchApp(url: string, state: string, options: WatchOptions): Promise<boolean> {
  const run = options.run ?? runCommand;
  const now = options.now ?? Date.now;
  const limits = { ...LIMITS, ...options.limits };
  const name = appName(url);
  const folder = join(state, name);
  const checkout = join(folder, 'checkout');
  const recordFile = join(folder, 'record.json');
  mkdirSync(folder, { recursive: true });
  const record = readRecord<MainRecord>(recordFile, { judgedHead: null, failure: null });
  const save = (next: MainRecord) => saveRecord(recordFile, next);
  const line = (message: string) => appendLog(join(state, 'mac-release.log'), `${new Date(now()).toISOString()} ${name}: ${message}`);
  const address = appAddress(url);
  if (typeof address === 'string') {
    line(`failed: ${address}`);
    return true;
  }
  const appFolder = join(checkout, address.folder);
  const childEnv = watcherChildEnv(options.env ?? process.env);
  const git = cloneGit(run, checkout, folder, childEnv);
  if (!(await fetchMain({ git, checkout, url: address.url, record, save, line, now, fetchMs: limits.fetch, cloneMs: limits.install }))) return true;

  const head = (await git(['rev-parse', 'refs/remotes/origin/main'])).out;
  if (head === record.judgedHead && !retryDue(record, head, now())) return false;
  const count = Number((await git(['rev-list', '--count', head])).out);
  const short = head.slice(0, 7);
  const judged = (failure: Failure | null = null) => {
    save({ judgedHead: head, failure, fetchFailingSince: null });
    return failure !== null;
  };
  const failed = (step: string, message: string, held = false) => {
    line(message);
    return judged({ commit: head, step, time: new Date(now()).toISOString(), ...(held ? { held } : {}) });
  };
  const retry = 'trying again in an hour';
  const buildOutput = buildLog(folder, count);

  const cleaned = await checkOutMain(git, head, address.folder);
  if (!cleaned.ok) return failed('checkout', `failed: checking out ${short}: ${lastLine(cleaned.out)}; ${retry}`);
  if (!existsSync(appFolder)) return failed('checkout', `held: ${short} has no folder ${address.folder}; held until main moves`, true);
  const config = readConfig(appFolder);
  if (typeof config === 'string') return failed('config', `held: ${short}: ${config}; held until main moves`, true);
  const repository = releasesRepository(config.endpoint);
  if (!repository) return failed('config', `held: ${short}: plugins.updater's endpoint ${config.endpoint} is not a GitHub release's latest.json; held until main moves`, true);

  // gh's token for the named account, handed to gh here and to the release, so another session's `gh auth switch`
  // never decides which account publishes.
  const ghEnv: Env = { ...childEnv };
  if (options.ghUser) {
    const token = await run(['gh', 'auth', 'token', '--user', options.ghUser], { env: childEnv, timeoutMs: 30_000 });
    if (token.code !== 0 || !token.stdout.trim()) return failed('gh', `failed: gh has no token for ${options.ghUser}: ${lastLine(token.out)}; ${retry}`);
    ghEnv.GH_TOKEN = token.stdout.trim();
  }
  const last = await run(['gh', 'release', 'view', '--repo', repository, '--json', 'tagName,body'], { env: ghEnv, timeoutMs: 60_000 });
  let lastTag: string | null = null;
  let lastCommit: string | null = null;
  if (last.code === 0) {
    let latest: { tagName?: string; body?: string };
    try {
      latest = JSON.parse(last.stdout) as typeof latest;
    } catch {
      return failed('releases', `failed: gh's answer about ${repository}'s last release is not JSON: ${lastLine(last.out)}; ${retry}`);
    }
    lastTag = latest.tagName ?? '';
    const named = builtFrom(latest.body ?? '');
    if (named) {
      const resolved = await git(['rev-parse', '--verify', '--quiet', `${named}^{commit}`]);
      if (resolved.ok && (await git(['merge-base', '--is-ancestor', resolved.out, head])).ok) lastCommit = resolved.out;
    }
  } else if (!/release not found/.test(last.out)) {
    return failed('releases', `failed: gh could not read ${repository}'s last release: ${lastLine(last.out)}; ${retry}`);
  }
  const changed = lastCommit && lastCommit !== head ? (await git(['diff', '--name-only', '--no-renames', lastCommit, head])).out.split('\n').filter(Boolean) : [];
  const decision = decide({ lastTag, lastCommit, head, changed, kind: appKind(readFileSync(join(appFolder, CONFIG), 'utf8')), folder: address.folder });
  // Waiting for a person's release by hand, which is not a failed step.
  if (decision.held) {
    failed('releases', decision.reason, true);
    return false;
  }
  line(decision.reason);
  if (!decision.release) return judged();

  const installed = await run(['bun', 'install', '--frozen-lockfile'], { cwd: appFolder, env: childEnv, timeoutMs: limits.install });
  buildOutput.start(`${new Date(now()).toISOString()} ${short}`, installed.out);
  if (installed.code !== 0) {
    const why = installed.timedOut ? `it did not finish in ${minutes(limits.install)} and was stopped` : lastLine(installed.out);
    return failed('install', `failed: bun install at ${short}: ${why}; ${retry} (${buildOutput.name})`);
  }
  if (!existsSync(join(appFolder, 'node_modules/app-kit/tauri/mac-release/watch.ts'))) {
    line("waiting: main's app-kit has no mac release that runs with nobody there; the landing that upgrades it releases");
    return judged();
  }

  // The app's own kit releases it, at background priority, keeping the Mac awake only while it runs.
  const released = await run(['caffeinate', '-i', 'taskpolicy', '-b', 'bun', 'run', 'app-kit', 'mac', 'release', '--token-only'], {
    cwd: appFolder,
    env: ghEnv,
    timeoutMs: limits.release,
    output: (chunk) => buildOutput.append(chunk),
  });
  const said = released.out.split('\n').filter((l) => l.startsWith('[mac release] ')).pop()?.slice('[mac release] '.length) ?? lastLine(released.out);
  if (released.code === 0) {
    const version = /^\[mac release\] published .* (\d+\.\d+\.\d+): /m.exec(released.out)?.[1];
    line(`released ${version ?? 'a new version'} from ${short}`);
    return judged();
  }
  if (released.timedOut) {
    return failed('release', `failed: the release of ${short} did not finish in ${minutes(limits.release)} and was stopped, at: ${said}; ${retry} (${buildOutput.name})`);
  }
  if (released.code === 3) return failed('release', `held: ${short} did not compile: ${said}; held until main moves (${buildOutput.name})`, true);
  // The same code builds to the same paths, so it is not built and notarized again every hour.
  if (released.code === 4) return failed('release', `held: ${short} holds this Mac's folder paths: ${said}; held until main moves (${buildOutput.name})`, true);
  return failed('release', `failed: the release of ${short} exited ${released.code}: ${said}; ${retry} (${buildOutput.name})`);
}
