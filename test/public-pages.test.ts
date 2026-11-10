// The public pages build (web/public-pages.tsx), run as an app runs it after vite build, in a process of its own with
// no simulated page (test/public-pages-child.tsx). The server's sending of what it writes is in web-server.test.ts,
// which takes the simulated page away for its file: this file leaves the shared page alone, as later files hold it.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// As Vite builds an app's index page: its code and what asks for it early, its stylesheet, the first frame's inline
// script, and the wordmark it shows until the app draws.
const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>shop</title>
    <script>document.documentElement.dataset.scheme = 'light';</script>
    <script type="module" crossorigin src="/assets/index-BF93Hsvo.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-C1x2y3z4.js">
    <link rel="stylesheet" crossorigin href="/assets/index-6x-pfrJZ.css">
  </head>
  <body>
    <div id="root"><span class="wordmark">shop</span></div>
  </body>
</html>
`;

async function builtFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'app-kit-public-pages-'));
  await mkdir(join(folder, 'assets'));
  await writeFile(join(folder, 'index.html'), INDEX);
  await writeFile(join(folder, 'assets', 'figtree-latin-wght-normal-B6Ywmhx1.woff2'), 'font');
  await writeFile(join(folder, 'assets', 'figtree-latin-ext-wght-normal-Dd7tQ2pL.woff2'), 'font');
  return folder;
}

function build(folder: string, which = 'pages') {
  const run = Bun.spawnSync(['bun', join(import.meta.dir, 'public-pages-child.tsx'), folder, which], { stdout: 'pipe', stderr: 'pipe' });
  return { exitCode: run.exitCode, stderr: run.stderr.toString() };
}

let folder: string;
let privacy: string;

beforeAll(async () => {
  folder = await builtFolder();
  const run = build(folder);
  if (run.exitCode !== 0) throw new Error(run.stderr);
  privacy = await readFile(join(folder, 'privacy.html'), 'utf8');
});

afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe('writePublicPages', () => {
  test("each page holds its words and title in the HTML, in place of the app's wordmark", () => {
    expect(privacy).toContain('The shop reads only the orders you open, and keeps none of them.');
    expect(privacy).toContain('<title>Privacy policy · shop</title>');
    expect(privacy).not.toContain('class="wordmark"');
    expect(privacy.match(/<title>/g)).toHaveLength(1);
  });

  test("the app's code is gone, and its stylesheet and own inline script stay", () => {
    expect(privacy).not.toContain('index-BF93Hsvo.js');
    expect(privacy).not.toContain('modulepreload');
    expect(privacy).toContain('href="/assets/index-6x-pfrJZ.css"');
    expect(privacy).toContain("document.documentElement.dataset.scheme = 'light';");
  });

  test("the theme's styles are written beside the words, with both color schemes, so dark mode needs no script", () => {
    expect(privacy).toContain('<style data-emotion=');
    expect(privacy).toContain('prefers-color-scheme: dark');
    expect(privacy).toContain(':root { --shop-line: #ddd; }');
  });

  test('the named font is asked for first in the head, and only that one', () => {
    expect(privacy).toMatch(/<head>\s*<link rel="preload" as="font" type="font\/woff2" href="\/assets\/figtree-latin-wght-normal-B6Ywmhx1\.woff2" crossorigin>/);
    expect(privacy).not.toContain('latin-ext');
  });

  test('the text size script is in the head, and a title in the words is escaped', async () => {
    expect(privacy.slice(0, privacy.indexOf('</head>'))).toContain("'app-kit:text-size'".replace(/'/g, '"'));
    expect(await readFile(join(folder, 'terms.html'), 'utf8')).toContain('Use the shop &amp; be kind.');
  });

  test('the build writes its list of pages, which the server reads', async () => {
    expect(JSON.parse(await readFile(join(folder, 'public-pages.json'), 'utf8'))).toEqual(['/privacy', '/terms']);
  });

  test('a page that renders no words, and a font the build lacks, stop the build', async () => {
    const other = await builtFolder();
    try {
      const empty = build(other, 'empty');
      expect(empty.exitCode).toBe(1);
      expect(empty.stderr).toContain('/privacy renders no words');
      const font = build(other, 'missing-font');
      expect(font.exitCode).toBe(1);
      expect(font.stderr).toContain('the build has no font file nowhere-latin.woff2');
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  test('inside a page, where the styles would go into the page and not the file, it refuses', () => {
    const run = build(folder, 'in-page');
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('run outside a page');
  });

  test('an address that is not one segment under the root is refused', () => {
    const run = build(folder, 'nested');
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('not one lower-case segment');
  });
});
