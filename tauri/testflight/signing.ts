/*
 * How the upload signs: with the team's distribution certificate from 1Password and the app's App Store provisioning
 * profile from App Store Connect, handed to Tauri in IOS_CERTIFICATE, IOS_CERTIFICATE_PASSWORD and IOS_MOBILE_PROVISION,
 * Tauri's documented way to sign with a given certificate (https://v2.tauri.app/distribute/sign/ios/). No Apple account
 * need be signed in to Xcode.
 *
 * What Tauri does with them, read in its source at tauri-cli-v2.12.1, and what is put back here:
 * - It makes a keychain of its own at a random path, puts it on the user's keychain list, unlocks it for an hour and
 *   imports the certificate into it; it deletes it only when it ends normally, so a build stopped by the watcher's time
 *   limit leaves it, holding the private key. Tauri runs `security` from PATH, so the build's PATH starts with a
 *   folder holding a `security` that writes down each keychain it is asked to create and hands every call to macOS's
 *   own; after the build, on a stop by signal too, exactly those keychains are deleted, and no other. One left by an
 *   upload killed outright (SIGKILL), which no handler sees, stays: locked after an hour, behind a random password
 *   nobody kept.
 * - It writes the profile into ~/Library/MobileDevice/Provisioning Profiles under a random name and leaves it; Xcode 16
 *   and later read ~/Library/Developer/Xcode/UserData/Provisioning Profiles, so the profile is written there by its
 *   uuid, which is not secret and the next run writes again, and the copy Tauri wrote during the build, a file that was
 *   not there before it with the profile's bytes, is removed.
 * - It writes CODE_SIGN_STYLE, CODE_SIGN_IDENTITY, DEVELOPMENT_TEAM and PROVISIONING_PROFILE_SPECIFIER into the iPhone
 *   target of the committed Xcode project, so the project is put back, only when nothing else in it changed and each
 *   signing line it changed carries this build's own team or profile, so an edit made meanwhile is not lost.
 * - Two Tauri builds signing at once each read the keychain list and set it back with their own added, dropping the
 *   other's, so signing builds run under a lock, one on a Mac at a time.
 * - Before 2.12.1 it put PROVISIONING_PROFILE_SPECIFIER outside the target (tauri#14462), and the build failed asking
 *   for a profile, so an older Tauri CLI is refused.
 *
 * The three variables reach every program the build runs. Any of them could already read the 1Password token from the
 * login keychain with /usr/bin/security, so this widens nothing.
 *
 * An app extension, such as a share sheet entry, is a second target in the committed Xcode project, which Tauri keeps
 * as it is. Tauri signs only the iPhone target, so for each extension:
 * - Its manual signing settings (the same four Tauri writes for the app, with its own profile) are written into its
 *   build configurations before the build, and put back after by the same rule as Tauri's.
 * - Tauri 2.12.1 to 2.12.4 write the export settings with only the app's profile, replacing any list the committed
 *   ExportOptions.plist holds (tauri-cli src/helpers/plist.rs, merge_plist), and Xcode's export refuses an extension
 *   with no profile there. cargo-mobile2 runs `xcodebuild` by name from PATH, so the folder first on the build's PATH
 *   holds an `xcodebuild` that sets each extension's profile in the export settings it is given and hands every call
 *   to Apple's. Tauri's pull request #15773 (merged to its dev branch on 2026-10-21, not yet released) keeps the
 *   committed list; once the kit's Tauri CLI floor is past it, the extension's entry can be written into
 *   ExportOptions.plist and put back, as the export method is, and this `xcodebuild` removed.
 * - Tauri's archive runs `agvtool new-version -all`, which writes the build number into the extension's Info.plist
 *   too, so the upload puts back every tracked Info.plist of the Tauri project, not only the app's.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Certificate } from './key.ts';
import type { Env } from '../build-env.ts';
import type { Run } from '../../command-line/run.ts';

/** The oldest Tauri CLI that writes the profile setting into the iPhone target. */
export const TAURI_CLI_FLOOR = [2, 12, 1] as const;

