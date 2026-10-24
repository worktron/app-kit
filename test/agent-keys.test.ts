import { beforeEach, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { callerOf, requireCaller, type Caller } from '../agent-keys';

/** The caller each test request carries, standing in for the provider's half. */
const CALLER = 'x-test-caller';
const ana: Caller = { kind: 'session', personId: 'person-ana' };
const anasKey: Caller = { kind: 'key', personId: 'person-ana', keyId: 'key-1', keyName: 'Reading agent' };

let logged: string[];
beforeEach(() => {
  logged = [];
});

/** An app shaped like the kit's adopters: health open, an API under /api, some of it in a sub-app, a JSON 404 last. */
function app(readableByKey: string[]) {
  const profiles = new Hono();
  profiles.get('/:id/decisions', (c) => c.json({ for: callerOf(c).personId, decisions: [] }));
  profiles.post('/:id/decisions', (c) => c.json({ wrote: true }));

  const api = new Hono();
  // Registered before the check, as argon's health check is, so it answers before the check runs.
  api.get('/api/health', (c) => c.json({ ok: true }));
  api.use(
    '/api/*',
    requireCaller({
      caller: (c) => JSON.parse(c.req.header(CALLER) ?? '{"kind":"nobody","reason":null}') as Caller,
      readableByKey,
      openPaths: ['/api/oauth/callback'],
      log: (line) => logged.push(line),
    }),
  );
  api.get('/api/oauth/callback', (c) => c.json({ callback: true }));
  // A literal route registered beside the listed :id route, which starts work when asked.
  api.get('/api/items/export', (c) => c.json({ exporting: true }));
  api.get('/api/items/:id', (c) => c.json({ item: c.req.param('id'), for: callerOf(c).personId }));
  api.get('/api/settings', (c) => c.json({ settings: true }));
  api.route('/api/profiles', profiles);
  api.all('/api/*', (c) => c.json({ error: 'not found' }, 404));
  return api;
}

const READABLE = ['GET /api/items/:id', 'GET /api/profiles/:id/decisions'];

function ask(path: string, caller: Caller | null, method = 'GET') {
  const headers: Record<string, string> = caller ? { [CALLER]: JSON.stringify(caller) } : {};
  return app(READABLE).request(path, { method, headers });
}

test('a signed-in session reaches every route, reads and writes alike', async () => {
  expect((await ask('/api/settings', ana)).status).toBe(200);
  expect((await ask('/api/items/export', ana)).status).toBe(200);
  expect((await ask('/api/profiles/p1/decisions', ana, 'POST')).status).toBe(200);
  expect(logged).toEqual([]);
});

test('a key reads a listed route as the person who owns it, and the decision is logged with the key', async () => {
  const res = await ask('/api/items/abc', anasKey);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ item: 'abc', for: 'person-ana' });
  expect(logged).toEqual(['key Reading agent (key-1) let through for GET /api/items/abc as GET /api/items/:id']);
});

test('a key reaches a listed route inside a sub-app mounted under /api', async () => {
  const res = await ask('/api/profiles/p1/decisions', anasKey);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ for: 'person-ana', decisions: [] });
});

test('a key is refused on a literal route registered beside a listed :id route, which it would match by pattern', async () => {
  const res = await ask('/api/items/export', anasKey);
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: 'this route is not one a key may read' });
  expect(logged).toEqual([
    'key Reading agent (key-1) refused for GET /api/items/export: GET /api/items/export would answer first, and it is not one a key may read',
  ]);
});

test('a key is refused on a route nobody listed, and on a path only the catch-all answers', async () => {
  expect((await ask('/api/settings', anasKey)).status).toBe(403);
  expect((await ask('/api/nothing/here', anasKey)).status).toBe(403);
  expect(logged[1]).toBe('key Reading agent (key-1) refused for GET /api/nothing/here: ALL /api/* would answer first, and it is not one a key may read');
});

