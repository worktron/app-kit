// `app-kit testflight upload` for a native Xcode app, an Apple TV app laid out as Lifeform's is: what it reads from
// project.yml, the checks before the build (XcodeGen's fixed build number, the App Store icon's back layer), the
// keychain it makes and deletes, the tvOS profile, the archive and export, and the upload as an Apple TV app; and which
// of its folder's files the watcher counts. Stand-ins for XcodeGen, xcodebuild, the keychain, 1Password, codesign,
// altool and App Store Connect, in a real git repository reached over file://.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand } from '../command-line/run.ts';
import { countsAsApp } from '../tauri/watch-main.ts';
import { decide } from '../tauri/testflight/watch.ts';
import { upload, type UploadOptions } from '../tauri/testflight/upload.ts';
import { buildNumberProblem, deleteKeychain, isNativeFolder, nativeIconProblem, nativeProject, PLATFORMS, type NativeProject } from '../tauri/testflight/native.ts';
import { drawTvIcons, LISTED_KEYCHAIN, projectYml, tv as tvFor, TV_BUNDLE_ID, TV_TARGET, tvFixture, type Tv } from './testflight-native-stand-in.ts';
import { appStoreConnect, CERTIFICATE, commit, git, GIT_IDENTITY_ENV, profileContent, scratch } from './testflight-stand-in.ts';

// Each test runs real git a dozen or more times, so it is held to the fifteen seconds a test may take, not Bun's five.
setDefaultTimeout(15_000);

let place: ReturnType<typeof scratch>;
let origin: string;
let app: string;
let asc: Awaited<ReturnType<typeof appStoreConnect>>;
const tv = (options: Tv = {}) => tvFor(app, asc.builds, options);

beforeEach(async () => {
  place = scratch('testflight-native-');
  ({ origin, app } = tvFixture(place.folder));
  // Apple holds no tvOS profile for the app yet; the iPhone one the stand-in starts with is another platform's.
  asc = await appStoreConnect({ bundleId: TV_BUNDLE_ID });
});

afterEach(async () => {
  await asc.stop();
  place.done();
});

async function runUpload(stand: ReturnType<typeof tv>, overrides: Partial<UploadOptions> = {}) {
  const printed: string[] = [];
  let clock = 0;
  const code = await upload({
    cwd: app,
    tokenOnly: false,
    run: stand.run,
    home: place.folder,
    appStoreConnect: asc.options,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    print: (line) => printed.push(line),
    fail: (line) => printed.push(`! ${line}`),
    output: () => {},
    ...overrides,
    env: { ...GIT_IDENTITY_ENV, PATH: '/usr/bin:/bin', HOME: place.folder },
  });
  return { code, printed, stand };
}

/** Lands a commit on the origin's main and brings the app's checkout to it. */
const land = (files: Record<string, string>) => {
  commit(origin, files);
  git(app, 'pull', '-q', '--ff-only');
};

const count = () => git(app, 'rev-list', '--count', 'HEAD');
const short = () => git(app, 'rev-parse', '--short=7', 'HEAD');