/** macOS's own openssl, LibreSSL: it reads the .p12 the README's steps make. Homebrew's, often first on PATH, is not it. */
export const OPENSSL = '/usr/bin/openssl';

/** The settings Tauri writes into the Xcode project to sign by hand, with or without the iPhone-only form. */
const SIGNING_SETTING = /^\s*"?(?:CODE_SIGN_STYLE|CODE_SIGN_IDENTITY|DEVELOPMENT_TEAM|PROVISIONING_PROFILE_SPECIFIER)(?:\[sdk=iphoneos\*\])?"?\s*=.*;\s*$/;

/** Why the app's Tauri CLI cannot sign by hand, or null. */
export function tauriCliProblem(cwd: string): string | null {
  // Found as `bunx tauri` finds it: in the folder's node_modules or any folder's above, where a workspace hoists it.
  let file: string | null = null;
  for (let folder = resolve(cwd); ; folder = dirname(folder)) {
    const candidate = join(folder, 'node_modules/@tauri-apps/cli/package.json');
    if (existsSync(candidate)) {
      file = candidate;
      break;
    }
    if (dirname(folder) === folder) break;
  }
  if (!file) return `${cwd} has no @tauri-apps/cli in node_modules: run bun install`;
  let version: string;
  try {
    version = String((JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown }).version ?? '');
  } catch {
    return `${file} is not JSON`;
  }
  const parts = version.split(/[.-]/).slice(0, 3).map(Number);
  for (const [at, floor] of TAURI_CLI_FLOOR.entries()) {
    const part = parts[at] ?? 0;
    if (part > floor) return null;
    if (part < floor || Number.isNaN(part)) {
      return `the app's Tauri CLI is ${version}, and signing with the certificate needs ${TAURI_CLI_FLOOR.join('.')} or later (earlier ones put the profile outside the iPhone target): update @tauri-apps/cli`;
    }
  }
  return null;
}

/** The iPhone app's bundle id: tauri.conf.json's identifier, or tauri.ios.conf.json's when it sets one, as Tauri merges them. */
export function bundleIdentifier(cwd: string): string | null {
  const read = (name: string) => {
    const file = join(cwd, 'src-tauri', name);
    if (!existsSync(file)) return null;
    try {
      const identifier = (JSON.parse(readFileSync(file, 'utf8')) as { identifier?: unknown }).identifier;
      return typeof identifier === 'string' && identifier ? identifier : null;
    } catch {
      return null;
    }
  };
  return read('tauri.ios.conf.json') ?? read('tauri.conf.json');
}

/**
 * What the upload reads from the certificate: its serial number, which Apple's record is found by, its team id, and its
 * common name, which Tauri writes as the app's CODE_SIGN_IDENTITY and the upload writes for each extension.
 */
export type CertificateFacts = { serial: string; team: string; name: string };

