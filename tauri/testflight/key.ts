/*
 * What the TestFlight part reads from 1Password, in the vault "TestFlight": the team's App Store Connect API key, the
 * item "App Store Connect API" with the fields "key id", "issuer id" and "private key" (the text of the .p8 file Apple
 * gives once), and the team's distribution certificate, the item "TestFlight distribution certificate" with the fields
 * "certificate" (the .p12 file, base64) and "password" (the .p12's password).
 *
 * The Mac release reads the same App Store Connect key to notarize a Developer ID build (mac-release/release.ts).
 *
 * A background job cannot answer 1Password's Touch ID prompt, so it reads the item through a 1Password service account
 * that may read only that vault. The service account's token is kept in the Mac's login keychain, under the service
 * name "app-kit testflight", and is handed only to the `op` call, never to the build's programs. A run by hand on a Mac
 * without the token uses the signed-in `op`, which asks for Touch ID.
 */
import type { TestFlightKey } from './app-store-connect.ts';
import type { Run } from '../../command-line/run.ts';

export const KEYCHAIN_SERVICE = 'app-kit testflight';
export const VAULT = 'TestFlight';
export const ITEM = 'App Store Connect API';
export const CERTIFICATE_ITEM = 'TestFlight distribution certificate';

/** The team's Apple Distribution certificate with its private key, as a .p12 file in base64, and the file's password. */
export type Certificate = { p12: string; password: string };

/** The service account's token from the login keychain, or null when the keychain holds none. */
export async function readToken(run: Run): Promise<string | null> {
  const found = await run(['/usr/bin/security', 'find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], { timeoutMs: 30_000 });
  const token = found.out.trim();
  return found.code === 0 && token ? token : null;
}

export type KeyResult = { key: TestFlightKey } | { missing: 'token' } | { error: string };

/**
 * The fields of `op item get --format json` named `labels`, each trimmed and empty when the item lacks it, or why the
 * answer cannot be read. The Mac release reads its update key with it too.
 */
export function itemFields(json: string, item: string, labels: string[]): Record<string, string> | string {
  let fields: { label?: string; value?: string }[];
  try {
    fields = (JSON.parse(json) as { fields?: { label?: string; value?: string }[] }).fields ?? [];
  } catch {
    return `1Password's answer for "${item}" is not JSON`;
  }
  return Object.fromEntries(labels.map((label) => [label, fields.find((f) => f.label === label)?.value?.trim() ?? '']));
}

/** The fields of `op item get --format json`, by label, every one of them required, or why they cannot be read. */
function fieldsOf(json: string, item: string, labels: string[]): Record<string, string> | string {
  const values = itemFields(json, item, labels);
  if (typeof values === 'string') return values;
  const missing = labels.filter((label) => !values[label]).map((label) => `"${label}"`);
  if (missing.length) return `the 1Password item "${item}" in the vault "${VAULT}" has no ${missing.join(', ')}`;
  return values;
}

/** The App Store Connect key from its item's fields. */
export function keyFromItem(json: string): TestFlightKey | string {
  const values = fieldsOf(json, ITEM, ['key id', 'issuer id', 'private key']);
  return typeof values === 'string' ? values : { keyId: values['key id']!, issuerId: values['issuer id']!, privateKey: values['private key']! };
}

/** The distribution certificate from its item's fields. */
export function certificateFromItem(json: string): Certificate | string {
  const values = fieldsOf(json, CERTIFICATE_ITEM, ['certificate', 'password']);
  return typeof values === 'string' ? values : { p12: values.certificate!.replace(/\s+/g, ''), password: values.password! };
}

/** Whether `op` said the item is not in the vault, rather than failing to read it, as for a vault it cannot reach. */
export function notFound(out: string): boolean {
  return /isn't an item in the "[^"]*" vault/.test(out);
}

/** Reads one item of the vault, through the token when the keychain holds one. */
async function readItem(run: Run, env: Record<string, string | undefined>, options: { tokenOnly: boolean }, item: string) {
  const token = await readToken(run);
  if (!token && options.tokenOnly) return { missing: 'token' as const };
  const opEnv = { ...env };
  if (token) opEnv.OP_SERVICE_ACCOUNT_TOKEN = token;
  return run(['op', 'item', 'get', item, '--vault', VAULT, '--format', 'json'], { env: opEnv, timeoutMs: 120_000 });
}

/**
 * Reads the key once. With `tokenOnly`, as the watcher runs it, a Mac without the token in its keychain reads
 * nothing; otherwise it falls back to the signed-in `op`.
 */
export async function readKey(run: Run, env: Record<string, string | undefined>, options: { tokenOnly: boolean }): Promise<KeyResult> {
  const item = await readItem(run, env, options, ITEM);
  if ('missing' in item) return item;
  if (item.code !== 0) return { error: `op could not read "${ITEM}" in the vault "${VAULT}": ${lastLine(item.out)}` };
  const key = keyFromItem(item.out);
  return typeof key === 'string' ? { error: key } : { key };
}

export type CertificateResult = { certificate: Certificate } | { missing: 'token' | 'certificate' } | { error: string };

/** Reads the distribution certificate once, the way `readKey` reads the key; `missing: 'certificate'` when the vault has no such item. */
export async function readCertificate(run: Run, env: Record<string, string | undefined>, options: { tokenOnly: boolean }): Promise<CertificateResult> {
  const item = await readItem(run, env, options, CERTIFICATE_ITEM);
  if ('missing' in item) return item;
  if (item.code !== 0) {
    if (notFound(item.out)) return { missing: 'certificate' };
    return { error: `op could not read "${CERTIFICATE_ITEM}" in the vault "${VAULT}": ${lastLine(item.out)}` };
  }
  const certificate = certificateFromItem(item.out);
  return typeof certificate === 'string' ? { error: certificate } : { certificate };
}

/** The last line of a program's output that says something, for a one-line report. */
export function lastLine(out: string): string {
  return (
    out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .pop() ?? 'no output'
  );
}
