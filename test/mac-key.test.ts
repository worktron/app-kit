// `app-kit mac key`: the key made once, kept in 1Password through a template on standard input, never in any
// program's arguments or a file, and the block for tauri.conf.json printed. The key maker's output is the shape Tauri's
// command-line tool 2.12.4 printed on 2026-11-05, its keys replaced.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generatedKeys, makeKey } from '../tauri/mac-release/key.ts';
import { exit, ok, scratch, standInRunner, type Answer } from './testflight-stand-in.ts';

const PRIVATE = 'dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWduIGVuY3J5cHRlZCBzZWNyZXQga2V5ClN0YW5kLWluLXByaXZhdGUta2V5';
const PUBLIC = 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDAwMDEKU3RhbmQtaW4tcHVibGljLWtleQ==';
const GENERATED = `
Your keys were generated successfully!

Private: (Keep it secret!)
${PRIVATE}

Public:
${PUBLIC}

Environment variables used to sign:
- \`TAURI_SIGNING_PRIVATE_KEY\`: Your private key. For the \`build\` and \`bundle\` command it can be either a string or a path to the file, for the \`signer sign\` command it must be the literal key string
- \`TAURI_SIGNING_PRIVATE_KEY_PATH\`: Path to your private key file, used by the \`signer sign\` command
- \`TAURI_SIGNING_PRIVATE_KEY_PASSWORD\`:  Your private key password (optional if key has no password)

ATTENTION: If you lose your private key OR password, you'll not be able to sign your update package and updates will not work
`;
const NOT_FOUND = exit(1, `[ERROR] 2026/11/05 12:00:00 "Example App update signing key" isn't an item in the "Personal" vault. Specify the item with its UUID, name, or domain.\n`);

let place: ReturnType<typeof scratch>;
let app: string;

beforeEach(() => {
  place = scratch('mac-key-');
  app = join(place.folder, 'app');
  mkdirSync(join(app, 'src-tauri'), { recursive: true });
  writeFileSync(join(app, 'src-tauri/tauri.conf.json'), JSON.stringify({ productName: 'Example App', version: '0.1.0' }));
});

afterEach(() => place.done());

async function runKey(answers: { get?: ReturnType<typeof ok>; create?: ReturnType<typeof ok>; generated?: string } = {}) {
  const answer: Answer = (command) => {
    const words = command.join(' ');
    if (words.startsWith('op item get')) return answers.get ?? NOT_FOUND;
    if (words.startsWith('op item create')) return answers.create ?? ok('{"id":"made"}');
    if (words === 'bunx tauri signer generate --ci') return ok(answers.generated ?? GENERATED);
    return undefined;
  };
  const stand = standInRunner(answer, []);
  const printed: string[] = [];
  const failed: string[] = [];
  const code = await makeKey({ cwd: app, repository: 'example/example-releases', run: stand.run, env: { PATH: '/usr/bin:/bin' }, print: (l) => printed.push(l), fail: (l) => failed.push(l) });
  return { code, printed, failed, ...stand };
}

test('the key goes to 1Password on standard input, and the block for tauri.conf.json is printed', async () => {
  const result = await runKey();
  expect(result.failed).toEqual([]);
  expect(result.code).toBe(0);
  const [create] = result.named('op item create');
  expect(create!.command).toEqual(['op', 'item', 'create', '--vault', 'Personal', '-']);
  const item = JSON.parse(create!.options.input!) as { title: string; fields: { label: string; value: string; type: string }[] };
  expect(item.title).toBe('Example App update signing key');
  expect(item.fields.map((field) => [field.label, field.type, field.value])).toEqual([
    ['private key', 'CONCEALED', PRIVATE],
    ['public key', 'STRING', PUBLIC],
  ]);
  // The private key is in no program's arguments, and never printed.
  for (const call of result.calls) expect(call.command.join(' ')).not.toContain(PRIVATE);
  expect(result.printed.join('\n')).not.toContain(PRIVATE);
  // Nothing was written beside the app.
  expect(readdirSync(app)).toEqual(['src-tauri']);
  const block = JSON.parse(result.printed.slice(result.printed.indexOf('') + 3).join('\n'));
  expect(block).toEqual({
    updater: {
      pubkey: PUBLIC,
      endpoints: ['https://github.com/example/example-releases/releases/latest/download/latest.json'],
      requireSignedVersion: true,
    },
  });
});

test('a key that exists is never replaced, and a failed look for it stops too', async () => {
  const existing = await runKey({ get: ok('{"title":"Example App update signing key"}') });
  expect(existing.code).toBe(1);
  expect(existing.failed[0]).toStartWith(`1Password's Personal vault already holds "Example App update signing key"`);
  expect(existing.named('tauri signer')).toEqual([]);
  const locked = await runKey({ get: exit(1, '[ERROR] 2026/11/05 12:00:00 authorization timeout\n') });
  expect(locked.failed).toEqual([`op could not look for "Example App update signing key" in the vault "Personal": [ERROR] 2026/11/05 12:00:00 authorization timeout`]);
  expect(locked.named('op item create')).toEqual([]);
});

test('output with no keys in it saves nothing', async () => {
  expect(generatedKeys(GENERATED)).toEqual({ privateKey: PRIVATE, publicKey: PUBLIC });
  const result = await runKey({ generated: 'Your keys were generated successfully!\n' });
  expect(result.code).toBe(1);
  expect(result.named('op item create')).toEqual([]);
});
