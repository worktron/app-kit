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
  FIRST_READ_DAYS,
  FULL_DISK_ACCESS_PANE,
  HOLD_READS,
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
  macMessages,
} from '../tauri/apple-messages';
import * as server from '../tauri/apple-messages/server';

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
    const handled = lib.match(/generate_handler!\[([^\]]*)\]/)![1]!.split(',').map((c) => c.trim().replace(/^mac::/, ''));
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
/** Reading turned on three days ago: it reads from 14 days before that. */
const READ_FROM = NOW - (3 + FIRST_READ_DAYS) * DAY;
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

describe('catching up', () => {
  test('the first upload reads from the first day asked, batch by batch, to the end', async () => {
    const m = mac(5);
    const uploads: Array<{ scannedTo: number; reset: boolean; n: number }> = [];
    const r = await catchUp({
      mark: { readMark: null, readFrom: READ_FROM },
      now: NOW,
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
    await catchUp({ mark: { readMark: 1, readFrom: yearAgo }, now: NOW, read: m.read, upload: async () => {} });
    expect(m.asked).toEqual([[1, yearAgo], [3, yearAgo]]);
  });

  test('a catch-up stops at its batch limit, and the next keeps to the same first day', async () => {
    const m = mac(2 * (MAX_BATCHES + 5), 2);
    const first = await catchUp({ mark: { readMark: null, readFrom: READ_FROM }, now: NOW, read: m.read, upload: async () => {} });
    expect(first).toMatchObject({ batches: MAX_BATCHES, toEnd: false });
    await catchUp({ mark: { readMark: 2 * MAX_BATCHES, readFrom: READ_FROM }, now: NOW, read: m.read, upload: async () => {} });
    expect(new Set(m.asked.map((a) => a[1]))).toEqual(new Set([READ_FROM]));
  });

  test('nothing new uploads nothing', async () => {
    const m = mac(5);
    const uploads: unknown[] = [];
    const r = await catchUp({ mark: { readMark: 5, readFrom: READ_FROM }, now: NOW, read: m.read, upload: async (b) => void uploads.push(b) });
    expect(uploads).toEqual([]);
    expect(r).toEqual({ uploaded: 0, batches: 0, toEnd: true });
  });

  test('a batch of only skipped rows still moves the mark', async () => {
    const read = async (after: number | null): Promise<MacBatch> => ({ texts: [], scannedTo: (after ?? 0) + 3, maxRowid: 8, contactsRead: true });
    const uploads: number[] = [];
    await catchUp({ mark: { readMark: 5, readFrom: READ_FROM }, now: NOW, read, upload: async (b) => void uploads.push(b.scannedTo) });
    expect(uploads).toEqual([8]);
  });

  test('a read held below a text Messages is still writing has not reached the end', async () => {
    const read = async (after: number | null): Promise<MacBatch> => ({ texts: [], scannedTo: after ?? 0, maxRowid: 5, contactsRead: true });
    const held = await catchUp({ mark: { readMark: 3, readFrom: READ_FROM }, now: NOW, read, upload: async () => {} });
    expect(held.toEnd).toBe(false);
  });

  test('a database rebuilt below the mark is read again from 14 days back, as a reset', async () => {
    const m = mac(3, 10);
    const uploads: Array<{ scannedTo: number; reset: boolean }> = [];
    await catchUp({
      mark: { readMark: 900, readFrom: READ_FROM },
      now: NOW,
      read: m.read,
      upload: async (b) => void uploads.push({ scannedTo: b.scannedTo, reset: b.reset }),
    });
    expect(m.asked).toEqual([[900, READ_FROM], [null, NOW - FIRST_READ_DAYS * DAY]]);
    expect(uploads).toEqual([{ scannedTo: 3, reset: true }]);
  });

  test('a failed upload stops the catch-up, leaving the mark where the server holds it', async () => {
    const m = mac(5);
    await expect(
      catchUp({ mark: { readMark: 0, readFrom: READ_FROM }, now: NOW, read: m.read, upload: async () => { throw new Error('offline'); } }),
    ).rejects.toThrow('offline');
    expect(m.asked).toHaveLength(1);
  });
});
