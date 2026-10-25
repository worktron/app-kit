/*
 * `app-kit testflight upload`: builds a Tauri app's iPhone app at the commit checked out, checks the build, uploads it
 * to TestFlight, and waits until App Store Connect has processed it. Run from the app's checkout, by hand or by the
 * watcher (watch.ts), which passes --token-only.
 *
 * The build number is the commit count, so each upload is higher than the last and names the commit it was built
 * from. A count only rises along one line of history, so it uploads only a commit on origin/main's first-parent line,
 * from a clean tree: a branch's number above main's would make Apple refuse every lower one.
 *
 * What each step works around, learned in the first uploads of Argon and Past the Break (Xcode 27.1, Tauri CLI 2.12):
 * - Signing goes through the Apple account Xcode is signed in to, which has Apple make the distribution certificate
 *   and profile in its cloud. With APPLE_API_* set, Tauri hands that key to xcodebuild, and an App Manager key fails
 *   the export with "Cloud signing permission error", so they are removed; the key is only for the upload.
 * - Xcode 27 hides the Swift entry points of Tauri and its plugins in a release build; swift-rs makes them visible
 *   again with llvm-objcopy, and without it the release build fails to link. A release build made before llvm-tools
 *   was installed needs src-tauri/target/aarch64-apple-ios/release removed so the swift-rs build scripts run again.
 * - The build number goes in as bundleVersion, not --build-number, which Tauri appends to the version (0.1.0.389),
 *   and App Store Connect takes at most three numbers.
 * - The export copies with rsync and passes options only Apple's accepts; Homebrew's rsync, ahead of it on PATH,
 *   fails with "Copy failed", so a folder holding a link to /usr/bin/rsync goes first on PATH.
 * - Tauri passes FORCE_COLOR into the Xcode build step as a flag, where a terminal's FORCE_COLOR=3 reads as a chip
 *   architecture, so it is removed.
 * - Tauri writes the export method and the build number into tracked files; only the values it wrote are put back,
 *   so an edit made to either file during the build survives.
 *
 * Exit codes: 0 uploaded and processed (or already uploaded, then processed); 3 the app did not compile; 1 anything
 * else.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppStoreConnect, type AppStoreConnectOptions, type TestFlightKey } from './app-store-connect.ts';
import { lastLine, readKey } from './key.ts';
import { runCommand, stopRunning, type Run } from './run.ts';

export const EXPORT_OPTIONS = 'src-tauri/gen/apple/ExportOptions.plist';
const INFO_PLIST = /^src-tauri\/gen\/apple\/[^/]+_iOS\/Info\.plist$/;
const IPA_FOLDER = 'src-tauri/gen/apple/build/arm64';
export const PROCESSING_LIMIT_MS = 30 * 60 * 1000;
const POLL_MS = 30_000;
/** The line the watcher reads as the end of the build: its time limit for the upload starts there. */
export const UPLOADING = /^\[testflight\] uploading build \d+/m;

type Env = Record<string, string | undefined>;

/**
 * The environment the build and the upload run in: Rust's own folder first, so a shell that never read rustup's
 * profile finds cargo; a UTF-8 locale, which CocoaPods and xcodebuild need; and none of what would change the build or
 * reach it that should not: FORCE_COLOR, APPLE_API_*, and the 1Password token.
 */
export function buildEnv(env: Env, home = homedir()): Env {
  const out: Env = {};
  for (const [name, value] of Object.entries(env)) {
    if (name === 'FORCE_COLOR' || name === 'OP_SERVICE_ACCOUNT_TOKEN' || name.startsWith('APPLE_API_')) continue;
    out[name] = value;
  }
  const cargo = join(env.CARGO_HOME || join(home, '.cargo'), 'bin');
  out.PATH = [cargo, ...(env.PATH ?? '').split(':').filter((dir) => dir && dir !== cargo)].join(':');
  out.LANG = 'en_US.UTF-8';
  return out;
}

/**
 * Whether a failed build failed on the app's own code, which builds the same way every time: Rust, Swift or the web
 * front end. Signing, network and Apple's tools fail for reasons another try can clear, and so can the link, which a
 * Rust build made before llvm-tools was installed fails until its folder is removed.
 */
