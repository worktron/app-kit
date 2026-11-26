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
 * - Signing used to go through the Apple account Xcode is signed in to, whose distribution certificate Apple keeps in
 *   its cloud; when Xcode signed itself out, every export failed with "No Accounts". It now signs with the team's
 *   distribution certificate from 1Password and the app's App Store profile from App Store Connect (signing.ts says
 *   how, and what Tauri leaves that is put back). APPLE_API_* stay removed: with them set, Tauri hands that key to
 *   xcodebuild for Apple's cloud signing, which an App Manager key fails with "Cloud signing permission error".
 * - Xcode 27 hides the Swift entry points of Tauri and its plugins in a release build; swift-rs makes them visible
 *   again with llvm-objcopy, and without it the release build fails to link. A release build made before llvm-tools
 *   was installed needs src-tauri/target/aarch64-apple-ios/release removed so the swift-rs build scripts run again.
 * - The build number goes in as bundleVersion, not --build-number, which Tauri appends to the version (0.1.0.389),
 *   and App Store Connect takes at most three numbers.
 * - The export copies with rsync and passes options only Apple's accepts; Homebrew's rsync, ahead of it on PATH,
 *   fails with "Copy failed", so a folder holding a link to /usr/bin/rsync goes first on PATH, with the `security`
 *   that notes Tauri's keychain (signing.ts).
 * - Tauri passes FORCE_COLOR into the Xcode build step as a flag, where a terminal's FORCE_COLOR=3 reads as a chip
 *   architecture, so it is removed, with the key, by the build environment every iPhone build shares (../build-env.ts).
 * - App Store Connect refuses an App Store icon with a pixel that is not fully opaque (90717), and altool says so only
 *   after the whole build; `tauri icon` writes every iPhone icon with an alpha channel, metamax's with pixels at 254, so
 *   the icon's pixels are read before the build, and the refusal names `app-kit icons render`, which draws them opaque.
 * - Tauri writes the export method and the build number into tracked files; only the values it wrote are put back,
 *   so an edit made to either file during the build survives.
 * - Tauri's deep-link plugin before 2.6.3 deletes the sign-in domain from the iPhone entitlements when its build script
 *   runs, as it does in a new clone, so such a build is refused with the update that fixes it (../deep-link-entitlements.ts).
 * - The apps the build made (the archive's, and Xcode's copy) are deleted once the upload is done with them, worked or
 *   not, and macOS told to forget them, and the upload starts by deleting Xcode's build folders of Tauri checkouts that
 *   are gone (../built-apps.ts): macOS registers the archive's app hours after the upload, and keeps it registered.
 *
 * Exit codes: 0 uploaded and processed (or already uploaded, then processed); 3 the app did not compile; 1 anything
 * else.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pngOpacities } from './icon-opacity.ts';
import { AppStoreConnect, AppStoreConnectError, type AppStoreConnectOptions, type AppStorePlatform, type CertificateRecord, type Profile, type ProfileType, type TestFlightKey } from './app-store-connect.ts';
import { CERTIFICATE_ITEM, lastLine, readCertificate, readKey, VAULT, type Certificate } from './key.ts';
import { lock } from '../state.ts';
import {
  bundleIdentifier,
  certificateFacts,
  deleteRecordedKeychains,
  extensionSigningSettings,
  installProfile,
  profileGroups,
  profileTimeSensitive,
  projectToPutBack,
  removeTauriProfileCopy,
  tauriCliProblem,
  tauriProfileFiles,
  TIME_SENSITIVE_ENTITLEMENT,
  withBuildSettings,
  writeSecurityRecorder,
  writeXcodebuildStandIn,
  xcodeProjectFile,
  xcodeTargets,
  type XcodeTarget,
  type XcodeTargets,
} from './signing.ts';
import { buildEnv, type Env } from '../build-env.ts';
import { deepLinkProblem } from '../deep-link-entitlements.ts';
import { appsBelow, iphoneApps, removeApps, removeAppsNow, sweepGoneCheckouts, type BuildStarted } from '../built-apps.ts';
import {
  buildNumberProblem,
  deleteKeychain,
  exportOptions,
  isNativeFolder,
  listedKeychains,
  nativeIconProblem,
  nativeProject,
  nativeSigningSettings,
  PROJECT_YML,
} from './native.ts';
import { runCommand, STOP_SIGNALS, stopRunning, type Run } from '../../command-line/run.ts';

export { buildEnv, pngOpacities, STOP_SIGNALS };

export const EXPORT_OPTIONS = 'src-tauri/gen/apple/ExportOptions.plist';
/** The app's Info.plist and each extension's, all of which Tauri's archive writes the build number into. */
const INFO_PLIST = /^src-tauri\/gen\/apple\/[^/]+\/Info\.plist$/;
const XCODE_PROJECT = /^src-tauri\/gen\/apple\/[^/]+\.xcodeproj\/project\.pbxproj$/;
/** Where the README says how to make the distribution certificate, named by every refusal that needs a new one. */
const MAKE_CERTIFICATE = `make it as app-kit's README, TestFlight, "The distribution certificate", says`;
const IPA_FOLDER = 'src-tauri/gen/apple/build/arm64';
export const PROCESSING_LIMIT_MS = 30 * 60 * 1000;
const POLL_MS = 30_000;
/** The line the watcher reads as the end of the build: its time limit for the upload starts there. */
export const UPLOADING = /^\[testflight\] uploading build \d+/m;

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

/** Whether altool refused the upload because App Store Connect already holds this build number. */
export function alreadyUploaded(output: string): boolean {
  return /Redundant Binary Upload|ITMS-90189|already uploaded a build with build number|ENTITY_ERROR\.ATTRIBUTE\.INVALID\.DUPLICATE/.test(output);
}

