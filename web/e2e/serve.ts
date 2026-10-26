// The fixture's server: its built page, sent by the kit's own server half as an app's server sends it.
import { join } from 'path';
import { serveBuiltPage } from '../server';

const port = Number(process.env.E2E_PORT);
if (!port) throw new Error('Run the browser tests through scripts/e2e.sh, which gives them their own port.');

const page = serveBuiltPage(join(import.meta.dir, 'fixture', 'dist'));

/**
 * What pieces.html sends as it is left, kept by the id in its address, for the test to read back. Recorded here rather
 * than through Playwright's own interception, which misses a keepalive request sent as a page goes (Playwright 43278).
 */
const left = new Map<string, { method: string; authorization: string | null }[]>();
const LEFT = /^\/api\/left\/([\w-]+)$/;

const server = Bun.serve({
  port,
  hostname: 'localhost',
  fetch(request) {
    const id = LEFT.exec(new URL(request.url).pathname)?.[1];
    if (!id) return page(request);
    if (request.method === 'GET') return Response.json(left.get(id) ?? []);
    left.set(id, [...(left.get(id) ?? []), { method: request.method, authorization: request.headers.get('Authorization') }]);
    return new Response(null, { status: 204 });
  },
});
console.log(`[fixture] serving on ${server.url}`);
