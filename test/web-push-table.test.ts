// The README's subscriptions table and the two functions that keep and forget a phone, taken from its code blocks as
// they are and run against Postgres (PGlite in memory), so the rule they promise holds: one person's phone is never
// refreshed or forgotten by another account.
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WebPushSubscription } from '../web/push/names';

const root = join(import.meta.dir, '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');

/** The README's TypeScript block whose first line is `first`. */
function block(first: string): string {
  const found = [...readme.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1]!).find((code) => code.startsWith(first));
  if (!found) throw new Error(`README.md has no ts block starting ${JSON.stringify(first)}`);
  return found;
}

const folder = mkdtempSync(join(tmpdir(), 'app-kit-push-table-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

/** The blocks as an app would have them, with the packages they import resolved from the kit's own node_modules. */
function write(name: string, code: string) {
  const resolved = code.replace(/from '(drizzle-orm[^']*)'/g, (_, pkg: string) => `from '${Bun.resolveSync(pkg, root)}'`).replace("from 'app-kit/web/push/server'", `from '${join(root, 'web/push/server.ts')}'`);
  writeFileSync(join(folder, name), resolved);
}

let client: PGlite;
let db: ReturnType<typeof drizzle>;
type Keep = (db: unknown, userId: string, subscription: WebPushSubscription) => Promise<boolean>;
type Forget = (db: unknown, userId: string, endpoint: string) => Promise<void>;
let keep: Keep;
let forget: Forget;

beforeAll(async () => {
  mkdirSync(folder, { recursive: true });
  write('schema.ts', block('// The subscriptions table'));
  write('push.ts', block("// Keeping a phone's subscription"));
  const push = (await import(join(folder, 'push.ts'))) as { keepWebPushSubscription: Keep; forgetWebPushSubscription: Forget };
  keep = push.keepWebPushSubscription;
  forget = push.forgetWebPushSubscription;
  client = new PGlite();
  db = drizzle(client);
  // The table as drizzle-kit would make it from the README's schema.
  await db.execute(sql`CREATE TABLE web_push_subscriptions (
    id serial PRIMARY KEY,
    user_id text NOT NULL,
    endpoint text NOT NULL UNIQUE,
    p256dh text NOT NULL,
    auth text NOT NULL,
    seen_at timestamp with time zone NOT NULL DEFAULT now()
  )`);
});
afterAll(() => client?.close());

const phone = (p256dh: string) => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/phone-1', keys: { p256dh, auth: 'auth-1' } });
type Row = { user_id: string; endpoint: string; p256dh: string; seen_at: Date };
const read = async () => (await client.query<Row>('SELECT user_id, endpoint, p256dh, seen_at FROM web_push_subscriptions')).rows;
const rows = async () => (await read()).map((r) => ({ userId: r.user_id, endpoint: r.endpoint, p256dh: r.p256dh }));

test('a phone is kept for the person who sent it, refreshed by them, and refused to anyone else', async () => {
  expect(await keep(db, 'parent-a', phone('key-1'))).toBe(true);
  const [first] = await read();
  expect(await keep(db, 'parent-a', phone('key-2'))).toBe(true);
  const [refreshed] = await read();
  expect(refreshed!.p256dh).toBe('key-2');
  expect(refreshed!.seen_at.getTime()).toBeGreaterThanOrEqual(first!.seen_at.getTime());

  // Another account that learned the endpoint changes nothing, and is told so.
  expect(await keep(db, 'someone-else', phone('their-key'))).toBe(false);
  expect(await rows()).toEqual([{ userId: 'parent-a', endpoint: 'https://fcm.googleapis.com/fcm/send/phone-1', p256dh: 'key-2' }]);

  // Nor can it forget the phone; its owner can.
  await forget(db, 'someone-else', 'https://fcm.googleapis.com/fcm/send/phone-1');
  expect(await rows()).toHaveLength(1);
  await forget(db, 'parent-a', 'https://fcm.googleapis.com/fcm/send/phone-1');
  expect(await rows()).toEqual([]);
});
