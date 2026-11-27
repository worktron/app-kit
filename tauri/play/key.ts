/*
 * What `app-kit play` reads from 1Password, in the TestFlight vault beside the Apple keys, which fleet's `op` and the
 * kit's service account read with nobody there:
 * - "Google Play service account", with the field "json key": the JSON key Google Cloud gives for the service account
 *   that Play Console's Users and permissions lets release the team's apps to testing tracks. One for every app.
 * - "<productName> Google Play upload key", with "keystore" (the PKCS12 keystore, base64), "password" and "alias": the
 *   key each of the app's builds is signed with before Google re-signs it with the app's own (Play App Signing).
 *
 * `app-kit play key` makes the upload key once: Java's keytool writes a keystore into a folder of its own, its
 * password handed through the environment (keytool's `:env` form), never on a command line where any program could
 * read it; the keystore goes into 1Password as an item template on standard input, and the folder is deleted.
 * It never replaces a key already there: Google refuses a build signed with another upload key until the key is reset
 * in Play Console.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand, type Run } from '../../command-line/run.ts';
import type { Env } from '../build-env.ts';
import { itemFields, lastLine, notFound, readItem, VAULT } from '../testflight/key.ts';
import type { ServiceAccount } from './google-play.ts';
import { readApp } from './app.ts';

export const SERVICE_ACCOUNT_ITEM = 'Google Play service account';
export const uploadKeyItem = (productName: string) => `${productName} Google Play upload key`;
export const KEY_ALIAS = 'upload';

/** The app's upload key: the keystore in base64, its password (the key's too), and the key's alias. */
export type UploadKey = { keystore: string; password: string; alias: string };

/** The service account from its item, or why it cannot be read. */
export function serviceAccountFromItem(json: string): ServiceAccount | string {
  const values = itemFields(json, SERVICE_ACCOUNT_ITEM, ['json key']);
  if (typeof values === 'string') return values;
  let account: Partial<ServiceAccount>;
  try {
    account = JSON.parse(values['json key'] ?? '') as Partial<ServiceAccount>;
  } catch {
    return `the 1Password item "${SERVICE_ACCOUNT_ITEM}" in the vault "${VAULT}" has no "json key" holding the service account's JSON key`;
  }
  if (!account.client_email || !account.private_key) return `the JSON key in "${SERVICE_ACCOUNT_ITEM}" has no client_email or private_key`;
  return { client_email: account.client_email, private_key: account.private_key, token_uri: account.token_uri };
}

/** The upload key from its item, or why it cannot be read. */
export function uploadKeyFromItem(json: string, item: string): UploadKey | string {
  const values = itemFields(json, item, ['keystore', 'password', 'alias']);
  if (typeof values === 'string') return values;
  const missing = ['keystore', 'password', 'alias'].filter((label) => !values[label]);
  if (missing.length) return `the 1Password item "${item}" in the vault "${VAULT}" has no ${missing.map((label) => `"${label}"`).join(', ')}`;
  return { keystore: values.keystore!.replace(/\s+/g, ''), password: values.password!, alias: values.alias! };
}

export async function readServiceAccount(run: Run, env: Env): Promise<ServiceAccount | string> {
  const item = await readItem(run, env, { tokenOnly: false }, SERVICE_ACCOUNT_ITEM);
  if ('missing' in item) return `no 1Password token for the ${VAULT} vault`;
  if (item.code !== 0) {
    if (notFound(item.out)) return `1Password's ${VAULT} vault has no "${SERVICE_ACCOUNT_ITEM}": make it as the README's "Shipping to Google Play" says`;
    return `op could not read "${SERVICE_ACCOUNT_ITEM}" in the vault "${VAULT}": ${lastLine(item.out)}`;
  }
  return serviceAccountFromItem(item.out);
}

export async function readUploadKey(run: Run, env: Env, productName: string): Promise<UploadKey | string> {
  const name = uploadKeyItem(productName);
  const item = await readItem(run, env, { tokenOnly: false }, name);
  if ('missing' in item) return `no 1Password token for the ${VAULT} vault`;
  if (item.code !== 0) {
    if (notFound(item.out)) return `1Password's ${VAULT} vault has no "${name}": make it once with app-kit play key`;
    return `op could not read "${name}" in the vault "${VAULT}": ${lastLine(item.out)}`;
  }
  return uploadKeyFromItem(item.out, name);
}

/** The 1Password item, as the template `op item create` reads on standard input. */
export function uploadKeyTemplate(title: string, key: UploadKey): string {
  return JSON.stringify({
    title,
    category: 'API_CREDENTIAL',
    fields: [
      { id: 'keystore', type: 'CONCEALED', label: 'keystore', value: key.keystore },
      { id: 'password', type: 'CONCEALED', label: 'password', value: key.password },
      { id: 'alias', type: 'STRING', label: 'alias', value: key.alias },
    ],
  });
}

export type PlayKeyOptions = { cwd: string; run?: Run; env?: Env; print?: (line: string) => void };

/** Makes the app's upload key once and keeps it in 1Password. 0 made; 1 anything else, such as a key already there. */
export async function makeUploadKey(options: PlayKeyOptions): Promise<0 | 1> {
  const run = options.run ?? runCommand;
  const env = options.env ?? process.env;
  const print = options.print ?? ((line: string) => console.log(line));
  const fail = (why: string): 1 => {
    print(`[play key] ${why}`);
    return 1;
  };
  const app = readApp(options.cwd);
  if (typeof app === 'string') return fail(app);
  const item = uploadKeyItem(app.productName);
  const existing = await run(['op', 'item', 'get', item, '--vault', VAULT, '--format', 'json'], { env });
  if (existing.code === 0) return fail(`1Password's ${VAULT} vault already holds "${item}"; nothing made, since Google refuses builds signed with a new key until it is reset in Play Console`);
  if (!notFound(existing.out)) return fail(`op could not look for "${item}" in the vault "${VAULT}": ${lastLine(existing.out)}`);

  const folder = mkdtempSync(join(tmpdir(), 'app-kit-play-key-'));
  try {
    const keystore = join(folder, 'upload.keystore');
    const password = randomBytes(24).toString('base64url');
    const made = await run(
      ['keytool', '-genkeypair', '-v', '-storetype', 'PKCS12', '-keystore', keystore, '-alias', KEY_ALIAS, '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
        '-dname', `CN=${app.productName}`, '-storepass:env', 'APP_KIT_PLAY_KEY_PASSWORD', '-keypass:env', 'APP_KIT_PLAY_KEY_PASSWORD'],
      { env: { ...env, APP_KIT_PLAY_KEY_PASSWORD: password }, timeoutMs: 120_000 },
    );
    if (made.code !== 0) return fail(`keytool made no keystore (Java comes from fleet's machine setup): ${lastLine(made.out)}`);
    const key = { keystore: readFileSync(keystore).toString('base64'), password, alias: KEY_ALIAS };
    const created = await run(['op', 'item', 'create', '--vault', VAULT, '-'], { env, input: uploadKeyTemplate(item, key) });
    if (created.code !== 0) return fail(`op could not save "${item}" in the vault "${VAULT}": ${lastLine(created.out)}`);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  print(`Saved "${item}" in 1Password's ${VAULT} vault. app-kit play upload signs every build of ${app.productName} with it.`);
  return 0;
}
