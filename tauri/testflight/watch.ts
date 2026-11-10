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
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppStoreConnect, type AppStoreConnectOptions } from './app-store-connect.ts';
import { lastLine, readKey } from './key.ts';
import { runCommand, type Run } from '../../command-line/run.ts';
import { UPLOADING } from './upload.ts';
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

export { appAddress, appKind, appName, countsAsApp, retryDue, RETRY_MS, type AppKind, type Failure } from '../watch-main.ts';

/** How long each step may run before it is stopped with everything it started, in milliseconds. */
export type Limits = { fetch: number; install: number; build: number; upload: number };
export const LIMITS: Limits = { fetch: 2 * 60_000, install: 10 * 60_000, build: 60 * 60_000, upload: 45 * 60_000 };
/** How long before Apple expires the newest build a fresh one goes up: on day 75 of its 90. */
export const RENEW_BEFORE_EXPIRY_MS = 15 * 24 * 60 * 60 * 1000;
/**
 * `expiryCheckAt` is when an unmoved main is judged again, as the newest build enters its last days; null when nothing
 * would change, and absent in a record written before it existed, which is judged once.
 */
export type AppRecord = MainRecord & { expiryCheckAt?: string | null };


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
  const state = stateFolder('testflight', options.env ?? process.env, options.home);
  return passOverApps({
    urls: options.urls,
    lockFile: join(state, 'testflight.lock'),
    logFile: join(state, 'testflight.log'),
    now: options.now ?? Date.now,
    app: (url) => watchApp(url, state, options),
  });
}

function log(state: string, line: string) {
  appendLog(join(state, 'testflight.log'), line);
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
  const record: AppRecord = readRecord<AppRecord>(recordFile, { judgedHead: null, failure: null });
  const save = (next: AppRecord) => saveRecord(recordFile, next);
  const line = (message: string) => log(state, `${new Date(now()).toISOString()} ${name}: ${message}`);
  const address = appAddress(url);
  if (typeof address === 'string') {
    line(`failed: ${address}`);
    return true;
  }
  // The app's Tauri project and its packages: the clone's root, or the folder its entry names.
  const appFolder = join(checkout, address.folder);
  const tauriConfigName = join(address.folder, 'src-tauri/tauri.conf.json');

  // The 1Password token is never in the environment of what it runs; the upload reads it for its own `op` call.
  const childEnv: Env = watcherChildEnv(options.env ?? process.env);
  const git = cloneGit(run, checkout, folder, childEnv);
  if (!(await fetchMain({ git, checkout, url: address.url, record, save, line, now, fetchMs: limits.fetch, cloneMs: limits.install }))) return true;

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

  const buildOutput = buildLog(folder, count);
  const logName = buildOutput.name;
  const startBuildLog = (installOutput: string) => buildOutput.start(`${new Date(now()).toISOString()} ${at}`, installOutput);
  const toBuildLog = (chunk: string) => buildOutput.append(chunk);

  const cleaned = await checkOutMain(git, head, address.folder);
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

