// The route check for apps' server tests, against apps shaped like the kit's adopters: one guarded as the README says,
// with its not-found catch-all listed for keys, and the same app with each kind of hole in it.
import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { requireCaller, type Caller } from '../authentication/agent-keys';
import { routesLetThrough } from '../authentication/agent-keys/testing';

const CALLER = 'x-test-caller';
const anasKey: Caller = { kind: 'key', personId: 'person-ana', keyId: 'key-1', keyName: 'Reading agent' };
const READABLE = ['GET /api/items/:id', 'ALL /api/*'];

/** An app with health open before the check; `openRoute` adds a route registered before the check too. */
function app(openRoute = false) {
  const a = new Hono();
  a.get('/api/health', (c) => c.json({ ok: true }));
  if (openRoute) a.get('/api/settings', (c) => c.json({ settings: true }));
  a.use(
    '/api/*',
    requireCaller({
      caller: (c) => JSON.parse(c.req.header(CALLER) ?? '{"kind":"nobody","reason":null}') as Caller,
      readableByKey: READABLE,
      openPaths: ['/api/health'],
      log: () => {},
    }),
  );
  a.get('/api/items/:id', (c) => c.json({ item: c.req.param('id') }));
  a.post('/api/items/:id', (c) => c.json({ wrote: true }));
  a.get('/api/settings/export', (c) => c.json({ exporting: true }));
  a.all('/api/*', (c) => c.json({ error: 'not found' }, 404));
  return a;
}

const as = (who: 'nobody' | 'key'): Record<string, string> => (who === 'key' ? { [CALLER]: JSON.stringify(anasKey) } : {});
const check = (openRoute = false, prefix = '/api') =>
  routesLetThrough({ app: app(openRoute), prefix, openPaths: ['/api/health'], readableByKey: READABLE, as });

test('an app guarded as the README says, its catch-all listed for keys, has nothing wrong', async () => {
  expect(await check()).toEqual([]);
});

test('a route registered before the check is named, for nobody and for a key alike', async () => {
  expect(await check(true)).toEqual([
    'nobody: GET /api/settings (GET /api/settings) answered 200, not 401',
    'key: GET /api/settings (GET /api/settings) answered 200, not 403, and is not listed for keys',
  ]);
});

test('a write a key reached is named', async () => {
  // The kit's check refuses a key's POST whatever the list says, so this hole is a route an app put in front of it.
  const leaky = new Hono();
  leaky.post('/api/items', (c) => c.json({ wrote: true }));
  leaky.route('/', app());
  expect(await routesLetThrough({ app: leaky, prefix: '/api', openPaths: ['/api/health'], readableByKey: READABLE, as })).toEqual([
    'nobody: POST /api/items (POST /api/items) answered 200, not 401',
    'key: POST /api/items (POST /api/items) answered 200, not 403, and a key only reads',
  ]);
});

test('a prefix with no routes under it is named, since nothing was checked', async () => {
  expect(await check(false, '/v1')).toEqual(['no route is registered under /v1, so nothing was checked']);
});
