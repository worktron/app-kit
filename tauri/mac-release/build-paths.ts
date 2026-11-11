/*
 * The releasing Mac's folder paths, kept out of a Mac release: the build settings that rewrite them, and the search of
 * what is about to be published for any that are left. The releases repositories are public, and Rust writes each
 * source file's full path into a program's panic and log messages, so without the rewrite every release named the
 * owner's home folder, login name included, hundreds of times: 855 of Messages Service's 866 were the cargo registry's
 * sources in the home folder, the rest the release's own checkout.
 *
 * Rust's compiler rewrites a path that starts with a given folder (`--remap-path-prefix`), the last matching rule
 * winning, so the checkout's rule comes after the home folder's, which holds it. They reach Cargo in
 * CARGO_BUILD_RUSTFLAGS, the environment's form of `build.rustflags`, which Cargo joins with an app's own
 * `build.rustflags`. Cargo splits it on spaces, so a folder named with one cannot be rewritten (`unrewritable`), and the
 * checkout becomes a fixed word rather than the app's name, which may hold a space. Cargo ignores it, as it does every
 * `build.rustflags`, when RUSTFLAGS or CARGO_ENCODED_RUSTFLAGS is set, which the release takes out of the build's
 * environment, or when an app's Cargo config sets `target.<triple>.rustflags`, which the search then catches. C that
 * Rust libraries compile through the cc crate gets the same rewrite in CFLAGS and CXXFLAGS, which cc joins with its own.
 *
 * Once the kit requires Rust 1.101, where Cargo's `trim-paths` profile setting is stable (cargo#17488), the rewrite can
 * be CARGO_PROFILE_RELEASE_TRIM_PATHS=all instead; the search stays, since trimming is best-effort.
 *
 * The rewrite cannot reach every path: `env!("CARGO_MANIFEST_DIR")` in a library stays as it is, and with `debug` on in
 * `[profile.release]` the linker keeps each object file's path, which `strings` does not show. So the search reads raw
 * bytes, every file of the app in the archive that goes up and its bundled page folder, which Tauri stores compressed
 * inside the program where a search of the program cannot see it.
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Env } from '../build-env.ts';

/** What the checkout's own paths become in a release. */
export const CHECKOUT_WORD = 'app';

/** What the home folder becomes in a release. */
export const HOME_WORD = '~';

/** The prefix every macOS home folder has, searched for besides this Mac's own. */
export const USERS = '/Users/';

/** How many paths a refusal names. */
export const NAMED = 5;

/** Why a folder's paths cannot be rewritten, or null when they can: Cargo splits CARGO_BUILD_RUSTFLAGS on whitespace. */
export function unrewritable(folders: { home: string; checkout: string; cargoHome?: string }): string | null {
  for (const [what, folder] of Object.entries(folders)) {
    if (folder && /\s/.test(folder)) return `the ${what === 'cargoHome' ? 'Cargo home' : what} folder ${folder} has a space in its name, which Rust's path rewriting cannot take`;
  }
  return null;
}

/**
 * The environment a release's build adds to rewrite its paths: the home folder to `~`, a Cargo home outside it to
 * `cargo`, and the checkout to `app`, in that order, since the last matching rule wins. The shell's C flags are kept,
 * with the rewrite after them.
 */
export function pathRewriteEnv(env: Env, folders: { home: string; checkout: string; cargoHome?: string }): Env {
  const rules: [string, string][] = [[folders.home, HOME_WORD]];
  if (folders.cargoHome && !within(folders.cargoHome, folders.home)) rules.push([folders.cargoHome, 'cargo']);
  rules.push([folders.checkout, CHECKOUT_WORD]);
  const rust = rules.map(([from, to]) => `--remap-path-prefix=${from}=${to}`).join(' ');
  const c = rules.map(([from, to]) => `-ffile-prefix-map=${from}=${to}`).join(' ');
  const joined = (name: string) => [env[name], c].filter(Boolean).join(' ');
  return { CARGO_BUILD_RUSTFLAGS: rust, CFLAGS: joined('CFLAGS'), CXXFLAGS: joined('CXXFLAGS') };
}

function within(folder: string, home: string): boolean {
  return folder === home || folder.startsWith(`${home.replace(/\/$/, '')}/`);
}

/** One path found: the file it is in, relative to the folder searched and named by `label`, and the path itself. */
export type FoundPath = { file: string; path: string };

/** Every path found, in the order the files are read; `count` counts them all, `found` keeps the first NAMED distinct ones. */
export type Search = { count: number; found: FoundPath[] };

/** A byte that can be part of a path as Rust and C write one into a program. */
function pathByte(byte: number): boolean {
  return (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || '/._-+~@'.includes(String.fromCharCode(byte));
}

/** The longest path a refusal names, so a path run into other text is cut. */
const LONGEST = 200;

/**
 * Searches every file under each folder, byte for byte, for `/Users/` and for each of the build's own folders (the home
 * folder, the checkout, a Cargo home), so one outside /Users/ is found too. Each match is cut to the path itself: from
 * where it starts to the first byte no path holds, since Rust packs its messages with nothing between them. Symbolic
 * links are not followed, since an app's frameworks link inside the app.
 */
export function searchForPaths(folders: { folder: string; label: string }[], buildFolders: (string | undefined)[]): Search {
  const outside = buildFolders.filter((folder): folder is string => !!folder && !within(folder, USERS.slice(0, -1)));
  const needles = [USERS, ...outside].map((needle) => Buffer.from(needle));
  const search: Search = { count: 0, found: [] };
  const seen = new Set<string>();
  const visit = (root: string, label: string, path: string) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(root, label, join(path, name));
      return;
    }
    if (!stat.isFile()) return;
    const bytes = readFileSync(path);
    const starts = new Set<number>();
    for (const needle of needles) {
      for (let at = bytes.indexOf(needle); at !== -1; at = bytes.indexOf(needle, at + 1)) starts.add(at);
    }
    for (const start of [...starts].sort((a, b) => a - b)) {
      search.count += 1;
      let end = start;
      while (end < bytes.length && end - start < LONGEST && pathByte(bytes[end]!)) end += 1;
      const found = bytes.subarray(start, end).toString('latin1');
      const file = join(label, relative(root, path));
      if (search.found.length < NAMED && !seen.has(found)) {
        seen.add(found);
        search.found.push({ file, path: found });
      }
    }
  };
  for (const { folder, label } of folders) visit(folder, label, folder);
  return search;
}

/** The refusal's words for what the search found. */
export function foundPathsMessage(search: Search): string {
  const named = search.found.map(({ file, path }) => `${path} in ${file}`).join('; ');
  return (
    `the build holds ${search.count} path${search.count === 1 ? '' : 's'} of this Mac's home folder, which a public release would publish: ${named}. ` +
    `The release rewrites them, so one left comes from an app's Cargo config naming target rustflags (they replace the rewrite), ` +
    `debug on in [profile.release] (the linker keeps object paths), or a library's env!("CARGO_MANIFEST_DIR"), which no rewrite reaches ` +
    `(app-kit's README, "Releases and updates")`
  );
}