test("an Apple TV app is generated, signed with a tvOS profile from a keychain of its own, archived with the build number, exported, uploaded as an Apple TV app and waited on", async () => {
  const stand = tv();
  const { code, printed } = await runUpload(stand);
  expect(printed).toEqual([`building build ${count()} (${short()})`, `uploading build ${count()} (${short()})`, `build ${count()} (${short()}) processed; TestFlight: IN_BETA_TESTING`]);
  expect(code).toBe(0);
  // A tvOS App Store profile was asked for, none was held, so one was made for the app's bundle id.
  expect(asc.requests.some((request) => request.includes('filter[profileType]=TVOS_APP_STORE'))).toBe(true);
  const made = asc.profiles.at(-1)!;
  expect(made.type).toBe('TVOS_APP_STORE');
  // The archive: the app's scheme for the Apple TV, the build number as the build setting the Info.plist reads.
  const archive = stand.named('xcodebuild archive')[0]!.command;
  expect(archive.slice(0, 13)).toEqual(['xcodebuild', 'archive', '-project', 'Couch.xcodeproj', '-scheme', TV_TARGET, '-configuration', 'Release', '-sdk', 'appletvos', '-destination', 'generic/platform=tvOS', '-archivePath']);
  expect(archive.at(-1)).toBe(`CURRENT_PROJECT_VERSION=${count()}`);
  // The signing went into the app target's two configurations of the generated project, and no other target's.
  const keychain = stand.named('/usr/bin/security create-keychain')[0]!.command.at(-1)!;
  const project = stand.during.project!;
  for (const line of ['CODE_SIGN_STYLE = Manual;', 'CODE_SIGN_IDENTITY = "Apple Distribution: Team (TEAM000000)";', '"CODE_SIGN_IDENTITY[sdk=appletvos*]" = "Apple Distribution: Team (TEAM000000)";', `PROVISIONING_PROFILE_SPECIFIER = "${made.uuid}";`, `OTHER_CODE_SIGN_FLAGS = "--keychain ${keychain}";`]) {
    expect(project.split('\n').filter((l) => l.trim() === line)).toHaveLength(2);
  }
  // The keychain: the certificate imported into it, put first on the list with the user's keychains kept, deleted after.
  const imported = stand.named('/usr/bin/security import')[0]!.command;
  expect(imported.slice(imported.indexOf('-P'), imported.indexOf('-P') + 2)).toEqual(['-P', CERTIFICATE.password]);
  expect(stand.named('/usr/bin/security list-keychains -d user -s')[0]!.command.slice(5)).toEqual([keychain, LISTED_KEYCHAIN]);
  expect(existsSync(keychain)).toBe(false);
  // The export, by hand with the profile for the bundle id, and the upload as an Apple TV app.
  expect(stand.during.exportOptions).toContain(`<key>${TV_BUNDLE_ID}</key>\n\t\t<string>${made.uuid}</string>`);
  expect(stand.during.exportOptions).toContain('<string>app-store-connect</string>');
  expect(stand.named('altool --upload-app')[0]!.command.slice(0, 5)).toEqual(['xcrun', 'altool', '--upload-app', '--type', 'appletvos']);
  // Apple's rsync first on the build's path, as the export needs; the profile where Xcode reads it.
  expect(stand.during.tools).toEqual({ rsync: '/usr/bin/rsync' });
  expect(readFileSync(join(place.folder, 'Library/Developer/Xcode/UserData/Provisioning Profiles', `${made.uuid}.mobileprovision`))).toEqual(Buffer.from(profileContent(made.uuid), 'base64'));
  // Nothing committed changed, the temporary folder with the archive and its apps is gone, and the lock is let go.
  expect(git(app, 'status', '--porcelain', '--untracked-files=no')).toBe('');
  expect(existsSync(join(keychain, '..'))).toBe(false);
  expect((await runUpload(tv())).code).toBe(0);
  // The second run found the profile the first made, and made none.
  expect(asc.profiles.filter((p) => p.type === 'TVOS_APP_STORE')).toHaveLength(1);
});

test("an Apple TV upload waits on its own build, though the iPhone app sharing its App Store Connect record has a processed build of the same number", async () => {
  asc.builds.push({ number: count(), states: ['VALID'] });
  const { code, printed } = await runUpload(tv({ states: ['PROCESSING', 'INVALID'] }));
  expect(printed.at(-1)).toBe(`! Apple's processing of build ${count()} ended INVALID`);
  expect(code).toBe(1);
  const lookups = asc.requests.filter((request) => request.startsWith('/v1/builds'));
  expect(lookups.length).toBeGreaterThan(0);
  expect(lookups.every((request) => request.includes('filter[preReleaseVersion.platform]=TV_OS'))).toBe(true);
});

test("a generated Info.plist with XcodeGen's fixed build number is refused before anything is built, naming the line to add", async () => {
  const stand = tv({ bundleVersion: '1' });
  const { code, printed } = await runUpload(stand);
  expect(code).toBe(1);
  expect(printed).toEqual([
    `! ${TV_TARGET}/Info.plist says CFBundleVersion 1, so every build would carry that number and App Store Connect would refuse all after the first: add "CFBundleVersion: $(CURRENT_PROJECT_VERSION)" and "CFBundleShortVersionString: $(MARKETING_VERSION)" to ${TV_TARGET}'s info.properties in project.yml, and commit it`,
  ]);
  expect(stand.named('xcodebuild')).toEqual([]);
  expect(stand.named('op item get')).toEqual([]);
});

