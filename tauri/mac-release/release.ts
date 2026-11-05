/*
 * `app-kit mac release`: builds a Tauri app's Mac app from landed code, signed with the app's code signing identity,
 * signs its update with the app's update key from 1Password, and publishes it as the next numbered release in the
 * public GitHub repository the app's updater asks, where every installed copy finds it (tauri/window/plugin's
 * updates.rs). Run by a person from the app's Tauri folder: the key's read asks for Touch ID.
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
 *
 * The key reaches only Tauri's build, through its environment, never a command line or a file. Exit codes: 0
 * published; 1 anything else.
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assetName, keyItem, latestJson, nextVersion, readConfig, releasesRepository, signedVersion, VAULT } from './app.ts';
import { itemFields, lastLine, notFound } from '../testflight/key.ts';
import { buildEnv, type Env } from '../build-env.ts';
import { runCommand, STOP_SIGNALS, stopRunning, type Run } from '../../command-line/run.ts';

export type ReleaseOptions = {
  /** The app's Tauri folder, the one holding src-tauri. */
  cwd: string;
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

/** Releases, as the module's comment says. Stopped by a signal, it stops the build and removes its temporary folder. */
export async function release(options: ReleaseOptions): Promise<0 | 1> {
  let folder: string | null = null;
  const onSignal = (signal: NodeJS.Signals) => {
    (options.fail ?? ((line: string) => console.error(`[mac release] ${line}`)))(`stopped by ${signal}; stopping the build`);
    stopRunning('SIGTERM');
    if (folder) rmSync(folder, { recursive: true, force: true });
    process.exit(1);
  };
  for (const signal of STOP_SIGNALS) process.on(signal, onSignal);
  try {
    return await releaseSteps(options, (made) => (folder = made));
  } finally {
    for (const signal of STOP_SIGNALS) process.off(signal, onSignal);
    if (folder) rmSync(folder, { recursive: true, force: true });
  }
}

async function releaseSteps(options: ReleaseOptions, madeFolder: (folder: string) => void): Promise<0 | 1> {
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
  if (!identities.out.includes(`"${config.identity}"`)) {
    return fail(
      `this Mac's keychain has no code signing identity "${config.identity}", which tauri.conf.json names (app-kit's README, "Releases and updates", says how to make one)`,
    );
  }

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
  const read = await run(['op', 'item', 'get', item, '--vault', VAULT, '--format', 'json'], { env });
  if (read.code !== 0) {
    if (notFound(read.out)) return fail(`1Password's ${VAULT} vault has no "${item}": make it once with app-kit mac key`);
    return fail(`op could not read "${item}" in the vault "${VAULT}": ${lastLine(read.out)}`);
  }
  const key = itemFields(read.stdout, item, ['private key', 'public key', 'password']);
  if (typeof key === 'string') return fail(key);
  if (!key['private key'] || !key['public key']) return fail(`the 1Password item "${item}" has no "private key" or no "public key"`);
  if (key['public key'] !== config.pubkey) {
    return fail(`the public key in "${item}" is not tauri.conf.json's plugins.updater.pubkey, so every installed copy would refuse this release`);
  }

  const installed = await run(['bun', 'install', '--frozen-lockfile'], { cwd, env, output });
  if (installed.code !== 0) return fail(`bun install --frozen-lockfile failed: ${lastLine(installed.out)}`);

  print(`building ${config.productName} ${version}, signed by "${config.identity}"`);
  const overrides = JSON.stringify({ version, bundle: { createUpdaterArtifacts: true } });
  const built = await run(['bunx', 'tauri', 'build', '--bundles', 'app', '--config', overrides], {
    cwd,
    env: { ...env, TAURI_SIGNING_PRIVATE_KEY: key['private key'], TAURI_SIGNING_PRIVATE_KEY_PASSWORD: key.password ?? '', APP_COMMIT: short },
    output,
  });
  if (built.code !== 0) return fail(`the build of ${version} failed: ${lastLine(built.out)}`);

  const app = join(cwd, BUNDLE_FOLDER, `${config.productName}.app`);
  const archive = `${app}.tar.gz`;
  if (!existsSync(archive) || !existsSync(`${archive}.sig`)) return fail(`the build made no signed update archive at ${archive}`);
  const signed = await run(['codesign', '-dv', '--verbose=2', app], { env });
  if (!signed.out.split('\n').some((line) => line.trim() === `Authority=${config.identity}`)) {
    return fail(`${app} is not signed by "${config.identity}": ${lastLine(signed.out)}`);
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

  const folder = mkdtempSync(join(tmpdir(), 'app-kit-mac-release-'));
  madeFolder(folder);
  const name = assetName(config.productName);
  copyFileSync(archive, join(folder, name));
  writeFileSync(join(folder, `${name}.sig`), signature);
  const url = `https://github.com/${repository}/releases/download/v${version}/${name}`;
  writeFileSync(join(folder, 'latest.json'), latestJson({ version, date: (options.now ?? (() => new Date()))(), signature, url }));
  // gh makes a draft, uploads to it and only then publishes it as the latest, so no installed copy sees half a release.
  const title = `${config.productName} for Mac ${version}`;
  const assets = [join(folder, name), join(folder, `${name}.sig`), join(folder, 'latest.json')];
  const published = await run(
    ['gh', 'release', 'create', `v${version}`, '--repo', repository, '--latest', '--title', title, '--notes', `${title}, built from ${short}.`, ...assets],
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
