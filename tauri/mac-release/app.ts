/*
 * What `app-kit mac release` and `app-kit mac key` read from a Tauri app and work out from it, with no programs run:
 * the app's settings in src-tauri/tauri.conf.json, the 1Password item its update key lives in, the releases repository
 * its updater asks, the next version, the name its update archive is published under, and the version an update's
 * signature was made for.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The 1Password vault the update keys live in, so every release asks for the person's Touch ID. */
export const VAULT = 'Personal';

/** The 1Password item holding an app's update key, Timescale's name for its own. */
export function keyItem(productName: string): string {
  return `${productName} update signing key`;
}

export const CONFIG = 'src-tauri/tauri.conf.json';

/** The settings the release needs from tauri.conf.json, each as written there. */
export type AppConfig = {
  productName: string;
  version: string;
  /** bundle.macOS.signingIdentity, the code signing identity every build is signed with. */
  identity: string;
  pubkey: string;
  /** plugins.updater.endpoints[0], where the installed app asks for the newest release. */
  endpoint: string;
};

/** The app's name and version from tauri.conf.json, or why they cannot be read; the key command needs no more. */
export function readNameAndVersion(cwd: string): { productName: string; version: string; config: Record<string, unknown> } | string {
  const path = join(cwd, CONFIG);
  if (!existsSync(path)) return `${CONFIG} is not here: run this from the folder holding the app's src-tauri`;
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    return `${CONFIG} is not JSON (${error instanceof Error ? error.message : String(error)})`;
  }
  const productName = typeof config.productName === 'string' ? config.productName.trim() : '';
  const version = typeof config.version === 'string' ? config.version : '';
  if (!productName) return `${CONFIG} names no productName, which names the app's update key and its releases`;
  if (!parseVersion(version)) return `${CONFIG}'s version is ${JSON.stringify(config.version)}, not three numbers such as 0.1.0`;
  return { productName, version, config };
}

/** Everything the release reads from tauri.conf.json, or what is missing and how to add it. */
export function readConfig(cwd: string): AppConfig | string {
  const read = readNameAndVersion(cwd);
  if (typeof read === 'string') return read;
  const { productName, version, config } = read;
  const object = (value: unknown) => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});
  const macOS = object(object(config.bundle).macOS);
  const identity = typeof macOS.signingIdentity === 'string' ? macOS.signingIdentity.trim() : '';
  if (!identity || identity === '-') {
    return `${CONFIG} names no bundle.macOS.signingIdentity, so every build would be signed differently and macOS would drop the app's permissions at each update: name the code signing identity there (app-kit's README, "Releases and updates")`;
  }
  const updater = object(object(config.plugins).updater);
  const pubkey = typeof updater.pubkey === 'string' ? updater.pubkey.trim() : '';
  const endpoints = Array.isArray(updater.endpoints) ? updater.endpoints : [];
  const endpoint = typeof endpoints[0] === 'string' ? endpoints[0] : '';
  if (!pubkey || !endpoint) {
    return `${CONFIG} has no plugins.updater with a pubkey and an endpoint: add the block app-kit mac key printed (app-kit's README, "Releases and updates")`;
  }
  return { productName, version, identity, pubkey, endpoint };
}

/** The GitHub repository `owner/name` an endpoint names, or null for an address that is not a release's latest.json. */
export function releasesRepository(endpoint: string): string | null {
  const match = endpoint.match(/^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/releases\/latest\/download\/latest\.json$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

type Version = [number, number, number];

/** Three numbers, with an optional leading v, or null. */
export function parseVersion(text: string): Version | null {
  const match = text.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/**
 * The version the next release takes: one past the higher of the last release and the config's version, so the first
 * release is newer than a copy built by hand, and raising the config's version starts a new minor or major version.
 */
export function nextVersion(lastRelease: string | null, configVersion: string): string {
  const config = parseVersion(configVersion)!;
  const last = lastRelease ? parseVersion(lastRelease) : null;
  const higher = last && (last[0] - config[0] || last[1] - config[1] || last[2] - config[2]) > 0 ? last : config;
  return `${higher[0]}.${higher[1]}.${higher[2] + 1}`;
}

/**
 * The name the update archive is published under, from the app's name: every run of characters other than letters,
 * digits, `_` and `-` becomes one dot, with none at either end, a name GitHub keeps as it is (it renames spaces and
 * other characters in an asset's name, and the address in latest.json must match). tauri-action names its assets so.
 */
export function assetName(productName: string): string {
  const safe = productName.replace(/[^A-Za-z0-9_-]+/g, '.').replace(/^\.+|\.+$/g, '');
  return `${safe || 'app'}.app.tar.gz`;
}

/**
 * The version an update's `.sig` file says it was signed for, from its trusted comment, which the signature covers and
 * the Tauri command-line tool fills from 2.12.0 on; null when it names none. The updater refuses a release whose
 * signed version differs from latest.json's when its config says `requireSignedVersion`.
 */
export function signedVersion(sig: string): string | null {
  const text = Buffer.from(sig.trim(), 'base64').toString('utf8');
  const comment = text.split('\n').find((line) => line.startsWith('trusted comment: '));
  return comment?.slice('trusted comment: '.length).split('\t').find((field) => field.startsWith('version:'))?.slice('version:'.length) ?? null;
}

/** latest.json, which the installed app's updater reads: the version, when, and the signed archive for Apple silicon. */
export function latestJson(release: { version: string; date: Date; signature: string; url: string }): string {
  const latest = {
    version: release.version,
    pub_date: release.date.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    platforms: { 'darwin-aarch64': { signature: release.signature, url: release.url } },
  };
  return `${JSON.stringify(latest, null, 2)}\n`;
}
