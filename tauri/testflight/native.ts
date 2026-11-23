/*
 * What `app-kit testflight upload` and `app-kit testflight watch` read from a native Xcode app, one whose folder holds an
 * XcodeGen `project.yml` and no Tauri project, such as an Apple TV app: its app target, platform and bundle id, its test
 * targets' folders, which the watcher leaves out of the app's files, the App Store icon's opacity, and the keychain the
 * build signs from.
 *
 * - The app is the one target of type `application`; an app extension, or a platform other than tvOS and iOS, is
 *   refused, since only the app is signed. The bundle id is the target's PRODUCT_BUNDLE_IDENTIFIER, else XcodeGen's
 *   `bundleIdPrefix` and the target's name, as XcodeGen makes it.
 * - XcodeGen writes CFBundleVersion 1 into a target's generated Info.plist unless `info.properties` says otherwise, and
 *   a build number given to the build changes nothing then (checked with XcodeGen 2.46.0 and Xcode 27.2), so the upload
 *   refuses such a plist before building and names the line to add.
 * - tvOS's App Store icon is an image stack whose front layers are see-through on purpose; App Store Connect wants the
 *   back layer opaque, so only that layer is read.
 * - A plain xcodebuild gets no keychain from anyone, as a Tauri build gets Tauri's, so the upload makes one at a path
 *   of its own with a random password, imports the certificate into it, puts it on the user's keychain list, where
 *   Xcode looks for the signing identity, and deletes it after the build, which also takes it off the list. It is made
 *   under the same signing lock as a Tauri build's, so the two never set the list at once. As with Tauri's, the
 *   passwords are in `security`'s arguments for the length of each call.
 */
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pngOpacities } from './icon-opacity.ts';

/** What differs between the platforms a native app may build for. */
export type NativePlatform = {
  /** As project.yml names it. */
  name: 'tvOS' | 'iOS';
  sdk: 'appletvos' | 'iphoneos';
  /** The App Store profile type App Store Connect makes and lists. */
  profileType: 'TVOS_APP_STORE' | 'IOS_APP_STORE';
  /** altool's --type. */
  altoolType: 'appletvos' | 'ios';
};

export const PLATFORMS: Record<NativePlatform['name'], NativePlatform> = {
  tvOS: { name: 'tvOS', sdk: 'appletvos', profileType: 'TVOS_APP_STORE', altoolType: 'appletvos' },
  iOS: { name: 'iOS', sdk: 'iphoneos', profileType: 'IOS_APP_STORE', altoolType: 'ios' },
};

/** The project file of a native app, beside which the generated Xcode project is written. */
export const PROJECT_YML = 'project.yml';

/** What the upload and the watcher read from project.yml. */
export type NativeProject = {
  /** The Xcode project's name, XcodeGen's `name`. */
  name: string;
  /** The app target's name, which is also the scheme the archive builds. */
  target: string;
  platform: NativePlatform;
  bundleId: string;
  /** The app target's Info.plist, as a path from the folder, when project.yml has XcodeGen write it. */
  infoPlist: string | null;
  /** The app icon's name in the asset catalog. */
  iconName: string;
  /** The folders, from the folder, of the test targets' sources, which are not part of the app. */
  testFolders: string[];
};

/** Whether `folder` holds a native Xcode app the TestFlight upload builds: a project.yml and no Tauri project. */
export function isNativeFolder(folder: string): boolean {
  return existsSync(join(folder, PROJECT_YML)) && !existsSync(join(folder, 'src-tauri/tauri.conf.json'));
}

type Settings = Record<string, unknown>;
type Target = { type?: unknown; platform?: unknown; settings?: unknown; sources?: unknown; info?: { path?: unknown } };

/** A build setting of the target's release configuration, as XcodeGen merges them: configs over base, or a flat map. */
function setting(settings: unknown, name: string): string | null {
  if (!settings || typeof settings !== 'object') return null;
  const s = settings as Settings;
  const configs = s.configs && typeof s.configs === 'object' ? (s.configs as Record<string, Settings>) : {};
  const release = Object.entries(configs).find(([config]) => config.toLowerCase() === 'release')?.[1];
  const base = s.base && typeof s.base === 'object' ? (s.base as Settings) : null;
  const flat = !('base' in s) && !('configs' in s) && !('groups' in s) ? s : null;
  for (const from of [release, base, flat]) {
    const value = from?.[name];
    if (typeof value === 'string' || typeof value === 'number') return String(value);
  }
  return null;
}