export function compileFailed(output: string): boolean {
  return [/error: could not compile `/, /^error\[E\d{4}\]/m, /beforeBuildCommand .* failed/i, /\.swift:\d+:\d+: error:/].some((pattern) =>
    pattern.test(output),
  );
}

/**
 * What must be undone however the upload ends: temporary folders (one holds the key) and the plists Tauri wrote. A
 * `finally` does not run when the process is stopped by a signal, so each is also kept here for the signal's handler.
 */
const cleanups = new Set<() => void>();

/** Keeps `cleanup` for a stop by signal, and gives the function that runs it once and forgets it. */
function cleanupOnStop(cleanup: () => void): () => void {
  cleanups.add(cleanup);
  return () => {
    if (cleanups.delete(cleanup)) cleanup();
  };
}

const STOP_SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];

/** Whether altool refused the upload because App Store Connect already holds this build number. */
export function alreadyUploaded(output: string): boolean {
  return /Redundant Binary Upload|ITMS-90189|already uploaded a build with build number|ENTITY_ERROR\.ATTRIBUTE\.INVALID\.DUPLICATE/.test(output);
}

/** What the built app says about itself: its Info.plist and its signed entitlements, each as JSON. */
export type IpaFacts = { info: Record<string, unknown>; entitlements: Record<string, unknown> };

/** Each reason the build must not go up, or none. */
export function ipaProblems(facts: IpaFacts, buildNumber: number): string[] {
  const problems: string[] = [];
  const { info, entitlements } = facts;
  if (info.CFBundleVersion !== String(buildNumber)) {
    problems.push(`its CFBundleVersion is ${String(info.CFBundleVersion)}, not the build number ${buildNumber}`);
  }
  if (info.ITSAppUsesNonExemptEncryption !== false) {
    problems.push(
      'its Info.plist does not say ITSAppUsesNonExemptEncryption false, so App Store Connect would hold every build on the export question: put it in src-tauri/Info.ios.plist',
    );
  }
  // With push, the App Store export must have rewritten the push environment and signed for distribution.
  if ('aps-environment' in entitlements) {
    if (entitlements['aps-environment'] !== 'production') {
      problems.push(`its aps-environment is ${String(entitlements['aps-environment'])}, not production, so push would go to Apple's sandbox`);
    }
    if (entitlements['beta-reports-active'] !== true) problems.push('its beta-reports-active is not true, so it is not signed for TestFlight');
    if (entitlements['get-task-allow'] !== false) problems.push('its get-task-allow is not false, so it is signed for development');
  }
  return problems;
}

/**
 * Puts back the committed value of `key` in a plist's text, only where it still holds the value the build wrote, so an
 * edit made during the build survives.
 */