/** The certificate's serial number and team from the .p12, read by macOS's openssl, or why they could not be read. */
export async function certificateFacts(certificate: Certificate, folder: string, run: Run, env: Env): Promise<CertificateFacts | { error: string }> {
  const file = join(folder, 'certificate.p12');
  writeFileSync(file, Buffer.from(certificate.p12, 'base64'), { mode: 0o600 });
  const withPassword = { ...env, APP_KIT_P12_PASSWORD: certificate.password };
  const pem = await run([OPENSSL, 'pkcs12', '-in', file, '-nokeys', '-clcerts', '-passin', 'env:APP_KIT_P12_PASSWORD'], { env: withPassword });
  if (pem.code !== 0 || !pem.stdout.includes('BEGIN CERTIFICATE')) {
    return { error: 'openssl could not read the certificate from the .p12 in 1Password: is its "password" the one it was made with?' };
  }
  const read = await run([OPENSSL, 'x509', '-noout', '-serial', '-subject'], { env, input: pem.stdout });
  const serial = read.stdout.match(/serial=([0-9A-Fa-f]+)/)?.[1];
  // Apple writes the team id as the subject's organizational unit: /UID=.../CN=.../OU=TEAMID/O=.../C=...
  const team = read.stdout.match(/\bOU\s*=\s*([A-Z0-9]+)/)?.[1];
  // macOS's openssl writes the subject with slashes; a name may hold a comma but never a slash.
  const name = read.stdout.match(/\/CN=([^/\n]+)/)?.[1]?.trim() ?? read.stdout.match(/\bCN\s*=\s*(.+?)(?:,\s*OU\s*=|\n|$)/)?.[1]?.trim();
  if (!serial || !team || !name) return { error: `openssl read no serial number, team or name from the certificate: ${read.out.trim()}` };
  return { serial, team, name };
}

/** The Xcode project of the Tauri project in `cwd`, as a path from `cwd`, or null when `tauri ios init` has made none. */
export function xcodeProjectFile(cwd: string): string | null {
  const folder = join(cwd, 'src-tauri/gen/apple');
  const project = existsSync(folder) ? readdirSync(folder).find((name) => name.endsWith('.xcodeproj')) : undefined;
  return project && existsSync(join(folder, project, 'project.pbxproj')) ? `src-tauri/gen/apple/${project}/project.pbxproj` : null;
}

/**
 * A target of the Xcode project the upload signs: its name, its bundle id, the App Groups its entitlements file asks
 * for, and the ids of its build configurations, which an extension's signing settings are written into.
 */
export type XcodeTarget = { name: string; bundleId: string; groups: string[]; configurations: string[] };

/** The iPhone app's target, or null when the project has none Tauri's way, and each app extension's. */
export type XcodeTargets = { app: XcodeTarget | null; extensions: XcodeTarget[] };

/** A bundle id or an App Group the upload writes into a script and a plist path: letters, digits, dots and hyphens. */
const PLAIN_ID = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

/**
 * The app's and each app extension's target in the Xcode project at `projectFile` (a path from `cwd`), read with plutil,
 * which reads Xcode's old-style plist; or why they cannot be signed. A target's bundle id and App Groups come from its
 * release configuration, as the build's; a value naming a build setting, `$(...)`, is refused, since the upload cannot
 * work out what Xcode would make of it.
 */