/** The iPhone app's icon set, in the Tauri project's generated Xcode project, where `tauri ios init` puts it. */
export const ICON_SET = 'src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset';

/**
 * Why the App Store icon would make Apple refuse the upload, or null. It is the set's 1024 entry for the App Store: Tauri
 * writes it as ios-marketing, Xcode's one-size form as universal for iOS, beside dark and tinted entries Apple wants
 * see-through, which are not it. altool refuses one with a pixel that is not fully opaque (90717), but only after the
 * whole build, so it is checked first. An alpha channel alone is not refused: getter's and Urge Surfer's App Store icons
 * have one, every pixel at 255, and went up; metamax's least opaque pixel was 254, and it was refused.
 */
export function appStoreIconProblem(cwd: string): string | null {
  const redraw = `draw the iPhone icons with app-kit icons render --icon-set ${ICON_SET} (app-kit's README, icons), and commit them`;
  const contents = join(cwd, ICON_SET, 'Contents.json');
  if (!existsSync(contents)) return `${ICON_SET} has no Contents.json, so the build would have no App Store icon: run bunx tauri ios init, then ${redraw}`;
  type Entry = { idiom?: string; platform?: string; size?: string; filename?: string; appearances?: unknown[] };
  let images: Entry[];
  try {
    images = (JSON.parse(readFileSync(contents, 'utf8')) as { images?: Entry[] }).images ?? [];
  } catch (error) {
    return `${ICON_SET}/Contents.json is not JSON (${error instanceof Error ? error.message : String(error)})`;
  }
  const entry = images.find(
    (image) => image.size === '1024x1024' && !image.appearances?.length && (image.idiom === 'ios-marketing' || (image.idiom === 'universal' && image.platform === 'ios')),
  );
  if (!entry?.filename) return `${ICON_SET} has no App Store icon (a 1024x1024 ios-marketing entry with a file), which App Store Connect requires: ${redraw}`;
  const file = join(cwd, ICON_SET, entry.filename);
  if (!existsSync(file)) return `the App Store icon ${ICON_SET}/${entry.filename} is missing: ${redraw}`;
  const opacities = pngOpacities(readFileSync(file));
  if (opacities === null) return `the App Store icon ${ICON_SET}/${entry.filename} is not a PNG that can be read: ${redraw}`;
  const least = opacities.findIndex((count) => count > 0);
  if (least < 255) {
    return `the App Store icon ${ICON_SET}/${entry.filename} has see-through pixels (the least opaque is ${least} of 255), which App Store Connect refuses after the whole build (90717): ${redraw}`;
  }
  return null;
}

/**
 * What the built app says about itself: its Info.plist and its signed entitlements, each as JSON, and the same for each
 * app extension inside it.
 */
export type IpaFacts = {
  info: Record<string, unknown>;
  entitlements: Record<string, unknown>;
  extensions?: { info: Record<string, unknown>; entitlements: Record<string, unknown> }[];
};

/** The App Groups a signature allows. */
const signedGroups = (entitlements: Record<string, unknown>) => {
  const groups = entitlements['com.apple.security.application-groups'];
  return Array.isArray(groups) ? groups.map(String) : [];
};

/** Whether a signature allows Time Sensitive Notifications. */
const signedTimeSensitive = (entitlements: Record<string, unknown>) => entitlements[TIME_SENSITIVE_ENTITLEMENT] === true;

/**
 * Each reason the build must not go up, or none. `targets` are the Xcode project's, whose App Groups each signature must
 * allow: an extension signed without its group installs, and its share sheet entry cannot hand anything to the app. So
 * must Time Sensitive Notifications where a target asks for it, or iOS shows a time-sensitive alert as a plain one and
 * a Focus holds it back.
 */
