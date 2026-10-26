import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { cp, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { closeTestDbs, openDb, openTestDb } from '../server/postgres';
import * as schema from './fixtures/postgres/schema';

const options = { schema, migrationsFolder: join(import.meta.dir, 'fixtures/postgres/drizzle') };

/** A copy of the fixture's migrations whose SQL Postgres refuses, and a step that puts the real SQL back. */
async function brokenMigrations() {
  const folder = await mkdtemp(join(tmpdir(), 'app-kit-postgres-'));
  await cp(options.migrationsFolder, folder, { recursive: true });
  const migration = join(folder, '0000_create_notes.sql');
  const sql = await readFile(migration, 'utf8');
  await writeFile(migration, 'this is not sql');
  return {
    migrationsFolder: folder,
    mend: () => writeFile(migration, sql),
    remove: () => rm(folder, { recursive: true, force: true }),
  };
}

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

  test('a migration that failed is tried again once it is fixed, in the same test process', async () => {
    const broken = await brokenMigrations();
    try {
      await expect(openTestDb({ schema, migrationsFolder: broken.migrationsFolder })).rejects.toThrow();
      await broken.mend();
      const db = await openTestDb({ schema, migrationsFolder: broken.migrationsFolder });
      expect(await db.select().from(schema.notes)).toEqual([]);
    } finally {
      await broken.remove();
    }
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

  test('an open whose migration fails closes its connection', async () => {
    // A server that takes one connection at a time: the second open gets through only if the first let go.
    const served = new PGlite();
    const server = new PGLiteSocketServer({ db: served, port: 0, maxConnections: 1 });
    await server.start();
    const broken = await brokenMigrations();
    try {
      const url = `postgres://postgres@${server.getServerConn()}/postgres`;
      await expect(openDb(url, { schema, migrationsFolder: broken.migrationsFolder })).rejects.toThrow();
      const db = await openDb(url, options);
      expect(await db.select().from(schema.notes)).toEqual([]);
      await db.close();
    } finally {
      await broken.remove();
      await server.stop();
      await served.close();
    }
  });
});