describe("the Apple TV App Store icon, read on its back layer", () => {
  test('a see-through front layer goes up', async () => {
    expect((await runUpload(tv({ icons: { front: 0, back: 255 } }))).code).toBe(0);
  });

  test('a see-through back layer, or no App Store icon, is refused before the build', async () => {
    const back = await runUpload(tv({ icons: { back: 254 } }));
    expect(back.code).toBe(1);
    expect(back.printed[0]).toContain("the App Store icon's back layer Icon.xcassets/App Icon & Top Shelf Image.brandassets/App Icon - App Store.imagestack/Back.imagestacklayer/Content.imageset/1x.png has see-through pixels (the least opaque is 254 of 255)");
    const missing = await runUpload(tv({ icons: { appStore: false } }));
    expect(missing.printed[0]).toContain('has no App Store icon (a 1280x768 primary-app-icon)');
    const none = await runUpload(tv({ icons: false }));
    expect(none.printed[0]).toContain('no App Icon & Top Shelf Image.brandassets was found');
    expect(none.printed[0]).toContain('preGenCommand');
  });

  test('an iPhone app is read on its icon set', () => {
    const folder = join(place.folder, 'phone');
    mkdirSync(join(folder, 'Assets.xcassets/AppIcon.appiconset'), { recursive: true });
    writeFileSync(join(folder, 'Assets.xcassets/AppIcon.appiconset/Contents.json'), JSON.stringify({ images: [{ size: '1024x1024', idiom: 'universal', platform: 'ios', filename: 'icon.png' }] }));
    drawTvIcons(folder);
    const project = { ...(nativeProject(app) as NativeProject), platform: PLATFORMS.iOS, iconName: 'AppIcon' } as const;
    expect(nativeIconProblem(folder, project)).toContain('AppIcon.appiconset/icon.png is missing');
    writeFileSync(join(folder, 'Assets.xcassets/AppIcon.appiconset/icon.png'), readFileSync(join(folder, 'Icon.xcassets/App Icon & Top Shelf Image.brandassets/App Icon.imagestack/Back.imagestacklayer/Content.imageset/1x.png')));
    expect(nativeIconProblem(folder, project)).toBeNull();
  });
});