export async function xcodeTargets(cwd: string, projectFile: string, run: Run, env: Env): Promise<XcodeTargets | { error: string }> {
  const json = async (file: string) => {
    const done = await run(['plutil', '-convert', 'json', '-o', '-', file], { cwd, env });
    if (done.code !== 0) return null;
    try {
      return JSON.parse(done.stdout) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const project = await json(projectFile);
  if (!project) return { error: `plutil could not read ${projectFile}` };
  type PbxObject = { isa?: string; name?: string; productType?: string; buildConfigurationList?: string; buildConfigurations?: string[]; buildSettings?: Record<string, unknown> };
  const objects = (project.objects ?? {}) as Record<string, PbxObject>;
  const sourceRoot = dirname(dirname(projectFile));
  const extensionKind = 'com.apple.product-type.app-extension';
  const targets: XcodeTargets = { app: null, extensions: [] };
  for (const target of Object.values(objects)) {
    if (target.isa !== 'PBXNativeTarget' || !target.name || !target.productType) continue;
    const isApp = target.productType === 'com.apple.product-type.application' && target.name.includes('_iOS');
    const isExtension = target.productType === extensionKind || target.productType.startsWith(`${extensionKind}.`);
    if (!isApp && !isExtension) continue;
    const configurations = objects[target.buildConfigurationList ?? '']?.buildConfigurations ?? [];
    const release = configurations.map((id) => objects[id]).find((configuration) => configuration?.name?.toLowerCase() === 'release');
    const settings = release?.buildSettings ?? {};
    const bundleId = String(settings.PRODUCT_BUNDLE_IDENTIFIER ?? '');
    if (isExtension && !PLAIN_ID.test(bundleId)) {
      return { error: `the app extension ${target.name} in ${projectFile} has the bundle id "${bundleId}" in its release configuration; write it out in full, as the upload registers and signs it by that id` };
    }
    let groups: string[] = [];
    const entitlementsFile = typeof settings.CODE_SIGN_ENTITLEMENTS === 'string' ? settings.CODE_SIGN_ENTITLEMENTS : null;
    if (entitlementsFile) {
      const entitlements = await json(join(sourceRoot, entitlementsFile));
      if (!entitlements) return { error: `plutil could not read ${join(sourceRoot, entitlementsFile)}, ${target.name}'s entitlements` };
      const asked = entitlements['com.apple.security.application-groups'];
      groups = Array.isArray(asked) ? asked.map(String) : [];
      const unplain = groups.find((group) => !PLAIN_ID.test(group));
      if (unplain) return { error: `${target.name}'s entitlements ask for the App Group "${unplain}"; write it out in full, as the upload checks the signing profile for it` };
    }
    const found = { name: target.name, bundleId, groups, configurations };
    if (isApp) targets.app = found;
    else targets.extensions.push(found);
  }
  targets.extensions.sort((a, b) => a.name.localeCompare(b.name));
  return targets;
}

/** The App Groups a provisioning profile allows, from the plist Apple signs into it; in base64, as Apple sends it. */
export function profileGroups(content: string): string[] {
  const text = Buffer.from(content, 'base64').toString('latin1');
  const list = text.match(/<key>com\.apple\.security\.application-groups<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1] ?? '';
  return [...list.matchAll(/<string>([^<]*)<\/string>/g)].map((match) => match[1]!);
}

/** The signing settings written into an extension's build configurations, in the forms Tauri writes for the app. */
export function extensionSigningSettings(signedWith: { identity: string; team: string; profileUuid: string }): [string, string][] {
  const quote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return [
    ['CODE_SIGN_STYLE', 'Manual'],
    ['CODE_SIGN_IDENTITY', quote(signedWith.identity)],
    ['"CODE_SIGN_IDENTITY[sdk=iphoneos*]"', quote(signedWith.identity)],
    ['DEVELOPMENT_TEAM', signedWith.team],
    ['"DEVELOPMENT_TEAM[sdk=iphoneos*]"', signedWith.team],
    ['PROVISIONING_PROFILE_SPECIFIER', quote(signedWith.profileUuid)],
    ['"PROVISIONING_PROFILE_SPECIFIER[sdk=iphoneos*]"', quote(signedWith.profileUuid)],
  ];
}

/**
 * The project's text with `settings` set in each build configuration whose id is in `configurations`: a setting's line
 * replaced where the configuration has one, added at the end of its build settings where it has none, as Tauri sets the
 * app's. Null when a configuration's build settings cannot be found in the text.
 */
export function withBuildSettings(text: string, configurations: string[], settings: [string, string][]): string | null {
  const lines = text.split('\n');
  const settingName = (line: string) => line.match(/^\s*("[^"]+"|[A-Za-z0-9_]+)\s*=/)?.[1];
  for (const id of configurations) {
    const start = lines.findIndex((line) => line.trimStart().startsWith(`${id} `) && line.trimEnd().endsWith('= {'));
    if (start < 0) return null;
    const open = lines.findIndex((line, at) => at > start && /^\s*buildSettings = \{\s*$/.test(line));
    if (open < 0) return null;
    const indent = lines[open]!.match(/^\s*/)![0];
    const close = lines.findIndex((line, at) => at > open && line === `${indent}};`);
    if (close < 0) return null;
    const inner = `${indent}\t`;
    let end = close;
    for (const [name, value] of settings) {
      const line = `${inner}${name} = ${value};`;
      const at = lines.findIndex((existing, index) => index > open && index < end && existing.startsWith(inner) && !existing.startsWith(`${inner}\t`) && settingName(existing) === name);
      if (at >= 0) lines[at] = line;
      else {
        lines.splice(end, 0, line);
        end++;
      }
    }
  }
  return lines.join('\n');
}

/**
 * Writes into `folder`, which goes first on the build's PATH, an `xcodebuild` that, when it is asked to export an
 * archive, sets each bundle id's profile uuid under provisioningProfiles in the export settings it is given, then hands
 * every call to `real`, Apple's. Ids and uuids are checked plain, since they are written into the script.
 */
export function writeXcodebuildStandIn(folder: string, profiles: { bundleId: string; profileUuid: string }[], real = '/usr/bin/xcodebuild') {
  for (const { bundleId, profileUuid } of profiles) {
    if (!PLAIN_ID.test(bundleId) || !PLAIN_ID.test(profileUuid)) throw new Error(`not a plain bundle id and profile uuid: ${bundleId} ${profileUuid}`);
  }
  const buddy = '/usr/libexec/PlistBuddy';
  const sets = profiles
    .map(
      ({ bundleId, profileUuid }) =>
        `  ${buddy} -c "Set :provisioningProfiles:${bundleId} ${profileUuid}" "$plist" 2>/dev/null || ${buddy} -c "Add :provisioningProfiles:${bundleId} string ${profileUuid}" "$plist" || exit 1\n`,
    )
    .join('');
  const script = `#!/bin/sh
# app-kit testflight upload: sets each app extension's profile in the export settings Tauri writes with the app's alone.
exporting=no; plist=; previous=
for argument in "$@"; do
  [ "$argument" = -exportArchive ] && exporting=yes
  [ "$previous" = -exportOptionsPlist ] && plist="$argument"
  previous="$argument"
done
if [ "$exporting" = yes ] && [ -n "$plist" ]; then
  ${buddy} -c "Print :provisioningProfiles" "$plist" >/dev/null 2>&1 || ${buddy} -c "Add :provisioningProfiles dict" "$plist" || exit 1
${sets}fi
exec ${real} "$@"
`;
  writeFileSync(join(folder, 'xcodebuild'), script, { mode: 0o755 });
}

/** Where Xcode 16 and later look for profiles, and where Tauri writes its copy. */
export function profileFolders(home: string) {
  return {
    xcode: join(home, 'Library/Developer/Xcode/UserData/Provisioning Profiles'),
    tauri: join(home, 'Library/MobileDevice/Provisioning Profiles'),
  };
}

/** Writes the profile where Xcode reads it, by its uuid. */
export function installProfile(home: string, uuid: string, content: string) {
  const { xcode } = profileFolders(home);
  mkdirSync(xcode, { recursive: true });
  writeFileSync(join(xcode, `${uuid}.mobileprovision`), Buffer.from(content, 'base64'));
}

/** The files in Tauri's profile folder, listed before a build so the copy it writes can be told apart. */
export function tauriProfileFiles(home: string): string[] {
  const { tauri } = profileFolders(home);
  return existsSync(tauri) ? readdirSync(tauri) : [];
}

/** Removes the copy of the profile Tauri wrote during the build: a file not in `before` with the profile's bytes. */
export function removeTauriProfileCopy(home: string, content: string, before: string[]) {
  const { tauri } = profileFolders(home);
  if (!existsSync(tauri)) return;
  const bytes = Buffer.from(content, 'base64');
  for (const name of readdirSync(tauri)) {
    if (!name.endsWith('.mobileprovision') || before.includes(name)) continue;
    const file = join(tauri, name);
    if (readFileSync(file).equals(bytes)) rmSync(file, { force: true });
  }
}

/** The file the `security` in the build's PATH writes each keychain it is asked to create into, one path a line. */
export const KEYCHAINS_MADE = 'keychains-made';

/**
 * Writes into `folder`, which goes first on the build's PATH, a `security` that writes down the path of each keychain
 * it is asked to create (`security create-keychain -p <password> <path>`, the path last) and hands every call to
 * `real`, macOS's own. The password is never written.
 */
export function writeSecurityRecorder(folder: string, real = '/usr/bin/security') {
  const script = `#!/bin/sh
# app-kit testflight upload: notes each keychain Tauri creates, so exactly those are deleted after the build.
if [ "$1" = create-keychain ]; then
  for argument in "$@"; do path="$argument"; done
  printf '%s\\n' "$path" >> "$(dirname "$0")/${KEYCHAINS_MADE}"
fi
exec ${real} "$@"
`;
  writeFileSync(join(folder, 'security'), script, { mode: 0o755 });
}

/**
 * Deletes each keychain the build's `security` wrote down, which also takes it off the keychain list; the ones it
 * deleted. Synchronous, since it also runs in a signal's handler.
 */
export function deleteRecordedKeychains(folder: string): string[] {
  const record = join(folder, KEYCHAINS_MADE);
  if (!existsSync(record)) return [];
  const paths = readFileSync(record, 'utf8').split('\n').filter(Boolean);
  for (const path of paths) {
    Bun.spawnSync(['/usr/bin/security', 'delete-keychain', path], { stdout: 'ignore', stderr: 'ignore' });
    // One security could not delete is removed as a file; off the list, it is nothing more.
    rmSync(path, { force: true });
  }
  return paths;
}

/** The signing lines of `text` beyond those of `other`, each line counted as often as it appears. */
function beyond(text: string, other: string): string[] {
  const left = new Map<string, number>();
  for (const line of other.split('\n')) if (SIGNING_SETTING.test(line)) left.set(line, (left.get(line) ?? 0) + 1);
  return text.split('\n').filter((line) => {
    if (!SIGNING_SETTING.test(line)) return false;
    const count = left.get(line) ?? 0;
    if (count) left.set(line, count - 1);
    return !count;
  });
}

/** The project's text without the signing settings, to compare what else changed. */
function withoutSigning(text: string): string {
  return text
    .split('\n')
    .filter((line) => !SIGNING_SETTING.test(line))
    .join('\n');
}

/**
 * The Xcode project's text to write back after the build: the text before it, when the build changed nothing in it
 * but the signing settings, each signing line it added or changed is what Tauri, or the upload for an extension, writes
 * for this certificate and these profiles (Manual, or a value naming the team or one of the profiles), and none was
 * removed; null otherwise, so an edit made meanwhile is not lost.
 */
export function projectToPutBack(before: string, after: string, signedWith: { team: string; profileUuids: string[] }): string | null {
  if (withoutSigning(before) !== withoutSigning(after)) return null;
  // Counted, not as sets: each build configuration repeats the same lines.
  const added = beyond(after, before);
  const removed = beyond(before, after);
  // Tauri replaces a setting's line, never removes one: a signing line gone with none of the same name in its place
  // was removed by someone else.
  const name = (line: string) => line.slice(0, line.indexOf('=')).trim();
  const replacements = new Map<string, number>();
  for (const line of added) replacements.set(name(line), (replacements.get(name(line)) ?? 0) + 1);
  for (const line of removed) {
    const left = replacements.get(name(line)) ?? 0;
    if (!left) return null;
    replacements.set(name(line), left - 1);
  }
  const tauriWrote = (line: string) => {
    const value = line.slice(line.indexOf('=') + 1);
    return /^\s*CODE_SIGN_STYLE\s*=\s*Manual;\s*$/.test(line) || value.includes(signedWith.team) || signedWith.profileUuids.some((uuid) => value.includes(uuid));
  };
  return added.every(tauriWrote) ? before : null;
}
