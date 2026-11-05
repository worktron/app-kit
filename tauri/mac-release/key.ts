/*
 * `app-kit mac key <owner>/<repository>`: makes the key that signs a Tauri app's updates, once, keeps it in 1Password as
 * "<app name> update signing key" in the Personal vault, and prints the public half with the plugins.updater block for
 * the app's tauri.conf.json. The key has no password: Tauri's key maker takes one only on its command line, where any
 * program on the Mac can read it, and the key lives only in 1Password. It is never written to a file: the key maker
 * prints it, the runner keeps that output in memory, and 1Password takes the item as a template on standard input, so
 * no secret is in any program's arguments either.
 *
 * Exit codes: 0 made; 1 anything else, such as an item that already exists, which it never replaces.
 */
import { keyItem, readNameAndVersion, VAULT } from './app.ts';
import { lastLine, notFound } from '../testflight/key.ts';
import { runCommand, type Run } from '../../command-line/run.ts';
import type { Env } from '../build-env.ts';

export type KeyOptions = {
  /** The app's Tauri folder, the one holding src-tauri. */
  cwd: string;
  /** The public GitHub repository the releases go to, `owner/name`, which the printed block names. */
  repository: string;
  run?: Run;
  env?: Env;
  print?: (line: string) => void;
  fail?: (line: string) => void;
};

/** The private and public keys from what `tauri signer generate` prints, each the line after its heading; or null. */
export function generatedKeys(printed: string): { privateKey: string; publicKey: string } | null {
  const lines = printed.split('\n').map((line) => line.trim());
  const after = (heading: RegExp) => {
    const at = lines.findIndex((line) => heading.test(line));
    return at >= 0 && /^[A-Za-z0-9+/=]{40,}$/.test(lines[at + 1] ?? '') ? lines[at + 1]! : null;
  };
  const privateKey = after(/^Private:/);
  const publicKey = after(/^Public:/);
  return privateKey && publicKey ? { privateKey, publicKey } : null;
}

/** The 1Password item, as the template `op item create` reads on standard input. */
export function itemTemplate(title: string, keys: { privateKey: string; publicKey: string }): string {
  return JSON.stringify({
    title,
    category: 'PASSWORD',
    fields: [
      { id: 'private_key', type: 'CONCEALED', label: 'private key', value: keys.privateKey },
      { id: 'public_key', type: 'STRING', label: 'public key', value: keys.publicKey },
    ],
  });
}

/** The block for tauri.conf.json's plugins, with the releases' address for `repository` (`owner/name`). */
export function updaterBlock(publicKey: string, repository: string): string {
  const block = {
    updater: {
      pubkey: publicKey,
      endpoints: [`https://github.com/${repository}/releases/latest/download/latest.json`],
      requireSignedVersion: true,
    },
  };
  return JSON.stringify(block, null, 2);
}

export async function makeKey(options: KeyOptions): Promise<0 | 1> {
  const run = options.run ?? runCommand;
  const env = options.env ?? process.env;
  const print = options.print ?? ((line: string) => console.log(line));
  const fail = (line: string): 1 => {
    (options.fail ?? ((text: string) => console.error(`[mac key] ${text}`)))(line);
    return 1;
  };
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(options.repository)) return fail(`${options.repository} is not a GitHub repository such as worktron/example-releases`);
  const app = readNameAndVersion(options.cwd);
  if (typeof app === 'string') return fail(app);
  const item = keyItem(app.productName);

  const existing = await run(['op', 'item', 'get', item, '--vault', VAULT, '--format', 'json'], { env });
  if (existing.code === 0) return fail(`1Password's ${VAULT} vault already holds "${item}"; nothing made, since a new key would strand every installed copy`);
  if (!notFound(existing.out)) return fail(`op could not look for "${item}" in the vault "${VAULT}": ${lastLine(existing.out)}`);

  const generated = await run(['bunx', 'tauri', 'signer', 'generate', '--ci'], { cwd: options.cwd, env });
  const keys = generated.code === 0 ? generatedKeys(generated.stdout) : null;
  if (!keys) return fail(`tauri signer generate made no key: ${lastLine(generated.out)}`);

  const created = await run(['op', 'item', 'create', '--vault', VAULT, '-'], { env, input: itemTemplate(item, keys) });
  if (created.code !== 0) return fail(`op could not save "${item}" in the vault "${VAULT}": ${lastLine(created.out)}`);

  print(`Saved "${item}" in 1Password's ${VAULT} vault. Its public key:`);
  print(keys.publicKey);
  print('');
  print(`Put this in src-tauri/tauri.conf.json's "plugins", and name the code signing identity every build is signed with`);
  print(`in "bundle": { "macOS": { "signingIdentity": "<identity>" } } (app-kit's README, "Releases and updates"):`);
  print(updaterBlock(keys.publicKey, options.repository));
  return 0;
}
