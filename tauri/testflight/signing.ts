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

/** What the upload reads from the certificate: its serial number, which Apple's record is found by, and its team id. */
export type CertificateFacts = { serial: string; team: string };

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
  if (!serial || !team) return { error: `openssl read no serial number or team from the certificate: ${read.out.trim()}` };
  return { serial, team };
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
 * but the signing settings, each signing line it added or changed is what Tauri writes for this certificate and
 * profile (Manual, or a value naming the team or the profile), and none was removed; null otherwise, so an edit made
 * meanwhile is not lost.
 */
export function projectToPutBack(before: string, after: string, signedWith: { team: string; profileUuid: string }): string | null {
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
    return /^\s*CODE_SIGN_STYLE\s*=\s*Manual;\s*$/.test(line) || value.includes(signedWith.team) || value.includes(signedWith.profileUuid);
  };
  return added.every(tauriWrote) ? before : null;
}
