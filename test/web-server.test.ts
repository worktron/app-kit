import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveBuiltPage } from '../web/server';
import { withoutPage } from './dom';

let built: string;
let serve: (request: Request) => Promise<Response>;
let putPageBack: () => void;

beforeAll(async () => {
  putPageBack = await withoutPage();
  built = await mkdtemp(join(tmpdir(), 'app-kit-built-'));
  await mkdir(join(built, 'assets'));
  await mkdir(join(built, '.vite'));
  await writeFile(join(built, 'index.html'), '<!doctype html><title>shop</title>');
  await writeFile(join(built, 'manifest.webmanifest'), '{}');
  await writeFile(join(built, 'assets', 'index-BF93Hsvo.js'), 'console.log(1)');
  await writeFile(join(built, 'assets', 'index-6x-pfrJZ.css'), 'body{}');
  await writeFile(join(built, 'assets', 'bg-DWpOMg8v.png'), 'png');
  await writeFile(join(built, 'assets', 'logo.png'), 'png');
  await writeFile(join(built, 'assets', 'brand-darkmode.png'), 'png');
  // As Vite 8 writes it for an entry with its CSS, an image the CSS names, and a screen loaded later.
  const manifest = {
    'bg.png': { file: 'assets/bg-DWpOMg8v.png', src: 'bg.png' },
    'index.html': { file: 'assets/index-BF93Hsvo.js', isEntry: true, css: ['assets/index-6x-pfrJZ.css'], assets: ['assets/bg-DWpOMg8v.png'] },
  };
  await writeFile(join(built, '.vite', 'manifest.json'), JSON.stringify(manifest));
  serve = serveBuiltPage(built);
});

afterAll(async () => {
  putPageBack();
  await rm(built, { recursive: true, force: true });
});

const get = (path: string, init?: RequestInit) => serve(new Request(`http://localhost${path}`, init));

describe('serveBuiltPage', () => {
  test('every address the app draws gets the index page, which the browser asks for again on each load', async () => {
    for (const path of ['/', '/index.html', '/shelf', '/shelf/3/edit']) {
      const answer = await get(path);
      expect(answer.status).toBe(200);
      expect(await answer.text()).toContain('<title>shop</title>');
      expect(answer.headers.get('Cache-Control')).toBe('no-cache');
      expect(answer.headers.get('Content-Type')).toStartWith('text/html');
    }
  });

  test("files Vite's manifest names are kept for a year, and the files beside the page are asked for again", async () => {
    for (const path of ['/assets/index-BF93Hsvo.js', '/assets/index-6x-pfrJZ.css', '/assets/bg-DWpOMg8v.png']) {
      const answer = await get(path);
      expect(answer.status).toBe(200);
      expect(answer.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    }
    expect((await get('/manifest.webmanifest')).headers.get('Cache-Control')).toBe('no-cache');
  });

  test('a file the app put in public/assets/ keeps its name across deploys, so it is asked for again, whatever its name looks like', async () => {
    // brand-darkmode.png ends in eight letters, as a name Vite made would.
    for (const path of ['/assets/logo.png', '/assets/brand-darkmode.png']) {
      const answer = await get(path);
      expect(answer.status).toBe(200);
      expect(answer.headers.get('Cache-Control')).toBe('no-cache');
    }
  });

  test('a build with no manifest keeps no file, and says so once', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'app-kit-built-'));
    await mkdir(join(bare, 'assets'));
    await writeFile(join(bare, 'assets', 'index-BF93Hsvo.js'), 'console.log(1)');
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const serveBare = serveBuiltPage(bare);
      for (let i = 0; i < 2; i++) {
        const answer = await serveBare(new Request('http://localhost/assets/index-BF93Hsvo.js'));
        expect(answer.status).toBe(200);
        expect(answer.headers.get('Cache-Control')).toBe('no-cache');
      }
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('set build: { manifest: true } in the Vite config');
    } finally {
      warn.mockRestore();
      await rm(bare, { recursive: true, force: true });
    }
  });

  test('a missing file is a 404, never the page, so an old build asking for its gone screen code is not handed HTML', async () => {
    for (const path of ['/assets/gone-999.js', '/favicon.ico']) {
      const answer = await get(path);
      expect(answer.status).toBe(404);
      expect(answer.headers.get('Cache-Control')).toBe('no-cache');
    }
  });

  test('an address under /api/ that no route took is a JSON 404, never the page', async () => {
    for (const path of ['/api/nothing-here', '/api']) {
      const answer = await get(path);
      expect(answer.status).toBe(404);
      expect(await answer.json()).toEqual({ error: 'Not found' });
    }
    expect((await get('/apiary')).status).toBe(200);
  });

  test('an app whose API sits elsewhere names it', async () => {
    const answer = await serveBuiltPage(built, { api: '/v1/' })(new Request('http://localhost/v1/nothing-here'));
    expect(answer.status).toBe(404);
    expect((await serveBuiltPage(built, { api: '/v1/' })(new Request('http://localhost/api/shelf'))).status).toBe(200);
  });

  test('paths never climb out of the built folder', async () => {
    // The URL parser folds plain dot segments, so that one reaches the page; encoded slashes are refused.
    expect(await (await get('/../../etc/passwd')).text()).toContain('<title>shop</title>');
    expect((await get('/..%2F..%2F..%2Fetc%2Fpasswd')).status).toBe(404);
    expect((await get('/assets/..%2F..%2Findex.html')).status).toBe(404);
  });

  test('a malformed escape is a 404, not a thrown error', async () => {
    expect((await get('/shelf%E0%A4%A')).status).toBe(404);
  });

  test('only reads are answered', async () => {
    const answer = await get('/shelf', { method: 'POST', body: 'x' });
    expect(answer.status).toBe(405);
    expect(answer.headers.get('Allow')).toBe('GET, HEAD');
    expect((await get('/', { method: 'HEAD' })).status).toBe(200);
  });
});
