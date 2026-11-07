import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { closeTestDbs, openDb, openTestDb, type Db } from '../server/postgres';
import { readyMadeEmptyDatabase } from '../server/postgres/ready-made';
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

const SYSTEM_ID = 'select system_identifier::text as id from pg_control_system()';

/**
 * The system identifier of PGlite's ready-made empty database. Postgres gives each database it makes a new one and
 * keeps it in the database's files, so a database started from the ready-made files has this one, and a made one not.
 */
async function readyMadeSystemId() {
  const found = await readyMadeEmptyDatabase();
  if (!('files' in found)) throw new Error(found.reason);
  const db = new PGlite({ loadDataDir: found.files });
  try {
    return (await db.query(SYSTEM_ID)).rows;
  } finally {
    await db.close();
  }
}

/** A database's system identifier, as PGlite answers the query. */
const systemId = (db: Db<typeof schema>): Promise<unknown> => db.execute(sql.raw(SYSTEM_ID));

describe('openTestDb', () => {
  // The process's one-time work, loading PGlite's ready-made empty database and migrating the template from it, is done
  // here, held to the fifteen seconds a test may take, so no one test pays it inside Bun's five. Making an empty
  // database instead took 17.5 to 19 seconds here at load 280, so the first open is held to have loaded it.
  beforeAll(async () => {
    const said = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await (await openTestDb(options)).close();
      expect(said.mock.calls.flat().filter((line) => String(line).startsWith('PGlite:'))).toEqual([]);
    } finally {
      said.mockRestore();
    }
  }, 15_000);
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

  test('a test database starts from PGlite’s ready-made empty database', async () => {
    expect(await systemId(await openTestDb(options))).toMatchObject({ rows: await readyMadeSystemId() });
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

describe('readyMadeEmptyDatabase', () => {
  let folder: string | undefined;
  /** Made-up PGlite packages installed in a folder, the ready-made one at `readyMade` or not at all. */
  async function install(pglite: string, readyMade?: string) {
    const made = (folder = await mkdtemp(join(tmpdir(), 'app-kit-ready-made-')));
    const write = async (name: string, version: string, source: string) => {
      const at = join(made, 'node_modules', name);
      await mkdir(join(at, 'dist'), { recursive: true });
      const manifest = { name, version, type: 'module', main: 'dist/index.js' };
      await writeFile(join(at, 'package.json'), JSON.stringify(manifest));
      await writeFile(join(at, 'dist/index.js'), source);
    };
    await write('@electric-sql/pglite', pglite, 'export {};');
    if (readyMade) {
      await write(
        '@electric-sql/pglite-prepopulatedfs',
        readyMade,
        `export const dataDir = async () => new Blob(['the files of ${readyMade}']);`,
      );
    }
    return join(made, 'app.js');
  }
  afterEach(async () => {
    if (folder) await rm(folder, { recursive: true, force: true });
    folder = undefined;
  });
  const since = 'making an empty database, since @electric-sql/pglite-prepopulatedfs';
  const install08 =
    'add @electric-sql/pglite-prepopulatedfs 0.5.8 as a dev dependency to start from PGlite’s ready-made one';

  test("is used only at exactly PGlite's version", async () => {
    const found = await readyMadeEmptyDatabase(await install('0.5.8', '0.5.8'));
    expect('files' in found && (await found.files.text())).toBe('the files of 0.5.8');
  });

  test('missing, it says to install it at PGlite’s version', async () => {
    expect(await readyMadeEmptyDatabase(await install('0.5.8'))).toEqual({
      reason: `${since} is not installed; ${install08}`,
    });
  });

  test('at another version, it is not used, and it says which version to install', async () => {
    expect(await readyMadeEmptyDatabase(await install('0.5.8', '0.5.15'))).toEqual({
      reason: `${since} is 0.5.15, for another PGlite; ${install08}`,
    });
  });

  test('the kit’s own PGlite and ready-made database are the same version, so its tests start from it', async () => {
    expect(await readyMadeEmptyDatabase()).toHaveProperty('files');
  });
});

describe('openDb', () => {
  let logged: string[];
  // The files of an empty database, which the served databases below start from: PGlite starts from files in about
  // a tenth of the time it takes to make a database, which a busy machine stretched past Bun's five seconds a test.
  // Made once here, held to the fifteen seconds a test may take.
  let emptyDatabase: File | Blob;
  beforeAll(async () => {
    const made = new PGlite();
    await made.waitReady;
    emptyDatabase = await made.dumpDataDir('none');
    await made.close();
  }, 15_000);
  beforeEach(() => {
    logged = [];
    spyOn(console, 'log').mockImplementation((line: string) => void logged.push(line));
  });
  afterEach(() => mock.restore());

  test('refuses an empty location, as a blank variable gives, instead of opening a folder', async () => {
    for (const location of ['', '  ']) await expect(openDb(location, options)).rejects.toThrow('no location');
    expect(logged).toEqual([]);
  });

  test('an in-memory PGlite starts from PGlite’s ready-made empty database too', async () => {
    const db = await openDb(':memory:', options);
    expect(await systemId(db)).toMatchObject({ rows: await readyMadeSystemId() });
    await db.close();
  });

  test('migrates an in-memory PGlite and says so', async () => {
    const db = await openDb(':memory:', options);
    await db.insert(schema.notes).values({ body: 'in memory', length: 9 });
    expect(await db.select({ body: schema.notes.body }).from(schema.notes)).toEqual([{ body: 'in memory' }]);
    expect(logged).toEqual(['database: opened PGlite in memory, migrated']);
    await db.close();
  });

  // A real database folder: the first open writes 981 files and the second reads them back, so it is held to the
  // fifteen seconds a test may take, not Bun's five.
  test('keeps a PGlite folder across opens, migrating it only once', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'app-kit-postgres-'));
    try {
      const first = await openDb(folder, options);
      await first.insert(schema.notes).values({ body: 'kept', length: 4 });
      await first.close();
      const again = await openDb(folder, options);
      expect(await again.select({ body: schema.notes.body }).from(schema.notes)).toEqual([{ body: 'kept' }]);
      expect(logged).toEqual(Array(2).fill(`database: opened PGlite in ${folder}, migrated`));
      await again.close();
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }, 15_000);

  test('opens a postgres:// URL through postgres-js, migrates it and says where, without the password', async () => {
    // PGlite served over Postgres's own wire protocol stands in for Railway's Postgres, on a port the system picks.
    const served = new PGlite({ loadDataDir: emptyDatabase });
    const server = new PGLiteSocketServer({ db: served, port: 0, maxConnections: 10 });
    await server.start();
    try {
      const db = await openDb(`postgres://postgres:not-a-real-password@${server.getServerConn()}/postgres`, options);
      // The line names the server and the database, never the password.
      expect(logged).toEqual([`database: opened Postgres at ${server.getServerConn()}/postgres, migrated`]);
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
    const served = new PGlite({ loadDataDir: emptyDatabase });
    const server = new PGLiteSocketServer({ db: served, port: 0, maxConnections: 1 });
    await server.start();
    const broken = await brokenMigrations();
    try {
      const url = `postgres://postgres@${server.getServerConn()}/postgres`;
      // Waited for here, not handed to expect's rejects: bun's wait on a pending promise slowed the traffic between
      // the client and the server in this same process from 25 milliseconds to 2 seconds.
      const failed = await openDb(url, { schema, migrationsFolder: broken.migrationsFolder }).catch((error) => error);
      expect(failed).toBeInstanceOf(Error);
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
