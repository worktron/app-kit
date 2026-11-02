// The upload's stand-ins for Apple's side: an app's checkout as Tauri lays it out, Rust as rustup installs it, and
// Tauri, codesign, altool, the keychain and 1Password as they answered in the first real uploads. Shared by the upload's
// tests and by testflight-upload-child.ts, which the tests run as a process of its own to stop it.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { runCommand } from '../command-line/run.ts';
import { commit, exit, git, ITEM_JSON, KEY, ok, repository, standInRunner, TOKEN, type Answer, type StandInBuild } from './testflight-stand-in.ts';

export const plist = (entries: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${entries}</dict>\n</plist>\n`;
export const EXPORT_OPTIONS = plist('\t<key>method</key>\n\t<string>debugging</string>\n');
export const INFO = plist('\t<key>CFBundleShortVersionString</key>\n\t<string>0.1.0</string>\n\t<key>CFBundleVersion</key>\n\t<string>0.1.0</string>\n');
// What codesign read from Past the Break's App Store build (no push), and what an App Store build with push carries; the
// team id replaced.
export const ENTITLEMENTS_NO_PUSH = plist('\t<key>application-identifier</key>\n\t<string>TEAM000000.app.pastthebreak</string>\n\t<key>beta-reports-active</key>\n\t<true/>\n\t<key>get-task-allow</key>\n\t<false/>\n');
export const ENTITLEMENTS_PUSH = plist(
  '\t<key>application-identifier</key>\n\t<string>TEAM000000.app.pastthebreak</string>\n\t<key>aps-environment</key>\n\t<string>production</string>\n\t<key>beta-reports-active</key>\n\t<true/>\n\t<key>get-task-allow</key>\n\t<false/>\n',
);
export const ENTITLEMENTS_DEVELOPMENT = plist('\t<key>aps-environment</key>\n\t<string>development</string>\n\t<key>get-task-allow</key>\n\t<true/>\n');

/**
 * A small PNG written by hand, unfiltered: `pixels` are its samples in rows `width` long, at `depth` bits (8 or 16), and
 * `chunks` go between its header and its image data, as a palette and its transparency do. Colour type 2 is colour with
 * no alpha channel, as `app-kit icons render` draws the iPhone icons; 6 is colour with alpha, as `tauri icon` writes them.
 */
export function png(colourType: number, pixels: number[][], { width = 2, depth = 8, chunks = [] }: { width?: number; depth?: 8 | 16; chunks?: [string, number[]][] } = {}): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(Bun.hash.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(pixels.length / width, 4);
  header[8] = depth;
  header[9] = colourType;
  const rows: number[] = [];
  pixels.forEach((samples, at) => {
    if (at % width === 0) rows.push(0);
    for (const value of samples) rows.push(...(depth === 16 ? [value >> 8, value & 0xff] : [value]));
  });
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    ...chunks.map(([type, data]) => chunk(type, Buffer.from(data))),
    chunk('IDAT', deflateSync(Buffer.from(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A 2 by 2 icon in colour with an alpha channel, every pixel opaque but the last, at `last`. */
export const rgba = (last: number) => png(6, [[9, 9, 9, 255], [9, 9, 9, 255], [9, 9, 9, 255], [9, 9, 9, last]]);
/** A 2 by 2 icon in colour, with no alpha channel. */
export const rgb = () => png(2, [[9, 9, 9], [9, 9, 9], [9, 9, 9], [9, 9, 9]]);

/** The icon set Tauri's `ios init` writes, cut to its App Store entry. */
export const ICON_CONTENTS = JSON.stringify({ images: [{ size: '1024x1024', idiom: 'ios-marketing', filename: 'AppIcon-512@2x.png', scale: '1x' }], info: { version: 1, author: 'xcode' } });

/**
 * An app's origin with main two commits long, its clone checked out at main, and a cargo folder holding rustc. With
 * `appFolder`, the Tauri project is in that subfolder of the repository, as Timescale's is in `desktop/`.
 */
export function uploadFixture(folder: string, appFolder = '') {
  const inApp = (path: string) => (appFolder ? `${appFolder}/${path}` : path);
  const origin = repository(join(folder, 'origin'), {
    [inApp('src-tauri/tauri.conf.json')]: JSON.stringify({ identifier: 'app.pastthebreak', build: { frontendDist: '../dist' } }),
    [inApp('src-tauri/gen/apple/ExportOptions.plist')]: EXPORT_OPTIONS,
    [inApp('src-tauri/gen/apple/past-the-break_iOS/Info.plist')]: INFO,
    [inApp('src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/Contents.json')]: ICON_CONTENTS,
    [inApp('src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png')]: rgb(),
    '.gitignore': `${inApp('src-tauri/gen/apple/build/')}\n`,
  });
  commit(origin, { 'src/app.ts': 'export {};\n' }, 'the page');
  const app = join(folder, 'app');
  git(folder, 'clone', '-q', `file://${origin}`, app);
  // Rust as rustup installs it: rustc only in the cargo folder, its sysroot holding llvm-objcopy.
  const cargoHome = join(folder, 'cargo');
  const sysroot = join(folder, 'sysroot');
  mkdirSync(join(cargoHome, 'bin'), { recursive: true });
  mkdirSync(join(sysroot, `lib/rustlib/${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin/bin`), { recursive: true });
  writeFileSync(join(sysroot, `lib/rustlib/${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin/bin/llvm-objcopy`), '');
  writeFileSync(join(cargoHome, 'bin/rustc'), `#!/bin/sh\necho ${sysroot}\n`);
  chmodSync(join(cargoHome, 'bin/rustc'), 0o755);
  return { origin, app, cargoHome };
}

