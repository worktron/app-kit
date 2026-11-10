/**
 * The server half of the web kit: the app's built page, sent so that a browser never keeps an old index page. The crash
 * reload (crash-reload.ts) and the new-build line (new-build.ts) both read which build the index page names, and a
 * browser that reused the page by its own guess, from its Last-Modified date, would answer them with the build they are
 * running. So the index page, and every address answered with it, goes out with `no-cache`, which makes the browser ask
 * again on each load; the files Vite built are named after what they hold and are kept for a year.
 *
 * A plain `(Request) => Promise<Response>`, so a Hono server and a bare Bun.serve take it the same way. No React.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const KEPT = 'public, max-age=31536000, immutable';
const ASKED_AGAIN = 'no-cache';
/**
 * Vite's record of the files it built, which `build: { manifest: true }` writes: each is named after what it holds, so a
 * deploy that changes one changes its name. A file an app put in `public/` is copied as it is and is not in the record,
 * whatever its name looks like, so it is asked for again.
 */
const MANIFEST = '.vite/manifest.json';
/**
 * The list of an app's public pages, which writePublicPages (public-pages.tsx) writes into the build beside each page's
 * file: a JSON array of addresses, as `["/privacy"]`, each read from `<name>.html`.
 */
export const PUBLIC_PAGES_LIST = 'public-pages.json';

interface ManifestEntry {
  file: string;
  css?: string[];
  assets?: string[];
}

export interface BuiltPageOptions {
  /**
   * Where the app's API answers, `/api/` unless the app says otherwise. An address there that reached this handler is
   * one no route took, and gets a JSON 404 rather than the page, which a caller expecting JSON could not read.
   */
  api?: string;
  /**
   * Whether the build holds public pages written by writePublicPages, sent at their addresses as finished HTML. The
   * build's own list says which; a build without the list, or without a file on it, stops the server at once rather
   * than send the empty index page there, which a reader that runs no JavaScript, as the Chrome Web Store's check of a
   * privacy link, finds empty.
   */
  publicPages?: boolean;
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
  let built: Promise<Set<string>> | undefined;
  const publicPages = options.publicPages ? readPublicPages(root) : new Map<string, string>();

  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const { pathname } = new URL(request.url);
    if (pathname.startsWith(api) || pathname === api.replace(/\/$/, '')) return Response.json({ error: 'Not found' }, { status: 404 });
    const publicPage = publicPages.get(pathname.replace(/(.)\/$/, '$1'));
    if (publicPage) return new Response(Bun.file(publicPage), { headers: { 'Cache-Control': ASKED_AGAIN, 'Content-Type': 'text/html; charset=utf-8' } });

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
        built ??= builtFiles(root);
        return new Response(file, { headers: { 'Cache-Control': (await built).has(path) ? KEPT : ASKED_AGAIN } });
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

/** Each public page's address and its file, from the build's list, every file checked as the server starts. */
function readPublicPages(root: string): Map<string, string> {
  const at = join(root, PUBLIC_PAGES_LIST);
  const fix = 'Run writePublicPages from app-kit/web/public-pages after vite build.';
  if (!existsSync(at)) throw new Error(`app-kit serve: publicPages is set but ${at} is missing, so its pages would be sent empty. ${fix}`);
  const addresses = JSON.parse(readFileSync(at, 'utf8')) as unknown;
  if (!Array.isArray(addresses) || !addresses.every((address) => typeof address === 'string' && /^\/[a-z0-9][a-z0-9-]*$/.test(address))) {
    throw new Error(`app-kit serve: ${at} is not a list of addresses, as ["/privacy"]. ${fix}`);
  }
  const pages = new Map<string, string>();
  for (const address of addresses as string[]) {
    const file = join(root, `${address.slice(1)}.html`);
    if (!existsSync(file)) throw new Error(`app-kit serve: ${address} is a public page but ${file} is missing, so it would be sent empty. ${fix}`);
    pages.set(address, file);
  }
  console.log(`[app-kit] serve: public pages sent as finished HTML: ${[...pages.keys()].join(', ')}`);
  return pages;
}

/** The addresses of the files Vite built, from its manifest, read once, at the first file asked for. */
async function builtFiles(root: string): Promise<Set<string>> {
  const at = join(root, MANIFEST);
  let manifest: Record<string, ManifestEntry>;
  try {
    manifest = (await Bun.file(at).json()) as Record<string, ManifestEntry>;
  } catch (error) {
    console.warn(`[app-kit] serve: could not read ${at} (${(error as Error).message}), so every file is asked for again; set build: { manifest: true } in the Vite config`);
    return new Set();
  }
  return new Set(Object.values(manifest).flatMap((entry) => [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]).map((name) => `/${name}`));
}

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'Cache-Control': ASKED_AGAIN } });
}
