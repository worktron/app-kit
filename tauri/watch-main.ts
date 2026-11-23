/*
 * What the kit's two watchers of an app's main share, the TestFlight watcher (testflight/watch.ts) and the Mac release
 * watcher (mac-release/watch.ts): one pass over every app under a lock, an app's name and folder from its entry, which
 * files make up the app, a clone of its own that main is fetched into and checked out in with nothing left from another
 * commit's build, the record of the commit judged last and the last failure, the hourly retry, and the build logs, and
 * finding the apps whose root package.json declares themselves under "app-kit" (the Mac release watcher's way so far).
 * Each watcher decides for itself whether main's head goes up, and how.
 */
import { appendFileSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lastLine } from './testflight/key.ts';
import { STOP_SIGNALS, stopRunning, type Run } from '../command-line/run.ts';
import { appendLog, lock } from './state.ts';

export type Env = Record<string, string | undefined>;

/** How long a failure other than a compile failure waits before the same commit is tried again. */
export const RETRY_MS = 60 * 60 * 1000;
const BUILD_LOGS_KEPT = 10;

export type Failure = { commit: string; step: string; time: string; held?: boolean };
/** What a watcher keeps per app: the main commit judged last, its failure, and since when fetching main fails. */
export type MainRecord = { judgedHead: string | null; failure: Failure | null; fetchFailingSince?: string | null };