export type Apple = {
  token?: boolean;
  build?: 'ok' | 'compile' | 'signing';
  version?: (n: string) => string;
  encryption?: boolean;
  entitlements?: string;
  altool?: 'ok' | 'duplicate' | 'refused';
  /** The states Apple's processing goes through once the build is listed. */
  states?: string[];
  /** Where the stand-in hangs, printing a line with the marker, which also names the hanging process. */
  hang?: { at: 'build' | 'altool'; marker: string };
};

/** Tauri, altool, codesign, the keychain and 1Password as they answered in the first real uploads. */
export function apple(app: string, builds: StandInBuild[], options: Apple = {}) {
  const keyFolders: string[] = [];
  const answer: Answer = (command, runOptions): ReturnType<Answer> => {
    const line = command.join(' ');
    const cwd = runOptions.cwd ?? app;
    if (command[0] === 'rustc') return undefined; // the stand-in rustc in the cargo folder, found through PATH
    if (command[0] === '/usr/bin/security') return options.token === false ? exit(44, 'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.') : ok(`${TOKEN}\n`);
    if (command[0] === 'op') return ok(ITEM_JSON);
    if (line.startsWith('bunx tauri ios build')) {
      // Tauri writes the build number and the export method into the tracked plists, then builds.
      const n = JSON.parse(command[command.length - 1]).bundle.iOS.bundleVersion as string;
      const info = join(cwd, 'src-tauri/gen/apple/past-the-break_iOS/Info.plist');
      writeFileSync(info, readFileSync(info, 'utf8').replace('<string>0.1.0</string>\n</dict>', `<string>${n}</string>\n</dict>`));
      const exportOptions = join(cwd, 'src-tauri/gen/apple/ExportOptions.plist');
      writeFileSync(exportOptions, readFileSync(exportOptions, 'utf8').replace('debugging', 'app-store-connect'));
      if (options.hang?.at === 'build') return hang(options.hang.marker, runOptions);
      if (options.build === 'compile') return exit(1, "error[E0425]: cannot find value `x` in this scope\nerror: could not compile `past-the-break` (lib) due to 1 previous error\n");
      if (options.build === 'signing') return exit(1, 'error: No signing certificate "iOS Distribution" found\nerror: failed to build iOS app\n');
      const appFolder = join(cwd, 'src-tauri/gen/apple/build/arm64/Payload/Past the Break.app');
      mkdirSync(appFolder, { recursive: true });
      const encryption = options.encryption === false ? '' : '\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>\n';
      writeFileSync(join(appFolder, 'Info.plist'), plist(`\t<key>CFBundleIdentifier</key>\n\t<string>app.pastthebreak</string>\n\t<key>CFBundleVersion</key>\n\t<string>${(options.version ?? ((v) => v))(n)}</string>\n${encryption}`));
      return undefined; // zipped below by the real zip
    }
    if (command[0] === 'codesign') {
      writeFileSync(command[3], options.entitlements ?? ENTITLEMENTS_NO_PUSH);
      return ok(`Executable=${command[5]}/Past the Break\n`);
    }
    if (line.startsWith('xcrun altool --upload-app')) {
      const folder = runOptions.env?.API_PRIVATE_KEYS_DIR ?? '';
      keyFolders.push(folder);
      const keyFile = join(folder, `AuthKey_${KEY.keyId}.p8`);
      if (!existsSync(keyFile) || readFileSync(keyFile, 'utf8').trim() !== KEY.privateKey) return exit(1, 'ERROR: no key file');
      if (options.hang?.at === 'altool') {
        writeFileSync(`${options.hang.marker}.keys`, folder);
        return hang(options.hang.marker, runOptions);
      }
      if (options.altool === 'refused') return exit(1, "ERROR: [ContentDelivery.Uploader] Asset validation failed (90062) This bundle is invalid. The value for key CFBundleVersion [3] in the Info.plist file must contain a higher version.");
      const n = git(cwd, 'rev-list', '--count', 'HEAD');
      if (options.altool === 'duplicate') {
        builds.push({ number: n, states: ['VALID'] });
        return exit(1, `ERROR ITMS-90189: "Redundant Binary Upload. You've already uploaded a build with build number '${n}' for version number '0.1.0'."`);
      }
      builds.push({ number: n, states: options.states ?? ['PROCESSING', 'VALID'], hiddenFor: 1 });
      return ok('No errors uploading archive\nUPLOAD SUCCEEDED\n');
    }
    return undefined;
  };
  const runner = standInRunner(async (command, runOptions) => {
    const answered = answer(command, runOptions);
    // After the stand-in build, the real zip makes the .ipa from the app it wrote.
    if (command.join(' ').startsWith('bunx tauri ios build') && !answered) {
      const build = join(runOptions.cwd ?? app, 'src-tauri/gen/apple/build/arm64');
      const zipped = Bun.spawnSync(['zip', '-qr', 'Past the Break.ipa', 'Payload'], { cwd: build });
      if (zipped.exitCode !== 0) return exit(1, 'zip failed');
      return ok('    Finished 1 iOS Bundle at:\n        src-tauri/gen/apple/build/arm64/Past the Break.ipa\n');
    }
    return answered;
  }, ['git', 'plutil', 'unzip', 'rustc']);
  return { ...runner, keyFolders };
}


/** A program that never ends, as a build waiting on a dialog does: a shell loop whose command line names `marker`. */
function hang(marker: string, options: Parameters<typeof runCommand>[1]) {
  return runCommand(['sh', '-c', `echo "[stand-in] hanging ${marker}"; while :; do sleep 1; done # ${marker}`], options);
}
