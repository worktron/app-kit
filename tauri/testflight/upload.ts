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
 *   fails with "Copy failed", so a folder holding a link to /usr/bin/rsync goes first on PATH.
 * - Tauri passes FORCE_COLOR into the Xcode build step as a flag, where a terminal's FORCE_COLOR=3 reads as a chip
 *   architecture, so it is removed, with the key, by the build environment every iPhone build shares (../build-env.ts).
 * - App Store Connect refuses an App Store icon with a pixel that is not fully opaque (90717), and altool says so only
 *   after the whole build; `tauri icon` writes every iPhone icon with an alpha channel, metamax's with pixels at 254, so
 *   the icon's pixels are read before the build, and the refusal names `app-kit icons render`, which draws them opaque.
 * - Tauri writes the export method and the build number into tracked files; only the values it wrote are put back,
 *   so an edit made to either file during the build survives.
 *
 * Exit codes: 0 uploaded and processed (or already uploaded, then processed); 3 the app did not compile; 1 anything
 * else.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { AppStoreConnect, AppStoreConnectError, type AppStoreConnectOptions, type Profile, type TestFlightKey } from './app-store-connect.ts';
import { CERTIFICATE_ITEM, lastLine, readCertificate, readKey, VAULT, type Certificate } from './key.ts';
import { lock } from './lock.ts';
import { bundleIdentifier, certificateFacts, deleteNewTauriKeychains, installProfile, projectToPutBack, removeTauriProfileCopies, tauriCliProblem, tauriKeychains } from './signing.ts';
import { buildEnv, type Env } from '../build-env.ts';
import { runCommand, STOP_SIGNALS, stopRunning, type Run } from '../../command-line/run.ts';

export { buildEnv, STOP_SIGNALS };

export const EXPORT_OPTIONS = 'src-tauri/gen/apple/ExportOptions.plist';
const INFO_PLIST = /^src-tauri\/gen\/apple\/[^/]+_iOS\/Info\.plist$/;
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

/** Each colour type's samples per pixel: grey, colour, palette, grey with alpha, colour with alpha. */
const PNG_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** Adam7's seven passes over an interlaced image: the first column and row of each, and its steps across and down. */
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] as const;

/**
 * How many of a PNG's pixels are at each opacity, from 0 (see-through) to 255 (opaque), a 16-bit alpha rounded down so
 * only a full one counts as 255; null when the bytes are not a PNG whose first chunk is its header, or its image data
 * cannot be read. An image with no alpha channel and no transparency chunk is opaque without being decoded; any other is
 * decoded whole: every colour type, bit depth, row filter and Adam7's interlacing, so a transparency only an unused
 * palette entry or colour carries counts for nothing, as on the phone.
 */
