/*
 * `app-kit mac release`: builds a Tauri app's Mac app from landed code, signed with the app's code signing identity,
 * signs its update with the app's update key from 1Password's TestFlight vault, and publishes it as the next numbered
 * release in the public GitHub repository the app's updater asks, where every installed copy finds it
 * (tauri/window/plugin's updates.rs). Run from the app's Tauri folder, by a person or by the Mac release watcher
 * (watch.ts) with --token-only: the keys are read through the keychain's 1Password token when it holds one, and the
 * signed-in op, which asks for Touch ID, only when it does not and the run is not token-only.
 *
 * What each check heads off:
 * - Only landed code is built: the folder must match origin/main, and HEAD be on main, so About never names a commit
 *   main lacks. The folder and HEAD are looked at again after the build, since other threads work in the same checkout
 *   and an edit during the build would ship code that never landed.
 * - A signing identity is required and the built app must carry it: a build signed ad hoc is signed differently every
 *   time, and macOS drops the app's permissions, such as Full Disk Access, at each update.
 * - The key's public half must be the config's, or every installed copy would refuse the release; and the update's
 *   signature must name the version it is published as, or an app whose config requires that would refuse it.
 * - The releases repository must be public, or the installed copies cannot read it, and writable by this gh, or the
 *   release fails only after the build. It is asked about before the last release, since gh reports a repository it
 *   cannot see as "release not found".
 * - Only gh's "release not found" means there are no releases; any other failure stops, since starting the numbers
 *   again below what is installed would leave every copy where it is.
 * - The archive is published under a name GitHub keeps as it is (app.ts, assetName), so latest.json's address matches.
 * - The identity may be the certificate's SHA-1 fingerprint, as codesign takes it, so an app's config need not commit a
 *   certificate's name, which for a Developer ID holds a person's name. The keychain's listing gives the name for it,
 *   and the build must then be signed by exactly that certificate. Nothing printed names the certificate.
 * - A Developer ID build is notarized, since macOS blocks one that is not on any other Mac and Messages Service's
 *   installer refuses it. Tauri's build notarizes and staples when it is given the team's App Store Connect key
 *   (testflight/key.ts), but only warns when it is not, and ignores a failed staple, so the archive about to go up is
 *   unpacked and must be stapled and called notarized by Gatekeeper before anything is published.
 * - Apple sign-in and certificate variables a shell may hold are taken out, since Tauri prefers them to the key.
 * - The releases repository is public, so the build rewrites this Mac's folder paths out of the program, and the app in
 *   the archive about to go up, with its bundled page, is searched for any left before anything is published
 *   (build-paths.ts says what the rewrite reaches and what it cannot).
 *
 * The update key reaches only Tauri's build, through its environment, never a command line or a file. The App Store
 * Connect key is the one exception: Tauri reads it only from a file, so it is written readable by this user alone into
 * a folder of its own, named for this process, removed however the build ends; a release that notarizes also removes
 * such folders of releases no longer running, which a hard kill left. Exit codes: 0 published; 3 the app did not
 * compile; 4 the build holds this Mac's folder paths; 1 anything else. The watcher holds 3 and 4 until main moves,
 * since building the same code again gives the same answer.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { assetName, keyItem, latestJson, moveCommand, nextVersion, readConfig, releasesRepository, signedVersion, VAULT } from './app.ts';
import { itemFields, KEYCHAIN_SERVICE, lastLine, notFound, readItem, readKey } from '../testflight/key.ts';
import { compileFailed } from '../testflight/upload.ts';
import { buildEnv, type Env } from '../build-env.ts';
import { foundPathsMessage, pathRewriteEnv, searchForPaths, unrewritable } from './build-paths.ts';
import { runCommand, STOP_SIGNALS, stopRunning, type Run, type RunResult } from '../../command-line/run.ts';

export type ReleaseOptions = {
  /** The app's Tauri folder, the one holding src-tauri. */
  cwd: string;
  /** Read the keys only through the keychain's 1Password token, never the signed-in op, as the Mac release watcher runs it. */
  tokenOnly?: boolean;
  run?: Run;
  env?: Env;
  /** The processor this runs on, `process.arch` when left out: releases are for Apple silicon. */
  arch?: string;
  now?: () => Date;
  print?: (line: string) => void;
  fail?: (line: string) => void;
  /** The build's own output as it comes. */
  output?: (chunk: string) => void;
};

/** Where `tauri build` puts the Mac app and its update archive. */
export const BUNDLE_FOLDER = 'src-tauri/target/release/bundle/macos';

