/*
 * Reading Apple Messages: the plugin's Rust (tauri/apple-messages/plugin/) shares names and limits with the page and
 * an app's server that no compiler checks across them, so this reads the Rust and holds each to names.ts. Then the
 * page half: its commands' names and arguments, and catchUp against a made-up Mac's batches. The reader itself is
 * tested in Rust, against made-up Messages and Contacts databases (`cargo test` in the plugin, which the gates run).
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BATCH_SIZE,
  COMMANDS,
  FULL_DISK_ACCESS_PANE,
  HOLD_READS,
  HOW_FAR_BACK,
  HOW_FAR_BACK_DEFAULT_DAYS,
  LOG_PREFIX,
  MAX_BATCHES,
  MAX_FIELD_UNITS,
  MAX_GUID_UNITS,
  MAX_PARTICIPANTS,
  MAX_SERVICE_UNITS,
  MAX_TEXT_UNITS,
  type MacBatch,
  type MacText,
  PLUGIN,
  catchUp,
  connectLink,
  macMessages,
  messagesService,
  readFromFor,
} from '../tauri/apple-messages';
import * as server from '../tauri/apple-messages/server';
import { checkTexts, messagesServiceRoutes } from '../tauri/apple-messages/server';
import { Webhook } from 'standardwebhooks';

const plugin = join(import.meta.dir, '../tauri/apple-messages/plugin');
const read = (path: string) => readFileSync(join(plugin, path), 'utf8');
const lib = read('src/lib.rs');
const reader = read('src/reader.rs');
const stringConstant = (source: string, name: string) => source.match(new RegExp(`const ${name}: &str = "([^"]*)";`))?.[1];
const numberConstant = (source: string, name: string) => {
  const value = source.match(new RegExp(`const ${name}: \\w+ = ([\\d_]+);`))?.[1];
  return value === undefined ? undefined : Number(value.replaceAll('_', ''));
};

describe('the names the page and the plugin share', () => {
  test('the plugin, its log lines and the Settings address', () => {
    expect(stringConstant(lib, 'PLUGIN')).toBe(PLUGIN);
    expect(stringConstant(lib, 'LOG_PREFIX')).toBe(LOG_PREFIX);
    expect(stringConstant(lib, 'FULL_DISK_ACCESS_PANE')).toBe(FULL_DISK_ACCESS_PANE);
    expect(read('Cargo.toml')).toContain(`links = "tauri-plugin-${PLUGIN}"`);
  });

  test('every log line of the plugin starts with the prefix', () => {
    const lines = [...`${lib}\n${reader}`.matchAll(/log::(?:info|warn|error)!\(\s*"([^"]*)"/g)].map((m) => m[1]!);
    expect(lines.length).toBeGreaterThan(8);
    expect(lines.filter((line) => !line.startsWith(`${LOG_PREFIX} `))).toEqual([]);
  });

  test('the commands: the build script, the handler, the default permission and the page agree', () => {
    const commands = Object.values(COMMANDS);
    const built = read('build.rs').match(/COMMANDS: &\[&str\] = &\[([^\]]*)\]/)![1]!.match(/"[^"]*"/g)!.map((c) => c.slice(1, -1));
    expect(built).toEqual(commands);
    const handled = lib.match(/generate_handler!\[([^\]]*)\]/)![1]!.split(',').map((c) => c.trim().replace(/^\w+::/, ''));
    expect(handled).toEqual(commands);
    const allowed = read('permissions/default.toml').match(/permissions = \[([^\]]*)\]/)![1]!.match(/"[^"]*"/g)!.map((c) => c.slice(1, -1));
    expect(allowed).toEqual(commands.map((c) => `allow-${c.replaceAll('_', '-')}`));
  });

  test('the limits the reader cuts to are the ones a server checks', () => {
    expect(numberConstant(reader, 'MAX_TEXT_UNITS')).toBe(MAX_TEXT_UNITS);
    expect(numberConstant(reader, 'MAX_FIELD_UNITS')).toBe(MAX_FIELD_UNITS);
    expect(numberConstant(reader, 'MAX_PARTICIPANTS')).toBe(MAX_PARTICIPANTS);
    expect(numberConstant(reader, 'MAX_GUID_UNITS')).toBe(MAX_GUID_UNITS);
    expect(numberConstant(reader, 'MAX_SERVICE_UNITS')).toBe(MAX_SERVICE_UNITS);
    expect(numberConstant(reader, 'HOLD_READS')).toBe(HOLD_READS);
    expect(numberConstant(lib, 'BATCH_SIZE')).toBe(BATCH_SIZE);
    expect(server.MAX_TEXT_UNITS).toBe(MAX_TEXT_UNITS);
    expect(server.BATCH_SIZE).toBe(BATCH_SIZE);
  });

  test("a text's fields are the ones the plugin sends, in the page's names", () => {
    const fields = reader.split('pub struct Text {')[1]!.split('}')[0]!.match(/pub (\w+):/g)!.map((f) => f.slice(4, -1));
    const camel = fields.map((f) => f.replace(/_(\w)/g, (_, c: string) => c.toUpperCase()));
    const sample: Record<keyof MacText, true> = {
      guid: true, rowid: true, chatGuid: true, chatName: true, participants: true, senderHandle: true,
      senderName: true, senderKind: true, service: true, sentAtMs: true, text: true,
    };
    expect(camel).toEqual(Object.keys(sample));
    const batch = reader.split('pub struct Batch {')[1]!.split('}')[0]!.match(/pub (\w+):/g)!.map((f) => f.slice(4, -1));
    const batchSample: Record<keyof MacBatch, true> = { texts: true, scannedTo: true, maxRowid: true, contactsRead: true };
    expect(batch.map((f) => f.replace(/_(\w)/g, (_, c: string) => c.toUpperCase()))).toEqual(Object.keys(batchSample));
  });
});

test('the README shows the shell that plugin/tests/readme.rs compiles', () => {
  const readme = readFileSync(join(import.meta.dir, '../README.md'), 'utf8');
  const section = readme.split('### Reading Apple Messages')[1]!.split('\n### ')[0]!;
  const shell = section.match(/```rust\n([\s\S]*?)```/)![1]!;
  expect(read('tests/readme.rs')).toContain(shell);
});

test("the page's commands call the plugin by its names, with the arguments the Rust takes", async () => {
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];
  const messages = macMessages(async (command, args) => {
    calls.push([command, args]);
    return null;
  });
  await messages.status();
  await messages.since(41, 1_000);
  await messages.since(null, 2_000);
  await messages.openFullDiskAccess();
  await messages.reopen();
  expect(calls).toEqual([
    ['plugin:apple-messages|access', undefined],
    ['plugin:apple-messages|since', { afterRowid: 41, sinceMs: 1_000 }],
    ['plugin:apple-messages|since', { afterRowid: null, sinceMs: 2_000 }],
    ['plugin:apple-messages|open_full_disk_access', undefined],
    ['plugin:apple-messages|reopen', undefined],
  ]);
  // Tauri hands a command's camelCase arguments to its snake_case parameters.
  expect(lib).toContain('after_rowid: Option<i64>, since_ms: i64');
});

const NOW = Date.UTC(2026, 10, 2, 12);
const DAY = 24 * 60 * 60 * 1000;
/** Reading turned on today with the last 3 months chosen. */
const READ_FROM = NOW - 90 * DAY;
const text = (rowid: number): MacText => ({
  guid: `g${rowid}`,
  rowid,
  chatGuid: 'any;-;+12015550134',
  chatName: null,
  participants: [],
  senderHandle: '+12015550134',
  senderName: null,
  senderKind: 'contact',
  service: 'iMessage',
  sentAtMs: NOW,
  text: 'hi',
});

