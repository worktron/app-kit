// The fixture's server: its built page, sent by the kit's own server half on the kit's server start, as an app's server
// sends it.
import { join } from 'path';
import { appServer, listen } from '../../server/start';
import { serveBuiltPage } from '../server';

const port = Number(process.env.E2E_PORT);
if (!port) throw new Error('Run the browser tests through scripts/e2e.sh, which gives them their own port.');

const page = serveBuiltPage(join(import.meta.dir, 'fixture', 'dist'));

/**
 * What pieces.html sends as it is left, kept by the id in its address, for the test to read back. Recorded here rather
 * than through Playwright's own interception, which misses a keepalive request sent as a page goes (Playwright 43278).
 */
const left = new Map<string, { method: string; authorization: string | null }[]>();

// The browser tests answer the app's API themselves; a request the log printed here is one that reached the server.
const app = appServer({ service: 'fixture', print: (line) => console.log(`[fixture] ${line}`) });
app.get('/api/left/:id', (c) => c.json(left.get(c.req.param('id')) ?? []));
app.all('/api/left/:id', (c) => {
  const id = c.req.param('id');
  left.set(id, [...(left.get(id) ?? []), { method: c.req.method, authorization: c.req.header('Authorization') ?? null }]);
  return c.body(null, 204);
});
app.get('*', (c) => page(c.req.raw));

listen(app, { port, hostname: 'localhost', print: (line) => console.log(`[fixture] ${line}`) });
