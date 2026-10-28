import { afterEach, beforeEach, expect, test } from 'bun:test';
import { get, type IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { callerOf, requireCaller, type Caller } from '../authentication/agent-keys';
import { appServer, loggedPath } from '../server/start';

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

test('a path with no query is logged as it is', () => {
  expect(loggedPath('https://example.com/api/items/7')).toBe('/api/items/7');
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
