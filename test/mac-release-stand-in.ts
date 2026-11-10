// What the Mac release tests share: a Tauri app's checkout cloned from an origin of its own over file://, and a runner
// that runs git and tar for real and answers for gh, op, security, codesign, bun install, Tauri's build, stapler and
// Gatekeeper, recording what each was given. gh's answers are recorded from the real gh (2026-11-05): a repository with
// no releases, and one gh cannot see, both answer "release not found" and exit 1. stapler's and spctl's are the real
// ones' shapes on macOS 27 (2026-11-07), spctl's on standard error as it writes them.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { commit, exit, git, ok, repository, standInRunner } from './testflight-stand-in.ts';
import type { RunOptions, RunResult } from '../command-line/run.ts';

export const IDENTITY = 'Example Code Signing';
export const PUBLIC_KEY = Buffer.from('untrusted comment: minisign public key: 0000000000000001\nRWStand-in-public-key\n').toString('base64');
export const PRIVATE_KEY = 'stand-in-private-key-never-printed';
export const REPOSITORY = 'example/example-releases';
export const ENDPOINT = `https://github.com/${REPOSITORY}/releases/latest/download/latest.json`;

/** A Developer ID certificate's name, with a made-up person in it, as the real one holds the owner's. */
export const DEVELOPER_ID_NAME = 'Developer ID Application: Example Person (TEAM000001)';
/** The leaf certificate codesign extracts from a build signed by it, and its SHA-1 fingerprint, the config's identity. */
export const CERTIFICATE = 'stand-in Developer ID leaf certificate';
export const FINGERPRINT = createHash('sha1').update(CERTIFICATE).digest('hex').toUpperCase();
/** The App Store Connect key's private half, which only the build's key file may hold. */
export const NOTARY_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nstand-in-notary-key-never-printed\n-----END PRIVATE KEY-----';

/** security's listing with the Developer ID identity, which is valid, so it is listed in both sections. */
export const DEVELOPER_ID_IDENTITIES = `Policy: Code Signing\n  Matching identities\n  1) 7F371F1546B11B1963F1A13A6D44D48C2BD96273 "${IDENTITY}" (CSSMERR_TP_NOT_TRUSTED)\n  2) ${FINGERPRINT} "${DEVELOPER_ID_NAME}"\n     2 identities found\n\n  Valid identities only\n  1) ${FINGERPRINT} "${DEVELOPER_ID_NAME}"\n     1 valid identities found\n`;

/** 1Password's answer for the TestFlight vault's App Store Connect key. */
export function notaryItemJson(): string {
  return JSON.stringify({
    title: 'App Store Connect API',
    vault: { name: 'TestFlight' },
    fields: [
      { label: 'key id', value: 'KEY0000001' },
      { label: 'issuer id', value: '00000000-0000-0000-0000-000000000001' },
      { label: 'private key', value: NOTARY_PRIVATE_KEY },
    ],
  });
}

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
  /** The leaf certificate codesign extracts, CERTIFICATE by default. */
  certificate?: string;
  /** 1Password's answer for the App Store Connect key. */
  notaryItem?: RunResult;
  /** Whether stapler finds a ticket on the app in the archive; true by default. */
  stapled?: boolean;
  /** spctl's answer for the app in the archive: notarized by default. */
  gatekeeper?: RunResult;
  /** Answers for Tauri's build in place of the stand-in's own. */
  build?: (command: string[], options: RunOptions) => RunResult | Promise<RunResult>;
  buildFails?: boolean;
  /** Runs during the build, as another thread would change the checkout. */
  duringBuild?: () => void;
  publish?: (command: string[], options: RunOptions) => RunResult | Promise<RunResult>;
  /** The TestFlight vault's service account token the login keychain holds; none by default. */
  token?: string;
};

export const releaseNotFound = exit(1, 'release not found\n');