export function ipaProblems(
  facts: IpaFacts,
  buildNumber: number,
  targets: XcodeTargets = { app: null, extensions: [] },
  encryptionHint = 'put it in src-tauri/Info.ios.plist',
): string[] {
  const problems: string[] = [];
  const { info, entitlements } = facts;
  const lacking = (signed: Record<string, unknown>, asked: string[]) => asked.filter((group) => !signedGroups(signed).includes(group));
  const appLacks = lacking(entitlements, targets.app?.groups ?? []);
  if (appLacks.length) problems.push(`its signature lacks the App Group ${appLacks.join(', ')} its entitlements ask for`);
  if (targets.app?.timeSensitive && !signedTimeSensitive(entitlements)) problems.push('its signature lacks Time Sensitive Notifications, which its entitlements ask for');
  for (const target of targets.extensions) {
    const built = facts.extensions?.find((extension) => extension.info.CFBundleIdentifier === target.bundleId);
    if (!built) {
      problems.push(`it holds no app extension ${target.bundleId}, which the Xcode project builds`);
      continue;
    }
    const lacks = lacking(built.entitlements, target.groups);
    if (lacks.length) problems.push(`its extension ${target.bundleId}'s signature lacks the App Group ${lacks.join(', ')} its entitlements ask for`);
    if (target.timeSensitive && !signedTimeSensitive(built.entitlements)) {
      problems.push(`its extension ${target.bundleId}'s signature lacks Time Sensitive Notifications, which its entitlements ask for`);
    }
  }
  if (info.CFBundleVersion !== String(buildNumber)) {
    problems.push(`its CFBundleVersion is ${String(info.CFBundleVersion)}, not the build number ${buildNumber}`);
  }
  if (info.ITSAppUsesNonExemptEncryption !== false) {
    problems.push(
      `its Info.plist does not say ITSAppUsesNonExemptEncryption false, so App Store Connect would hold every build on the export question: ${encryptionHint}`,
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
  /** The home folder whose keychains and profile folders Tauri and Xcode use. */
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
  const run = options.run ?? runCommand;
  const home = options.home ?? homedir();
  const output = options.output ?? ((chunk: string) => void process.stdout.write(chunk));
  const build: BuildStarted = { started: false };
  const onSignal = (signal: NodeJS.Signals) => {
    say(`stopped by ${signal}; stopping the programs it started and removing the key`);
    stopRunning('SIGTERM');
    for (const cleanup of cleanups) {
      cleanups.delete(cleanup);
      cleanup();
    }
    stopRunning('SIGKILL');
    // After the build is stopped for good, so it cannot write the app again.
    if (build.started) removeAppsNow(iphoneApps(options.cwd, home));
    process.exit(1);
  };
  for (const signal of STOP_SIGNALS) process.on(signal, onSignal);
  try {
    await sweepGoneCheckouts(home, run, output);
    return await (isNativeFolder(options.cwd) ? nativeUploadSteps : uploadSteps)(options, build);
  } finally {
    for (const signal of STOP_SIGNALS) process.off(signal, onSignal);
    if (build.started) await removeApps(iphoneApps(options.cwd, home), run, output);
  }
}

/** What every step of an upload, the Tauri one's or a native app's, reads from its options. */
type Steps = {
  cwd: string;
  tokenOnly: boolean;
  run: Run;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  print: (line: string) => void;
  say: (line: string) => void;
  fail: (line: string) => 1;
  output: (chunk: string) => void;
  env: Env;
  git: (...args: string[]) => Promise<{ ok: boolean; out: string }>;
};

function steps(options: UploadOptions): Steps {
  const { cwd, tokenOnly } = options;
  const run = options.run ?? runCommand;
  const say = options.fail ?? ((line: string) => console.error(`[testflight] ${line}`));
  const env = buildEnv(options.env ?? process.env, options.home);
  return {
    cwd,
    tokenOnly,
    run,
    now: options.now ?? Date.now,
    sleep: options.sleep ?? ((ms: number) => Bun.sleep(ms)),
    print: options.print ?? ((line: string) => console.log(`[testflight] ${line}`)),
    say,
    fail: (line: string): 1 => {
      say(line);
      return 1;
    },
    output: options.output ?? ((chunk: string) => void process.stdout.write(chunk)),
    env,
    git: async (...args: string[]) => {
      const done = await run(['git', ...args], { cwd, env });
      return { ok: done.code === 0, out: done.out.trim() };
    },
  };
}

/** HEAD, when it is a commit of main's first-parent line in a clean tree, which a build number may name; else why not. */
async function commitToBuild({ cwd, git }: Steps): Promise<{ head: string } | { error: string }> {
  const status = await git('status', '--porcelain');
  if (!status.ok) return { error: `${cwd} is not a git checkout` };
  if (status.out) return { error: 'commit first: the build number names a commit, and the tree has uncommitted changes' };
  const head = (await git('rev-parse', 'HEAD')).out;
  const main = await git('rev-list', '--first-parent', 'origin/main');
  if (!main.ok || !main.out.split('\n').includes(head)) {
    return {
      error: `HEAD (${head.slice(0, 7)}) is not a commit on origin/main's first-parent line: a build number names one, and a number from a branch makes Apple refuse main's lower ones. Fetch, and check out main.`,
    };
  }
  return { head };
}

async function uploadSteps(options: UploadOptions, started: BuildStarted): Promise<0 | 1 | 3> {
  const context = steps(options);
  const { cwd, tokenOnly, run, now, print, say, fail, output, env, git } = context;
  const plistValue = async (text: string, key: string) => {
    const done = await run(['plutil', '-extract', key, 'raw', '-'], { cwd, env, input: text });
    return done.code === 0 ? done.out.trim() : null;
  };

  const commit = await commitToBuild(context);
  if ('error' in commit) return fail(commit.error);
  const { head } = commit;

  const icon = appStoreIconProblem(cwd);
  if (icon) return fail(icon);
  const tauriCli = tauriCliProblem(cwd);
  if (tauriCli) return fail(tauriCli);
  const identifier = bundleIdentifier(cwd);
  if (!identifier) return fail('src-tauri/tauri.conf.json names no identifier, the bundle id the App Store profile is for');
  // The app's target and its app extensions, from the committed Xcode project, which Tauri keeps as it is.
  const projectFile = xcodeProjectFile(cwd);
  const project = projectFile?.match(/([^/]+)\.xcodeproj\/project\.pbxproj$/)?.[1];
  const erasing = project ? deepLinkProblem(cwd, project) : null;
  if (erasing) return fail(erasing);
  const targetsRead: XcodeTargets | { error: string } = projectFile ? await xcodeTargets(cwd, projectFile, run, env) : { app: null, extensions: [] };
  if ('error' in targetsRead) return fail(targetsRead.error);
  const targets = targetsRead;

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
  const certificateRead = await readCertificate(run, env, { tokenOnly });
  if ('missing' in certificateRead) return fail(`the vault "${VAULT}" has no "${CERTIFICATE_ITEM}", which the build signs with: ${MAKE_CERTIFICATE}`);
  if ('error' in certificateRead) return fail(certificateRead.error);
  const certificate = certificateRead.certificate;
  const appStoreConnect = new AppStoreConnect(key, options.appStoreConnect);
  const signing = await signingFiles(certificate, identifier, targets, appStoreConnect, run, env, now);
  if (typeof signing === 'string') return fail(signing);
  const profileUuids = [signing.profile.uuid, ...signing.extensions.map((extension) => extension.profile.uuid)];

  // The committed values of what Tauri writes, to put back after. ls-files names each file from the folder it runs in,
  // and `HEAD:./` reads it from there too, so a Tauri project in a subfolder of its repository is put back as well.
  const tracked = (await git('ls-files', '--', 'src-tauri/gen/apple')).out.split('\n');
  const restores: { file: string; key: string; wrote: string; committed: string }[] = [];
  const projects = tracked.filter((file) => XCODE_PROJECT.test(file)).map((file) => ({ file, before: readFileSync(join(cwd, file), 'utf8') }));
  // An extension's signing is written into the project for the build, so it must be one put back after.
  if (signing.extensions.length && !projects.some((project) => project.file === projectFile)) {
    return fail(`${projectFile} is not committed, so the signing written into it for the app extensions could not be put back: commit it`);
  }
  for (const file of tracked) {
    const plistKey = file === EXPORT_OPTIONS ? 'method' : INFO_PLIST.test(file) ? 'CFBundleVersion' : null;
    if (!plistKey) continue;
    const committed = await plistValue((await git('show', `HEAD:./${file}`)).out, plistKey);
    const wrote = plistKey === 'method' ? 'app-store-connect' : String(buildNumber);
    if (committed !== null) restores.push({ file, key: plistKey, wrote, committed });
  }

  // One signing build on a Mac at a time: two Tauri builds signing at once drop each other's keychain from the list.
  const home = options.home ?? homedir();
  const signingLock = join(home, 'Library/Caches/app-kit/testflight-signing.lock');
  if (!lock(signingLock)) return fail(`another signing build is running on this Mac (its process id is in ${signingLock}); try again once it ends`);
  const changedProjects: string[] = [];
  const profileFilesBefore = tauriProfileFiles(home);
  // The folder first on the build's PATH: Apple's rsync, and the security that writes down Tauri's keychain.
  const tools = mkdtempSync(join(tmpdir(), 'app-kit-testflight-tools-'));
  const putBack = cleanupOnStop(() => {
    deleteRecordedKeychains(tools);
    rmSync(tools, { recursive: true, force: true });
    for (const r of restores) {
      const path = join(cwd, r.file);
      if (existsSync(path)) writeFileSync(path, restoreValue(readFileSync(path, 'utf8'), r.key, r.wrote, r.committed));
    }
    for (const project of projects) {
      const path = join(cwd, project.file);
      if (!existsSync(path)) continue;
      const text = projectToPutBack(project.before, readFileSync(path, 'utf8'), { team: signing.team, profileUuids });
      if (text === null) changedProjects.push(project.file);
      else writeFileSync(path, text);
    }
    removeTauriProfileCopy(home, signing.profile.content, profileFilesBefore);
    if (existsSync(signingLock) && readFileSync(signingLock, 'utf8') === String(process.pid)) rmSync(signingLock, { force: true });
  });
  try {
    installProfile(home, signing.profile.uuid, signing.profile.content);
    symlinkSync('/usr/bin/rsync', join(tools, 'rsync'));
    writeSecurityRecorder(tools);
    if (signing.extensions.length && projectFile) {
      // Each extension signs by hand with its own profile, as Tauri signs the app; put back after with the app's lines.
      const path = join(cwd, projectFile);
      let text: string | null = readFileSync(path, 'utf8');
      for (const { target, profile } of signing.extensions) {
        installProfile(home, profile.uuid, profile.content);
        text = text && withBuildSettings(text, target.configurations, extensionSigningSettings({ identity: signing.name, team: signing.team, profileUuid: profile.uuid }));
      }
      if (text === null) return fail(`could not find the app extensions' build settings in ${projectFile} to write their signing into`);
      writeFileSync(path, text);
      writeXcodebuildStandIn(
        tools,
        signing.extensions.map(({ target, profile }) => ({ bundleId: target.bundleId, profileUuid: profile.uuid })),
      );
    }
    print(`building build ${buildNumber} (${short})`);
    const config = JSON.stringify({ bundle: { iOS: { bundleVersion: String(buildNumber) } } });
    started.started = true;
    const built = await run(['bunx', 'tauri', 'ios', 'build', '--ci', '--export-method', 'app-store-connect', '--config', config], {
      cwd,
      env: {
        ...env,
        PATH: `${tools}:${env.PATH}`,
        IOS_CERTIFICATE: certificate.p12,
        IOS_CERTIFICATE_PASSWORD: certificate.password,
        IOS_MOBILE_PROVISION: signing.profile.content,
      },
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
    if (changedProjects.length) {
      say(`the build changed ${changedProjects.join(', ')} beyond its signing settings, so it is left as the build wrote it: look at git diff, and put it back or commit it`);
    }
  }
  if (changedProjects.length) return 1;

  const ipaFolder = join(cwd, IPA_FOLDER);
  const ipaName = existsSync(ipaFolder) ? readdirSync(ipaFolder).find((name) => name.endsWith('.ipa')) : undefined;
  if (!ipaName) return fail(`the build made no .ipa in ${IPA_FOLDER}`);
  const ipa = join(ipaFolder, ipaName);

  const facts = await readIpa(ipa, run, env);
  if (typeof facts === 'string') return fail(facts);
  const problems = ipaProblems(facts, buildNumber, targets);
  if (problems.length) return fail(`${ipaName} must not go up: ${problems.join('; ')}`);
  const bundleId = String(facts.info.CFBundleIdentifier ?? '');

  return await uploadAndWait(context, options, { ipa, key, appStoreConnect, bundleId, buildNumber, short, altoolType: 'ios', platform: 'IOS' });
}

/**
 * The upload of a native Xcode app (native.ts says what is read from it and why): the project generated by XcodeGen,
 * archived and exported by xcodebuild, signed by hand from a keychain of its own with the certificate and the
 * platform's App Store profile, written into the generated project, which git ignores and the next run makes again, so
 * nothing is put back. The build, its archive and its export are made in a temporary folder, deleted after with every
 * app in it forgotten by macOS.
 */
async function nativeUploadSteps(options: UploadOptions, started: BuildStarted): Promise<0 | 1 | 3> {
  const context = steps(options);
  const { cwd, tokenOnly, run, now, print, say, fail, output, env, git } = context;
  const commit = await commitToBuild(context);
  if ('error' in commit) return fail(commit.error);
  const { head } = commit;
  const project = nativeProject(cwd);
  if ('error' in project) return fail(project.error);
  const { platform, bundleId } = project;
  const xcodegen = await run(['xcodegen', '--version'], { cwd, env });
  if (xcodegen.code !== 0) return fail('the project is generated by XcodeGen, which is not on PATH: brew install xcodegen');
  const xcodeProject = `${project.name}.xcodeproj`;
  if ((await git('ls-files', '--', xcodeProject)).out) {
    return fail(`${xcodeProject} is committed, and the upload writes its signing into the project it generates: have git ignore it, as XcodeGen's project is made from ${PROJECT_YML}`);
  }
  const generated = await run(['xcodegen', 'generate'], { cwd, env, output });
  if (generated.code !== 0) return fail(`xcodegen generate failed: ${lastLine(generated.out)}`);
  // What it changed of the commit, and what it wrote that git does not ignore, which would leave the next run's tree unclean.
  const changed = [(await git('diff', '--name-only', 'HEAD')).out, (await git('ls-files', '--others', '--exclude-standard')).out].filter(Boolean).join('\n');
  if (changed) {
    return fail(`xcodegen generate changed or wrote files git does not ignore (${changed.split('\n').join(', ')}), so the build would not be the commit's: have git ignore what it writes, or commit it`);
  }
  if (project.infoPlist) {
    const version = await run(['plutil', '-extract', 'CFBundleVersion', 'raw', project.infoPlist], { cwd, env });
    const problem = buildNumberProblem(project, version.code === 0 ? version.out.trim() : null);
    if (problem) return fail(problem);
  }
  const icon = nativeIconProblem(cwd, project);
  if (icon) return fail(icon);
  const projectFile = `${xcodeProject}/project.pbxproj`;
  const targetsRead = await xcodeTargets(cwd, projectFile, run, env, project.target);
  if ('error' in targetsRead) return fail(targetsRead.error);
  const app = targetsRead.app;
  if (!app) return fail(`${projectFile} has no app target named ${project.target}, which ${PROJECT_YML} names`);
  if (targetsRead.extensions.length) return fail(`${projectFile} has the app extension ${targetsRead.extensions.map((target) => target.name).join(', ')}, and the upload signs a native app's own target alone`);
  const targets: XcodeTargets = { app, extensions: [] };

  const buildNumber = Number((await git('rev-list', '--count', 'HEAD')).out);
  const short = head.slice(0, 7);

  const keyRead = await readKey(run, env, { tokenOnly });
  if ('missing' in keyRead) {
    return fail(`waiting for the 1Password token: the login keychain has no "app-kit testflight" item (app-kit's README, TestFlight, says how to add it)`);
  }
  if ('error' in keyRead) return fail(keyRead.error);
  const key = keyRead.key;
  const certificateRead = await readCertificate(run, env, { tokenOnly });
  if ('missing' in certificateRead) return fail(`the vault "${VAULT}" has no "${CERTIFICATE_ITEM}", which the build signs with: ${MAKE_CERTIFICATE}`);
  if ('error' in certificateRead) return fail(certificateRead.error);
  const certificate = certificateRead.certificate;
  const appStoreConnect = new AppStoreConnect(key, options.appStoreConnect);
  const signing = await signingFiles(certificate, bundleId, targets, appStoreConnect, run, env, now, platform.profileType);
  if (typeof signing === 'string') return fail(signing);

  // One signing build on a Mac at a time: it puts its keychain on the list, as a Tauri build does.
  const home = options.home ?? homedir();
  const signingLock = join(home, 'Library/Caches/app-kit/testflight-signing.lock');
  if (!lock(signingLock)) return fail(`another signing build is running on this Mac (its process id is in ${signingLock}); try again once it ends`);
  const folder = mkdtempSync(join(tmpdir(), 'app-kit-testflight-native-'));
  const keychain = join(folder, 'signing.keychain-db');
  let keychainMade = false;
  const putBack = cleanupOnStop(() => {
    if (keychainMade) {
      const left = deleteKeychain(keychain);
      if (left) say(left);
    }
    // After the build is stopped for good, so it cannot write the app again.
    if (started.started) removeAppsNow(appsBelow(folder));
    rmSync(folder, { recursive: true, force: true });
    if (existsSync(signingLock) && readFileSync(signingLock, 'utf8') === String(process.pid)) rmSync(signingLock, { force: true });
  });
  let ipa: string;
  try {
    const security = async (...args: string[]) => {
      const done = await run(['/usr/bin/security', ...args], { cwd, env });
      return done.code === 0 ? null : `security ${args[0]} failed: ${lastLine(done.out)}`;
    };
    const password = randomBytes(24).toString('hex');
    const p12 = join(folder, 'certificate.p12');
    writeFileSync(p12, Buffer.from(certificate.p12, 'base64'), { mode: 0o600 });
    keychainMade = true;
    const listed = await run(['/usr/bin/security', 'list-keychains', '-d', 'user'], { cwd, env });
    if (listed.code !== 0) return fail(`security could not list the keychains: ${lastLine(listed.out)}`);
    const madeKeychain =
      (await security('create-keychain', '-p', password, keychain)) ??
      (await security('set-keychain-settings', '-lut', '3600', keychain)) ??
      (await security('unlock-keychain', '-p', password, keychain)) ??
      (await security('import', p12, '-k', keychain, '-P', certificate.password, '-T', '/usr/bin/codesign', '-T', '/usr/bin/security')) ??
      (await security('set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain)) ??
      (await security('list-keychains', '-d', 'user', '-s', keychain, ...listedKeychains(listed.stdout).filter((path) => path !== keychain)));
    rmSync(p12, { force: true });
    if (madeKeychain) return fail(madeKeychain);
    installProfile(home, signing.profile.uuid, signing.profile.content);
    const signedWith = { identity: signing.name, team: signing.team, profileUuid: signing.profile.uuid };
    const projectPath = join(cwd, projectFile);
    const signed = withBuildSettings(readFileSync(projectPath, 'utf8'), app.configurations, nativeSigningSettings(platform, { ...signedWith, keychain }));
    if (signed === null) return fail(`could not find ${project.target}'s build settings in ${projectFile} to write its signing into`);
    writeFileSync(projectPath, signed);
    // The export copies with rsync and passes options only Apple's accepts, as the Tauri path's does.
    const tools = join(folder, 'tools');
    mkdirSync(tools);
    symlinkSync('/usr/bin/rsync', join(tools, 'rsync'));
    const buildEnv = { ...env, PATH: `${tools}:${env.PATH}` };

    print(`building build ${buildNumber} (${short})`);
    started.started = true;
    const archive = join(folder, `${project.target}.xcarchive`);
    const archived = await run(
      [
        'xcodebuild', 'archive', '-project', xcodeProject, '-scheme', project.target, '-configuration', 'Release',
        '-sdk', platform.sdk, '-destination', `generic/platform=${platform.name}`, '-archivePath', archive,
        '-derivedDataPath', join(folder, 'derived-data'), `CURRENT_PROJECT_VERSION=${buildNumber}`,
      ],
      { cwd, env: buildEnv, output },
    );
    if (archived.code !== 0) {
      if (compileFailed(archived.out)) {
        say(`build ${buildNumber} (${short}) did not compile: ${lastLine(archived.out)}`);
        return 3;
      }
      return fail(`the build of ${buildNumber} (${short}) failed: ${lastLine(archived.out)}`);
    }
    const exportPlist = join(folder, 'ExportOptions.plist');
    writeFileSync(exportPlist, exportOptions({ ...signedWith, bundleId }));
    const exportFolder = join(folder, 'export');
    const exported = await run(['xcodebuild', '-exportArchive', '-archivePath', archive, '-exportPath', exportFolder, '-exportOptionsPlist', exportPlist], {
      cwd,
      env: buildEnv,
      output,
    });
    if (exported.code !== 0) return fail(`the export of build ${buildNumber} (${short}) failed: ${lastLine(exported.out)}`);
    const ipaName = existsSync(exportFolder) ? readdirSync(exportFolder).find((name) => name.endsWith('.ipa')) : undefined;
    if (!ipaName) return fail(`the export made no .ipa`);
    ipa = join(exportFolder, ipaName);

    const facts = await readIpa(ipa, run, env);
    if (typeof facts === 'string') return fail(facts);
    const problems = ipaProblems(facts, buildNumber, targets, `put "ITSAppUsesNonExemptEncryption: false" in ${project.target}'s info.properties in ${PROJECT_YML}`);
    if (facts.info.CFBundleIdentifier !== bundleId) problems.push(`its bundle id is ${String(facts.info.CFBundleIdentifier)}, not ${bundleId}, which it was signed for`);
    if (problems.length) return fail(`${ipaName} must not go up: ${problems.join('; ')}`);
    // The archive's apps are done with; the .ipa stays for the upload.
    await removeApps(appsBelow(folder), run, output);
    return await uploadAndWait(context, options, { ipa, key, appStoreConnect, bundleId, buildNumber, short, altoolType: platform.altoolType, platform: platform.appStorePlatform });
  } finally {
    if (started.started) await removeApps(appsBelow(folder), run, output);
    putBack();
  }
}

/**
 * Uploads the checked .ipa and waits for Apple's processing: 0 once it is processed, or when App Store Connect already
 * held the number and has processed it; 1 when altool refuses, processing fails, or it takes longer than the limit.
 */
async function uploadAndWait(
  { run, now, sleep, print, fail, output, env }: Steps,
  options: UploadOptions,
  sent: { ipa: string; key: TestFlightKey; appStoreConnect: AppStoreConnect; bundleId: string; buildNumber: number; short: string; altoolType: 'ios' | 'appletvos'; platform: AppStorePlatform },
): Promise<0 | 1> {
  const { ipa, key, appStoreConnect, bundleId, buildNumber, short } = sent;
  print(`uploading build ${buildNumber} (${short})`);
  const uploaded = await altoolUpload(ipa, key, run, env, output, sent.altoolType);
  if (uploaded === 'already') print(`build ${buildNumber} is already uploaded; waiting for Apple's processing`);
  else if (uploaded !== 'uploaded') return fail(`altool did not upload build ${buildNumber}: ${uploaded}`);

  const limit = options.processingLimitMs ?? PROCESSING_LIMIT_MS;
  const until = now() + limit;
  let seen = 'not listed yet';
  let appId: string | null = null;
  while (true) {
    try {
      appId ??= await appStoreConnect.appId(bundleId);
      if (!appId) return fail(`no app in App Store Connect has the bundle id ${bundleId}: its record is made once, by hand (app-kit's README, TestFlight)`);
      const build = await appStoreConnect.build(appId, String(buildNumber), sent.platform);
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

/** What a target's entitlements ask for that its profile does not allow: App Groups, and Time Sensitive Notifications. */
type Lacks = { groups: string[]; timeSensitive: boolean };

/** A target's App Store profile, or what the profile for it lacks, or why there is none. */
type TargetProfile = { profile: Profile } | { lacks: Lacks } | { error: string };

/**
 * The profile `target` signs with: an active one for its bundle id and the certificate that allows every App Group its
 * entitlements ask for, and Time Sensitive Notifications when they ask for it, else one made when it has no active one.
 * When active ones exist and none allows them, or the one made does not, Apple's record of the App ID lacks the group or
 * the capability, which only a person can add on the developer site; nothing more is made, and nothing is deleted.
 * Adding it changes the App ID, which makes Apple mark every profile for it invalid, so the next upload makes one that
 * allows it.
 */
async function targetProfile(
  appStoreConnect: AppStoreConnect,
  target: { bundleId: string; groups: string[]; timeSensitive: boolean; extension: boolean },
  certificate: CertificateRecord,
  profileType: ProfileType = 'IOS_APP_STORE',
): Promise<TargetProfile> {
  const { bundleId: identifier, groups, timeSensitive } = target;
  let bundleId = await appStoreConnect.bundleId(identifier);
  if (!bundleId && !target.extension) {
    return { error: `the team has no bundle id ${identifier}: register it on Apple's developer site (Certificates, Identifiers & Profiles, Identifiers), with the capabilities the app uses` };
  }
  if (!bundleId) {
    try {
      bundleId = await appStoreConnect.createBundleId(identifier);
    } catch (error) {
      if (!(error instanceof AppStoreConnectError)) throw error;
      return {
        error: `Apple refused registering the app extension's bundle id ${identifier} (${error.message}): register it once on Apple's developer site (Certificates, Identifiers & Profiles, Identifiers, +, App IDs, App, its description and the explicit bundle id ${identifier}, Continue, Register), and the next upload uses it`,
      };
    }
  }
  const lacks = (profile: Profile): Lacks => ({
    groups: groups.filter((group) => !profileGroups(profile.content).includes(group)),
    timeSensitive: timeSensitive && !profileTimeSensitive(profile.content),
  });
  const allows = (profile: Profile) => {
    const lacking = lacks(profile);
    return lacking.groups.length === 0 && !lacking.timeSensitive;
  };
  const active = await appStoreConnect.appStoreProfiles(bundleId, certificate.id, profileType);
  const fitting = active.find(allows);
  if (fitting) return { profile: fitting };
  if (active.length) return { lacks: lacks(active[0]!) };
  let made: Profile;
  try {
    made = await appStoreConnect.createAppStoreProfile(bundleId, identifier, certificate.id, profileType);
  } catch (error) {
    if (error instanceof AppStoreConnectError && error.status === 403) {
      return {
        error: `Apple refused the key making the App Store profile for ${identifier}: make it once on Apple's developer site (Profiles, +, App Store Connect${profileType === 'TVOS_APP_STORE' ? ', tvOS' : ''}, ${identifier}, the certificate expiring ${certificate.expires?.slice(0, 10) ?? 'latest'}), and the next upload fetches it`,
      };
    }
    throw error;
  }
  return allows(made) ? { profile: made } : { lacks: lacks(made) };
}

/**
 * What a person does on Apple's developer site so each App ID's profile allows its App Groups and Time Sensitive
 * Notifications, which Apple's API cannot do, as one line: the watcher keeps only the upload's last line in its log.
 */
export function capabilitySteps(lacking: ({ bundleId: string } & Lacks)[]): string {
  const parts: string[] = [];
  const grouped = lacking.filter((target) => target.groups.length > 0);
  if (grouped.length) {
    const groups = [...new Set(grouped.flatMap((target) => target.groups))];
    const assign = grouped.map((target) => `${target.bundleId} (tick App Groups, Configure, tick ${target.groups.join(' and ')}, Continue, Assign, Done, Save, Confirm)`);
    parts.push(
      `the App Store profile for ${grouped.map((target) => target.bundleId).join(' and ')} lacks the App Group ${groups.join(' and ')}, which Apple's API cannot add: ` +
        `on Apple's developer site, Certificates, Identifiers & Profiles, Identifiers, choose App Groups in the menu at the right, and if ${groups.join(' or ')} is not listed, ` +
        `+, App Groups, Continue, a description and the identifier, Continue, Register; then choose App IDs in that menu and open ` +
        assign.join(', then '),
    );
  }
  const sensitive = lacking.filter((target) => target.timeSensitive).map((target) => target.bundleId);
  if (sensitive.length) {
    parts.push(
      `the App Store profile for ${sensitive.join(' and ')} lacks Time Sensitive Notifications, which Apple's API cannot switch on: ` +
        `on Apple's developer site, Certificates, Identifiers & Profiles, Identifiers, App IDs, open ` +
        sensitive.map((bundleId) => `${bundleId} (tick Time Sensitive Notifications, Save, Confirm)`).join(', then '),
    );
  }
  return `${parts.join('; and ')}; then run the upload again, which makes profiles that allow it`;
}

/**
 * The App Store profile the app signs with, and each extension's, after checking the certificate against Apple's record
 * of it; or why the build cannot sign. A missing App Group is told for every target at once, so one visit to the
 * developer site settles them all.
 */
async function signingFiles(
  certificate: Certificate,
  identifier: string,
  targets: XcodeTargets,
  appStoreConnect: AppStoreConnect,
  run: Run,
  env: Env,
  now: () => number,
  profileType: ProfileType = 'IOS_APP_STORE',
): Promise<{ profile: Profile; extensions: { target: XcodeTarget; profile: Profile }[]; team: string; name: string } | string> {
  const folder = mkdtempSync(join(tmpdir(), 'app-kit-testflight-certificate-'));
  const remove = cleanupOnStop(() => rmSync(folder, { recursive: true, force: true }));
  let facts: Awaited<ReturnType<typeof certificateFacts>>;
  try {
    facts = await certificateFacts(certificate, folder, run, env);
  } finally {
    remove();
  }
  if ('error' in facts) return facts.error;
  const { team, name } = facts;
  try {
    const record = await appStoreConnect.distributionCertificate(facts.serial);
    if (!record) return `Apple lists no distribution certificate with the serial number of the one in 1Password, so it was revoked or is another team's: ${MAKE_CERTIFICATE}`;
    if (record.expires && Date.parse(record.expires) <= now()) return `the distribution certificate expired on ${record.expires.slice(0, 10)}: ${MAKE_CERTIFICATE}`;
    const asked = { bundleId: identifier, groups: targets.app?.groups ?? [], timeSensitive: targets.app?.timeSensitive ?? false, extension: false };
    const app = await targetProfile(appStoreConnect, asked, record, profileType);
    if ('error' in app) return app.error;
    const lacking: ({ bundleId: string } & Lacks)[] = 'lacks' in app ? [{ bundleId: identifier, ...app.lacks }] : [];
    const extensions: { target: XcodeTarget; profile: Profile }[] = [];
    for (const target of targets.extensions) {
      const found = await targetProfile(appStoreConnect, { ...target, extension: true }, record);
      if ('error' in found) return found.error;
      if ('lacks' in found) lacking.push({ bundleId: target.bundleId, ...found.lacks });
      else extensions.push({ target, profile: found.profile });
    }
    if (lacking.length || !('profile' in app)) return capabilitySteps(lacking);
    return { profile: app.profile, extensions, team, name };
  } catch (error) {
    return `App Store Connect could not give the signing profiles for ${identifier}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** The built app's Info.plist and entitlements, and each extension's, or why they could not be read. */
async function readIpa(ipa: string, run: Run, env: Env): Promise<IpaFacts | string> {
  const folder = mkdtempSync(join(tmpdir(), 'app-kit-testflight-ipa-'));
  const remove = cleanupOnStop(() => rmSync(folder, { recursive: true, force: true }));
  try {
    const unzipped = await run(['unzip', '-q', '-o', ipa, '-d', folder], { env });
    if (unzipped.code !== 0) return `could not unzip ${ipa}: ${lastLine(unzipped.out)}`;
    const payload = join(folder, 'Payload');
    const app = existsSync(payload) ? readdirSync(payload).find((name) => name.endsWith('.app')) : undefined;
    if (!app) return `${ipa} holds no app in Payload/`;
    const json = async (file: string) => {
      if (!existsSync(file)) return {};
      const done = await run(['plutil', '-convert', 'json', '-o', '-', file], { env });
      return done.code === 0 ? (JSON.parse(done.out) as Record<string, unknown>) : null;
    };
    const bundleFacts = async (bundle: string, name: string, at: number) => {
      const entitlementsFile = join(folder, `entitlements-${at}.plist`);
      const signed = await run(['codesign', '-d', '--entitlements', entitlementsFile, '--xml', bundle], { env });
      if (signed.code !== 0) return `codesign could not read ${name}'s entitlements: ${lastLine(signed.out)}`;
      const info = await json(join(bundle, 'Info.plist'));
      const entitlements = await json(entitlementsFile);
      if (!info || !entitlements) return `could not read ${name}'s Info.plist or entitlements`;
      return { info, entitlements };
    };
    const facts = await bundleFacts(join(payload, app), app, 0);
    if (typeof facts === 'string') return facts;
    const plugIns = join(payload, app, 'PlugIns');
    const extensions: NonNullable<IpaFacts['extensions']> = [];
    for (const name of existsSync(plugIns) ? readdirSync(plugIns).filter((entry) => entry.endsWith('.appex')).sort() : []) {
      const extension = await bundleFacts(join(plugIns, name), name, extensions.length + 1);
      if (typeof extension === 'string') return extension;
      extensions.push(extension);
    }
    return { ...facts, extensions };
  } finally {
    remove();
  }
}

/**
 * Why altool refused: its ERROR lines, without their time and without the "ExitFailure" line that ends every refusal and
 * says nothing of why, else its last line.
 */
export function altoolRefusal(out: string): string {
  const errors = out
    .split('\n')
    .map((line) => line.trim().replace(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d+)? /, ''))
    .filter((line) => /\bERROR\b/.test(line) && !/^ERROR: \[altool\.main\] ExitFailure\b/.test(line));
  return errors.length ? errors.join(' ') : lastLine(out);
}

/**
 * Uploads with altool, which finds the key file in API_PRIVATE_KEYS_DIR: a folder of its own, for the length of the
 * upload only. 'uploaded', 'already' when App Store Connect holds the number, or altool's refusal.
 */
async function altoolUpload(ipa: string, key: TestFlightKey, run: Run, env: Env, output: (chunk: string) => void, type: 'ios' | 'appletvos' = 'ios'): Promise<string> {
  const keys = mkdtempSync(join(tmpdir(), 'app-kit-testflight-key-'));
  const remove = cleanupOnStop(() => rmSync(keys, { recursive: true, force: true }));
  try {
    writeFileSync(join(keys, `AuthKey_${key.keyId}.p8`), `${key.privateKey}\n`, { mode: 0o600 });
    const done = await run(['xcrun', 'altool', '--upload-app', '--type', type, '--file', ipa, '--apiKey', key.keyId, '--apiIssuer', key.issuerId], {
      env: { ...env, API_PRIVATE_KEYS_DIR: keys },
      output,
    });
    if (alreadyUploaded(done.out)) return 'already';
    // altool has exited 0 while printing an error, so its own word counts too.
    if (done.code === 0 && !/\bERROR\b[^\n]*ITMS-|UPLOAD FAILED/.test(done.out)) return 'uploaded';
    return altoolRefusal(done.out);
  } finally {
    remove();
  }
}