export function restoreValue(text: string, key: string, wrote: string, committed: string): string {
  if (wrote === committed) return text;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(<key>${escape(key)}</key>\\s*<string>)${escape(wrote)}(</string>)`), (_, open: string, close: string) => `${open}${committed}${close}`);
}

export type UploadOptions = {
  /** The app's checkout. */
  cwd: string;
  /** Read the key only through the keychain's token, never the signed-in `op`. */
  tokenOnly: boolean;
  run?: Run;
  env?: Env;
  home?: string;
  appStoreConnect?: AppStoreConnectOptions;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  print?: (line: string) => void;
  fail?: (line: string) => void;
  /** The build's and the upload's own output as it comes. */
  output?: (chunk: string) => void;
  pollMs?: number;
  processingLimitMs?: number;
};

/**
 * Uploads, as the module's comment says. Stopped by a signal, as the watcher's time limit stops it, it stops the
 * programs it started, each in a process group of its own that the watcher's signal does not reach, removes its
 * temporary folders and puts the plists back, then exits 1.
 */
export async function upload(options: UploadOptions): Promise<0 | 1 | 3> {
  const say = options.fail ?? ((line: string) => console.error(`[testflight] ${line}`));
  const onSignal = (signal: NodeJS.Signals) => {
    say(`stopped by ${signal}; stopping the programs it started and removing the key`);
    stopRunning('SIGTERM');
    for (const cleanup of cleanups) {
      cleanups.delete(cleanup);
      cleanup();
    }
    stopRunning('SIGKILL');
    process.exit(1);
  };
  for (const signal of STOP_SIGNALS) process.on(signal, onSignal);
  try {
    return await uploadSteps(options);
  } finally {
    for (const signal of STOP_SIGNALS) process.off(signal, onSignal);
  }
}

async function uploadSteps(options: UploadOptions): Promise<0 | 1 | 3> {
  const { cwd, tokenOnly } = options;
  const run = options.run ?? runCommand;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms));
  const print = options.print ?? ((line: string) => console.log(`[testflight] ${line}`));
  const say = options.fail ?? ((line: string) => console.error(`[testflight] ${line}`));
  const fail = (line: string): 1 => {
    say(line);
    return 1;
  };
  const output = options.output ?? ((chunk: string) => void process.stdout.write(chunk));
  const env = buildEnv(options.env ?? process.env, options.home);
  const git = async (...args: string[]) => {
    const done = await run(['git', ...args], { cwd, env });
    return { ok: done.code === 0, out: done.out.trim() };
  };
  const plistValue = async (text: string, key: string) => {
    const done = await run(['plutil', '-extract', key, 'raw', '-'], { cwd, env, input: text });
    return done.code === 0 ? done.out.trim() : null;
  };

  const status = await git('status', '--porcelain');
  if (!status.ok) return fail(`${cwd} is not a git checkout`);
  if (status.out) return fail('commit first: the build number names a commit, and the tree has uncommitted changes');
  const head = (await git('rev-parse', 'HEAD')).out;
  const main = await git('rev-list', '--first-parent', 'origin/main');
  if (!main.ok || !main.out.split('\n').includes(head)) {
    return fail(
      `HEAD (${head.slice(0, 7)}) is not a commit on origin/main's first-parent line: a build number names one, and a number from a branch makes Apple refuse main's lower ones. Fetch, and check out main.`,
    );
  }

  const sysroot = await run(['rustc', '--print', 'sysroot'], { cwd, env });
  if (sysroot.code !== 0) return fail(`rustc not found in ${env.PATH?.split(':')[0]} or on PATH: install Rust from https://rustup.rs`);
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  if (!existsSync(join(sysroot.out.trim(), `lib/rustlib/${arch}-apple-darwin/bin/llvm-objcopy`))) {
    return fail('a release build needs llvm-objcopy: rustup component add llvm-tools');
  }

  const buildNumber = Number((await git('rev-list', '--count', 'HEAD')).out);
  const short = head.slice(0, 7);

  // Read before the build, so a Mac without the key says so in seconds, not after a build.
  const keyRead = await readKey(run, env, { tokenOnly });
  if ('missing' in keyRead) {
    return fail(`waiting for the 1Password token: the login keychain has no "app-kit testflight" item (app-kit's README, TestFlight, says how to add it)`);
  }
  if ('error' in keyRead) return fail(keyRead.error);
  const key = keyRead.key;

  // The committed values of what Tauri writes, to put back after.
  const tracked = (await git('ls-files', '--', 'src-tauri/gen/apple')).out.split('\n');
  const restores: { file: string; key: string; wrote: string; committed: string }[] = [];
  for (const file of tracked) {
    const plistKey = file === EXPORT_OPTIONS ? 'method' : INFO_PLIST.test(file) ? 'CFBundleVersion' : null;
    if (!plistKey) continue;
    const committed = await plistValue((await git('show', `HEAD:${file}`)).out, plistKey);
    const wrote = plistKey === 'method' ? 'app-store-connect' : String(buildNumber);
    if (committed !== null) restores.push({ file, key: plistKey, wrote, committed });
  }

  const appleRsync = mkdtempSync(join(tmpdir(), 'app-kit-testflight-rsync-'));
  const putBack = cleanupOnStop(() => {
    rmSync(appleRsync, { recursive: true, force: true });
    for (const r of restores) {
      const path = join(cwd, r.file);
      if (existsSync(path)) writeFileSync(path, restoreValue(readFileSync(path, 'utf8'), r.key, r.wrote, r.committed));
    }
  });
  try {
    symlinkSync('/usr/bin/rsync', join(appleRsync, 'rsync'));
    print(`building build ${buildNumber} (${short})`);
    const config = JSON.stringify({ bundle: { iOS: { bundleVersion: String(buildNumber) } } });
    const built = await run(['bunx', 'tauri', 'ios', 'build', '--ci', '--export-method', 'app-store-connect', '--config', config], {
      cwd,
      env: { ...env, PATH: `${appleRsync}:${env.PATH}` },
      output,
    });
    if (built.code !== 0) {
      if (compileFailed(built.out)) {
        say(`build ${buildNumber} (${short}) did not compile: ${lastLine(built.out)}`);
        return 3;
      }
      return fail(`the build of ${buildNumber} (${short}) failed: ${lastLine(built.out)}`);
    }
  } finally {
    putBack();
  }

  const ipaFolder = join(cwd, IPA_FOLDER);
  const ipaName = existsSync(ipaFolder) ? readdirSync(ipaFolder).find((name) => name.endsWith('.ipa')) : undefined;
  if (!ipaName) return fail(`the build made no .ipa in ${IPA_FOLDER}`);
  const ipa = join(ipaFolder, ipaName);

  const facts = await readIpa(ipa, run, env);
  if (typeof facts === 'string') return fail(facts);
  const problems = ipaProblems(facts, buildNumber);
  if (problems.length) return fail(`${ipaName} must not go up: ${problems.join('; ')}`);
  const bundleId = String(facts.info.CFBundleIdentifier ?? '');

  print(`uploading build ${buildNumber} (${short})`);
  const uploaded = await altoolUpload(ipa, key, run, env, output);
  if (uploaded === 'already') print(`build ${buildNumber} is already uploaded; waiting for Apple's processing`);
  else if (uploaded !== 'uploaded') return fail(`altool did not upload build ${buildNumber}: ${uploaded}`);

  const appStoreConnect = new AppStoreConnect(key, options.appStoreConnect);
  const limit = options.processingLimitMs ?? PROCESSING_LIMIT_MS;
  const until = now() + limit;
  let seen = 'not listed yet';
  let appId: string | null = null;
  while (true) {
    try {
      appId ??= await appStoreConnect.appId(bundleId);
      if (!appId) return fail(`no app in App Store Connect has the bundle id ${bundleId}: its record is made once, by hand (app-kit's README, TestFlight)`);
      const build = await appStoreConnect.build(appId, String(buildNumber));
      seen = build ? build.processingState : 'not listed yet';
      if (build?.processingState === 'VALID') {
        print(`build ${buildNumber} (${short}) processed; TestFlight: ${build.internalState ?? 'unknown'}`);
        return 0;
      }
      if (build && (build.processingState === 'FAILED' || build.processingState === 'INVALID')) {
        return fail(`Apple's processing of build ${buildNumber} ended ${build.processingState}`);
      }
    } catch (error) {
      seen = error instanceof Error ? error.message : String(error);
    }
    if (now() >= until) {
      return fail(`build ${buildNumber} was uploaded, but Apple had not processed it in ${Math.round(limit / 60_000)} minutes (${seen})`);
    }
    await sleep(options.pollMs ?? POLL_MS);
  }
}