/** An app with the check in front and the given routes after it, asked by Ana's key. */
async function askWith(path: string, routes: (api: Hono) => void) {
  const api = new Hono();
  api.use('/api/*', requireCaller({ caller: () => anasKey, readableByKey: READABLE, log: (line) => logged.push(line) }));
  routes(api);
  return api.request(path);
}

test('a listed route that could pass the request on with next() to an unlisted route refuses the key', async () => {
  const res = await askWith('/api/items/export', (api) => {
    api.get('/api/items/:id', (c, next) => (c.req.param('id') === 'export' ? next() : c.json({})));
    api.get('/api/items/export', (c) => c.json({ exporting: true }));
  });
  expect(res.status).toBe(403);
  expect(logged).toEqual([
    'key Reading agent (key-1) refused for GET /api/items/export: GET /api/items/export would run if GET /api/items/:id passed the request on, and it is not one a key may read',
  ]);
});

test('an app.all handler or middleware mounted after the check, ahead of a listed route, refuses the key', async () => {
  const all = await askWith('/api/items/export', (api) => {
    api.all('/api/items/export', (c) => c.json({ exporting: true }));
    api.get('/api/items/:id', (c) => c.json({}));
  });
  expect(all.status).toBe(403);
  const middleware = await askWith('/api/items/abc', (api) => {
    api.use('/api/items/*', async (_c, next) => next());
    api.get('/api/items/:id', (c) => c.json({}));
  });
  expect(middleware.status).toBe(403);
  expect(logged[1]).toBe(
    'key Reading agent (key-1) refused for GET /api/items/abc: ALL /api/items/* would answer first, and it is not one a key may read',
  );
});

test("catch-alls after a listed route, a not-found answer and the app's page for every other address, let the key through", async () => {
  const res = await askWith('/api/items/abc', (api) => {
    api.get('/api/items/:id', (c) => c.json({ item: c.req.param('id') }));
    api.all('/api/*', (c) => c.json({ error: 'not found' }, 404));
    api.get('*', (c) => c.html('<!doctype html>'));
  });
  expect(res.status).toBe(200);
});

test('a key only reads: a POST to a listed path is refused even though the app lists it', async () => {
  const res = await ask('/api/profiles/p1/decisions', anasKey, 'POST');
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: 'a key only reads: it is refused on anything but GET' });
  for (const method of ['PUT', 'PATCH', 'DELETE']) expect((await ask('/api/items/abc', anasKey, method)).status).toBe(403);
});

test('HEAD runs the GET route, so a key may ask it of a listed route and nothing else', async () => {
  expect((await ask('/api/items/abc', anasKey, 'HEAD')).status).toBe(200);
  expect((await ask('/api/items/export', anasKey, 'HEAD')).status).toBe(403);
});

test('nobody gets 401; a refused key is logged with why, and an ordinary signed-out request is not', async () => {
  expect((await ask('/api/items/abc', null)).status).toBe(401);
  expect(logged).toEqual([]);
  const res = await ask('/api/items/abc', { kind: 'nobody', reason: 'the key is revoked, expired or unknown (token-invalid)' });
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: 'unauthorized' });
  expect(logged).toEqual(['key refused for GET /api/items/abc: the key is revoked, expired or unknown (token-invalid)']);
});

test('a key the provider could not check gets 503, so an agent does not report it revoked', async () => {
  const res = await ask('/api/items/abc', { kind: 'unchecked', reason: 'Clerk could not check the key (unexpected-error)' });
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: 'could not check the key with the sign-in provider; try again shortly' });
});

test('open paths, and a route that answers before the check, are reached with no caller', async () => {
  expect((await ask('/api/oauth/callback', null)).status).toBe(200);
  expect((await ask('/api/health', null)).status).toBe(200);
});

test('a handler asking for its caller with nothing mounted in front fails closed with 401', async () => {
  const bare = new Hono();
  bare.get('/api/items/:id', (c) => c.json({ for: callerOf(c).personId }));
  expect((await bare.request('/api/items/abc')).status).toBe(401);
});