export function pngOpacities(bytes: Uint8Array): number[] | null {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (view.length < 33 || !view.subarray(0, 8).equals(signature) || view.toString('latin1', 12, 16) !== 'IHDR') return null;
  const [width, height, depth, colourType, interlace] = [view.readUInt32BE(16), view.readUInt32BE(20), view[24]!, view[25]!, view[28]!];
  const channels = PNG_CHANNELS[colourType];
  if (!channels || !width || !height || ![1, 2, 4, 8, 16].includes(depth) || interlace > 1) return null;
  let transparency: Buffer | undefined;
  const data: Buffer[] = [];
  for (let at = 8; at + 12 <= view.length; ) {
    const length = view.readUInt32BE(at);
    const type = view.toString('latin1', at + 4, at + 8);
    const body = view.subarray(at + 8, at + 8 + length);
    if (type === 'tRNS') transparency = body;
    if (type === 'IDAT') data.push(body);
    if (type === 'IEND') break;
    at += 12 + length;
  }
  // A colour key holds a two-byte value for each channel; one cut short cannot say which colour it makes see-through.
  if (transparency && (colourType === 0 || colourType === 2) && transparency.length < channels * 2) return null;
  const counts = Array.from({ length: 256 }, () => 0);
  if (colourType !== 4 && colourType !== 6 && !transparency) {
    counts[255] = width * height;
    return counts;
  }
  let pixels: Buffer;
  try {
    pixels = inflateSync(Buffer.concat(data));
  } catch {
    return null;
  }
  const max = (1 << depth) - 1;
  const bits = channels * depth;
  const step = Math.max(1, bits >> 3);
  const sample = (row: Buffer, x: number, channel: number) => {
    if (depth === 16) return row.readUInt16BE((x * channels + channel) * 2);
    if (depth === 8) return row[x * channels + channel]!;
    const bit = (x * channels + channel) * depth;
    return (row[bit >> 3]! >> (8 - depth - (bit & 7))) & max;
  };
  const key = transparency && (colourType === 0 || colourType === 2) ? Array.from({ length: channels }, (_, at) => transparency.readUInt16BE(at * 2)) : null;
  const opacity = (row: Buffer, x: number): number => {
    if (colourType === 4 || colourType === 6) {
      const alpha = sample(row, x, channels - 1);
      return depth === 16 ? Math.floor(alpha / 257) : alpha;
    }
    if (colourType === 3) return transparency![sample(row, x, 0)] ?? 255;
    return key!.every((value, channel) => sample(row, x, channel) === value) ? 0 : 255;
  };
  let at = 0;
  for (const [left, top, across, down] of interlace ? ADAM7 : [[0, 0, 1, 1] as const]) {
    const passWidth = Math.ceil((width - left) / across);
    const passHeight = Math.ceil((height - top) / down);
    if (passWidth <= 0 || passHeight <= 0) continue;
    const rowBytes = Math.ceil((passWidth * bits) / 8);
    let previous = Buffer.alloc(rowBytes);
    for (let y = 0; y < passHeight; y++, at += 1 + rowBytes) {
      if (at + 1 + rowBytes > pixels.length) return null;
      const filter = pixels[at]!;
      const row = Buffer.from(pixels.subarray(at + 1, at + 1 + rowBytes));
      for (let i = 0; i < rowBytes; i++) {
        const leftByte = i >= step ? row[i - step]! : 0;
        const up = previous[i]!;
        const upLeft = i >= step ? previous[i - step]! : 0;
        if (filter === 1) row[i] = row[i]! + leftByte;
        else if (filter === 2) row[i] = row[i]! + up;
        else if (filter === 3) row[i] = row[i]! + ((leftByte + up) >> 1);
        else if (filter === 4) {
          const guess = leftByte + up - upLeft;
          const [toLeft, toUp, toUpLeft] = [Math.abs(guess - leftByte), Math.abs(guess - up), Math.abs(guess - upLeft)];
          row[i] = row[i]! + (toLeft <= toUp && toLeft <= toUpLeft ? leftByte : toUp <= toUpLeft ? up : upLeft);
        } else if (filter !== 0) return null;
      }
      for (let x = 0; x < passWidth; x++) counts[opacity(row, x)]!++;
      previous = row;
    }
  }
  return counts;
}

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
  /** The home folder whose keychains and profile folders Tauri and Xcode use. */
  home?: string;
  /** Whether a keychain holds the certificate with this SHA-1; `security find-certificate` unless the tests stand in. */
  keychainHolds?: (path: string, sha1: string) => boolean;
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

  const icon = appStoreIconProblem(cwd);
  if (icon) return fail(icon);
  const tauriCli = tauriCliProblem(cwd);
  if (tauriCli) return fail(tauriCli);
  const identifier = bundleIdentifier(cwd);
  if (!identifier) return fail('src-tauri/tauri.conf.json names no identifier, the bundle id the App Store profile is for');

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
  const signing = await signingFiles(certificate, identifier, appStoreConnect, run, env, now);
  if (typeof signing === 'string') return fail(signing);

  // The committed values of what Tauri writes, to put back after. ls-files names each file from the folder it runs in,
  // and `HEAD:./` reads it from there too, so a Tauri project in a subfolder of its repository is put back as well.
  const tracked = (await git('ls-files', '--', 'src-tauri/gen/apple')).out.split('\n');
  const restores: { file: string; key: string; wrote: string; committed: string }[] = [];
  const projects = tracked.filter((file) => XCODE_PROJECT.test(file)).map((file) => ({ file, before: readFileSync(join(cwd, file), 'utf8') }));
  for (const file of tracked) {
    const plistKey = file === EXPORT_OPTIONS ? 'method' : INFO_PLIST.test(file) ? 'CFBundleVersion' : null;
    if (!plistKey) continue;
    const committed = await plistValue((await git('show', `HEAD:./${file}`)).out, plistKey);
    const wrote = plistKey === 'method' ? 'app-store-connect' : String(buildNumber);
    if (committed !== null) restores.push({ file, key: plistKey, wrote, committed });
  }

  // One signing build on a Mac at a time, so every keychain of Tauri's shape is this build's or one left behind.
  const home = options.home ?? homedir();
  const signingLock = join(home, 'Library/Caches/app-kit/testflight-signing.lock');
  if (!lock(signingLock)) return fail(`another signing build is running on this Mac (its process id is in ${signingLock}); try again once it ends`);
  const changedProjects: string[] = [];
  const keychainsBefore = tauriKeychains(home);
  const appleRsync = mkdtempSync(join(tmpdir(), 'app-kit-testflight-rsync-'));
  const putBack = cleanupOnStop(() => {
    rmSync(appleRsync, { recursive: true, force: true });
    for (const r of restores) {
      const path = join(cwd, r.file);
      if (existsSync(path)) writeFileSync(path, restoreValue(readFileSync(path, 'utf8'), r.key, r.wrote, r.committed));
    }
    for (const project of projects) {
      const path = join(cwd, project.file);
      if (!existsSync(path)) continue;
      const text = projectToPutBack(project.before, readFileSync(path, 'utf8'), { team: signing.team, profileUuid: signing.profile.uuid });
      if (text === null) changedProjects.push(project.file);
      else writeFileSync(path, text);
    }
    deleteNewTauriKeychains(home, keychainsBefore, signing.sha1, options.keychainHolds);
    removeTauriProfileCopies(home, signing.profile.content);
    if (existsSync(signingLock) && readFileSync(signingLock, 'utf8') === String(process.pid)) rmSync(signingLock, { force: true });
  });
  try {
    installProfile(home, signing.profile.uuid, signing.profile.content);
    symlinkSync('/usr/bin/rsync', join(appleRsync, 'rsync'));
    print(`building build ${buildNumber} (${short})`);
    const config = JSON.stringify({ bundle: { iOS: { bundleVersion: String(buildNumber) } } });
    const built = await run(['bunx', 'tauri', 'ios', 'build', '--ci', '--export-method', 'app-store-connect', '--config', config], {
      cwd,
      env: {
        ...env,
        PATH: `${appleRsync}:${env.PATH}`,
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
  const problems = ipaProblems(facts, buildNumber);
  if (problems.length) return fail(`${ipaName} must not go up: ${problems.join('; ')}`);
  const bundleId = String(facts.info.CFBundleIdentifier ?? '');

  print(`uploading build ${buildNumber} (${short})`);
  const uploaded = await altoolUpload(ipa, key, run, env, output);
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

/**
 * The App Store profile the build signs with, after checking the certificate against Apple's record of it; or why the
 * build cannot sign. The profile is made when the app has none, which Apple refuses a key whose role may not do.
 */
async function signingFiles(
  certificate: Certificate,
  identifier: string,
  appStoreConnect: AppStoreConnect,
  run: Run,
  env: Env,
  now: () => number,
): Promise<{ profile: Profile; team: string; sha1: string } | string> {
  const folder = mkdtempSync(join(tmpdir(), 'app-kit-testflight-certificate-'));
  const remove = cleanupOnStop(() => rmSync(folder, { recursive: true, force: true }));
  let facts: Awaited<ReturnType<typeof certificateFacts>>;
  try {
    facts = await certificateFacts(certificate, folder, run, env);
  } finally {
    remove();
  }
  if ('error' in facts) return facts.error;
  const { team, sha1 } = facts;
  try {
    const record = await appStoreConnect.distributionCertificate(facts.serial);
    if (!record) return `Apple lists no distribution certificate with the serial number of the one in 1Password, so it was revoked or is another team's: ${MAKE_CERTIFICATE}`;
    if (record.expires && Date.parse(record.expires) <= now()) return `the distribution certificate expired on ${record.expires.slice(0, 10)}: ${MAKE_CERTIFICATE}`;
    const bundleId = await appStoreConnect.bundleId(identifier);
    if (!bundleId) return `the team has no bundle id ${identifier}: register it on Apple's developer site (Certificates, Identifiers & Profiles, Identifiers), with the capabilities the app uses`;
    const found = await appStoreConnect.appStoreProfile(bundleId, record.id);
    if (found) return { profile: found, team, sha1 };
    try {
      return { profile: await appStoreConnect.createAppStoreProfile(bundleId, identifier, record.id), team, sha1 };
    } catch (error) {
      if (error instanceof AppStoreConnectError && error.status === 403) {
        return `Apple refused the key making the App Store profile for ${identifier}: make it once on Apple's developer site (Profiles, +, App Store Connect, ${identifier}, the certificate expiring ${record.expires?.slice(0, 10) ?? 'latest'}), and the next upload fetches it`;
      }
      throw error;
    }
  } catch (error) {
    return `App Store Connect could not give the signing profile for ${identifier}: ${error instanceof Error ? error.message : String(error)}`;
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
