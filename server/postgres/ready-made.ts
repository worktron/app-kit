import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const READY_MADE = '@electric-sql/pglite-prepopulatedfs';

/**
 * PGlite's ready-made empty database, which PGlite publishes as its own package and which starts in about a fifth of
 * the processor time of making one, when it is installed at exactly the installed PGlite's version, the only one PGlite
 * promises it works with. Otherwise why not, with the version to install. Packages are found from `from`, a file in the
 * folder they are installed beside, which is this file for the kit and a made-up folder in its tests.
 */
export async function readyMadeEmptyDatabase(
  from: string = import.meta.filename,
): Promise<{ files: Blob } | { reason: string }> {
  const require = createRequire(from);
  const pglite = await installed(require, '@electric-sql/pglite');
  const readyMade = await installed(require, READY_MADE).catch(() => undefined);
  const install = `add ${READY_MADE} ${pglite.version} as a dev dependency to start from PGlite’s ready-made one`;
  if (!readyMade) return { reason: `making an empty database, since ${READY_MADE} is not installed; ${install}` };
  if (readyMade.version !== pglite.version) {
    return {
      reason: `making an empty database, since ${READY_MADE} is ${readyMade.version}, for another PGlite; ${install}`,
    };
  }
  // Its module build, as an import finds it: its CommonJS build cannot find its own files under Bun.
  const entry = readyMade.exports?.['.']?.import?.default ?? readyMade.module ?? readyMade.main ?? 'index.js';
  const { dataDir } = (await import(pathToFileURL(join(readyMade.folder, entry)).href)) as {
    dataDir: () => Promise<Blob>;
  };
  return { files: await unzipped(await dataDir()) };
}

/**
 * The files unzipped, once: PGlite publishes them gzipped, and a database loaded from them unzips them again each time,
 * which made each migrations folder's template cost a third more than one loaded from files PGlite saved unzipped.
 */
async function unzipped(files: Blob) {
  const bytes = new Uint8Array(await files.arrayBuffer());
  return bytes[0] === 0x1f && bytes[1] === 0x8b ? new Blob([gunzipSync(bytes)]) : files;
}

interface Package {
  folder: string;
  version: string;
  exports?: Record<string, { import?: { default?: string } } | undefined>;
  module?: string;
  main?: string;
}

/**
 * An installed package's folder and package.json, found from its entry file: neither PGlite package exports its
 * package.json, and Node refuses `<package>/package.json` for a package that does not. Throws when it is not installed.
 */
async function installed(require: NodeJS.Require, name: string): Promise<Package> {
  const entry = require.resolve(name);
  for (let folder = dirname(entry); ; folder = dirname(folder)) {
    const read = await readFile(join(folder, 'package.json'), 'utf8').catch(() => undefined);
    const found = read === undefined ? undefined : (JSON.parse(read) as Partial<Package> & { name?: string });
    if (found?.name === name && found.version) return { ...found, folder, version: found.version };
    if (dirname(folder) === folder) throw new Error(`could not find ${name}'s package.json above ${entry}`);
  }
}
