/*
 * `app-kit testflight watch <git url>[#<folder>]...`: one pass over each iPhone app's main, which a background job runs
 * every five minutes. When an app's main has moved and the change touches its iPhone app, or the newest TestFlight build
 * is near the day Apple expires it, it builds main's exact commit in a clone of its own and runs the app's own
 * `bun run app-kit testflight upload --token-only` there, so the app's pinned kit decides how it is built. An app whose
 * Tauri project is in a subfolder of its repository names it after a `#`, and everything runs in that folder. Every
 * decision is one line in testflight.log, with its reason.
 *
 * What has already gone up is read from App Store Connect, never kept here, so an upload by hand is never repeated and
 * never causes a skip. The record kept per app holds only the last main commit judged and the last failure, so a pass
 * on an unmoved main reads no key and writes no line, until the newest build nears its expiry.
 *
 * Files, under $XDG_STATE_HOME/app-kit/testflight (~/.local/state/app-kit/testflight by default):
 *   testflight.log         one line per decision, rotated to testflight.log.1 at 1 MB
 *   <app>/checkout/        the clone it builds in, which nobody works in
 *   <app>/build-<n>.log    the install's, build's and upload's output for build n
 *   <app>/record.json      the main commit last judged, the last failure (commit, step, time), and when to judge an
 *                          unmoved main again because the newest build nears its expiry
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { AppStoreConnect, type AppStoreConnectOptions } from './app-store-connect.ts';
import { lastLine, readKey } from './key.ts';
import { runCommand, STOP_SIGNALS, stopRunning, type Run } from './run.ts';
import { UPLOADING } from './upload.ts';

type Env = Record<string, string | undefined>;

/** How long each step may run before it is stopped with everything it started, in milliseconds. */
export type Limits = { fetch: number; install: number; build: number; upload: number };
export const LIMITS: Limits = { fetch: 2 * 60_000, install: 10 * 60_000, build: 60 * 60_000, upload: 45 * 60_000 };
/** How long a failure other than a compile failure waits before the same commit is tried again. */
export const RETRY_MS = 60 * 60 * 1000;
/** How long before Apple expires the newest build a fresh one goes up: on day 75 of its 90. */
export const RENEW_BEFORE_EXPIRY_MS = 15 * 24 * 60 * 60 * 1000;
const LOG_MAX = 1_000_000;
const BUILD_LOGS_KEPT = 10;

export type Failure = { commit: string; step: string; time: string; held?: boolean };
/**
 * `expiryCheckAt` is when an unmoved main is judged again, as the newest build enters its last days; null when nothing
 * would change, and absent in a record written before it existed, which is judged once.
 */
export type AppRecord = { judgedHead: string | null; failure: Failure | null; fetchFailingSince?: string | null; expiryCheckAt?: string | null };

/** The folder the watcher keeps its clones, logs and records in. */
export function stateFolder(env: Env, home = homedir()): string {
  return join(env.XDG_STATE_HOME || join(home, '.local', 'state'), 'app-kit', 'testflight');
}

