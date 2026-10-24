import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { describeRoute, resolver, validator } from 'hono-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { z } from 'zod';
import { callerOf, requireCaller, type Caller, type SignedInCaller } from '../agent-keys';
import { openApiDescriptions, REFERENCE_PAGE_SETTINGS, undescribedForKey } from '../agent-keys/openapi';

const READABLE = [
  'GET /api/reference.json',
  'GET /api/profiles/:id/decisions',
  'GET /api/profiles/:id/notes',
  'GET /api/export.csv',
  'GET /api/undescribed',
  'ALL /api/*',
  'GET /*',
];

const Decisions = z.object({ rows: z.array(z.object({ subject: z.string() })) });
// A field only the write route takes: a key's description must never show it.
const NewDecision = z.object({ privateWriteOnlyField: z.string() });

/** An app shaped like the kit's first adopter: health before the check, a sub-app, a catch-all and a page fallback. */
function app() {
  const api = new Hono();
  api.get('/api/health', (c) => c.json({ ok: true }));
  api.use('/api/*', async (_c, next) => next());
  api.use('/api/*', requireCaller({ caller: () => ({ kind: 'session', personId: 'person-ana' }), readableByKey: READABLE, log: () => {} }));

  const profiles = new Hono();
  profiles.onError((error, c) => c.json({ error: error.message }, 500));
  profiles.get(
    '/:id/decisions',
    describeRoute({
      summary: 'List the decisions on a profile',
      responses: { 200: { description: 'The decisions', content: { 'application/json': { schema: resolver(Decisions) } } } },
    }),
    (c) => c.json({ rows: [] }),
  );
  profiles.post('/:id/decisions', describeRoute({ summary: 'Make a decision' }), validator('json', NewDecision), (c) => c.json({}));
  profiles.get('/:id/notes', validator('param', z.object({ id: z.string() })), (c) => c.json({}));
  api.route('/api/profiles', profiles);

  api.get('/api/export.csv', describeRoute({ summary: 'Export the decisions as CSV' }), (c) => c.text(''));
  api.get('/api/settings', describeRoute({ summary: 'Read the settings' }), (c) => c.json({}));
  api.get('/api/undescribed', (c) => c.json({}));
  const descriptions = openApiDescriptions(api, { title: 'Example', description: 'An example app.', readableByKey: READABLE });
  api.get('/api/reference.json', describeRoute({ summary: "This API's OpenAPI description" }), async (c) =>
    c.json(await descriptions.forCaller(callerOf(c))),
  );
  api.all('/api/*', (c) => c.json({ error: 'not found' }, 404));
  api.get('/*', (c) => c.html('<!doctype html>'));
  return { api, descriptions };
}

const operations = (paths: Record<string, Record<string, unknown> | undefined> | undefined) =>
  Object.entries(paths ?? {}).flatMap(([path, item]) => Object.keys(item ?? {}).map((method) => `${method.toUpperCase()} ${path}`));

test("a person's description holds every described route, and the reference's own", async () => {
  const doc = await app().descriptions.forPerson();
  expect(operations(doc.paths).sort()).toEqual(
    [
      'GET /api/export.csv',
      'GET /api/profiles/{id}/decisions',
      'GET /api/profiles/{id}/notes',
      'GET /api/reference.json',
      'GET /api/settings',
      'POST /api/profiles/{id}/decisions',
    ].sort(),
  );
});

test("a key's description holds only the listed GET routes, and nothing only a write route uses", async () => {
  const doc = await app().descriptions.forKey();
  expect(operations(doc.paths).sort()).toEqual(
    ['GET /api/export.csv', 'GET /api/profiles/{id}/decisions', 'GET /api/profiles/{id}/notes', 'GET /api/reference.json'].sort(),
  );
  expect(JSON.stringify(doc)).not.toContain('privateWriteOnlyField');
  expect(JSON.stringify(await app().descriptions.forPerson())).toContain('privateWriteOnlyField');
});

test('both descriptions say how to call with a key, after the app\'s own words, naming the routes a key reads', async () => {
  const { descriptions } = app();
  for (const doc of [await descriptions.forKey(), await descriptions.forPerson()]) {
    const text = doc.info.description;
    expect(text.startsWith('An example app.\n\n## Calling this API with a key')).toBe(true);
    expect(text).toContain('`Authorization: Bearer <key>`');
    expect(text).toContain('- `GET /api/profiles/{id}/decisions`: List the decisions on a profile');
    expect(text).not.toContain('/api/settings');
    expect(text).toContain('401 when no key or session is sent');
    expect(text).toContain('403 when the route is not one a key may read');
    expect(text).toContain('503 when the key could not be checked');
  }
});

test('the description answers each caller with theirs, generated once, after every route is registered', async () => {
  const { api, descriptions } = app();
  const key: Caller = { kind: 'key', personId: 'person-ana', keyId: 'key-1', keyName: 'Reading agent' };
  expect(await descriptions.forCaller(key)).toBe(await descriptions.forKey());
  expect(await descriptions.forCaller({ kind: 'session', personId: 'person-ana' })).toBe(await descriptions.forPerson());
  const served = await (await api.request('/api/reference.json')).json();
  expect(operations(served.paths)).toContain('GET /api/settings');
});

test('a caller who is neither signed in nor a checked key gets no description, not the whole one', async () => {
  const { descriptions } = app();
  // An app that hands over the provider's caller instead of callerOf's: the types refuse it, and so does the code.
  const signedOut = { kind: 'nobody', reason: null } as unknown as SignedInCaller;
  const unchecked = { kind: 'unchecked', reason: 'Clerk could not check the key' } as unknown as SignedInCaller;
  await expect(descriptions.forCaller(signedOut)).rejects.toThrow('no OpenAPI description for a caller who is nobody');
  await expect(descriptions.forCaller(unchecked)).rejects.toThrow('no OpenAPI description for a caller who is unchecked');
});

test('the check names each listed GET route a key would not see described, and skips the catch-alls', async () => {
  expect(await undescribedForKey(app().api, READABLE)).toEqual(['GET /api/profiles/:id/notes', 'GET /api/undescribed']);
  const described = READABLE.filter((entry) => !entry.endsWith('/notes') && !entry.endsWith('/undescribed'));
  expect(await undescribedForKey(app().api, described)).toEqual([]);
  expect(await undescribedForKey(app().api, ['ALL /api/*'])).toEqual(['no GET route is listed for keys']);
});

test("the reference page settings turn off Scalar's agent, hosted proxy, developer toolbar, fonts and telemetry", async () => {
  const page = new Hono();
  page.get('/api/reference', Scalar({ ...REFERENCE_PAGE_SETTINGS, pageTitle: 'Example API', url: '/api/reference.json' }));
  const html = await (await page.request('/api/reference')).text();
  const config = html.replace(/\s+/g, '');
  expect(config).toContain('"proxyUrl":""');
  expect(config).toContain('"agent":{"disabled":true}');
  expect(config).toContain('"withDefaultFonts":false');
  expect(config).toContain('"telemetry":false');
  expect(config).toContain('"showDeveloperTools":"never"');
  expect(html).not.toContain('proxy.scalar.com');
  expect(html).toContain('color-scheme: light dark');
  // The script is one pinned release, never whatever Scalar published last.
  expect(html).toContain('<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.76.0/dist/browser/standalone.js"></script>');
  expect(html).not.toContain('@scalar/api-reference/esm.js');
});