/** An app's name from its git address: https://github.com/worktron/argon-watcher.git, or its SSH form, is argon-watcher. */
export function appName(url: string): string {
  return (url.replace(/#.*$/, '').replace(/\/+$/, '').split(/[/:]/).pop() ?? url).replace(/\.git$/, '');
}

/**
 * An app's entry in a watcher's list: its git address, then `#<folder>` when its Tauri project is in a subfolder,
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
export function retryDue(record: MainRecord, head: string, nowMs: number): boolean {
  const failure = record.failure;
  if (!failure || failure.commit !== head || failure.held) return false;
  return nowMs - Date.parse(failure.time) >= RETRY_MS;
}

/**
 * Which files make up the app, from its Tauri setup. A shell that loads a website (frontendDist an address, or the
 * kit's start page, which goes on to the site) is only its Tauri folder and its package and lock files, which carry the
 * kit's native code and the start page; the website reaches people when it deploys. One that packs its pages is every
 * file but documentation, plans and tests.
 */
export type AppKind = 'loads-a-website' | 'packs-its-pages';

/** The kit's start page's folder as an app's frontendDist names it, from wherever its node_modules is. */
const KIT_START_PAGE = /(^|\/)node_modules\/app-kit\/tauri\/window\/start\/?$/;

export function appKind(tauriConfig: string): AppKind {
  try {
    const dist = (JSON.parse(tauriConfig) as { build?: { frontendDist?: unknown } }).build?.frontendDist;
    return typeof dist === 'string' && (/^https?:\/\//.test(dist) || KIT_START_PAGE.test(dist)) ? 'loads-a-website' : 'packs-its-pages';
  } catch {
    return 'packs-its-pages';
  }
}

/**
 * Whether a changed file, named from the repository's root, is part of the app whose Tauri project, or native Xcode
 * project, is in `folder`; `excluded` are folders of it that are not the app, such as a native app's test targets.
 */
export function countsAsApp(path: string, kind: AppKind, folder = '', excluded: string[] = []): boolean {
  if (folder) {
    if (!path.startsWith(`${folder}/`)) return false;
    path = path.slice(folder.length + 1);
  }
  if (kind === 'loads-a-website') return path.startsWith('src-tauri/') || path === 'package.json' || path === 'bun.lock';
  if (excluded.some((excludedFolder) => path.startsWith(`${excludedFolder}/`))) return false;
  const parts = path.split('/');
  const name = parts[parts.length - 1];
  if (name.endsWith('.md') || name.includes('.test.')) return false;
  return !parts.slice(0, -1).some((folder) => ['.claude', 'docs', 'test', 'tests', 'e2e'].includes(folder));
}

/** The record kept in `file`, with `empty`'s fields where it has none or cannot be read. */
export function readRecord<T extends MainRecord>(file: string, empty: T): T {
  try {
    return { ...empty, ...(JSON.parse(readFileSync(file, 'utf8')) as Partial<T>) };
  } catch {
    return { ...empty };
  }
}

export function saveRecord(file: string, record: MainRecord): void {
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
}

/**
 * One pass over every app's entry, under the lock file, writing to the log file: gives how many apps had a step fail,
 * each failure logged. Stopped itself (launchd unloading its job), it stops the programs it started, each in a process
 * group of its own, so no build goes on in a clone the next pass checks out.
 */
export async function passOverApps(input: {
  /** The apps' entries, or how to find them, which runs under the lock so two passes never find them at once. */
  urls: string[] | (() => Promise<string[]>);
  lockFile: string;
  logFile: string;
  now: () => number;
  /** One app's pass; gives true when a step failed. */
  app: (url: string) => Promise<boolean>;
}): Promise<number> {
  // Another pass is building; it has written its own lines.
  if (!lock(input.lockFile)) return 0;
  const onSignal = () => {
    stopRunning('SIGTERM');
    rmSync(input.lockFile, { force: true });
    process.exit(1);
  };
  for (const signal of STOP_SIGNALS) process.on(signal, onSignal);
  let failures = 0;
  try {
    const urls = typeof input.urls === 'function' ? await input.urls() : input.urls;
    // Each app has one clone and one record, by its repository's name, so a repository is watched once, at one folder.
    const watched = new Set<string>();
    for (const url of urls) {
      try {
        if (watched.has(appName(url))) throw new Error(`${url} is a repository an earlier entry already watches; each is watched at one folder`);
        watched.add(appName(url));
        if (await input.app(url)) failures++;
      } catch (error) {
        // Nothing an app does stops the pass over the others.
        appendLog(input.logFile, `${new Date(input.now()).toISOString()} ${appName(url)}: failed: ${error instanceof Error ? error.message : String(error)}`);
        failures++;
      }
    }
  } finally {
    for (const signal of STOP_SIGNALS) process.off(signal, onSignal);
    rmSync(input.lockFile, { force: true });
  }
  return failures;
}

/**
 * The environment a watcher's programs run in: no terminal to prompt on, so a fetch that needs a password fails instead
 * of waiting, and no 1Password token, which a build reads for its own `op` call from the keychain.
 */
export function watcherChildEnv(env: Env): Env {
  const child: Env = { ...env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=10' };
  delete child.OP_SERVICE_ACCOUNT_TOKEN;
  return child;
}

export type Git = (args: string[], timeoutMs?: number) => Promise<{ ok: boolean; out: string; timedOut: boolean }>;

/** git in the app's clone, or in its state folder before the clone exists. */
export function cloneGit(run: Run, checkout: string, folder: string, env: Env): Git {
  return async (args, timeoutMs) => {
    const done = await run(['git', ...args], { cwd: existsSync(checkout) ? checkout : folder, env, timeoutMs });
    return { ok: done.code === 0, out: done.out.trim(), timedOut: done.timedOut };
  };
}

/**
 * Fetches main into the clone, or clones it the first time, and gives whether that worked. A fetch is cheap, so a
 * failing one is tried every pass, with a line when it starts failing and one when it works again.
 */
export async function fetchMain(input: {
  git: Git;
  checkout: string;
  url: string;
  record: MainRecord;
  save: (record: MainRecord) => void;
  line: (message: string) => void;
  now: () => number;
  fetchMs: number;
  cloneMs: number;
}): Promise<boolean> {
  const { git, record } = input;
  const cloned = existsSync(join(input.checkout, '.git'));
  // A clone is kept by the repository's name alone, so one made from another repository, such as another owner's of
  // the same name, is never fetched into and built as this one. The address is read as stored, since `remote get-url`
  // gives it rewritten by any insteadOf rule; the same repository by another address, as an https clone found over SSH
  // later, is pointed at the new one.
  const origin = cloned ? (await git(['config', '--get', 'remote.origin.url'])).out : input.url;
  if (origin !== input.url && repositoryOf(origin) === repositoryOf(input.url)) await git(['remote', 'set-url', 'origin', input.url]);
  const fetched =
    repositoryOf(origin) !== repositoryOf(input.url)
      ? { ok: false, out: `the clone in ${input.checkout} is of ${origin}, not ${input.url}; remove that folder to clone it afresh`, timedOut: false }
      : cloned
        ? await git(['fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main'], input.fetchMs)
        : await git(['clone', '--quiet', '--no-checkout', input.url, input.checkout], input.cloneMs);
  if (!fetched.ok) {
    if (!record.fetchFailingSince) {
      const why = fetched.timedOut ? 'it did not finish in time and was stopped' : lastLine(fetched.out);
      input.line(`failed: fetching main: ${why}; trying every pass, with a line when it works`);
      input.save({ ...record, fetchFailingSince: new Date(input.now()).toISOString() });
    }
    return false;
  }
  if (record.fetchFailingSince) {
    input.line(`fetching main works again (failing since ${record.fetchFailingSince})`);
    record.fetchFailingSince = null;
    input.save(record);
  }
  return true;
}

/**
 * The repository a git address names, so two ways of writing one compare equal: GitHub's https and SSH forms give
 * `github.com/<owner>/<name>` in lower case, as GitHub's names are; any other address is itself, less a trailing `.git`
 * or slash.
 */
export function repositoryOf(url: string): string {
  const trimmed = url.replace(/\/+$/, '').replace(/\.git$/, '');
  const github = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+)$/i.exec(trimmed);
  return github ? `github.com/${github[1]!.toLowerCase()}` : trimmed;
}

/**
 * Main's exact commit, with nothing left from another commit's build but the installed packages and Rust's build. git
 * clean runs at the clone's root, where a pattern with a slash is read from the root and `node_modules` matches at any
 * depth.
 */
export async function checkOutMain(git: Git, head: string, appFolder: string): Promise<{ ok: boolean; out: string }> {
  const checkedOut = await git(['checkout', '--quiet', '--force', '--detach', head]);
  return checkedOut.ok ? await git(['clean', '-ffdxq', '-e', 'node_modules', '-e', join(appFolder, 'src-tauri/target')]) : checkedOut;
}

/**
 * The log of one build, `build-<count>.log` in the app's folder, written only for a pass that builds, or whose install
 * failed, so skipped landings never push the logs of real builds out. Each try starts its own, keeping the try before,
 * so retries at one commit never grow it; the ten newest builds' logs are kept.
 */
export function buildLog(folder: string, count: number) {
  const file = join(folder, `build-${count}.log`);
  return {
    name: `build-${count}.log`,
    start(heading: string, installOutput: string) {
      if (existsSync(file)) renameSync(file, `${file}.1`);
      writeFileSync(file, `== ${heading}\n${installOutput}`);
      pruneBuildLogs(folder);
    },
    append(chunk: string) {
      appendFileSync(file, chunk);
    },
  };
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

/** A step's time limit in words, for a log line. */
export function minutes(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} minutes` : `${ms / 1000} seconds`;
}

/** An app found declaring itself: its entry, as a watcher's list gives one, and main's head as GitHub gave it. */
export type DeclaredApp = { entry: string; head: string | null };

/**
 * The entry a root package.json declares for `key` under "app-kit", such as `"app-kit": { "mac-release": "shell" }`:
 * `cloneUrl` alone for the repository's root (`"."`), `cloneUrl#<folder>` otherwise, or null when it declares nothing.
 * The folder is not judged here: a watcher's entry rule (appAddress) refuses one that is not plain, with a line.
 */
export function declaredEntry(packageJson: string, key: string, cloneUrl: string): string | null {
  let declared: unknown;
  try {
    declared = (JSON.parse(packageJson) as { 'app-kit'?: Record<string, unknown> })?.['app-kit']?.[key];
  } catch {
    return null;
  }
  if (declared === undefined || declared === null) return null;
  const folder = typeof declared === 'string' ? declared.replace(/\/+$/, '') : JSON.stringify(declared);
  return folder === '.' || folder === '' ? cloneUrl : `${cloneUrl}#${folder}`;
}

/** The address a found app is cloned from: SSH, since fetching over https would go through gh's active account. */
export const sshCloneUrl = (nameWithOwner: string) => `git@github.com:${nameWithOwner}.git`;

/**
 * One question to GitHub per page of 100 repositories: each repository the owner owns, never a fork, an archived one or
 * one it only collaborates on, with main's head and main's root package.json.
 */
const DECLARED_APPS_QUERY = `query($owner: String!, $after: String) {
  repositoryOwner(login: $owner) {
    repositories(first: 100, after: $after, ownerAffiliations: OWNER, isFork: false, isArchived: false) {
      pageInfo { hasNextPage endCursor }
      nodes {
        nameWithOwner
        owner { login }
        ref(qualifiedName: "refs/heads/main") { target { oid } }
        object(expression: "main:package.json") { ... on Blob { text } }
      }
    }
  }
}`;

type DeclaredAppsPage = {
  data?: {
    repositoryOwner: {
      repositories: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: { nameWithOwner: string; owner: { login: string }; ref: { target: { oid: string } } | null; object: { text?: string } | null }[];
      };
    } | null;
  };
  errors?: { message: string }[];
};

/**
 * The apps the owners' repositories declare for `key` in their root package.json on main, by asking GitHub's GraphQL API
 * through gh, whose environment `env` holds the token that reads them; or why the question failed. A repository another
 * account owns is never one of them, whatever GitHub answers, since the watcher signs and publishes what it builds.
 */
export async function declaredApps(input: {
  owners: string[];
  key: string;
  run: Run;
  env: Env;
  cloneUrl?: (nameWithOwner: string) => string;
}): Promise<DeclaredApp[] | { failed: string }> {
  const cloneUrl = input.cloneUrl ?? sshCloneUrl;
  const apps: DeclaredApp[] = [];
  for (const owner of input.owners) {
    let after: string | null = null;
    do {
      const asked = await input.run(['gh', 'api', 'graphql', '-f', `query=${DECLARED_APPS_QUERY}`, '-f', `owner=${owner}`, ...(after ? ['-f', `after=${after}`] : [])], {
        env: input.env,
        timeoutMs: 60_000,
      });
      if (asked.code !== 0) return { failed: `gh could not ask GitHub about ${owner}'s repositories: ${asked.timedOut ? 'it did not finish in a minute and was stopped' : lastLine(asked.out)}` };
      let page: DeclaredAppsPage;
      try {
        page = JSON.parse(asked.stdout) as DeclaredAppsPage;
      } catch {
        return { failed: `GitHub's answer about ${owner}'s repositories is not JSON: ${lastLine(asked.out)}` };
      }
      const repositories = page.data?.repositoryOwner?.repositories;
      if (page.errors?.length || !repositories) return { failed: `GitHub did not list ${owner}'s repositories: ${page.errors?.[0]?.message ?? 'no such account'}` };
      for (const node of repositories.nodes) {
        if (node.owner.login.toLowerCase() !== owner.toLowerCase() || typeof node.object?.text !== 'string') continue;
        const entry = declaredEntry(node.object.text, input.key, cloneUrl(node.nameWithOwner));
        if (entry) apps.push({ entry, head: node.ref?.target.oid ?? null });
      }
      after = repositories.pageInfo.hasNextPage ? repositories.pageInfo.endCursor : null;
    } while (after);
  }
  return apps;
}
