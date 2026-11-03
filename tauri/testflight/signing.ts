/*
 * How the upload signs: with the team's distribution certificate from 1Password and the app's App Store provisioning
 * profile from App Store Connect, handed to Tauri in IOS_CERTIFICATE, IOS_CERTIFICATE_PASSWORD and IOS_MOBILE_PROVISION,
 * Tauri's documented way to sign with a given certificate (https://v2.tauri.app/distribute/sign/ios/). No Apple account
 * need be signed in to Xcode.
 *
 * What Tauri does with them, read in its source at tauri-cli-v2.12.1, and what is put back here:
 * - It makes a keychain of its own, ~/Library/Keychains/<16 letters and digits>.keychain-db, puts it on the user's
 *   keychain list, unlocks it for an hour and imports the certificate into it; it deletes it only when it ends
 *   normally, so a build stopped by the watcher's time limit leaves it, holding the private key. Every keychain of that
 *   shape is deleted before and after each signing build, which runs under a lock, one on a Mac at a time, so none of
 *   them can be another build's.
 * - It writes the profile into ~/Library/MobileDevice/Provisioning Profiles under a random name and leaves it; Xcode 16
 *   and later read ~/Library/Developer/Xcode/UserData/Provisioning Profiles, so the profile is written there by its
 *   uuid, which is not secret and the next run writes again, and Tauri's copy is removed by its bytes.
 * - It writes CODE_SIGN_STYLE, CODE_SIGN_IDENTITY, DEVELOPMENT_TEAM and PROVISIONING_PROFILE_SPECIFIER into the iPhone
 *   target of the committed Xcode project, so the project is put back, only when nothing else in it changed.
 * - Before 2.12.1 it put PROVISIONING_PROFILE_SPECIFIER outside the target (tauri#14462), and the build failed asking
 *   for a profile, so an older Tauri CLI is refused.
 *
 * The three variables reach every program the build runs. Any of them could already read the 1Password token from the
 * login keychain with /usr/bin/security, so this widens nothing.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Certificate } from './key.ts';
import type { Env } from '../build-env.ts';
import type { Run } from '../../command-line/run.ts';

/** The oldest Tauri CLI that writes the profile setting into the iPhone target. */
export const TAURI_CLI_FLOOR = [2, 12, 1] as const;

/** macOS's own openssl, LibreSSL: it reads the .p12 the README's steps make. Homebrew's, often first on PATH, is not it. */
export const OPENSSL = '/usr/bin/openssl';

/** The settings Tauri writes into the Xcode project to sign by hand, with or without the iPhone-only form. */
const SIGNING_SETTING = /^\s*"?(?:CODE_SIGN_STYLE|CODE_SIGN_IDENTITY|DEVELOPMENT_TEAM|PROVISIONING_PROFILE_SPECIFIER)(?:\[sdk=iphoneos\*\])?"?\s*=.*;\s*$/;

/** The keychains Tauri makes. */
const TAURI_KEYCHAIN = /^[A-Za-z0-9]{16}\.keychain-db$/;

/** Why the app's Tauri CLI cannot sign by hand, or null. */
export function tauriCliProblem(cwd: string): string | null {
  const file = join(cwd, 'node_modules/@tauri-apps/cli/package.json');
  if (!existsSync(file)) return `${cwd} has no @tauri-apps/cli in node_modules: run bun install`;
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

/** The certificate's serial number from the .p12, read by macOS's openssl, or why it could not be read. */
export async function certificateSerial(certificate: Certificate, folder: string, run: Run, env: Env): Promise<string | { error: string }> {
  const file = join(folder, 'certificate.p12');
  writeFileSync(file, Buffer.from(certificate.p12, 'base64'), { mode: 0o600 });
  const withPassword = { ...env, APP_KIT_P12_PASSWORD: certificate.password };
  const pem = await run([OPENSSL, 'pkcs12', '-in', file, '-nokeys', '-clcerts', '-passin', 'env:APP_KIT_P12_PASSWORD'], { env: withPassword });
  if (pem.code !== 0 || !pem.stdout.includes('BEGIN CERTIFICATE')) {
    return { error: 'openssl could not read the certificate from the .p12 in 1Password: is its "password" the one it was made with?' };
  }
  const serial = await run([OPENSSL, 'x509', '-noout', '-serial'], { env, input: pem.stdout });
  const found = serial.stdout.match(/serial=([0-9A-Fa-f]+)/)?.[1];
  return found ?? { error: `openssl read no serial number from the certificate: ${serial.out.trim()}` };
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

/** Removes every copy of the profile in Tauri's folder, found by its bytes; Tauri names each at random. */
export function removeTauriProfileCopies(home: string, content: string) {
  const { tauri } = profileFolders(home);
  if (!existsSync(tauri)) return;
  const bytes = Buffer.from(content, 'base64');
  for (const name of readdirSync(tauri)) {
    if (!name.endsWith('.mobileprovision')) continue;
    const file = join(tauri, name);
    if (readFileSync(file).equals(bytes)) rmSync(file, { force: true });
  }
}

/**
 * Deletes every keychain of the shape Tauri makes, which also takes it off the keychain list. Run only under the
 * signing lock, so none of them is another build's, and synchronously, since it also runs in a signal's handler.
 */
export function deleteTauriKeychains(home: string): string[] {
  const folder = join(home, 'Library/Keychains');
  if (!existsSync(folder)) return [];
  const deleted: string[] = [];
  for (const name of readdirSync(folder)) {
    if (!TAURI_KEYCHAIN.test(name)) continue;
    const path = join(folder, name);
    Bun.spawnSync(['/usr/bin/security', 'delete-keychain', path], { stdout: 'ignore', stderr: 'ignore' });
    // One security could not delete is removed as a file; off the list, it is nothing more.
    rmSync(path, { force: true });
    deleted.push(path);
  }
  return deleted;
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
 * but the signing settings; null when something else changed too, so an edit made meanwhile is not lost.
 */
export function projectToPutBack(before: string, after: string): string | null {
  return withoutSigning(before) === withoutSigning(after) ? before : null;
}