/** What a Developer ID certificate's name starts with: a build signed by one is notarized. */
export const DEVELOPER_ID = 'Developer ID Application';

/** What Gatekeeper says of a notarized Developer ID app. */
export const NOTARIZED = 'source=Notarized Developer ID';

/** The start of the name of the folder the App Store Connect key is written to, followed by the release's pid. */
export const NOTARY_KEY_FOLDER = 'app-kit-notary-key-';

/** Whether an identity is a certificate's SHA-1 fingerprint, forty hex digits, rather than its name. */
export function isFingerprint(identity: string): boolean {
  return /^[0-9a-f]{40}$/i.test(identity);
}

/**
 * The certificate's name for an identity in `security find-identity -p codesigning`'s listing, or null when the
 * keychain lacks it: by its fingerprint's `N) <FINGERPRINT> "<name>"` line, in any case and whichever of the listing's
 * two sections holds it, or for a name, the name itself when it is listed.
 */
export function identityName(listing: string, identity: string): string | null {
  if (!isFingerprint(identity)) return listing.includes(`"${identity}"`) ? identity : null;
  for (const line of listing.split('\n')) {
    const match = /^\s*\d+\) ([0-9A-Fa-f]{40}) "([^"]*)"/.exec(line);
    if (match && match[1]!.toUpperCase() === identity.toUpperCase()) return match[2]!;
  }
  return null;
}

/** Whether a process is running, for a key folder a release left: a pid that cannot be signalled for want of permission is someone's. */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The key's file in its folder, the only thing a release puts there. */
const KEY_FILE = 'key.p8';

/**
 * Removes the key folders of releases no longer running, which a hard kill or a crash left: only a folder named for a
 * release's pid that holds nothing but the key's file, the shape a release makes, so nothing another program made goes.
 */
export function removeLeftKeyFolders(folder = tmpdir()): void {
  for (const name of readdirSync(folder)) {
    const pid = new RegExp(`^${NOTARY_KEY_FOLDER}(\\d+)-`).exec(name)?.[1];
    if (!pid || running(Number(pid))) continue;
    const left = join(folder, name);
    let held: string[];
    try {
      held = readdirSync(left);
    } catch {
      continue;
    }
    if (held.every((file) => file === KEY_FILE)) rmSync(left, { recursive: true, force: true });
  }
}

/** Releases, as the module's comment says. Stopped by a signal, it stops the build and removes its temporary folder. */
export async function release(options: ReleaseOptions): Promise<0 | 1 | 3 | 4> {
  const folders = new Set<string>();
  const remove = () => {
    for (const folder of folders) rmSync(folder, { recursive: true, force: true });
  };
  const onSignal = (signal: NodeJS.Signals) => {
    (options.fail ?? ((line: string) => console.error(`[mac release] ${line}`)))(`stopped by ${signal}; stopping the build`);
    stopRunning('SIGTERM');
    remove();
    process.exit(1);
  };
  for (const signal of STOP_SIGNALS) process.on(signal, onSignal);
  try {
    return await releaseSteps(options, folders);
  } finally {
    for (const signal of STOP_SIGNALS) process.off(signal, onSignal);
    remove();
  }
}

