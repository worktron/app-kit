import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { onlyThisMachine, serverSignIn } from '../authentication/server-sign-in';

const SETTINGS = ['CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY', 'OWNER_EMAIL'];
const ALL_SET = { CLERK_SECRET_KEY: 'sk_test_x', CLERK_PUBLISHABLE_KEY: 'pk_test_x', OWNER_EMAIL: 'owner@example.com' };

function decide(env: Record<string, string | undefined>) {
  const logged: string[] = [];
  const decision = serverSignIn({ env, settings: SETTINGS, log: (line) => logged.push(line), port: 6301 });
  return { decision, logged };
}

describe('serverSignIn', () => {
  test('with every setting, sign-in is required, on every interface, with the values trimmed', () => {
    const { decision } = decide({ ...ALL_SET, OWNER_EMAIL: ' owner@example.com ', NODE_ENV: 'production' });
    expect(decision).toEqual({ required: true, values: { ...ALL_SET }, hostname: '0.0.0.0' });
  });

  test('with none on the dev Mac, it runs open on this machine only and says so with the address', () => {
    const { decision, logged } = decide({});
    expect(decision.required).toBe(false);
    expect(decision.hostname).toBe('127.0.0.1');
    expect(logged).toEqual(['[sign-in] open: none of CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY, OWNER_EMAIL is set, so only this machine is let in, at http://127.0.0.1:6301']);
  });

  test.each([['RAILWAY_ENVIRONMENT'], ['RAILWAY_ENVIRONMENT_NAME'], ['RAILWAY_PROJECT_ID'], ['NODE_ENV']])('hosted by %s, it refuses to start without them, naming what is missing', (name) => {
    const env = { [name]: 'production', CLERK_SECRET_KEY: 'sk_test_x' };
    expect(() => decide(env)).toThrow('A hosted server needs CLERK_PUBLISHABLE_KEY, OWNER_EMAIL. Refusing to start without a sign-in.');
  });

  test('NODE_ENV other than production is not hosted', () => {
    expect(decide({ NODE_ENV: 'development' }).decision.required).toBe(false);
  });

  test('half set on the dev Mac, it refuses rather than guess', () => {
    expect(() => decide({ CLERK_SECRET_KEY: 'sk_test_x' })).toThrow('Sign-in is half set: CLERK_PUBLISHABLE_KEY, OWNER_EMAIL missing.');
  });

  test('a blank setting counts as unset', () => {
    expect(decide({ CLERK_SECRET_KEY: ' ', CLERK_PUBLISHABLE_KEY: '', OWNER_EMAIL: undefined }).decision.required).toBe(false);
    expect(() => decide({ ...ALL_SET, OWNER_EMAIL: '  ', RAILWAY_PROJECT_ID: 'p' })).toThrow('needs OWNER_EMAIL.');
  });
});

describe('onlyThisMachine', () => {
  function server() {
    const logged: string[] = [];
    const app = new Hono();
    app.use('*', onlyThisMachine((line) => logged.push(line)));
    app.get('/api/items', (c) => c.json({ items: [] }));
    /** A request as Bun hands it to Hono: its server, whose requestIP reads the socket's peer, as the environment. */
    const call = (peer: string | null, headers: Record<string, string> = {}) =>
      app.fetch(new Request('http://127.0.0.1/api/items', { headers }), { requestIP: () => (peer === null ? null : { address: peer }) });
    return { call, logged };
  }

  test('a request from this machine goes through, by IPv4 or IPv6', async () => {
    const { call } = server();
    expect((await call('127.0.0.1')).status).toBe(200);
    expect((await call('::1')).status).toBe(200);
    expect((await call('::ffff:127.0.0.1')).status).toBe(200);
  });

  test('a request from another machine is refused, and the refusal is logged', async () => {
    const { call, logged } = server();
    const res = await call('192.168.1.20');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'This server runs without sign-in and lets in only the machine it runs on.' });
    expect(logged).toEqual(['[sign-in] refused GET /api/items from 192.168.1.20: an open server lets in only this machine']);
  });

  test('a request a proxy on this machine forwards for another machine is refused', async () => {
    const { call } = server();
    expect((await call('127.0.0.1', { 'X-Forwarded-For': '100.64.0.7' })).status).toBe(403);
    expect((await call('127.0.0.1', { 'X-Forwarded-For': '127.0.0.1, 10.0.0.4' })).status).toBe(403);
    expect((await call('127.0.0.1', { 'X-Forwarded-For': '127.0.0.1' })).status).toBe(200);
  });

  test('a request whose caller cannot be read is refused', async () => {
    const { call, logged } = server();
    expect((await call(null)).status).toBe(403);
    expect(logged[0]).toContain('from an unknown address');
  });

  test('the open decision carries it', async () => {
    const { decision } = decide({});
    if (decision.required) throw new Error('expected open');
    const app = new Hono();
    app.use('*', decision.middleware);
    app.get('/', (c) => c.text('ok'));
    expect((await app.fetch(new Request('http://127.0.0.1/'), { requestIP: () => ({ address: '10.0.0.9' }) })).status).toBe(403);
  });
});