/** The folder of each source entry, a string or `{ path }`. */
function sourceFolders(sources: unknown): string[] {
  const list = Array.isArray(sources) ? sources : sources === undefined ? [] : [sources];
  return list.flatMap((entry) => {
    const path = typeof entry === 'string' ? entry : entry && typeof entry === 'object' ? (entry as { path?: unknown }).path : null;
    return typeof path === 'string' && path ? [path.replace(/^\.\//, '').replace(/\/+$/, '').replace(/^\.$/, '')] : [];
  });
}

/** Whether one folder is the other or holds it, `''` being the project's folder itself. */
const overlaps = (a: string, b: string) => a === b || a === '' || b === '' || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

/** The native app's project as project.yml in `folder` describes it, or why the upload cannot build it. */
export function nativeProject(folder: string): NativeProject | { error: string } {
  const file = join(folder, PROJECT_YML);
  let spec: { name?: unknown; options?: { bundleIdPrefix?: unknown }; targets?: Record<string, Target> };
  try {
    spec = Bun.YAML.parse(readFileSync(file, 'utf8')) as typeof spec;
  } catch (error) {
    return { error: `${PROJECT_YML} could not be read as YAML (${error instanceof Error ? error.message : String(error)})` };
  }
  if (!spec || typeof spec !== 'object' || typeof spec.name !== 'string' || !spec.name) return { error: `${PROJECT_YML} names no project (its "name")` };
  const targets = Object.entries(spec.targets ?? {});
  const extensions = targets.filter(([, target]) => typeof target.type === 'string' && target.type.startsWith('app-extension'));
  if (extensions.length) {
    return { error: `${PROJECT_YML} has the app extension ${extensions.map(([name]) => name).join(', ')}, and the upload signs a native app's own target alone: an app with extensions is not uploaded yet` };
  }
  const apps = targets.filter(([, target]) => target.type === 'application');
  if (apps.length !== 1) return { error: `${PROJECT_YML} has ${apps.length ? apps.map(([name]) => name).join(' and ') : 'no target of type application'}; the upload builds one app` };
  const [target, spec_] = apps[0]!;
  const platform = typeof spec_.platform === 'string' ? PLATFORMS[spec_.platform as NativePlatform['name']] : undefined;
  if (!platform) return { error: `${target}'s platform in ${PROJECT_YML} is ${JSON.stringify(spec_.platform ?? null)}; the upload builds tvOS and iOS apps` };
  const prefix = typeof spec.options?.bundleIdPrefix === 'string' ? spec.options.bundleIdPrefix : null;
  const bundleId = setting(spec_.settings, 'PRODUCT_BUNDLE_IDENTIFIER') ?? (prefix ? `${prefix}.${target}` : null);
  if (!bundleId || bundleId.includes('$')) {
    return { error: `${target} in ${PROJECT_YML} has no plain bundle id: set PRODUCT_BUNDLE_IDENTIFIER in its settings, as the upload signs and finds it by that id` };
  }
  // A test target's folder that the app's sources share, hold or sit in is the app's too, so its changes still count.
  const appFolders = sourceFolders(spec_.sources);
  const testFolders = targets
    .filter(([, t]) => t.type === 'bundle.unit-test' || t.type === 'bundle.ui-testing')
    .flatMap(([, t]) => sourceFolders(t.sources))
    .filter((testFolder) => !appFolders.some((appFolder) => overlaps(appFolder, testFolder)));
  return {
    name: spec.name,
    target,
    platform,
    bundleId,
    infoPlist: typeof spec_.info?.path === 'string' ? spec_.info.path : null,
    iconName: setting(spec_.settings, 'ASSETCATALOG_COMPILER_APPICON_NAME') ?? (platform.name === 'tvOS' ? 'App Icon & Top Shelf Image' : 'AppIcon'),
    testFolders: [...new Set(testFolders)].sort(),
  };
}

/** The value XcodeGen's info.properties must give CFBundleVersion so the build number reaches the app. */
export const BUILD_NUMBER_SETTING = '$(CURRENT_PROJECT_VERSION)';

/** Why the generated Info.plist would carry a fixed build number, given its CFBundleVersion, or null. */
export function buildNumberProblem(project: NativeProject, bundleVersion: string | null): string | null {
  if (bundleVersion === BUILD_NUMBER_SETTING) return null;
  return (
    `${project.infoPlist} says CFBundleVersion ${bundleVersion ?? '(none)'}, so every build would carry that number and App Store Connect would refuse all after the first: ` +
    `add "CFBundleVersion: $(CURRENT_PROJECT_VERSION)" and "CFBundleShortVersionString: $(MARKETING_VERSION)" to ${project.target}'s info.properties in ${PROJECT_YML}, and commit it`
  );
}

/** Folders never searched for the asset catalog: packages, builds, git and Xcode's own. */
const SKIPPED = new Set(['node_modules', '.git', 'build', 'DerivedData']);

/** The first folder below `folder` named `name`, as a path from `folder`, searching breadth first. */
function findFolder(folder: string, name: string): string | null {
  let level = [''];
  for (let depth = 0; level.length && depth < 8; depth++) {
    const next: string[] = [];
    for (const relative of level) {
      let entries;
      try {
        entries = readdirSync(join(folder, relative), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || SKIPPED.has(entry.name) || entry.name.endsWith('.xcodeproj')) continue;
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.name === name) return path;
        next.push(path);
      }
    }
    level = next;
  }
  return null;
}

function json<T>(file: string): T | { error: string } {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch (error) {
    return { error: `${file} is not JSON (${error instanceof Error ? error.message : String(error)})` };
  }
}

/** Why `file` (a path from `folder`) is not an icon every pixel of which is opaque, or null. */
function opaqueProblem(folder: string, file: string, what: string, redraw: string): string | null {
  if (!existsSync(join(folder, file))) return `${what} ${file} is missing: ${redraw}`;
  const opacities = pngOpacities(readFileSync(join(folder, file)));
  if (opacities === null) return `${what} ${file} is not a PNG that can be read: ${redraw}`;
  const least = opacities.findIndex((count) => count > 0);
  if (least < 255) return `${what} ${file} has see-through pixels (the least opaque is ${least} of 255), which App Store Connect refuses after the whole build (90717): ${redraw}`;
  return null;
}

/**
 * Why the native app's App Store icon would make Apple refuse the upload, or null, read after `xcodegen generate`, which
 * runs the step an app draws its icons in. tvOS: the brand assets' 1280x768 App Store image stack, whose back layer
 * (the last of its layers, which are listed front first) must be opaque. iOS: the icon set's 1024 App Store entry.
 */
export function nativeIconProblem(folder: string, project: NativeProject): string | null {
  const redraw = `draw it, opaque, before the project is generated (XcodeGen's options.preGenCommand runs a step before every generate)`;
  if (project.platform.name === 'iOS') {
    const set = findFolder(folder, `${project.iconName}.appiconset`);
    if (!set) return `no ${project.iconName}.appiconset was found below ${folder}, so the build would have no App Store icon: ${redraw}`;
    type Entry = { idiom?: string; platform?: string; size?: string; filename?: string; appearances?: unknown[] };
    const contents = json<{ images?: Entry[] }>(join(folder, set, 'Contents.json'));
    if ('error' in contents) return contents.error;
    const entry = (contents.images ?? []).find(
      (image) => image.size === '1024x1024' && !image.appearances?.length && (image.idiom === 'ios-marketing' || (image.idiom === 'universal' && image.platform === 'ios')),
    );
    if (!entry?.filename) return `${set} has no App Store icon (a 1024x1024 ios-marketing entry with a file), which App Store Connect requires: ${redraw}`;
    return opaqueProblem(folder, `${set}/${entry.filename}`, 'the App Store icon', redraw);
  }
  const brand = findFolder(folder, `${project.iconName}.brandassets`);
  if (!brand) return `no ${project.iconName}.brandassets was found below ${folder}, so the build would have no App Store icon: ${redraw}`;
  const assets = json<{ assets?: { filename?: string; role?: string; size?: string }[] }>(join(folder, brand, 'Contents.json'));
  if ('error' in assets) return assets.error;
  const store = (assets.assets ?? []).find((asset) => asset.role === 'primary-app-icon' && asset.size === '1280x768' && asset.filename);
  if (!store) return `${brand} has no App Store icon (a 1280x768 primary-app-icon), which App Store Connect requires: ${redraw}`;
  const stack = `${brand}/${store.filename}`;
  const layers = json<{ layers?: { filename?: string }[] }>(join(folder, stack, 'Contents.json'));
  if ('error' in layers) return layers.error;
  const back = layers.layers?.at(-1)?.filename;
  if (!back) return `${stack} has no layers: ${redraw}`;
  const imageSet = `${stack}/${back}/Content.imageset`;
  const images = json<{ images?: { filename?: string }[] }>(join(folder, imageSet, 'Contents.json'));
  if ('error' in images) return images.error;
  const files = (images.images ?? []).flatMap((image) => (image.filename ? [image.filename] : []));
  if (!files.length) return `${imageSet}, the App Store icon's back layer, has no image: ${redraw}`;
  for (const file of files) {
    const problem = opaqueProblem(folder, `${imageSet}/${file}`, "the App Store icon's back layer", redraw);
    if (problem) return problem;
  }
  return null;
}

/** The signing settings written into the app target's configurations, plain and for the platform's devices. */
export function nativeSigningSettings(platform: NativePlatform, signedWith: { identity: string; team: string; profileUuid: string; keychain: string }): [string, string][] {
  const quote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const device = `[sdk=${platform.sdk}*]`;
  return [
    ['CODE_SIGN_STYLE', 'Manual'],
    ['CODE_SIGN_IDENTITY', quote(signedWith.identity)],
    [`"CODE_SIGN_IDENTITY${device}"`, quote(signedWith.identity)],
    ['DEVELOPMENT_TEAM', signedWith.team],
    [`"DEVELOPMENT_TEAM${device}"`, signedWith.team],
    ['PROVISIONING_PROFILE_SPECIFIER', quote(signedWith.profileUuid)],
    [`"PROVISIONING_PROFILE_SPECIFIER${device}"`, quote(signedWith.profileUuid)],
    ['OTHER_CODE_SIGN_FLAGS', quote(`--keychain ${signedWith.keychain}`)],
  ];
}

/** The export settings for the archive: the App Store, signed by hand with the certificate and the app's profile. */
export function exportOptions(signedWith: { identity: string; team: string; bundleId: string; profileUuid: string }): string {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n' +
    '\t<key>method</key>\n\t<string>app-store-connect</string>\n' +
    '\t<key>destination</key>\n\t<string>export</string>\n' +
    '\t<key>signingStyle</key>\n\t<string>manual</string>\n' +
    `\t<key>signingCertificate</key>\n\t<string>${escape(signedWith.identity)}</string>\n` +
    `\t<key>teamID</key>\n\t<string>${escape(signedWith.team)}</string>\n` +
    `\t<key>provisioningProfiles</key>\n\t<dict>\n\t\t<key>${escape(signedWith.bundleId)}</key>\n\t\t<string>${escape(signedWith.profileUuid)}</string>\n\t</dict>\n` +
    '</dict>\n</plist>\n'
  );
}