/** A Mac with rows 1..max, handing out batches of `size` after a mark. */
function mac(max: number, size = 2) {
  const asked: Array<[number | null, number]> = [];
  const read = async (after: number | null, sinceMs: number): Promise<MacBatch> => {
    asked.push([after, sinceMs]);
    const from = after ?? 0;
    const to = Math.min(max, from + size);
    const texts = [];
    for (let r = from + 1; r <= to; r++) texts.push(text(r));
    return { texts, scannedTo: Math.max(from, to), maxRowid: max, contactsRead: true };
  };
  return { asked, read };
}

describe('how far back', () => {
  test("the choices are the plugin's, which Messages Service's window offers", () => {
    const service = read('src/service.rs');
    const rust = [...service.matchAll(/\("([^"]+)", (?:Some\((\d+)\)|None)\)/g)].map((m) => ({ label: m[1], days: m[2] === undefined ? null : Number(m[2]) }));
    expect(rust).toEqual(HOW_FAR_BACK.map((c) => ({ label: c.label, days: c.days })));
    expect(numberConstant(service, 'HOW_FAR_BACK_DEFAULT_DAYS')).toBe(HOW_FAR_BACK_DEFAULT_DAYS);
  });

  test('the default is one of the choices, and short of every text', () => {
    expect(HOW_FAR_BACK.some((c) => c.days === HOW_FAR_BACK_DEFAULT_DAYS)).toBe(true);
    expect(HOW_FAR_BACK_DEFAULT_DAYS).not.toBeNull();
  });

  test('each choice reads from that many days before it was made, everything from the start, and nothing else is taken', () => {
    expect(readFromFor(14, NOW)).toBe(NOW - 14 * DAY);
    expect(readFromFor(HOW_FAR_BACK_DEFAULT_DAYS, NOW)).toBe(NOW - 90 * DAY);
    expect(readFromFor(null, NOW)).toBe(0);
    expect(() => readFromFor(30, NOW)).toThrow('not one of');
  });

  test("the server's entry has the same choices, so a server can set the first day itself", () => {
    expect(server.HOW_FAR_BACK).toBe(HOW_FAR_BACK);
    expect(server.readFromFor).toBe(readFromFor);
  });
});

describe('catching up', () => {
  test('the first upload reads from the first day asked, batch by batch, to the end', async () => {
    const m = mac(5);
    const uploads: Array<{ scannedTo: number; reset: boolean; n: number }> = [];
    const r = await catchUp({
      mark: { readMark: null, readFrom: READ_FROM },
      read: m.read,
      upload: async (b) => void uploads.push({ scannedTo: b.scannedTo, reset: b.reset, n: b.texts.length }),
    });
    expect(m.asked).toEqual([[null, READ_FROM], [2, READ_FROM], [4, READ_FROM]]);
    expect(uploads).toEqual([
      { scannedTo: 2, reset: false, n: 2 },
      { scannedTo: 4, reset: false, n: 2 },
      { scannedTo: 5, reset: false, n: 1 },
    ]);
    expect(r).toEqual({ uploaded: 5, batches: 3, toEnd: true });
  });

  test('after a mark, every text since the first day is read, however long the Mac was away', async () => {
    const m = mac(5, 2);
    const yearAgo = NOW - 365 * DAY;
    await catchUp({ mark: { readMark: 1, readFrom: yearAgo }, read: m.read, upload: async () => {} });
    expect(m.asked).toEqual([[1, yearAgo], [3, yearAgo]]);
  });

  test('a catch-up stops at its batch limit, and the next keeps to the same first day', async () => {
    const m = mac(2 * (MAX_BATCHES + 5), 2);
    const first = await catchUp({ mark: { readMark: null, readFrom: READ_FROM }, read: m.read, upload: async () => {} });
    expect(first).toMatchObject({ batches: MAX_BATCHES, toEnd: false });
    await catchUp({ mark: { readMark: 2 * MAX_BATCHES, readFrom: READ_FROM }, read: m.read, upload: async () => {} });
    expect(new Set(m.asked.map((a) => a[1]))).toEqual(new Set([READ_FROM]));
  });

  test('nothing new uploads nothing', async () => {
    const m = mac(5);
    const uploads: unknown[] = [];
    const r = await catchUp({ mark: { readMark: 5, readFrom: READ_FROM }, read: m.read, upload: async (b) => void uploads.push(b) });
    expect(uploads).toEqual([]);
    expect(r).toEqual({ uploaded: 0, batches: 0, toEnd: true });
  });

  test('a batch of only skipped rows still moves the mark', async () => {
    const read = async (after: number | null): Promise<MacBatch> => ({ texts: [], scannedTo: (after ?? 0) + 3, maxRowid: 8, contactsRead: true });
    const uploads: number[] = [];
    await catchUp({ mark: { readMark: 5, readFrom: READ_FROM }, read, upload: async (b) => void uploads.push(b.scannedTo) });
    expect(uploads).toEqual([8]);
  });

  test('a read held below a text Messages is still writing has not reached the end', async () => {
    const read = async (after: number | null): Promise<MacBatch> => ({ texts: [], scannedTo: after ?? 0, maxRowid: 5, contactsRead: true });
    const held = await catchUp({ mark: { readMark: 3, readFrom: READ_FROM }, read, upload: async () => {} });
    expect(held.toEnd).toBe(false);
  });

  test('a database rebuilt below the mark is read again from the first day the person chose, as a reset', async () => {
    const m = mac(3, 10);
    const uploads: Array<{ scannedTo: number; reset: boolean }> = [];
    await catchUp({
      mark: { readMark: 900, readFrom: READ_FROM },
      read: m.read,
      upload: async (b) => void uploads.push({ scannedTo: b.scannedTo, reset: b.reset }),
    });
    expect(m.asked).toEqual([[900, READ_FROM], [null, READ_FROM]]);
    expect(uploads).toEqual([{ scannedTo: 3, reset: true }]);
  });

  test('a failed upload stops the catch-up, leaving the mark where the server holds it', async () => {
    const m = mac(5);
    await expect(
      catchUp({ mark: { readMark: 0, readFrom: READ_FROM }, read: m.read, upload: async () => { throw new Error('offline'); } }),
    ).rejects.toThrow('offline');
    expect(m.asked).toHaveLength(1);
  });
});

describe('Messages Service', () => {
  const service = read('src/service.rs');

  test('the service names the installer and the page share', async () => {
    const names = await import('../tauri/apple-messages/names');
    for (const name of ['SERVICE_APP_NAME', 'SERVICE_BUNDLE_ID', 'SERVICE_SCHEME', 'SERVICE_CONNECT_HOST', 'SERVICE_LATEST_JSON', 'SERVICE_PLATFORM'] as const) {
      expect(stringConstant(service, name)).toBe(names[name]);
    }
  });

  test("the service's releases are read from its public releases repository, not its private code repository", async () => {
    const names = await import('../tauri/apple-messages/names');
    expect(names.SERVICE_LATEST_JSON).toBe('https://github.com/worktron/messages-service-releases/releases/latest/download/latest.json');
  });

  test('the connect link carries the address and the code, and the plugin opens only such a link', () => {
    const link = connectLink({ address: 'https://app.example.com/api/messages-service', code: 'ab'.repeat(32) });
    expect(link).toBe(`messages-service://connect?address=https%3A%2F%2Fapp.example.com%2Fapi%2Fmessages-service&code=${'ab'.repeat(32)}`);
    expect(new URL(link).searchParams.get('address')).toBe('https://app.example.com/api/messages-service');
    expect(service).toContain('fn is_connect_link');
  });

  test("the page's service commands call the plugin by its names", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const s = messagesService(async (command, args) => {
      calls.push([command, args]);
      return null;
    });
    await s.installService('ABCDE12345');
    await s.openConnectLink('ABCDE12345', 'messages-service://connect?address=x&code=y');
    expect(calls).toEqual([
      ['plugin:apple-messages|install_service', { teamId: 'ABCDE12345' }],
      ['plugin:apple-messages|open_connect_link', { teamId: 'ABCDE12345', link: 'messages-service://connect?address=x&code=y' }],
    ]);
    expect(lib).toContain('pub async fn install_service(team_id: String)');
    expect(lib).toContain('pub async fn open_connect_link(team_id: String, link: String)');
  });
});

