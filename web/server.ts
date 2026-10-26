/**
 * The server half of the web kit: the app's built page, sent so that a browser never keeps an old index page. The crash
 * reload (crash-reload.ts) and the new-build line (new-build.ts) both read which build the index page names, and a
 * browser that reused the page by its own guess, from its Last-Modified date, would answer them with the build they are
 * running. So the index page, and every address answered with it, goes out with `no-cache`, which makes the browser ask
 * again on each load; the files Vite built under /assets/ are named after what they hold and are kept for a year.
 *
 * A plain `(Request) => Promise<Response>`, so a Hono server and a bare Bun.serve take it the same way. No React.
 */
import { join, resolve, sep } from 'node:path';

const KEPT = 'public, max-age=31536000, immutable';
const ASKED_AGAIN = 'no-cache';
/**
 * A file Vite built, named `<name>-<hash>.<ext>` with an eight-character hash of what it holds, so a deploy that changes
 * it changes its name. A file an app put in `public/assets/` keeps its own name across deploys and is asked for again.
 */
const BUILT_NAME = /^\/assets\/(?:.*\/)?[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/i;

export interface BuiltPageOptions {
  /**
   * Where the app's API answers, `/api/` unless the app says otherwise. An address there that reached this handler is
   * one no route took, and gets a JSON 404 rather than the page, which a caller expecting JSON could not read.
   */
  api?: string;
}

/**
 * Answers every read with a file from `folder`, the folder Vite built, or with its index.html for an address the app
 * draws. Mount it after the app's own routes:
 *
 * ```ts
 * const page = serveBuiltPage('dist');
 * app.get('*', (c) => page(c.req.raw));
 * ```
 */
export function serveBuiltPage(folder: string, options: BuiltPageOptions = {}): (request: Request) => Promise<Response> {
  const root = resolve(folder);
  const api = options.api ?? '/api/';
  const index = join(root, 'index.html');

  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const { pathname } = new URL(request.url);
    if (pathname.startsWith(api) || pathname === api.replace(/\/$/, '')) return Response.json({ error: 'Not found' }, { status: 404 });

    let path: string;
    try {
      path = decodeURIComponent(pathname);
    } catch {
      return notFound();
    }
    const target = resolve(root, `.${path}`);
    // A decoded `..%2F` climbs where the URL parser could not see it.
    if (target !== root && !target.startsWith(root + sep)) return notFound();

    if (target !== root) {
      const file = Bun.file(target);
      if (await file.exists()) {
        return new Response(file, { headers: { 'Cache-Control': BUILT_NAME.test(pathname) ? KEPT : ASKED_AGAIN } });
      }
    }
    // An address with a file's extension is a file, never a screen: an old build asking for screen code a deploy
    // removed gets a 404, which reloadOnFailedLoad reads, rather than HTML it would try to run.
    if (/\.[a-z0-9]+$/i.test(path)) return notFound();
    return new Response(Bun.file(index), {
      headers: { 'Cache-Control': ASKED_AGAIN, 'Content-Type': 'text/html; charset=utf-8' },
    });
  };
}

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'Cache-Control': ASKED_AGAIN } });
}