/** The runner for one release of the app in `app`, and what it was asked. */
export function macRunner(app: string, world: MacWorld = {}) {
  const published: { command: string[]; files: Record<string, string> }[] = [];
  /** The App Store Connect key's file as the build found it, when it was given one. */
  const keyAtBuild: { path: string; text: string; mode: number; folderMode: number }[] = [];
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
    // The TestFlight vault's token, which this Mac's keychain holds only when the test says so; without it op is asked
    // as the person.
    if (program === '/usr/bin/security') {
      return world.token ? ok(`${world.token}\n`) : exit(44, 'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\n');
    }
    if (program === 'op' && words.startsWith('item get App Store Connect API')) return world.notaryItem ?? ok(notaryItemJson());
    if (program === 'op' && words.startsWith('item get')) return world.item ?? ok(keyItemJson());
    if (program === 'bun' && words === 'install --frozen-lockfile') return ok();
    if (program === 'bunx' && args[0] === 'tauri' && args[1] === 'build') {
      const keyPath = options.env?.APPLE_API_KEY_PATH;
      if (keyPath) {
        keyAtBuild.push({ path: keyPath, text: readFileSync(keyPath, 'utf8'), mode: statSync(keyPath).mode & 0o777, folderMode: statSync(dirname(keyPath)).mode & 0o777 });
      }
      if (world.build) return world.build(command, options);
      if (world.buildFails) return exit(1, 'error: could not compile `example`\n');
      world.duringBuild?.();
      const version = (JSON.parse(args[args.indexOf('--config') + 1]!) as { version: string }).version;
      const bundle = join(app, 'src-tauri/target/release/bundle/macos');
      mkdirSync(join(bundle, 'Example App.app/Contents'), { recursive: true });
      writeFileSync(join(bundle, 'Example App.app/Contents/Info.plist'), '<plist/>');
      if (keyPath) {
        // A notarized build's archive is a real one, which the release unpacks to check the app in it.
        const tar = Bun.spawnSync(['tar', '-czf', join(bundle, 'Example App.app.tar.gz'), '-C', bundle, 'Example App.app']);
        if (tar.exitCode !== 0) throw new Error(`tar: ${tar.stderr.toString()}`);
      } else {
        writeFileSync(join(bundle, 'Example App.app.tar.gz'), 'the archive');
      }
      writeFileSync(join(bundle, 'Example App.app.tar.gz.sig'), signatureFile(world.signedVersion === undefined ? version : world.signedVersion));
      return ok('Finished 1 updater bundle\n');
    }
    if (program === 'codesign' && args[1]?.startsWith('--extract-certificates=')) {
      writeFileSync(`${args[1].slice('--extract-certificates='.length)}0`, world.certificate ?? CERTIFICATE);
      return ok();
    }
    if (program === 'xcrun' && args[0] === 'stapler' && args[1] === 'validate') {
      const path = args[2]!;
      if (world.stapled === false) return exit(65, `Processing: ${path}\n${path} does not have a ticket stapled to it.\n`);
      return ok(`Processing: ${path}\nThe validate action worked!\n`);
    }
    if (program === 'spctl') {
      return world.gatekeeper ?? exit(0, `${args.at(-1)}: accepted\nsource=Notarized Developer ID\norigin=${DEVELOPER_ID_NAME}\n`);
    }
    if (program === 'codesign') {
      return exit(0, `Executable=${app}/Example App.app/Contents/MacOS/example\nAuthority=${world.signedBy ?? IDENTITY}\nTeamIdentifier=not set\n`);
    }
    return undefined;
  }, ['git', 'tar']);
  return { ...stand, published, keyAtBuild };
}

/** Commits a change to the app on origin's main, as a landing elsewhere would. */
export function landElsewhere(origin: string, place: string, path: string) {
  const other = join(place, 'elsewhere');
  git(place, 'clone', '-q', origin, other);
  commit(other, { [path]: 'changed\n' });
  git(other, 'push', '-q', 'origin', 'main');
}