/** The keychains `security list-keychains -d user` lists, one quoted path a line. */
export function listedKeychains(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
}

/** `security` run with these arguments, synchronously, as a signal's handler must: its exit code and output. */
export type Security = (args: string[]) => { code: number; out: string };
const security: Security = (args) => {
  const done = Bun.spawnSync(['/usr/bin/security', ...args], { stdout: 'pipe', stderr: 'pipe' });
  return { code: done.exitCode ?? 1, out: `${done.stdout.toString()}${done.stderr.toString()}` };
};

/**
 * Deletes the keychain the build signed from, which takes it off the user's keychain list too. When security cannot
 * delete it, the file is removed and the list is set again without it; what is still wrong after that is returned, for
 * the upload to say. Synchronous, for a signal's handler.
 */
export function deleteKeychain(path: string, run: Security = security): string | null {
  const deleted = run(['delete-keychain', path]);
  rmSync(path, { force: true });
  if (deleted.code === 0) return null;
  const listed = run(['list-keychains', '-d', 'user']);
  if (listed.code !== 0) return `security could not delete the build's keychain ${path} (${lastLine(deleted.out)}), nor list the keychains to check it is off the list: security list-keychains -d user shows them`;
  const kept = listedKeychains(listed.out);
  if (!kept.includes(path)) return null;
  const others = kept.filter((keychain) => keychain !== path);
  const set = run(['list-keychains', '-d', 'user', '-s', ...others]);
  if (set.code === 0) return null;
  return `the build's keychain ${path} is gone but still on the keychain list, and security could not take it off (${lastLine(set.out)}): security list-keychains -d user -s ${others.map((keychain) => JSON.stringify(keychain)).join(' ')} does`;
}

const lastLine = (text: string) => text.trim().split('\n').at(-1) ?? '';
