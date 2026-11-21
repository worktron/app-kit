// scripts/kit-features.ts's landedAt answers the feature entries' searches in memory, from one read of an app, rather
// than with a git process each. These tests hold it to git's own answers: every search and file read the entries make,
// and a few more on the edges of git's path rules, asked of one made-up app both ways and expected equal. The app holds
// files on each edge (dot folders and dot-files, node_modules at any depth, test files and folders, Rust build folders,
// root and nested Markdown, a symlink, a submodule, a binary file, one over a megabyte, Windows line ends and a letter
// outside ASCII) and is laid out so every entry applies to it, so a new entry is compared too.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { ereToRegExp, FEATURES, featuresOf, landedAt, pathspecMatcher, type Landed } from '../scripts/kit-features.ts';
import { GIT_IDENTITY_ENV, pathWithGitItself } from './testflight-stand-in.ts';

// git's answers in the C locale with paths printed as they are, the reading landedAt promises.
const env = { ...process.env, PATH: pathWithGitItself(process.env.PATH), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C', ...GIT_IDENTITY_ENV };
const REF = 'app';
let root: string;

// One line of each kind the entries look for, so a file the path rules wrongly keep or drop changes an answer.
const EVERY_KIND = [
  "import { iphoneSignInForGate } from 'app-kit/tauri/iphone-sign-in';",
  'export const iphoneSignIn = iphoneSignInForGate({ handBackOverHttps: true });',
  "import { getAuth } from '@clerk/hono';",
  "import { listen } from 'app-kit/server/start';",
  'listen(app, { onStop: () => db.close() });',
  'const app = new Hono();',
  'serveBuiltPage(app);',
  "import { pgTable } from 'drizzle-orm/pg-core';",
  "import { SignInGate } from 'app-kit/web';",
  '<SignInGate>',
  '<ErrorBoundary placeholder={<Saved />}>',
  "import TextField from '@mui/material/TextField';",
  "const pages = ['/privacy', '/terms'];",
  "await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages');",
  "RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '10'",
  "import { test } from 'bun:test';",
  'clerkServerSignIn({ env: process.env, port });',
  "import { toolbarIconFollowsMode } from 'app-kit/extension/worker/toolbar-icon.js';",
  'toolbarIconFollowsMode(chrome.action);',
].join('\n');

const RUST = 'let menu = AppMenu::new(app)?;\nlet url = WebviewUrl::External(site);\napp.settings_window()?;\n';

/** Each file of the made-up app: its mode and its bytes, or a submodule's commit. */
const FILES: Record<string, { mode: string; text: string | Buffer } | { submodule: string }> = {
  // Shipped code, so every entry applies.
  'client/src/App.tsx': { mode: '100644', text: EVERY_KIND },
  'server/index.ts': { mode: '100644', text: EVERY_KIND },
  '.railway/railway.ts': { mode: '100644', text: "export default defineRailway(() => project('app', { env: { RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '10' } }));\n" },
  'apps/cloud/.railway/railway.ts': { mode: '100644', text: "env: { RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '0' }\n" },
  'src-tauri/Cargo.toml': { mode: '100644', text: 'tauri-plugin-app-kit-window = { git = "https://example.com/app-kit" }\n' },
  'src-tauri/src/lib.rs': { mode: '100644', text: RUST },
  'src-tauri/tauri.conf.json': { mode: '100644', text: JSON.stringify({ identifier: 'com.example.app', build: { frontendDist: '../node_modules/app-kit/tauri/window/start' } }) },
  'src-tauri/gen/apple/app_iOS/app_iOS.entitlements': {
    mode: '100644',
    text: '<plist><dict><key>com.apple.developer.associated-domains</key><array><string>webcredentials:app.example.com</string></array></dict></plist>\n',
  },
  'bin/run.js': { mode: '100755', text: EVERY_KIND },
  'package.json': { mode: '100644', text: JSON.stringify({ scripts: { icons: 'app-kit icons --toolbar-color "#333333"' } }) },
  // The path rules' edges, each holding every kind of line.
  'node_modules/kit/index.ts': { mode: '100644', text: EVERY_KIND },
  'packages/web/node_modules/kit/index.js': { mode: '100644', text: EVERY_KIND },
  '.github/scripts/check.ts': { mode: '100644', text: EVERY_KIND },
  'client/src/.hidden.ts': { mode: '100644', text: EVERY_KIND },
  'client/src/App.test.tsx': { mode: '100644', text: EVERY_KIND },
  'client/src/App.spec.ts': { mode: '100644', text: EVERY_KIND },
  'client/src/types.test.d/index.ts': { mode: '100644', text: EVERY_KIND },
  'test/helpers.ts': { mode: '100644', text: EVERY_KIND },
  'server/tests/db.ts': { mode: '100644', text: EVERY_KIND },
  'e2e/sign-in.ts': { mode: '100644', text: EVERY_KIND },
  'extension/background.ts': { mode: '100644', text: EVERY_KIND },
  'apps/chrome-extension/worker.js': { mode: '100644', text: EVERY_KIND },
  'README.md': { mode: '100644', text: 'Railway waits for the clean stop: RAILWAY_DEPLOYMENT_DRAINING_SECONDS=10.\n' },
  'docs/deploy.md': { mode: '100644', text: 'RAILWAY_DEPLOYMENT_DRAINING_SECONDS=10\n' },
  'docs/case.md': { mode: '100644', text: 'lower case first\n' },
  'NOTES.MD': { mode: '100644', text: 'RAILWAY_DEPLOYMENT_DRAINING_SECONDS=10\n' },
  'crates/menu/Cargo.toml': { mode: '100644', text: 'tauri-plugin-app-kit-window = "1"\n' },
  'node_modules/plugin/Cargo.toml': { mode: '100644', text: 'tauri-plugin-app-kit-window = "1"\n' },
  'src-tauri/target/debug/build/out.rs': { mode: '100644', text: RUST },
  'src-tauri/tests/window.rs': { mode: '100644', text: RUST },
  'node_modules/plugin/src/lib.rs': { mode: '100644', text: RUST },
  // git grep never reads a symlink's target or a submodule.
  'client/src/link.ts': { mode: '120000', text: EVERY_KIND },
  'vendor/kit': { submodule: '1234567890abcdef1234567890abcdef12345678' },
  'assets/logo.bin': { mode: '100644', text: Buffer.concat([Buffer.from([0, 1, 2, 255, 0]), Buffer.from(`\n${EVERY_KIND}\n`)]) },
  'assets/bundle.js': { mode: '100644', text: `${'// filler\n'.repeat(120_000)}${EVERY_KIND}\n` },
  'client/src/crlf.ts': { mode: '100644', text: EVERY_KIND.replaceAll('\n', '\r\n') },
  // A letter outside ASCII just before a word: not a letter in the C locale, so `[^.[:alnum:]_]listen\(` matches.
  'server/accents.ts': { mode: '100644', text: 'const xélisten(app);\n' },
  'client/src/café.ts': { mode: '100644', text: 'listen(app);\n' },
};

/** git's answers, as landedAt gave them before it read in memory: a git process for every question. */
function throughGit(dir: string, ref: string): Landed {
  const git = (args: string[]) => {
    const p = Bun.spawnSync(['git', '-C', dir, '-c', 'core.quotePath=false', ...args], { env, stdout: 'pipe', stderr: 'pipe' });
    return { ok: p.exitCode === 0, out: p.stdout.toString() };
  };
  return {
    tracked: git(['ls-tree', '-r', '--name-only', ref]).out.split('\n').filter(Boolean),
    show: (file) => {
      const shown = git(['show', `${ref}:${file}`]);
      return shown.ok ? shown.out : '';
    },
    grep: (pattern, pathspecs) =>
      git(['grep', '-l', '-E', pattern, ref, '--', ...pathspecs])
        .out.split('\n')
        .filter(Boolean)
        .map((line) => line.slice(ref.length + 1)),
  };
}

beforeAll(() => {
  const cache = join(import.meta.dir, '../node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  root = mkdtempSync(join(cache, 'app-kit-feature-landed-'));
  const stream: Buffer[] = [Buffer.from(`commit refs/heads/${REF}\ncommitter Worktron <kit@example.com> 0 +0000\ndata 3\nApp\n`)];
  for (const [path, file] of Object.entries(FILES)) {
    if ('submodule' in file) {
      stream.push(Buffer.from(`M 160000 ${file.submodule} ${path}\n`));
      continue;
    }
    const bytes = Buffer.from(file.text);
    stream.push(Buffer.from(`M ${file.mode} inline ${path}\ndata ${bytes.length}\n`), bytes, Buffer.from('\n'));
  }
  for (const args of [['init', '-q', '--bare'], ['fast-import', '--quiet']]) {
    const p = Bun.spawnSync(['git', ...args], { cwd: root, env, stdin: args[0] === 'fast-import' ? Buffer.concat(stream) : undefined, stdout: 'pipe', stderr: 'pipe' });
    if (p.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${p.stderr}`);
  }
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

test('every feature entry applies to the made-up app, so each of its searches is compared with git below', () => {
  const app = landedAt(root, REF, env);
  expect(FEATURES.filter((entry) => !entry.appliesTo(app)).map((entry) => entry.feature)).toEqual([]);
});

test("every search and file read the entries make is answered as git answers it, with one git process for the list and one for the texts", async () => {
  const inMemory = landedAt(root, REF, env);
  const git = throughGit(root, REF);
  const asked: string[] = [];
  const compared: Landed = {
    tracked: inMemory.tracked,
    show: (file) => {
      asked.push(`show ${file}`);
      expect({ file, text: inMemory.show(file) }).toEqual({ file, text: git.show(file) });
      return inMemory.show(file);
    },
    grep: (pattern, pathspecs) => {
      asked.push(`grep ${pattern}`);
      expect({ pattern, pathspecs, paths: inMemory.grep(pattern, pathspecs) }).toEqual({ pattern, pathspecs, paths: git.grep(pattern, pathspecs) });
      return inMemory.grep(pattern, pathspecs);
    },
  };
  expect(inMemory.tracked).toEqual(git.tracked);
  for (const entry of FEATURES) {
    expect(entry.appliesTo(compared)).toBe(true);
    await entry.present(compared, async () => ({ failed: 'these tests never ask Apple' }));
  }
  // The entries read files and search the path rules' edges, so the comparison above is not empty.
  expect(asked.filter((each) => each.startsWith('show ')).length).toBeGreaterThan(2);
  expect(asked.filter((each) => each.startsWith('grep ')).length).toBeGreaterThan(20);

  // Read afresh, the whole feature check is two git processes: the list, then every text.
  const spawned: string[] = [];
  const spawnSync = Bun.spawnSync;
  Bun.spawnSync = ((...args: Parameters<typeof Bun.spawnSync>) => {
    spawned.push(String((args[0] as string[])[0]));
    return spawnSync(...args);
  }) as typeof Bun.spawnSync;
  try {
    await featuresOf(landedAt(root, REF, env), async () => ({ failed: 'these tests never ask Apple' }));
  } finally {
    Bun.spawnSync = spawnSync;
  }
  expect(spawned).toEqual(['git', 'git']);
}, 15_000); // git runs once for every search it is compared on, a hundred processes, so it has the fifteen seconds a test may take.

test("the path rules' edges are answered as git answers them", () => {
  const inMemory = landedAt(root, REF, env);
  const git = throughGit(root, REF);
  const asks: [string, string[]][] = [
    ['RAILWAY', [':(glob)*.md']],
    ['RAILWAY', [':(glob)**/*.md']],
    ['RAILWAY', [':(glob)**/*.MD']],
    ['listen', [':(glob)**/*.test.*']],
    ['listen', [':(glob)client/**']],
    ['listen', [':(glob)client/**/*.ts', ':(exclude,glob)**/.*']],
    ['listen', [':(exclude,glob)**/node_modules/**', ':(exclude,glob)assets/**']],
    ['listen', [':(glob)?erver/*.ts']],
    ['[[:alpha:]][[:digit:]]', [':(glob)**/*']],
    ['^[[:upper:]][[:lower:]]+ ', [':(glob)**/*.md']],
    ['[[:space:]]$', [':(glob)**/*.ts']],
    // git finds an empty line after a file's last line end.
    ['^$', [':(glob)**/*.md']],
    // In the C locale é is two characters, as git reads it.
    ['x..listen', [':(glob)**/*.ts']],
    // A dot matches the \r of a Windows line end.
    [';.$', [':(glob)**/*.ts']],
  ];
  for (const [pattern, pathspecs] of asks) expect({ pattern, pathspecs, paths: inMemory.grep(pattern, pathspecs) }).toEqual({ pattern, pathspecs, paths: git.grep(pattern, pathspecs) });
});

test('a pathspec or pattern git could read differently from the in-memory search is refused, never guessed', () => {
  expect(() => pathspecMatcher(['src/*.ts'])).toThrow('landedAt reads only :(glob) and :(exclude,glob) pathspecs, not src/*.ts');
  expect(() => pathspecMatcher([':(icase,glob)*.md'])).toThrow('not :(icase,glob)*.md');
  expect(() => pathspecMatcher([':(glob)a**b'])).toThrow('landedAt reads ** only as a whole folder name');
  expect(() => pathspecMatcher([':(glob)[ab].ts'])).toThrow('landedAt reads no brackets');
  expect(() => ereToRegExp('listen\\s*\\(')).toThrow('cannot read listen\\s*\\( as git does: \\s');
  expect(() => ereToRegExp('[[:word:]]')).toThrow('the class [:word:]');
  expect(() => ereToRegExp('[]a]')).toThrow('a bracket opening with ]');
  expect(() => ereToRegExp('[[.a.]]')).toThrow('a collating element');
  expect(() => ereToRegExp('café')).toThrow('a character outside printable ASCII');
  expect(() => ereToRegExp('[abc')).toThrow('a bracket that never closes');
});