describe('project.yml', () => {
  test('the app, its platform, bundle id, Info.plist, icon and test folders are read', () => {
    expect(nativeProject(app)).toEqual({
      name: 'Couch',
      target: TV_TARGET,
      platform: { name: 'tvOS', sdk: 'appletvos', profileType: 'TVOS_APP_STORE', altoolType: 'appletvos', appStorePlatform: 'TV_OS' },
      bundleId: TV_BUNDLE_ID,
      infoPlist: `${TV_TARGET}/Info.plist`,
      iconName: 'App Icon & Top Shelf Image',
      testFolders: [`${TV_TARGET}Tests`, `${TV_TARGET}UITests`],
    });
    expect(isNativeFolder(app)).toBe(true);
    // A Tauri project beside it is the Tauri path's.
    mkdirSync(join(app, 'src-tauri'));
    writeFileSync(join(app, 'src-tauri/tauri.conf.json'), '{}');
    expect(isNativeFolder(app)).toBe(false);
  });

  test("the bundle id falls back to XcodeGen's prefix and the target's name, and a release config's wins", () => {
    const read = (yml: string) => {
      writeFileSync(join(app, 'project.yml'), yml);
      return nativeProject(app);
    };
    const base = 'name: Couch\noptions:\n  bundleIdPrefix: com.example\ntargets:\n  Sofa:\n    type: application\n    platform: tvOS\n';
    expect(read(base)).toMatchObject({ bundleId: 'com.example.Sofa', infoPlist: null, testFolders: [] });
    expect(read(`${base}    settings:\n      base:\n        PRODUCT_BUNDLE_IDENTIFIER: a.b\n      configs:\n        Release:\n          PRODUCT_BUNDLE_IDENTIFIER: a.c\n`)).toMatchObject({ bundleId: 'a.c' });
    expect(read(`${base}    settings:\n      PRODUCT_BUNDLE_IDENTIFIER: a.d\n`)).toMatchObject({ bundleId: 'a.d' });
  });

  test("a test target's folder that the app's sources share, hold or sit in stays the app's", () => {
    writeFileSync(
      join(app, 'project.yml'),
      'name: Couch\noptions:\n  bundleIdPrefix: com.example\ntargets:\n  Sofa:\n    type: application\n    platform: tvOS\n    sources: [Sofa, Shared/Models]\n' +
        '  SofaTests:\n    type: bundle.unit-test\n    platform: tvOS\n    sources: [SofaTests, Sofa, Shared, ./Sofa/Views]\n',
    );
    expect(nativeProject(app)).toMatchObject({ testFolders: ['SofaTests'] });
    writeFileSync(join(app, 'project.yml'), 'name: Couch\noptions:\n  bundleIdPrefix: com.example\ntargets:\n  Sofa:\n    type: application\n    platform: tvOS\n    sources: [.]\n  SofaTests:\n    type: bundle.unit-test\n    platform: tvOS\n    sources: [SofaTests]\n');
    expect(nativeProject(app)).toMatchObject({ testFolders: [] });
  });

  test('no app target, two, an app extension, another platform or a bundle id from a setting is refused, and nothing is built', async () => {
    const cases: [string, string][] = [
      ['name: Couch\ntargets:\n  Tests:\n    type: bundle.unit-test\n    platform: tvOS\n', 'project.yml has no target of type application; the upload builds one app'],
      ['name: Couch\ntargets:\n  A:\n    type: application\n    platform: tvOS\n  B:\n    type: application\n    platform: tvOS\n', 'project.yml has A and B; the upload builds one app'],
      ['name: Couch\ntargets:\n  A:\n    type: application\n    platform: tvOS\n  Shelf:\n    type: app-extension\n    platform: tvOS\n', 'project.yml has the app extension Shelf'],
      ['name: Couch\ntargets:\n  A:\n    type: application\n    platform: macOS\n', `A's platform in project.yml is "macOS"; the upload builds tvOS and iOS apps`],
      ['name: Couch\ntargets:\n  A:\n    type: application\n    platform: tvOS\n    settings:\n      PRODUCT_BUNDLE_IDENTIFIER: $(BASE).tv\n', 'A in project.yml has no plain bundle id'],
    ];
    for (const [yml, said] of cases) {
      land({ 'project.yml': yml });
      const stand = tv();
      const { code, printed } = await runUpload(stand);
      expect(code).toBe(1);
      expect(printed[0]).toContain(said);
      expect(stand.named('xcodegen')).toEqual([]);
    }
  });

  test('a committed Xcode project, a generate that changes committed files, or no XcodeGen is refused before the build', async () => {
    const missing = await runUpload(tv({ xcodegen: false }));
    expect(missing.printed).toEqual(['! the project is generated by XcodeGen, which is not on PATH: brew install xcodegen']);
    const rewrites = await runUpload(tv({ writesCommitted: 'README.md' }));
    expect(rewrites.printed).toEqual(["! xcodegen generate changed or wrote files git does not ignore (README.md), so the build would not be the commit's: have git ignore what it writes, or commit it"]);
    expect(rewrites.stand.named('xcodebuild')).toEqual([]);
    git(app, 'checkout', '-q', 'README.md');
    // A generated Info.plist git does not ignore would leave the tree unclean for the next run, so it is refused too.
    rmSync(join(app, TV_TARGET, 'Info.plist'));
    land({ '.gitignore': 'Couch.xcodeproj/\nIcon.xcassets/\nnode_modules/\n' });
    const untracked = await runUpload(tv());
    expect(untracked.printed).toEqual([`! xcodegen generate changed or wrote files git does not ignore (${TV_TARGET}/Info.plist), so the build would not be the commit's: have git ignore what it writes, or commit it`]);
    rmSync(join(app, TV_TARGET, 'Info.plist'));
    // Git ignores the generated project no longer, and a copy of it is committed.
    rmSync(join(app, 'Couch.xcodeproj'), { recursive: true });
    land({ '.gitignore': `${TV_TARGET}/Info.plist\nIcon.xcassets/\nnode_modules/\n`, 'Couch.xcodeproj/project.pbxproj': '{}' });
    const committed = tv();
    expect((await runUpload(committed)).printed[0]).toContain('Couch.xcodeproj is committed');
    expect(committed.named('xcodegen generate')).toEqual([]);
  });
});

test('a Swift compile failure exits 3, and the keychain and temporary folder are deleted', async () => {
  const stand = tv({ build: 'compile' });
  const { code, printed } = await runUpload(stand);
  expect(code).toBe(3);
  expect(printed.at(-1)).toContain(`did not compile: ** ARCHIVE FAILED **`);
  const keychain = stand.named('/usr/bin/security create-keychain')[0]!.command.at(-1)!;
  expect(existsSync(join(keychain, '..'))).toBe(false);
  // The lock is let go.
  expect((await runUpload(tv())).code).toBe(0);
});

test("a build that does not say ITSAppUsesNonExemptEncryption false, or carries another bundle id, never goes up", async () => {
  const encryption = await runUpload(tv({ encryption: false }));
  expect(encryption.printed.at(-1)).toContain(`put "ITSAppUsesNonExemptEncryption: false" in ${TV_TARGET}'s info.properties in project.yml`);
  const other = tv({ bundleId: 'com.example.other' });
  const { code, printed } = await runUpload(other);
  expect(code).toBe(1);
  expect(printed.at(-1)).toContain(`its bundle id is com.example.other, not ${TV_BUNDLE_ID}`);
  expect(other.named('altool')).toEqual([]);
});

