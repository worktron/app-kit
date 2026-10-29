import { afterEach, beforeEach, expect, test } from 'bun:test';
import { get, type IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { callerOf, requireCaller, type Caller } from '../authentication/agent-keys';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { cors } from 'hono/cors';
import { appServer } from '../server/start';
import { serveBuiltPage } from '../web/server';
import { ServerRequest } from './dom';

const anasKey: Caller = { kind: 'key', personId: 'person-ana', keyId: 'key-1', keyName: 'Reading agent' };

let printed: string[];
beforeEach(() => {
  printed = [];
});
afterEach(() => {
  delete process.env.RAILWAY_GIT_COMMIT_SHA;
});

function server() {
  return appServer({ service: 'argon-watcher', print: (line) => printed.push(line) });
}

test('the health route names the service and the commit Railway built from', async () => {
  process.env.RAILWAY_GIT_COMMIT_SHA = '0123abc';
  const answer = await server().request('/api/health');
  expect(answer.status).toBe(200);
  expect(await answer.json()).toEqual({ ok: true, service: 'argon-watcher', commit: '0123abc' });
});

test('off Railway the health route says it does not know the commit', async () => {
  expect(await (await server().request('/api/health')).json()).toEqual({ ok: true, service: 'argon-watcher', commit: null });
});

test("the log line for a sign-in callback carries neither its code nor its state", async () => {
  const app = server();
  app.get('/api/oauth/callback', (c) => c.text('signed in'));
  await app.request('/api/oauth/callback?code=4%2F0AQSTgQ-live&state=xyz789');
  expect(printed).toHaveLength(1);
  expect(printed[0]).toMatch(/^GET \/api\/oauth\/callback\?\[redacted\] 200 \d+ms$/);
  expect(printed[0]).not.toContain('4%2F0AQSTgQ');
  expect(printed[0]).not.toContain('xyz789');
});

test('a path with no query is logged as it is', async () => {
  await server().request('/api/items/7');
  expect(printed[0]).toMatch(/^GET \/api\/items\/7 404 \d+ms$/);
});

test('agent keys on the app answer 401 with their own body, from the middleware and from a route', async () => {
  const app = server();
  app.use(
    '/api/*',
    requireCaller({
      caller: (c) => JSON.parse(c.req.header('x-test-caller') ?? '{"kind":"nobody","reason":null}') as Caller,
      readableByKey: [],
      openPaths: ['/api/open'],
    }),
  );
  app.get('/api/items', (c) => c.json({ for: callerOf(c).personId }));
  // A route outside the check that still asks who is calling throws callerOf's own 401.
  app.get('/api/open', (c) => c.json({ for: callerOf(c).personId }));

  const refused = await app.request('/api/items');
  expect(refused.status).toBe(401);
  expect(await refused.json()).toEqual({ error: 'unauthorized' });
  const thrown = await app.request('/api/open');
  expect(thrown.status).toBe(401);
  expect(await thrown.json()).toEqual({ error: 'unauthorized' });
  // The health route answers before the check.
  expect((await app.request('/api/health')).status).toBe(200);
});

test("the README's whole server lets a key read its listed route past the page's catch-all", async () => {
  const dist = mkdtempSync(join(tmpdir(), 'server-start-'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>app</title>');
  const app = server();
  app.use('/api/*', requireCaller({ caller: () => anasKey, readableByKey: ['GET /api/items', 'GET /*'] }));
  app.get('/api/items', (c) => c.json({ for: callerOf(c).personId }));
  app.get('/api/settings', (c) => c.json({ settings: true }));
  const page = serveBuiltPage(dist);
  app.get('*', (c) => page(c.req.raw));

  const read = await app.request('/api/items');
  expect(read.status).toBe(200);
  expect(await read.json()).toEqual({ for: 'person-ana' });
  // A route the list leaves out stays refused to the key, catch-all or not.
  expect((await app.request('/api/settings')).status).toBe(403);
});

test('an ordinary error is logged with its stack and answered as JSON with a 500', async () => {
  const app = server();
  app.get('/api/items', () => {
    throw new Error('the database went away');
  });
  const answer = await app.request('/api/items?q=private');
  expect(answer.status).toBe(500);
  expect(await answer.json()).toEqual({ error: 'Something went wrong on the server.' });
  const failure = printed.find((line) => line.includes('failed:'));
  expect(failure).toContain('GET /api/items?[redacted] failed: Error: the database went away');
  expect(failure).toContain('server-start.test.ts');
  expect(printed).toContainEqual(expect.stringMatching(/^GET \/api\/items\?\[redacted\] 500 \d+ms$/));
});

test('an address under /api/ that no route takes is a JSON 404', async () => {
  const answer = await server().request('/api/nothing');
  expect(answer.status).toBe(404);
  expect(await answer.json()).toEqual({ error: 'Not found' });
});

/** Reads the child's output line by line until a line matches. */
async function lineMatching(lines: AsyncIterator<string>, pattern: RegExp): Promise<string> {
  for (;;) {
    const next = await lines.next();
    if (next.done) throw new Error(`the server ended before printing ${pattern}`);
    if (pattern.test(next.value)) return next.value;
  }
}

async function* linesOf(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let held = '';
  for await (const chunk of stream) {
    held += decoder.decode(chunk, { stream: true });
    const parts = held.split('\n');
    held = parts.pop() ?? '';
    yield* parts;
  }
  if (held) yield held;
}

test('on SIGTERM the server closes a websocket and a stream that never ends, runs onStop and exits', async () => {
  const child = Bun.spawn(['bun', join(import.meta.dir, 'server-start-child.ts')], { stdout: 'pipe', stderr: 'inherit' });
  const lines = linesOf(child.stdout);
  try {
    const address = new URL((await lineMatching(lines, /^listening on /)).slice('listening on '.length));
    // The hostname the child passed went through to Bun.serve as it was.
    expect(address.hostname).toBe('127.0.0.1');

    const socket = new WebSocket(`ws://${address.host}/api/live`);
    const socketClosed = new Promise<number>((resolve) => socket.addEventListener('close', (event) => resolve(event.code)));
    await new Promise((resolve) => socket.addEventListener('open', resolve));
    socket.send('hello');
    await lineMatching(lines, /^socket heard hello$/);

    // Through node:http, since the simulated page's fetch refuses another origin; the page stays, as other files need it.
    const stream = await new Promise<IncomingMessage>((resolve) => get(new URL('/api/stream', address), resolve));
    const chunks = stream[Symbol.asyncIterator]();
    expect(String((await chunks.next()).value)).toBe('first\n');
    const streamEnded = chunks.next().then(
      (read) => (read.done ? 'ended' : 'more'),
      () => 'ended',
    );

    child.kill('SIGTERM');
    await lineMatching(lines, /^SIGTERM: stopping/);
    await lineMatching(lines, /^onStop ran$/);
    expect(await child.exited).toBe(0);
    expect(await streamEnded).toBe('ended');
    // 1001 is going away, as the forced close sends it; a process that only exited leaves 1006.
    expect(await socketClosed).toBe(1001);
  } finally {
    child.kill('SIGKILL');
  }
});

/** The fixture app with a write route, and a call to it as a browser or a script would send it. */
function writable(otherSites?: string[]) {
  const app = appServer({ service: 'argon-watcher', print: (line) => printed.push(line), otherSites });
  app.post('/api/items', (c) => c.json({ saved: true }));
  app.get('/api/items', (c) => c.json({ items: [] }));
  const call = (method: string, headers: Record<string, string> = {}, body?: string) =>
    app.fetch(new ServerRequest('http://localhost:3000/api/items', { method, headers, body }));
  return { app, call };
}

test('a write another website sends is refused with 403 and a log line, whatever its body', async () => {
  const { call } = writable();
  const fromThere = { Origin: 'https://elsewhere.example.com', 'Sec-Fetch-Site': 'cross-site' };
  for (const [type, body] of [['application/x-www-form-urlencoded', 'a=1'], ['application/json', '{"a":1}'], ['text/plain', '{"a":1}']]) {
    const answer = await call('POST', { ...fromThere, 'Content-Type': type }, body);
    expect(answer.status).toBe(403);
    expect(await answer.json()).toEqual({ error: 'This server takes no writes sent from another website.' });
  }
  expect((await call('POST', fromThere)).status).toBe(403);
  expect(printed).toContain('refused POST /api/items: sent from https://elsewhere.example.com (Sec-Fetch-Site: cross-site)');
});

test("a write the app's own page sends goes through, as does one a script sends with no browser's marks", async () => {
  const { call } = writable();
  const json = { 'Content-Type': 'application/json' };
  expect((await call('POST', { ...json, Origin: 'http://localhost:3000', 'Sec-Fetch-Site': 'same-origin' }, '{}')).status).toBe(200);
  // Typed in the address bar, or sent by an extension the person installed.
  expect((await call('POST', { 'Sec-Fetch-Site': 'none' })).status).toBe(200);
  // curl, a webhook, an agent's script: no browser sent it, so no other site can have.
  expect((await call('POST', json, '{}')).status).toBe(200);
  expect((await call('POST', { 'Content-Type': 'application/x-www-form-urlencoded' }, 'a=1')).status).toBe(200);
});

test('with no Sec-Fetch-Site, an Origin on the address the request went to passes, and another port of the same machine does not', async () => {
  const { call } = writable();
  expect((await call('POST', { Origin: 'http://localhost:3000' })).status).toBe(200);
  // Behind Railway the page is https while the server is reached over http: the host decides, not the scheme.
  expect((await call('POST', { Origin: 'https://localhost:3000' })).status).toBe(200);
  expect((await call('POST', { Origin: 'http://localhost:5173' })).status).toBe(403);
  // A sandboxed frame or a data: page.
  expect((await call('POST', { Origin: 'null' })).status).toBe(403);
});

test("a site another app lists may write, with the person's cookies, and only a listed site gets an answer to its cross-origin question", async () => {
  const { call } = writable(['http://192.168.1.20:5900']);
  expect((await call('POST', { Origin: 'http://192.168.1.20:5900', 'Sec-Fetch-Site': 'cross-site' })).status).toBe(200);
  const asked = (origin: string) =>
    call('OPTIONS', { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' });
  const listed = await asked('http://192.168.1.20:5900');
  expect(listed.headers.get('Access-Control-Allow-Origin')).toBe('http://192.168.1.20:5900');
  // A page there calling with `credentials: 'include'` reads the answer only when the server says so.
  expect(listed.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  expect((await asked('https://elsewhere.example.com')).headers.get('Access-Control-Allow-Origin')).toBeNull();
  expect((await writable().call('OPTIONS', { Origin: 'http://192.168.1.20:5900', 'Access-Control-Request-Method': 'POST' })).headers.get('Access-Control-Allow-Origin')).toBeNull();
});

test("another site may read, but not open a websocket, and an app's own cors() after it lets no other site write", async () => {
  const { call } = writable();
  const fromThere = { Origin: 'https://elsewhere.example.com', 'Sec-Fetch-Site': 'cross-site' };
  expect((await call('GET', fromThere)).status).toBe(200);
  expect((await call('GET', { ...fromThere, Upgrade: 'websocket', Connection: 'Upgrade' })).status).toBe(403);
  // An app that kept its own let-everyone-in rule while it moved onto the kit.
  const permissive = appServer({ service: 'argon-watcher', print: (line) => printed.push(line) });
  permissive.use(cors());
  permissive.post('/api/items', (c) => c.json({ saved: true }));
  const sent = await permissive.fetch(
    new ServerRequest('http://localhost:3000/api/items', { method: 'POST', headers: { ...fromThere, 'Content-Type': 'application/json' }, body: '{}' }),
  );
  expect(sent.status).toBe(403);
});
