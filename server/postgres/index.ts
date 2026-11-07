import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { readyMadeEmptyDatabase } from './ready-made';

/** An app's Drizzle schema, every table it exports, as `import * as schema from './schema'` gives it. */
export type Schema = Record<string, unknown>;

/** The app's schema and the folder drizzle-kit generates its migrations into, as an absolute path. */
export interface DbOptions<TSchema extends Schema> {
  schema: TSchema;
  migrationsFolder: string;
}

export type Db<TSchema extends Schema> = PgDatabase<PgQueryResultHKT, TSchema> & { close: () => Promise<void> };

/**
 * Opens the database and brings its schema up to date. A postgres:// URL is a Postgres server, as on Railway.
 * Anything else is an embedded Postgres (PGlite): a folder on disk for local use, or `:memory:`, which starts from
 * PGlite's ready-made empty database when it is installed at PGlite's version, as test databases do. It logs which one it
 * opened, since a server on Railway whose URL went missing would otherwise run on a folder its next deploy throws away.
 */
export async function openDb<TSchema extends Schema>(
  location: string,
  { schema, migrationsFolder }: DbOptions<TSchema>,
): Promise<Db<TSchema>> {
  // A blank variable, as a broken reference on Railway gives, would otherwise open PGlite in the working folder.
  if (!location.trim()) throw new Error('openDb was given no location: pass a postgres:// URL, a folder or :memory:');
  if (/^postgres(ql)?:\/\//.test(location)) {
    const client = postgres(location, { onnotice: () => {} });
    const db = Object.assign(drizzlePostgres(client, { schema }), { close: () => client.end() });
    await migrateOrClose(db, () => migratePostgres(db, { migrationsFolder }));
    const { host, pathname } = new URL(location);
    console.log(`database: opened Postgres at ${host}${pathname}, migrated`);
    return db;
  }
  const client = location === ':memory:' ? new PGlite({ loadDataDir: await readyMadeFiles() }) : new PGlite(location);
  const db = Object.assign(drizzlePglite(client, { schema }), { close: () => client.close() });
  await migrateOrClose(db, () => migratePglite(db, { migrationsFolder }));
  console.log(`database: opened PGlite ${location === ':memory:' ? 'in memory' : `in ${resolve(location)}`}, migrated`);
  return db;
}

/** Runs the migration, and closes the database when it fails, so an open that throws leaves nothing open behind it. */
async function migrateOrClose(db: { close: () => Promise<void> }, migrate: () => Promise<void>) {
  try {
    await migrate();
  } catch (error) {
    await db.close();
    throw error;
  }
}

/**
 * PGlite's ready-made empty database, read once per process, which an in-memory database and the tests' templates start
 * from in about a fifth of the processor time of making one. Without it, or at another version than PGlite's, they make
 * one as before, and one line says why and what to install, since a busy machine stretches making one past a test's
 * time limit.
 */
let readyMade: Promise<Blob | undefined> | undefined;

function readyMadeFiles() {
  readyMade ??= readyMadeEmptyDatabase()
    .catch((error: unknown) => ({ reason: `making an empty database, since the ready-made one failed: ${error}` }))
    .then((found) => {
      if ('files' in found) return found.files;
      console.log(`PGlite: ${found.reason}`);
      return undefined;
    });
  return readyMade;
}

/** The files of an empty database, once per test process, which each migrations folder's template starts from. */
let empty: Promise<File | Blob> | undefined;
/** The files of one database migrated once per test process, for each migrations folder. */
const migrated = new Map<string, Promise<File | Blob>>();
const testDbs = new Set<PGlite>();

function emptyFiles() {
  if (!empty) {
    empty = readyMadeFiles().then((files) => files ?? dumpAndClose(new PGlite(), async () => {}));
    empty.catch(() => (empty = undefined));
  }
  return empty;
}

/**
 * Runs a step on a database, then gives its files and closes it, whether or not the step threw. Saving the files of
 * a database not yet ready never finishes, so it waits for that first.
 */
async function dumpAndClose(client: PGlite, step: (client: PGlite) => Promise<void>) {
  try {
    await client.waitReady;
    await step(client);
    return await client.dumpDataDir('none');
  } finally {
    await client.close();
  }
}

/**
 * An empty in-memory database with the schema, for a test: loaded from the files of one migrated once per test
 * process, since migrating takes most of a second. A test file closes them after each test with `closeTestDbs`.
 */
export async function openTestDb<TSchema extends Schema>({
  schema,
  migrationsFolder,
}: DbOptions<TSchema>): Promise<Db<TSchema>> {
  let files = migrated.get(migrationsFolder);
  if (!files) {
    files = emptyFiles().then((empty) =>
      dumpAndClose(new PGlite({ loadDataDir: empty }), (template) =>
        migratePglite(drizzlePglite(template), { migrationsFolder }),
      ),
    );
    // A migration that failed is tried again by the next test, so a fixed migration needs no new test process.
    files.catch(() => migrated.delete(migrationsFolder));
    migrated.set(migrationsFolder, files);
  }
  const client = new PGlite({ loadDataDir: await files });
  testDbs.add(client);
  const db = drizzlePglite(client, { schema });
  return Object.assign(db, { close: () => closeTestDb(client) });
}

/**
 * Closes every database `openTestDb` gave out. Each holds a few hundred megabytes, and bun runs every test file in one
 * process, so left open they grew one app's test process past 3 GB and stalled requests for most of a second while it
 * collected them.
 */
export async function closeTestDbs() {
  await Promise.all([...testDbs].map(closeTestDb));
}

async function closeTestDb(client: PGlite) {
  testDbs.delete(client);
  if (!client.closed) await client.close();
}