describe("the app's routes for Messages Service", () => {
  const SECRET = `whsec_${Buffer.from(new Uint8Array(32).fill(7)).toString('base64')}`;
  const OTHER = `whsec_${Buffer.from(new Uint8Array(32).fill(9)).toString('base64')}`;
  const sample: MacText = text(1);

  function app(signedIn: string | null = 'person-1') {
    const connections = new Map<string, { userId: string; secret: string }>();
    const stored: Array<{ userId: string; guids: string[]; connection: string }> = [];
    const routes = messagesServiceRoutes({
      name: 'Example',
      userId: () => signedIn,
      account: async (userId) => `${userId}@example.com`,
      connect: async (userId, secret) => {
        const id = `c${connections.size + 1}`;
        connections.set(id, { userId, secret });
        return id;
      },
      connectionOf: async (id) => connections.get(id) ?? null,
      store: async (userId, texts, connection) => void stored.push({ userId, guids: texts.map((t) => t.guid), connection }),
    });
    const ask = (path: string, init: RequestInit = {}) => routes.request(path, init);
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      ask(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } });
    return { connections, stored, ask, post };
  }

  async function connected(a: ReturnType<typeof app>) {
    const { code } = (await (await a.post('/code', {}, { Authorization: 'Bearer session' })).json()) as { code: string };
    const { connection } = (await (await a.post('/connect', { code, secret: SECRET })).json()) as { connection: string };
    return connection;
  }

  const signed = (secret: string, body: unknown, id = 'msg_1', at = new Date()) => {
    const payload = JSON.stringify(body);
    return { body: payload, headers: { 'webhook-id': id, 'webhook-timestamp': String(Math.floor(at.getTime() / 1000)), 'webhook-signature': new Webhook(secret).sign(id, at, payload), 'Content-Type': 'application/json' } };
  };

  test("the service reads the app's name, and the account a live code was made for, from the app's own address", async () => {
    const a = app();
    expect(await (await a.ask('/about')).json()).toEqual({ name: 'Example' });
    const { code } = (await (await a.post('/code', {}, { Authorization: 'Bearer session' })).json()) as { code: string };
    expect(await (await a.ask(`/about?code=${code}`)).json()).toEqual({ name: 'Example', account: 'person-1@example.com' });
    await a.post('/connect', { code, secret: SECRET });
    expect(await (await a.ask(`/about?code=${code}`)).json()).toEqual({ name: 'Example' });
  });

  test('a connect code is made only for a signed-in session with a bearer token, and works once', async () => {
    expect((await app(null).post('/code', {}, { Authorization: 'Bearer session' })).status).toBe(401);
    expect((await app().post('/code', {})).status).toBe(401);
    const a = app();
    const { code } = (await (await a.post('/code', {}, { Authorization: 'Bearer session' })).json()) as { code: string };
    expect((await a.post('/connect', { code, secret: 'not-a-secret' })).status).toBe(400);
    const first = await a.post('/connect', { code, secret: SECRET });
    expect(await first.json()).toEqual({ connection: 'c1' });
    expect(a.connections.get('c1')).toEqual({ userId: 'person-1', secret: SECRET });
    expect((await a.post('/connect', { code, secret: OTHER })).status).toBe(400);
    expect(a.connections.size).toBe(1);
  });

  test("a batch signed with the connection's secret is stored for its person", async () => {
    const a = app();
    const connection = await connected(a);
    const res = await a.ask(`/texts/${connection}`, { method: 'POST', ...signed(SECRET, { texts: [sample] }) });
    expect(res.status).toBe(200);
    expect(a.stored).toEqual([{ userId: 'person-1', guids: ['g1'], connection: 'c1' }]);
  });

  test('a batch not signed by the connection, or signed long ago, is refused and stores nothing', async () => {
    const a = app();
    const connection = await connected(a);
    expect((await a.ask(`/texts/${connection}`, { method: 'POST', ...signed(OTHER, { texts: [sample] }) })).status).toBe(401);
    const old = signed(SECRET, { texts: [sample] }, 'msg_2', new Date(Date.now() - 10 * 60_000));
    expect((await a.ask(`/texts/${connection}`, { method: 'POST', ...old })).status).toBe(401);
    const tampered = signed(SECRET, { texts: [sample] });
    expect((await a.ask(`/texts/${connection}`, { method: 'POST', headers: tampered.headers, body: JSON.stringify({ texts: [text(2)] }) })).status).toBe(401);
    expect(a.stored).toEqual([]);
  });

  test('a push to a connection turned off is answered gone, so the service stops', async () => {
    const a = app();
    const connection = await connected(a);
    a.connections.delete(connection);
    expect((await a.ask(`/texts/${connection}`, { method: 'POST', ...signed(SECRET, { texts: [sample] }) })).status).toBe(410);
  });

  test('a batch past the limits the reader cuts to is refused', async () => {
    const a = app();
    const connection = await connected(a);
    const long = { ...sample, text: 'x'.repeat(MAX_TEXT_UNITS + 1) };
    expect((await a.ask(`/texts/${connection}`, { method: 'POST', ...signed(SECRET, { texts: [long] }) })).status).toBe(400);
    expect(checkTexts({ texts: Array.from({ length: BATCH_SIZE + 1 }, (_, i) => text(i)) })).toEqual({ refused: `more than ${BATCH_SIZE} texts` });
    expect(checkTexts({ texts: [{ ...sample, senderKind: 'someone' }] })).toEqual({ refused: 'text 0 is not a text within the limits' });
    expect(checkTexts({ texts: [{ ...sample, text: 'x'.repeat(MAX_TEXT_UNITS) }] })).toEqual({ texts: [{ ...sample, text: 'x'.repeat(MAX_TEXT_UNITS) }] });
    // What the reader can send empty, Messages' own chat id and service, is never what refuses a batch.
    const bare = { ...sample, chatGuid: '', service: '' };
    expect(checkTexts({ texts: [bare] })).toEqual({ texts: [bare] });
    expect(checkTexts({ texts: [{ ...sample, guid: '' }] })).toEqual({ refused: 'text 0 is not a text within the limits' });
    expect(a.stored).toEqual([]);
  });
});