/** The built app's Info.plist and entitlements, or why they could not be read. */
async function readIpa(ipa: string, run: Run, env: Env): Promise<IpaFacts | string> {
  const folder = mkdtempSync(join(tmpdir(), 'app-kit-testflight-ipa-'));
  const remove = cleanupOnStop(() => rmSync(folder, { recursive: true, force: true }));
  try {
    const unzipped = await run(['unzip', '-q', '-o', ipa, '-d', folder], { env });
    if (unzipped.code !== 0) return `could not unzip ${ipa}: ${lastLine(unzipped.out)}`;
    const payload = join(folder, 'Payload');
    const app = existsSync(payload) ? readdirSync(payload).find((name) => name.endsWith('.app')) : undefined;
    if (!app) return `${ipa} holds no app in Payload/`;
    const entitlementsFile = join(folder, 'entitlements.plist');
    const signed = await run(['codesign', '-d', '--entitlements', entitlementsFile, '--xml', join(payload, app)], { env });
    if (signed.code !== 0) return `codesign could not read ${app}'s entitlements: ${lastLine(signed.out)}`;
    const json = async (file: string) => {
      if (!existsSync(file)) return {};
      const done = await run(['plutil', '-convert', 'json', '-o', '-', file], { env });
      return done.code === 0 ? (JSON.parse(done.out) as Record<string, unknown>) : null;
    };
    const info = await json(join(payload, app, 'Info.plist'));
    const entitlements = await json(entitlementsFile);
    if (!info || !entitlements) return `could not read ${app}'s Info.plist or entitlements`;
    return { info, entitlements };
  } finally {
    remove();
  }
}

/**
 * Uploads with altool, which finds the key file in API_PRIVATE_KEYS_DIR: a folder of its own, for the length of the
 * upload only. 'uploaded', 'already' when App Store Connect holds the number, or altool's refusal.
 */
async function altoolUpload(ipa: string, key: TestFlightKey, run: Run, env: Env, output: (chunk: string) => void): Promise<string> {
  const keys = mkdtempSync(join(tmpdir(), 'app-kit-testflight-key-'));
  const remove = cleanupOnStop(() => rmSync(keys, { recursive: true, force: true }));
  try {
    writeFileSync(join(keys, `AuthKey_${key.keyId}.p8`), `${key.privateKey}\n`, { mode: 0o600 });
    const done = await run(['xcrun', 'altool', '--upload-app', '--type', 'ios', '--file', ipa, '--apiKey', key.keyId, '--apiIssuer', key.issuerId], {
      env: { ...env, API_PRIVATE_KEYS_DIR: keys },
      output,
    });
    if (alreadyUploaded(done.out)) return 'already';
    // altool has exited 0 while printing an error, so its own word counts too.
    if (done.code === 0 && !/\bERROR\b[^\n]*ITMS-|UPLOAD FAILED/.test(done.out)) return 'uploaded';
    return lastLine(done.out);
  } finally {
    remove();
  }
}
