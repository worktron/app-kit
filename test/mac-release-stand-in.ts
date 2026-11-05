// What the Mac release tests share: a Tauri app's checkout cloned from an origin of its own over file://, and a runner
// that runs git for real and answers for gh, op, security, codesign, bun install and Tauri's build, recording what
// each was given. gh's answers are recorded from the real gh (2026-11-05): a repository with no releases, and one gh
// cannot see, both answer "release not found" and exit 1.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commit, exit, git, ok, repository, standInRunner } from './testflight-stand-in.ts';
import type { RunOptions, RunResult } from '../command-line/run.ts';

export const IDENTITY = 'Example Code Signing';
export const PUBLIC_KEY = Buffer.from('untrusted comment: minisign public key: 0000000000000001\nRWStand-in-public-key\n').toString('base64');
export const PRIVATE_KEY = 'stand-in-private-key-never-printed';
export const REPOSITORY = 'example/example-releases';
export const ENDPOINT = `https://github.com/${REPOSITORY}/releases/latest/download/latest.json`;

/** tauri.conf.json as an app on the kit writes it, with `change` applied. */
export function tauriConfig(change: (config: Record<string, any>) => void = () => {}): string {
  const config: Record<string, any> = {
    productName: 'Example App',
    version: '0.1.0',
    identifier: 'com.example.app',
    bundle: { active: true, targets: ['app'], macOS: { signingIdentity: IDENTITY } },
    plugins: { updater: { pubkey: PUBLIC_KEY, endpoints: [ENDPOINT], requireSignedVersion: true } },
  };
  change(config);
  return JSON.stringify(config, null, 2);
}

/** An origin, and a checkout of it with the app at `folder` inside (the root by default), on main and up to date. */
export function macApp(place: string, options: { config?: string; folder?: string } = {}) {
  const seed = repository(join(place, 'seed'), {
    [join(options.folder ?? '', 'src-tauri/tauri.conf.json')]: options.config ?? tauriConfig(),
    [join(options.folder ?? '', 'package.json')]: '{"name":"example"}',
    'README.md': 'the app\n',
    // As every Tauri app ignores its build folder, where the release's build writes.
    '.gitignore': 'target/\n',
  });
  const origin = join(place, 'origin.git');
  git(place, 'clone', '-q', '--bare', seed, origin);
  const checkout = join(place, 'checkout');
  git(place, 'clone', '-q', origin, checkout);
  return { origin, checkout, app: join(checkout, options.folder ?? '') };
}

/** The `.sig` file Tauri's command-line tool writes, its trusted comment naming `version` when given. */
export function signatureFile(version: string | null): string {
  const comment = `timestamp:1791649051\tfile:Example App.app.tar.gz${version ? `\tversion:${version}` : ''}`;
  return Buffer.from(`untrusted comment: signature from tauri secret key\nRUStand-in-signature\ntrusted comment: ${comment}\nStand-in-global-signature\n`).toString('base64');
}

/** 1Password's answer for the key's item, cut to what is read. */
export function keyItemJson(fields: { privateKey?: string; publicKey?: string; password?: string } = {}): string {
  return JSON.stringify({
    title: 'Example App update signing key',
    vault: { name: 'Personal' },
    fields: [
      { label: 'password', value: fields.password ?? '' },
      { label: 'private key', value: fields.privateKey ?? PRIVATE_KEY },
      { label: 'public key', value: fields.publicKey ?? PUBLIC_KEY },
    ],
  });
}

export type MacWorld = {
  /** gh repo view's answer. */
  repo?: RunResult;
  /** gh release view's answer: the last release's tag, or a failure. */
  lastRelease?: RunResult;
  identities?: string;
  item?: RunResult;
  /** The version the build's signature names, or null for none; the version it was asked to build by default. */
  signedVersion?: string | null;
  /** The identity codesign reports. */
  signedBy?: string;
  buildFails?: boolean;
  /** Runs during the build, as another thread would change the checkout. */
  duringBuild?: () => void;
  publish?: (command: string[], options: RunOptions) => RunResult | Promise<RunResult>;
};

export const releaseNotFound = exit(1, 'release not found\n');

/** The runner for one release of the app in `app`, and what it was asked. */
export function macRunner(app: string, world: MacWorld = {}) {
  const published: { command: string[]; files: Record<string, string> }[] = [];
  const stand = standInRunner(async (command, options) => {
    const [program, ...args] = command;
    const words = args.join(' ');
    if (program === 'git') return undefined;
    if (program === 'security') {
      // The shape security printed on 2026-11-05, hashes cut: a self-signed identity not yet marked trusted is listed
      // with macOS's reason, and only under Matching identities.
      return ok(
        world.identities ??
          `Policy: Code Signing\n  Matching identities\n  1) 7F37 "${IDENTITY}" (CSSMERR_TP_NOT_TRUSTED)\n  2) CCB7 "Apple Development: Someone (TEAM000001)"\n     2 identities found\n\n  Valid identities only\n  1) CCB7 "Apple Development: Someone (TEAM000001)"\n     1 valid identities found\n`,
      );
    }
    if (program === 'gh' && words.startsWith('repo view')) {
      return world.repo ?? ok('{"isEmpty":false,"viewerPermission":"ADMIN","visibility":"PUBLIC"}\n');
    }
    if (program === 'gh' && words.startsWith('release view')) return world.lastRelease ?? ok('v0.1.8\n');
    if (program === 'gh' && words.startsWith('release create')) {
      const files: Record<string, string> = {};
      for (const path of args.filter((arg) => arg.startsWith('/'))) files[path.split('/').pop()!] = await Bun.file(path).text();
      published.push({ command, files });
      return world.publish ? world.publish(command, options) : ok('https://github.com/example/example-releases/releases/tag/v0\n');
    }
    if (program === 'op' && words.startsWith('item get')) return world.item ?? ok(keyItemJson());
    if (program === 'bun' && words === 'install --frozen-lockfile') return ok();
    if (program === 'bunx' && args[0] === 'tauri' && args[1] === 'build') {
      if (world.buildFails) return exit(1, 'error: could not compile `example`\n');
      world.duringBuild?.();
      const version = (JSON.parse(args[args.indexOf('--config') + 1]!) as { version: string }).version;
      const bundle = join(app, 'src-tauri/target/release/bundle/macos');
      mkdirSync(join(bundle, 'Example App.app'), { recursive: true });
      writeFileSync(join(bundle, 'Example App.app.tar.gz'), 'the archive');
      writeFileSync(join(bundle, 'Example App.app.tar.gz.sig'), signatureFile(world.signedVersion === undefined ? version : world.signedVersion));
      return ok('Finished 1 updater bundle\n');
    }
    if (program === 'codesign') {
      return exit(0, `Executable=${app}/Example App.app/Contents/MacOS/example\nAuthority=${world.signedBy ?? IDENTITY}\nTeamIdentifier=not set\n`);
    }
    return undefined;
  }, ['git']);
  return { ...stand, published };
}

/** Commits a change to the app on origin's main, as a landing elsewhere would. */
export function landElsewhere(origin: string, place: string, path: string) {
  const other = join(place, 'elsewhere');
  git(place, 'clone', '-q', origin, other);
  commit(other, { [path]: 'changed\n' });
  git(other, 'push', '-q', 'origin', 'main');
}
