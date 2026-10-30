/*
 * The team's App Store Connect API key, read from 1Password. It is the item "App Store Connect API" in the vault
 * "TestFlight", with the fields "key id", "issuer id" and "private key" (the text of the .p8 file Apple gives once).
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

/** The service account's token from the login keychain, or null when the keychain holds none. */
export async function readToken(run: Run): Promise<string | null> {
  const found = await run(['/usr/bin/security', 'find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], { timeoutMs: 30_000 });
  const token = found.out.trim();
  return found.code === 0 && token ? token : null;
}

export type KeyResult = { key: TestFlightKey } | { missing: 'token' } | { error: string };

/** The fields of `op item get --format json`, by label. */
export function keyFromItem(json: string): TestFlightKey | string {
  let fields: { label?: string; value?: string }[];
  try {
    fields = (JSON.parse(json) as { fields?: { label?: string; value?: string }[] }).fields ?? [];
  } catch {
    return `1Password's answer for "${ITEM}" is not JSON`;
  }
  const field = (label: string) => fields.find((f) => f.label === label)?.value?.trim() ?? '';
  const key = { keyId: field('key id'), issuerId: field('issuer id'), privateKey: field('private key') };
  const missing = Object.entries({ 'key id': key.keyId, 'issuer id': key.issuerId, 'private key': key.privateKey })
    .filter(([, value]) => !value)
    .map(([label]) => `"${label}"`);
  if (missing.length) return `the 1Password item "${ITEM}" in the vault "${VAULT}" has no ${missing.join(', ')}`;
  return key;
}

/**
 * Reads the key once. With `tokenOnly`, as the watcher runs it, a Mac without the token in its keychain reads
 * nothing; otherwise it falls back to the signed-in `op`.
 */
export async function readKey(run: Run, env: Record<string, string | undefined>, options: { tokenOnly: boolean }): Promise<KeyResult> {
  const token = await readToken(run);
  if (!token && options.tokenOnly) return { missing: 'token' };
  const opEnv = { ...env };
  if (token) opEnv.OP_SERVICE_ACCOUNT_TOKEN = token;
  const item = await run(['op', 'item', 'get', ITEM, '--vault', VAULT, '--format', 'json'], { env: opEnv, timeoutMs: 120_000 });
  if (item.code !== 0) return { error: `op could not read "${ITEM}" in the vault "${VAULT}": ${lastLine(item.out)}` };
  const key = keyFromItem(item.out);
  return typeof key === 'string' ? { error: key } : { key };
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