/** An app's name from its git address: https://github.com/worktron/argon-watcher.git, or its SSH form, is argon-watcher. */
export function appName(url: string): string {
  return (url.replace(/#.*$/, '').replace(/\/+$/, '').split(/[/:]/).pop() ?? url).replace(/\.git$/, '');
}

/**
 * An app's entry in the watcher's list: its git address, then `#<folder>` when its Tauri project is in a subfolder,
 * as Timescale's `desktop/` is; the folder is '' at the repository's root. GitHub's names hold no `#`. The folder goes to
 * git clean as a pattern, so only plain path characters are taken; anything else is why the entry is refused.
 */
export function appAddress(entry: string): { url: string; folder: string } | string {
  const at = entry.lastIndexOf('#');
  if (at < 0) return { url: entry, folder: '' };
  const folder = entry.slice(at + 1).replace(/\/+$/, '');
  const plain = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(folder) && !folder.split('/').some((part) => part === '.' || part === '..');
  if (!plain) return `the folder "${entry.slice(at + 1)}" after # is not a folder inside the repository, named in letters, digits, ., _, - and /`;
  return { url: entry.slice(0, at), folder };
}

/** Whether the commit judged last should be built again: it failed for a reason other than its own code, an hour ago. */
export function retryDue(record: AppRecord, head: string, nowMs: number): boolean {
  const failure = record.failure;
  if (!failure || failure.commit !== head || failure.held) return false;
  return nowMs - Date.parse(failure.time) >= RETRY_MS;
}

/**
 * Which files make up the iPhone app, from the app's Tauri setup. An iPhone shell that loads a website (frontendDist an
 * address) is only its Tauri folder and its package and lock files, which carry the kit's native code; the website
 * reaches phones when it deploys. One that packs its pages is every file but documentation, plans and tests.
 */
export type AppKind = 'loads-a-website' | 'packs-its-pages';

export function appKind(tauriConfig: string): AppKind {
  try {
    const dist = (JSON.parse(tauriConfig) as { build?: { frontendDist?: unknown } }).build?.frontendDist;
    return typeof dist === 'string' && /^https?:\/\//.test(dist) ? 'loads-a-website' : 'packs-its-pages';
  } catch {
    return 'packs-its-pages';
  }
}

/** Whether a changed file, named from the repository's root, is part of the app whose Tauri project is in `folder`. */
export function countsAsApp(path: string, kind: AppKind, folder = ''): boolean {
  if (folder) {
    if (!path.startsWith(`${folder}/`)) return false;
    path = path.slice(folder.length + 1);
  }
  if (kind === 'loads-a-website') return path.startsWith('src-tauri/') || path === 'package.json' || path === 'bun.lock';
  const parts = path.split('/');
  const name = parts[parts.length - 1];
  if (name.endsWith('.md') || name.includes('.test.')) return false;
  return !parts.slice(0, -1).some((folder) => ['.claude', 'docs', 'test', 'tests', 'e2e'].includes(folder));
}

export type Head = { commit: string; count: number };
export type Decision = { upload: boolean; reason: string };

/**
 * Whether main's head goes up. `newest` is the largest build number App Store Connect holds, compared as a number,
 * never by the server's order; `newestCommit` the commit on main's first-parent line whose count it is, or null; and
 * `changed` the files changed from that commit to main's head, so landings since the last build are judged together.
 * `newestExpires` is when Apple expires the newest build: from RENEW_BEFORE_EXPIRY_MS before it, and after it, main's
 * head goes up with no app file changed, since testers cannot open an expired build.
 */
export function decide(input: {
  newest: number | null;
  newestCommit: string | null;
  head: Head;
  changed: string[];
  kind: AppKind;
  folder?: string;
  newestExpires?: string | null;
  now?: number;
}): Decision {
  const { newest, newestCommit, head, kind } = input;
  const at = `build ${head.count} (${head.commit.slice(0, 7)})`;
  const expiresMs = input.newestExpires ? Date.parse(input.newestExpires) : NaN;
  const now = input.now ?? Date.now();
  const expiring = now >= expiresMs - RENEW_BEFORE_EXPIRY_MS ? `${now >= expiresMs ? 'expired' : 'expires'} on ${new Date(expiresMs).toISOString().slice(0, 10)}` : null;
  if (newest === null) return { upload: true, reason: `uploading ${at}: App Store Connect has no build yet` };
  if (newest > head.count) {
    return { upload: false, reason: `skipped: App Store Connect's newest build ${newest} is above main's count ${head.count}; uploads resume when main passes it` };
  }
  if (newest === head.count) {
    if (newestCommit === head.commit) {
      if (expiring) return { upload: false, reason: `skipped: ${at} is already in App Store Connect; it ${expiring}, and the next landing uploads a fresh one` };
      return { upload: false, reason: `skipped: ${at} is already in App Store Connect` };
    }
    return { upload: false, reason: `skipped: App Store Connect holds build ${newest} from a commit not on main; uploads resume when main passes it` };
  }
  if (!newestCommit) {
    return { upload: true, reason: `uploading ${at}: App Store Connect's newest build ${newest} names no commit on main` };
  }
  const changed = input.changed.filter((path) => countsAsApp(path, kind, input.folder));
  if (!changed.length) {
    if (expiring) return { upload: true, reason: `uploading ${at}: build ${newest} ${expiring}` };
    return { upload: false, reason: `skipped: no app files changed since build ${newest}` };
  }
  const named = changed.slice(0, 3).join(', ') + (changed.length > 3 ? ` and ${changed.length - 3} more` : '');
  return { upload: true, reason: `uploading ${at}: app files changed since build ${newest} (${named})` };
}

/**
 * The commit on main's first-parent line whose commit count is `number`, or null when none is. `line` is that line,
 * newest first; counts only rise along it, so a binary search asks git for a few counts.
 */
export async function commitForNumber(number: number, line: string[], count: (commit: string) => Promise<number>): Promise<string | null> {
  const oldestFirst = [...line].reverse();
  let low = 0;
  let high = oldestFirst.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const found = await count(oldestFirst[middle]);
    if (found === number) return oldestFirst[middle];
    if (found < number) low = middle + 1;
    else high = middle - 1;
  }
  return null;
}

/** One pass at a time: launchd never overlaps its own job, but a pass by hand can meet one. A lock whose holder is gone is taken over. */
export function lock(file: string, pid = process.pid): boolean {
  mkdirSync(dirname(file), { recursive: true });
  try {
    writeFileSync(file, String(pid), { flag: 'wx' });
    return true;
  } catch {
    // held
  }
  if (held(file, pid)) return false;
  writeFileSync(file, String(pid));
  return true;
}

/** Whether a live process other than this one holds the lock file. */
function held(file: string, pid: number): boolean {
  let holder: number;
  try {
    holder = Number(readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
  if (!holder || holder === pid) return false;
  try {
    process.kill(holder, 0);
    return true;
  } catch {
    return false;
  }
}

export type WatchOptions = {
  urls: string[];
  run?: Run;
  env?: Env;
  home?: string;
  now?: () => number;
  limits?: Partial<Limits>;
  appStoreConnect?: AppStoreConnectOptions;
};

/** One pass over every app; gives how many of them had a step fail in it, each failure logged. */
export async function watch(options: WatchOptions): Promise<number> {
  const env = options.env ?? process.env;
  const state = stateFolder(env, options.home);
  const lockFile = join(state, 'testflight.lock');
  // Another pass is building; it has written its own lines.
  if (!lock(lockFile)) return 0;
  // Stopped itself (launchd unloading its job), it stops the programs it started, each in a process group of its own,
  // so no upload goes on building in a clone the next pass checks out; the upload puts its own things back.
  const onSignal = () => {
    stopRunning('SIGTERM');
    rmSync(lockFile, { force: true });
    process.exit(1);
  };
  for (const signal of STOP_SIGNALS) process.on(signal, onSignal);
  let failures = 0;
  try {
    for (const url of options.urls) {
      try {
        if (await watchApp(url, state, options)) failures++;
      } catch (error) {
        // Nothing an app does stops the pass over the others.
        log(state, `${new Date((options.now ?? Date.now)()).toISOString()} ${appName(url)}: failed: ${error instanceof Error ? error.message : String(error)}`);
        failures++;
      }
    }
  } finally {
    for (const signal of STOP_SIGNALS) process.off(signal, onSignal);
    rmSync(lockFile, { force: true });
  }
  return failures;
}

function log(state: string, line: string) {
  const file = join(state, 'testflight.log');
  try {
    if (statSync(file).size > LOG_MAX) renameSync(file, `${file}.1`);
  } catch {
    // no log yet
  }
  appendFileSync(file, `${line}\n`);
}

function readRecord(file: string): AppRecord {
  try {
    return { judgedHead: null, failure: null, ...(JSON.parse(readFileSync(file, 'utf8')) as Partial<AppRecord>) };
  } catch {
    return { judgedHead: null, failure: null };
  }
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
  const record = readRecord(recordFile);
  const save = (next: AppRecord) => writeFileSync(recordFile, `${JSON.stringify(next, null, 2)}\n`);
  const line = (message: string) => log(state, `${new Date(now()).toISOString()} ${name}: ${message}`);
  const address = appAddress(url);
  if (typeof address === 'string') {
    line(`failed: ${address}`);
    return true;
  }
  // The app's Tauri project and its packages: the clone's root, or the folder its entry names.
  const appFolder = join(checkout, address.folder);
  const tauriConfigName = join(address.folder, 'src-tauri/tauri.conf.json');
  const minutes = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} minutes` : `${ms / 1000} seconds`);

  // No terminal to prompt on: a fetch that needs a password fails instead of waiting. The 1Password token is never in
  // the environment of what it runs; the upload reads it for its own `op` call.
  const childEnv: Env = { ...(options.env ?? process.env), GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=10' };
  delete childEnv.OP_SERVICE_ACCOUNT_TOKEN;
  const git = async (args: string[], timeoutMs?: number) => {
    const done = await run(['git', ...args], { cwd: existsSync(checkout) ? checkout : folder, env: childEnv, timeoutMs });
    return { ok: done.code === 0, out: done.out.trim(), timedOut: done.timedOut };
  };

  // A fetch is cheap, so a failing one is tried every pass, with a line when it starts failing and one when it works.
  const fetched = existsSync(join(checkout, '.git'))
    ? await git(['fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main'], limits.fetch)
    : await git(['clone', '--quiet', '--no-checkout', address.url, checkout], limits.install);
  if (!fetched.ok) {
    if (!record.fetchFailingSince) {
      const why = fetched.timedOut ? 'it did not finish in time and was stopped' : lastLine(fetched.out);
      line(`failed: fetching main: ${why}; trying every pass, with a line when it works`);
      save({ ...record, fetchFailingSince: new Date(now()).toISOString() });
    }
    return true;
  }
  if (record.fetchFailingSince) {
    line(`fetching main works again (failing since ${record.fetchFailingSince})`);
    record.fetchFailingSince = null;
    save(record);
  }

  const head = (await git(['rev-parse', 'refs/remotes/origin/main'])).out;
  const expiryDue = record.expiryCheckAt === undefined || (record.expiryCheckAt !== null && now() >= Date.parse(record.expiryCheckAt));
  if (head === record.judgedHead && !retryDue(record, head, now()) && !expiryDue) return false;
  const count = Number((await git(['rev-list', '--count', head])).out);
  const at = `build ${count} (${head.slice(0, 7)})`;
  // Set once App Store Connect has said when the newest build expires, while that is still ahead.
  let expiryCheckAt: string | null = null;
  const judged = (failure: Failure | null = null) => {
    save({ judgedHead: head, failure, fetchFailingSince: null, expiryCheckAt });
    return failure !== null;
  };
  const failed = (step: string, message: string, held = false) => {
    line(message);
    return judged({ commit: head, step, time: new Date(now()).toISOString(), ...(held ? { held } : {}) });
  };
  const retry = 'trying again in an hour';

  // A build log is written only for a pass that builds, or whose install failed, so skipped landings never push the
  // logs of real builds out. Each try starts its own, keeping the try before, so retries at one commit never grow it.
  const buildLog = join(folder, `build-${count}.log`);
  const logName = `build-${count}.log`;
  const startBuildLog = (installOutput: string) => {
    if (existsSync(buildLog)) renameSync(buildLog, `${buildLog}.1`);
    writeFileSync(buildLog, `== ${new Date(now()).toISOString()} ${at}\n${installOutput}`);
    pruneBuildLogs(folder);
  };
  const toBuildLog = (chunk: string) => appendFileSync(buildLog, chunk);

  // Main's exact commit, with nothing left from another commit's build but the installed packages and Rust's build.
  // git clean runs at the clone's root, where a pattern with a slash is read from the root and `node_modules` matches
  // at any depth.
  const checkedOut = await git(['checkout', '--quiet', '--force', '--detach', head]);
  const cleaned = checkedOut.ok ? await git(['clean', '-ffdxq', '-e', 'node_modules', '-e', join(address.folder, 'src-tauri/target')]) : checkedOut;
  if (!cleaned.ok) return failed('checkout', `failed: checking out ${at}: ${lastLine(cleaned.out)}; ${retry}`);
  if (!existsSync(appFolder)) return failed('checkout', `held: ${at} has no folder ${address.folder}; held until main moves`, true);

  const installed = await run(['bun', 'install', '--frozen-lockfile'], { cwd: appFolder, env: childEnv, timeoutMs: limits.install });
  if (installed.code !== 0) {
    startBuildLog(installed.out);
    const why = installed.timedOut ? `it did not finish in ${minutes(limits.install)} and was stopped` : lastLine(installed.out);
    return failed('install', `failed: bun install at ${at}: ${why}; ${retry} (${logName})`);
  }
  if (!existsSync(join(appFolder, 'node_modules/app-kit/tauri/testflight/upload.ts'))) {
    line("waiting: main's app-kit has no testflight upload");
    return judged();
  }

  const keyRead = await readKey(run, childEnv, { tokenOnly: true });
  if ('missing' in keyRead) {
    // Kept as a failure, so it is checked again in an hour, but a pass waiting for the owner has not failed.
    failed('token', `waiting for the 1Password token: the login keychain has no "app-kit testflight" item; checking again in an hour`);
    return false;
  }
  if ('error' in keyRead) return failed('key', `failed: ${keyRead.error}; ${retry}`);

  let tauriConfig: string;
  let builds: { number: number; expires: string | null }[];
  try {
    tauriConfig = readFileSync(join(checkout, tauriConfigName), 'utf8');
    const bundleId = (JSON.parse(tauriConfig) as { identifier?: string }).identifier;
    if (!bundleId) return failed('app store connect', `failed: ${tauriConfigName} at ${at} names no identifier; ${retry}`);
    const appStoreConnect = new AppStoreConnect(keyRead.key, options.appStoreConnect);
    const appId = await appStoreConnect.appId(bundleId);
    if (!appId) return failed('app store connect', `failed: no app in App Store Connect has the bundle id ${bundleId}; ${retry}`);
    // Build numbers are compared as numbers: the server's order puts 99 above 100.
    builds = (await appStoreConnect.builds(appId)).map((build) => ({ number: Number(build.number), expires: build.expires })).filter((b) => Number.isInteger(b.number));
  } catch (error) {
    return failed('app store connect', `failed: ${error instanceof Error ? error.message : String(error)}; ${retry}`);
  }
  const newest = builds.length ? Math.max(...builds.map((b) => b.number)) : null;
  const newestExpires = builds.find((b) => b.number === newest)?.expires ?? null;
  const renewFrom = newestExpires ? Date.parse(newestExpires) - RENEW_BEFORE_EXPIRY_MS : NaN;
  if (renewFrom > now()) expiryCheckAt = new Date(renewFrom).toISOString();
  const mainLine = (await git(['rev-list', '--first-parent', head])).out.split('\n');
  const newestCommit =
    newest !== null && newest <= count
      ? await commitForNumber(newest, mainLine, async (commit) => Number((await git(['rev-list', '--count', commit])).out))
      : null;
  const changed = newestCommit && newestCommit !== head ? (await git(['diff', '--name-only', '--no-renames', newestCommit, head])).out.split('\n').filter(Boolean) : [];
  const decision = decide({ newest, newestCommit, head: { commit: head, count }, changed, kind: appKind(tauriConfig), folder: address.folder, newestExpires, now: now() });
  line(decision.reason);
  if (!decision.upload) return judged();
  startBuildLog(installed.out);

  // The app's own kit builds it, at background priority, keeping the Mac awake only while it runs. The build has its
  // time limit, and the upload and Apple's processing theirs from the line that says the build is done.
  let tail = '';
  let uploading = false;
  const uploaded = await run(['caffeinate', '-i', 'taskpolicy', '-b', 'bun', 'run', 'app-kit', 'testflight', 'upload', '--token-only'], {
    cwd: appFolder,
    env: childEnv,
    timeoutMs: limits.build,
    output: (chunk) => {
      toBuildLog(chunk);
      if (uploading) return;
      tail = (tail + chunk).slice(-500);
      if (!UPLOADING.test(tail)) return;
      uploading = true;
      return limits.upload;
    },
  });
  const said = uploaded.out.split('\n').filter((l) => l.startsWith('[testflight] ')).pop()?.slice('[testflight] '.length) ?? lastLine(uploaded.out);
  if (uploaded.code === 0) {
    line(`uploaded ${at}, processed`);
    // The newest build is now main's head, which nothing can renew until main moves, and the next judgment reads its date.
    expiryCheckAt = null;
    return judged();
  }
  if (uploaded.timedOut) {
    const step = uploading ? 'upload' : 'build';
    const limit = uploading ? limits.upload : limits.build;
    return failed(step, `failed: the ${step} of ${at} did not finish in ${minutes(limit)} and was stopped; ${retry} (${logName})`);
  }
  if (uploaded.code === 3) return failed('build', `held: ${at} did not compile: ${said}; held until main moves (${logName})`, true);
  return failed('upload', `failed: the upload of ${at} exited ${uploaded.code}: ${said}; ${retry} (${logName})`);
}

/** Keeps the newest builds' logs, by build number, each with its try before. */
function pruneBuildLogs(folder: string) {
  const logs = readdirSync(folder)
    .map((name) => ({ name, number: Number(name.match(/^build-(\d+)\.log(?:\.1)?$/)?.[1]) }))
    .filter((log) => Number.isInteger(log.number))
    .sort((a, b) => b.number - a.number);
  const kept = new Set([...new Set(logs.map((log) => log.number))].slice(0, BUILD_LOGS_KEPT));
  for (const old of logs.filter((log) => !kept.has(log.number))) rmSync(join(folder, old.name), { force: true });
}