/** The steps; every folder made goes into `folders`, which `release` removes however the steps end. */
async function releaseSteps(options: ReleaseOptions, folders: Set<string>): Promise<0 | 1 | 3 | 4> {
  const madeFolder = (prefix: string) => {
    const folder = mkdtempSync(join(tmpdir(), prefix));
    folders.add(folder);
    return folder;
  };
  const { cwd } = options;
  const run = options.run ?? runCommand;
  const print = options.print ?? ((line: string) => console.log(`[mac release] ${line}`));
  const say = options.fail ?? ((line: string) => console.error(`[mac release] ${line}`));
  const fail = (line: string): 1 => {
    say(line);
    return 1;
  };
  const output = options.output ?? ((chunk: string) => void process.stdout.write(chunk));
  // The build's environment, without a signing identity of the shell's, which would take the place of the config's, or
  // a Cargo build folder of the shell's, where Tauri would put the bundle instead of the app's own src-tauri/target.
  const env = buildEnv(options.env ?? process.env);
  delete env.APPLE_SIGNING_IDENTITY;
  delete env.CARGO_TARGET_DIR;
  // Tauri notarizes with an Apple ID before the App Store Connect key, and imports a certificate given here in place of
  // the keychain's.
  for (const name of ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD']) delete env[name];
  // Cargo uses the first of these it finds and then ignores build.rustflags, where the path rewriting goes.
  for (const name of ['RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'CARGO_BUILD_RUSTFLAGS']) delete env[name];
  const git = async (...args: string[]) => {
    const done = await run(['git', ...args], { cwd, env });
    return { code: done.code, out: done.out.trim() };
  };

  const arch = options.arch ?? process.arch;
  if (arch !== 'arm64') return fail(`releases are built for Apple silicon only, and this Mac is ${arch}`);

  const fetched = await git('fetch', '-q', 'origin', 'main');
  if (fetched.code !== 0) return fail(`could not fetch origin's main: ${lastLine(fetched.out)}`);
  /** Why the folder is not landed code, or null, and the commit it is at. */
  const landed = async (): Promise<{ problem: string | null; head: string }> => {
    // Uncommitted changes anywhere in the checkout count, since the build may read files outside the app's folder.
    const status = await git('status', '--porcelain');
    if (status.code !== 0) return { problem: `${cwd} is not a git checkout`, head: '' };
    const head = (await git('rev-parse', 'HEAD')).out;
    if (status.out) return { problem: 'the checkout has uncommitted changes; a release builds only landed code', head };
    if ((await git('merge-base', '--is-ancestor', 'HEAD', 'origin/main')).code !== 0) {
      return { problem: `HEAD (${head.slice(0, 7)}) is not on origin/main; a release builds only landed code, so check out main`, head };
    }
    if ((await git('diff', '--quiet', 'HEAD', 'origin/main', '--', '.')).code !== 0) {
      return { problem: 'the folder differs from origin/main; a release builds only landed code, so pull main first', head };
    }
    return { problem: null, head };
  };
  const before = await landed();
  if (before.problem) return fail(before.problem);
  const short = before.head.slice(0, 7);
  const home = env.HOME || homedir();
  const buildFolders = { home, checkout: (await git('rev-parse', '--show-toplevel')).out, cargoHome: env.CARGO_HOME };
  const cannot = unrewritable(buildFolders);
  if (cannot) return fail(`${cannot}, so the release would publish it: release from a folder without one`);

  const config = readConfig(cwd);
  if (typeof config === 'string') return fail(config);
  const repository = releasesRepository(config.endpoint);
  if (!repository) {
    return fail(
      `plugins.updater's endpoint ${config.endpoint} is not https://github.com/<owner>/<repository>/releases/latest/download/latest.json, the releases this command publishes to`,
    );
  }
  // Every identity, not only those macOS trusts (-v): a self-signed one is untrusted until marked so, and still signs.
  const identities = await run(['security', 'find-identity', '-p', 'codesigning'], { env });
  const certificateName = identityName(identities.out, config.identity);
  if (certificateName === null) {
    return fail(
      `this Mac's keychain has no code signing identity "${config.identity}", which tauri.conf.json names (app-kit's README, "Releases and updates", says how to make one)`,
    );
  }
  const notarize = certificateName.startsWith(DEVELOPER_ID);

  const viewed = await run(['gh', 'repo', 'view', repository, '--json', 'visibility,isEmpty,viewerPermission'], { env });
  if (viewed.code !== 0) return fail(`gh could not see ${repository}: ${lastLine(viewed.out)}`);
  let facts: { visibility?: string; isEmpty?: boolean; viewerPermission?: string };
  try {
    facts = JSON.parse(viewed.stdout) as typeof facts;
  } catch {
    return fail(`gh's answer about ${repository} is not JSON: ${lastLine(viewed.out)}`);
  }
  if (facts.visibility !== 'PUBLIC') {
    return fail(`${repository} is ${facts.visibility?.toLowerCase() ?? 'not public'}, so installed copies could not read its releases: make it public`);
  }
  if (facts.isEmpty) return fail(`${repository} is empty, and gh cannot make a release in an empty repository: add a README to it`);
  if (!['ADMIN', 'MAINTAIN', 'WRITE'].includes(facts.viewerPermission ?? '')) {
    return fail(`gh's account may not write to ${repository} (its permission is ${facts.viewerPermission || 'none'}): sign gh in to an account that can`);
  }
  const last = await run(['gh', 'release', 'view', '--repo', repository, '--json', 'tagName', '--jq', '.tagName'], { env });
  let lastTag: string | null = null;
  if (last.code === 0) lastTag = last.stdout.trim();
  else if (!/release not found/.test(last.out)) return fail(`gh could not read ${repository}'s last release: ${lastLine(last.out)}`);
  if (lastTag !== null && !/^v\d+\.\d+\.\d+$/.test(lastTag)) return fail(`${repository}'s last release is ${lastTag}, not v and three numbers such as v0.1.8`);
  const version = nextVersion(lastTag, config.version);
  print(`releasing ${config.productName} ${version} from ${short} (last release: ${lastTag ?? 'none'}, tauri.conf.json: ${config.version})`);

  const item = keyItem(config.productName);
  const tokenOnly = options.tokenOnly ?? false;
  const read = await readItem(run, env, { tokenOnly }, item);
  if ('missing' in read) return fail(`the login keychain has no "${KEYCHAIN_SERVICE}" item, the 1Password token a release with nobody there reads the keys through (app-kit's README, "TestFlight")`);
  if (read.code !== 0) {
    if (notFound(read.out)) {
      return fail(
        `1Password's ${VAULT} vault has no "${item}". If it is still in the Personal vault, move it: ${moveCommand(item)}. Make a key with app-kit mac key only for an app that has never released, since a new key strands every installed copy`,
      );
    }
    return fail(`op could not read "${item}" in the vault "${VAULT}": ${lastLine(read.out)}`);
  }
  const key = itemFields(read.stdout, item, ['private key', 'public key', 'password']);
  if (typeof key === 'string') return fail(key);
  if (!key['private key'] || !key['public key']) return fail(`the 1Password item "${item}" has no "private key" or no "public key"`);
  if (key['public key'] !== config.pubkey) {
    return fail(`the public key in "${item}" is not tauri.conf.json's plugins.updater.pubkey, so every installed copy would refuse this release`);
  }

  let notary: { keyId: string; issuerId: string; privateKey: string } | null = null;
  if (notarize) {
    const read = await readKey(run, env, { tokenOnly });
    if ('missing' in read) return fail(`the login keychain has no "${KEYCHAIN_SERVICE}" item, the 1Password token the App Store Connect key that notarizes is read through`);
    if ('error' in read) return fail(`${read.error}; a Developer ID build is notarized with it`);
    notary = read.key;
  }

  const installed = await run(['bun', 'install', '--frozen-lockfile'], { cwd, env, output });
  if (installed.code !== 0) return fail(`bun install --frozen-lockfile failed: ${lastLine(installed.out)}`);

  print(`building ${config.productName} ${version}, signed by "${config.identity}"${notarize ? ', and notarized' : ''}`);
  const overrides = JSON.stringify({ version, bundle: { createUpdaterArtifacts: true } });
  const buildEnvironment: Env = {
    ...env,
    ...pathRewriteEnv(env, buildFolders),
    TAURI_SIGNING_PRIVATE_KEY: key['private key'],
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: key.password ?? '',
    APP_COMMIT: short,
  };
  let keyFolder: string | null = null;
  if (notary) {
    removeLeftKeyFolders();
    keyFolder = madeFolder(`${NOTARY_KEY_FOLDER}${process.pid}-`);
    const keyPath = join(keyFolder, KEY_FILE);
    writeFileSync(keyPath, `${notary.privateKey}\n`, { mode: 0o600 });
    // Added after buildEnv took every APPLE_API_* out, and on this one call alone.
    Object.assign(buildEnvironment, { APPLE_API_KEY: notary.keyId, APPLE_API_ISSUER: notary.issuerId, APPLE_API_KEY_PATH: keyPath });
  }
  let built: RunResult;
  try {
    built = await run(['bunx', 'tauri', 'build', '--bundles', 'app', '--config', overrides], { cwd, env: buildEnvironment, output });
  } finally {
    if (keyFolder) {
      rmSync(keyFolder, { recursive: true, force: true });
      folders.delete(keyFolder);
    }
  }
  if (built.code !== 0) {
    say(`the build of ${version} ${compileFailed(built.out) ? 'did not compile' : 'failed'}: ${lastLine(built.out)}`);
    return compileFailed(built.out) ? 3 : 1;
  }

  const app = join(cwd, BUNDLE_FOLDER, `${config.productName}.app`);
  const archive = `${app}.tar.gz`;
  if (!existsSync(archive) || !existsSync(`${archive}.sig`)) return fail(`the build made no signed update archive at ${archive}`);
  const folder = madeFolder('app-kit-mac-release-');
  if (isFingerprint(config.identity)) {
    // codesign names the signer only by its certificate's name; its leaf certificate's SHA-1 is the fingerprint.
    const certificates = join(folder, 'signer');
    mkdirSync(certificates);
    const extracted = await run(['codesign', '-d', `--extract-certificates=${join(certificates, 'certificate')}`, app], { env });
    const leaf = join(certificates, 'certificate0');
    const signer = extracted.code === 0 && existsSync(leaf) ? createHash('sha1').update(readFileSync(leaf)).digest('hex').toUpperCase() : null;
    rmSync(certificates, { recursive: true, force: true });
    if (signer !== config.identity.toUpperCase()) {
      return fail(`${app} is not signed by the certificate ${config.identity}: ${signer ? `its signer's is ${signer}` : lastLine(extracted.out)}`);
    }
  } else {
    const signed = await run(['codesign', '-dv', '--verbose=2', app], { env });
    if (!signed.out.split('\n').some((line) => line.trim() === `Authority=${config.identity}`)) {
      return fail(`${app} is not signed by "${config.identity}": ${lastLine(signed.out)}`);
    }
  }
  const signature = readFileSync(`${archive}.sig`, 'utf8').trim();
  const signedFor = signedVersion(signature);
  if (signedFor !== version) {
    return fail(`the update's signature names version ${signedFor ?? 'none'}, not ${version}: use Tauri's command-line tool 2.12.0 or later, which records it`);
  }
  const after = await landed();
  if (after.problem || after.head !== before.head) {
    return fail(`the checkout changed during the build, so it may hold code that never landed: ${after.problem ?? `HEAD moved to ${after.head.slice(0, 7)}`}; release again`);
  }

  const name = assetName(config.productName);
  copyFileSync(archive, join(folder, name));
  writeFileSync(join(folder, `${name}.sig`), signature);
  // What is checked is the copy that goes up, unpacked, so a build that replaced the archive meanwhile is caught too.
  const unpacked = join(folder, 'unpacked');
  mkdirSync(unpacked);
  const untarred = await run(['tar', '-xzf', join(folder, name), '-C', unpacked], { env });
  const inside = join(unpacked, `${config.productName}.app`);
  if (untarred.code !== 0 || !existsSync(inside)) return fail(`the update archive holds no ${config.productName}.app: ${lastLine(untarred.out)}`);
  const searched = [{ folder: inside, label: `${config.productName}.app` }];
  const page = config.frontendDist === null ? null : join(cwd, 'src-tauri', config.frontendDist);
  if (page && existsSync(page)) searched.push({ folder: page, label: `frontendDist ${config.frontendDist}` });
  const search = searchForPaths(searched, [buildFolders.home, buildFolders.checkout, buildFolders.cargoHome]);
  if (search.count > 0) {
    say(foundPathsMessage(search));
    return 4;
  }
  print(`the update archive's app holds none of this Mac's folder paths`);
  if (notarize) {
    const stapled = await run(['xcrun', 'stapler', 'validate', inside], { env });
    if (stapled.code !== 0) {
      return fail(`the app in the update archive has no notarization ticket stapled to it, so it was not notarized or its staple failed: ${lastLine(stapled.out)}`);
    }
    // Gatekeeper answers on standard error.
    const assessed = await run(['spctl', '-a', '-t', 'exec', '-vv', inside], { env });
    if (assessed.code !== 0 || !assessed.out.includes(NOTARIZED)) {
      return fail(`Gatekeeper does not call the app in the update archive notarized: ${lastLine(assessed.out)}`);
    }
    print(`the update archive's app is notarized and stapled`);
  }
  rmSync(unpacked, { recursive: true, force: true });
  const url = `https://github.com/${repository}/releases/download/v${version}/${name}`;
  writeFileSync(join(folder, 'latest.json'), latestJson({ version, date: (options.now ?? (() => new Date()))(), signature, url }));
  // gh makes a draft, uploads to it and only then publishes it as the latest, so no installed copy sees half a release.
  const title = `${config.productName} for Mac ${version}`;
  const assets = [join(folder, name), join(folder, `${name}.sig`), join(folder, 'latest.json')];
  const published = await run(
    ['gh', 'release', 'create', `v${version}`, '--repo', repository, '--latest', '--title', title, '--notes', `${title}, built from ${short} (${before.head}).`, ...assets],
    { env },
  );
  if (published.code !== 0) {
    return fail(
      `gh could not publish v${version} in ${repository}: ${lastLine(published.out)}; if it left a draft at https://github.com/${repository}/releases, delete it, then release again`,
    );
  }
  print(`published ${config.productName} ${version}: https://github.com/${repository}/releases/tag/v${version}`);
  print(`installed copies offer it the next time their window comes forward, or at Check for Updates…; ${app} is the same build`);
  return 0;
}
