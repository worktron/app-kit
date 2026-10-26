import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { closeTestDbs, openDb, openTestDb } from '../server/postgres';
import * as schema from './fixtures/postgres/schema';

const options = { schema, migrationsFolder: join(import.meta.dir, 'fixtures/postgres/drizzle') };

describe('openTestDb', () => {
  afterEach(closeTestDbs);

  test('gives a migrated database a row can be written to and read back from', async () => {
    const db = await openTestDb(options);
    const [written] = await db.insert(schema.notes).values({ body: 'first', length: 5 }).returning();
    expect(written).toMatchObject({ id: 1, body: 'first', length: 5 });
    expect(written?.createdAt).toBeInstanceOf(Date);
    expect(await db.select().from(schema.notes).where(eq(schema.notes.id, 1))).toEqual([written!]);
    // The schema reaches the relational queries too.
    expect(await db.query.notes.findFirst()).toEqual(written);
  });

  test('gives each test its own empty database', async () => {
    const one = await openTestDb(options);
    const two = await openTestDb(options);
    await one.insert(schema.notes).values({ body: 'only in one', length: 11 });
    expect(await one.select().from(schema.notes)).toHaveLength(1);
    expect(await two.select().from(schema.notes)).toEqual([]);
  });

  test('closeTestDbs closes every database it gave out, and a closed one closes again quietly', async () => {
    const one = await openTestDb(options);
    const two = await openTestDb(options);
    await one.close();
    await closeTestDbs();
    await expect(two.select().from(schema.notes).execute()).rejects.toThrow();
    await one.close();
  });
});

describe('openDb', () => {
  test('migrates an in-memory PGlite', async () => {
    const db = await openDb(':memory:', options);
    await db.insert(schema.notes).values({ body: 'in memory', length: 9 });
    expect(await db.select({ body: schema.notes.body }).from(schema.notes)).toEqual([{ body: 'in memory' }]);
    await db.close();
  });

  test('keeps a PGlite folder across opens, migrating it only once', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'app-kit-postgres-'));
    try {
      const first = await openDb(folder, options);
      await first.insert(schema.notes).values({ body: 'kept', length: 4 });
      await first.close();
      const again = await openDb(folder, options);
      expect(await again.select({ body: schema.notes.body }).from(schema.notes)).toEqual([{ body: 'kept' }]);
      await again.close();
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  test('opens a postgres:// URL through postgres-js and migrates it', async () => {
    // PGlite served over Postgres's own wire protocol stands in for Railway's Postgres, on a port the system picks.
    const served = new PGlite();
    const server = new PGLiteSocketServer({ db: served, port: 0, maxConnections: 10 });
    await server.start();
    try {
      const db = await openDb(`postgres://postgres@${server.getServerConn()}/postgres`, options);
      await db.insert(schema.notes).values({ body: 'over the wire', length: 13 });
      await db.close();
      expect((await served.query('select body from notes')).rows).toEqual([{ body: 'over the wire' }]);
    } finally {
      await server.stop();
      await served.close();
    }
  });
});
