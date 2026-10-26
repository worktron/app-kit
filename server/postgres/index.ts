import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

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
 * Anything else is an embedded Postgres (PGlite): a folder on disk for local use, or `:memory:`.
 */
export async function openDb<TSchema extends Schema>(
  location: string,
  { schema, migrationsFolder }: DbOptions<TSchema>,
): Promise<Db<TSchema>> {
  if (/^postgres(ql)?:\/\//.test(location)) {
    const client = postgres(location, { onnotice: () => {} });
    const db = drizzlePostgres(client, { schema });
    await migratePostgres(db, { migrationsFolder });
    return Object.assign(db, { close: () => client.end() });
  }
  const client = location === ':memory:' ? new PGlite() : new PGlite(location);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return Object.assign(db, { close: () => client.close() });
}

/** The files of one database migrated once per test process, for each migrations folder. */
const migrated = new Map<string, Promise<File | Blob>>();
const testDbs = new Set<PGlite>();

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
    files = (async () => {
      const template = new PGlite();
      await migratePglite(drizzlePglite(template), { migrationsFolder });
      const dump = await template.dumpDataDir('none');
      await template.close();
      return dump;
    })();
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