test("stopped by the watcher's time limit mid-archive, the native upload stops the build and deletes its keychain and folder", async () => {
  const marker = join(place.folder, 'hang-archive');
  const temporary = join(place.folder, 'tmp');
  mkdirSync(temporary);
  const stopped = await runCommand(['caffeinate', '-i', 'bun', join(import.meta.dir, 'testflight-native-child.ts'), app, place.folder, marker], {
    env: { ...process.env, TMPDIR: temporary, ...GIT_IDENTITY_ENV },
    output: (chunk) => (chunk.includes(`hanging ${marker}`) ? 0 : undefined),
  });
  expect(stopped.timedOut).toBe(true);
  expect(stopped.out).toContain('[testflight] stopped by SIGTERM; stopping the programs it started and removing the key');
  expect(Bun.spawnSync(['pgrep', '-f', marker]).stdout.toString()).toBe('');
  // The folder holding the keychain, the archive and the build is gone.
  expect(readdirSync(temporary).filter((name) => name.startsWith('app-kit-testflight-native-'))).toEqual([]);
});

describe("the watcher's rule for a native app's files", () => {
  const excluded = ['check', `${TV_TARGET}Tests`, `${TV_TARGET}UITests`];
  test("its folder's files count, but not its documentation, check folder or test targets", () => {
    const counts = (path: string) => countsAsApp(path, 'packs-its-pages', 'tvos', excluded);
    expect(counts(`tvos/${TV_TARGET}/Home.swift`)).toBe(true);
    expect(counts('tvos/project.yml')).toBe(true);
    expect(counts('tvos/scripts/render-icons.ts')).toBe(true);
    expect(counts('tvos/package.json')).toBe(true);
    expect(counts('tvos/README.md')).toBe(false);
    expect(counts('tvos/check/run.sh')).toBe(false);
    expect(counts(`tvos/${TV_TARGET}Tests/HomeTests.swift`)).toBe(false);
    expect(counts(`tvos/${TV_TARGET}UITests/TonightTests.swift`)).toBe(false);
    expect(counts('client/public/icon.svg')).toBe(false);
  });

  test('a landing that changes only its tests is skipped, and one that changes the app goes up', () => {
    const head = { commit: 'b'.repeat(40), count: 12 };
    const judge = (changed: string[]) => decide({ newest: 10, newestCommit: 'a'.repeat(40), head, changed, kind: 'packs-its-pages', folder: 'tvos', excluded });
    expect(judge([`tvos/${TV_TARGET}Tests/HomeTests.swift`, 'tvos/README.md'])).toEqual({ upload: false, reason: 'skipped: no app files changed since build 10' });
    expect(judge([`tvos/${TV_TARGET}/Home.swift`]).upload).toBe(true);
  });
});

test("a keychain security cannot delete is taken off the user's list, and one it cannot take off is named", () => {
  const keychain = join(place.folder, 'signing.keychain-db');
  const login = '/Library/Keychains/System.keychain';
  const answer = (setCode: number) => {
    const calls: string[][] = [];
    const run = (args: string[]) => {
      calls.push(args);
      if (args[0] === 'delete-keychain') return { code: 50, out: 'security: SecKeychainDelete: The specified keychain could not be found.' };
      if (args.includes('-s')) return { code: setCode, out: setCode ? 'security: SecKeychainSetSearchList: refused' : '' };
      return { code: 0, out: `    "${keychain}"\n    "${login}"\n` };
    };
    return { calls, run };
  };
  writeFileSync(keychain, 'a keychain');
  const taken = answer(0);
  expect(deleteKeychain(keychain, taken.run)).toBeNull();
  expect(existsSync(keychain)).toBe(false);
  expect(taken.calls.at(-1)).toEqual(['list-keychains', '-d', 'user', '-s', login]);
  const stuck = answer(1);
  expect(deleteKeychain(keychain, stuck.run)).toBe(`the build's keychain ${keychain} is gone but still on the keychain list, and security could not take it off (security: SecKeychainSetSearchList: refused): security list-keychains -d user -s "${login}" does`);
  // Deleted as asked, nothing more is done.
  const fine = { calls: [] as string[][], run: (args: string[]) => (fine.calls.push(args), { code: 0, out: '' }) };
  expect(deleteKeychain(keychain, fine.run)).toBeNull();
  expect(fine.calls).toEqual([['delete-keychain', keychain]]);
});

test('the build number check passes the build setting and refuses anything else', () => {
  const project = nativeProject(app) as NativeProject;
  expect(buildNumberProblem(project, '$(CURRENT_PROJECT_VERSION)')).toBeNull();
  expect(buildNumberProblem(project, null)).toContain('says CFBundleVersion (none)');
  expect(projectYml('')).not.toContain('CFBundleVersion');
});
