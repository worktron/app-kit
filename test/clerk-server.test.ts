/*
 * The Clerk half of the key check, run through Clerk's own middleware with Clerk's Backend API answered from answers
 * recorded against a real development instance (fixtures/clerk-api-key-verify.json). What these do not cover, a
 * session token, was checked live against the same instance: a session reaches every route.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { Hono } from 'hono';
import { clerkMiddleware, getAuth } from '@clerk/hono';
import { callerOf, requireCaller } from '../authentication/agent-keys';
import { clerkCaller, clerkServerSignIn } from '../authentication/clerk/server';
import recorded from './fixtures/clerk-api-key-verify.json';

const SECRET = `ak_${'s'.repeat(32)}`;
const realFetch = globalThis.fetch;
let clerkAnswer: () => Response;
let logged: string[];

beforeEach(() => {
  logged = [];
  // Clerk reads the global fetch on each call while NODE_ENV is test, which bun test sets.
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url !== 'https://api.clerk.com/api_keys/verify' && url !== 'https://api.clerk.com/v1/jwks') throw new Error(`unexpected request to ${url}`);
    return clerkAnswer();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const answer = (sample: { status: number; body: unknown }) => () => Response.json(sample.body, { status: sample.status });

function app() {
  const a = new Hono();
  a.use(
    '/api/*',
    clerkMiddleware({ secretKey: 'sk_test_stand_in', publishableKey: `pk_test_${btoa('example.clerk.accounts.dev$')}` }),
  );
  a.use('/api/*', requireCaller({ caller: clerkCaller, readableByKey: ['GET /api/items/:id'], log: (l) => logged.push(l) }));
  a.get('/api/items/:id', (c) => c.json({ for: callerOf(c).personId, via: callerOf(c).kind }));
  return a;
}

const withKey = (secret = SECRET) => ({ headers: { Authorization: `Bearer ${secret}` } });

test('a live key is its owner, by the user id Clerk gives, and its secret never reaches the log', async () => {
  clerkAnswer = answer(recorded.valid);
  const res = await app().request('/api/items/abc', withKey());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ for: 'user_stand_in_person', via: 'key' });
  expect(logged).toEqual(['key Reading agent (ak_stand_in_key_id) let through for GET /api/items/abc as GET /api/items/:id']);
  expect(logged.join('\n')).not.toContain(SECRET);
});

test('a key Clerk does not know, which is also what a revoked key gets, is nobody', async () => {
  clerkAnswer = answer(recorded.notFound);
  const res = await app().request('/api/items/abc', withKey());
  expect(res.status).toBe(401);
  expect(logged).toEqual(['key refused for GET /api/items/abc: the key is revoked, expired or unknown (token-invalid)']);
});

test('Clerk out of reach is a key that could not be checked, never one called revoked', async () => {
  clerkAnswer = () => {
    throw new TypeError('fetch failed');
  };
  const res = await app().request('/api/items/abc', withKey());
  expect(res.status).toBe(503);
  expect(logged).toEqual(['key refused for GET /api/items/abc: Clerk could not check the key (unexpected-error)']);
});

test('Clerk answering with a server error is a key that could not be checked', async () => {
  clerkAnswer = () => Response.json({ errors: [{ message: 'Internal error', code: 'internal_clerk_error' }] }, { status: 500 });
  expect((await app().request('/api/items/abc', withKey())).status).toBe(503);
});

test('a key owned by an organization is nobody: only a person reads with a key', async () => {
  // The recorded answer with its subject an organization, the one field Clerk tells the two kinds apart by.
  clerkAnswer = answer({ status: 200, body: { ...recorded.valid.body, subject: 'org_stand_in_organization' } });
  const res = await app().request('/api/items/abc', withKey());
  expect(res.status).toBe(401);
  expect(logged[0]).toBe('key refused for GET /api/items/abc: key Reading agent (ak_stand_in_key_id) belongs to an organization, not a person');
});

test("Clerk's other machine tokens are neither a session nor a key", async () => {
  clerkAnswer = () => {
    throw new Error('an OAuth token is not checked as a key');
  };
  const res = await app().request('/api/items/abc', withKey(`oat_${'o'.repeat(32)}`));
  expect(res.status).toBe(401);
});

test('no sign-in at all is nobody, and is not logged', async () => {
  const res = await app().request('/api/items/abc');
  expect(res.status).toBe(401);
  expect(logged).toEqual([]);
});

describe('clerkServerSignIn', () => {
  // Clerk checks a session token against the keys it fetches from its Backend API; here that answer is a key made for
  // the test, so the real middleware takes a session signed below with no network.
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65537 });
  // Clerk keeps the keys it fetched for the life of the process, by id, so each key made here has an id of its own.
  const KID = `ins_stand_in_session_key_${crypto.randomUUID()}`;
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
  const ENV = { CLERK_SECRET_KEY: 'sk_test_stand_in', CLERK_PUBLISHABLE_KEY: `pk_test_${btoa('example.clerk.accounts.dev$')}` };

  const base64url = (data: string | Buffer) => Buffer.from(data).toString('base64url');
  function sessionToken(azp: string) {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' }));
    const payload = base64url(
      JSON.stringify({ sub: 'user_stand_in_person', sid: 'sess_stand_in', azp, iss: 'https://example.clerk.accounts.dev', iat: now - 5, nbf: now - 5, exp: now + 60 }),
    );
    return `${header}.${payload}.${base64url(sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey))}`;
  }

  function server(env: Record<string, string>) {
    const signIn = clerkServerSignIn({ env, log: () => {} });
    const a = new Hono();
    a.use('/api/*', signIn.middleware);
    a.get('/api/me', (c) => c.json({ userId: getAuth(c).userId ?? null }));
    return a;
  }
  const asSession = (azp: string) => ({ headers: { Authorization: `Bearer ${sessionToken(azp)}` } });

  beforeEach(() => {
    clerkAnswer = () => Response.json({ keys: [jwk] });
  });

  test('with APP_ORIGIN set, a session made for the app is taken and one made for another site is not', async () => {
    const app = server({ ...ENV, APP_ORIGIN: 'https://app.example.com/' });
    expect(await (await app.request('/api/me', asSession('https://app.example.com'))).json()).toEqual({ userId: 'user_stand_in_person' });
    expect(await (await app.request('/api/me', asSession('https://other.example.com'))).json()).toEqual({ userId: null });
  });

  test('without APP_ORIGIN, a session from any site is taken', async () => {
    const app = server(ENV);
    expect(await (await app.request('/api/me', asSession('https://other.example.com'))).json()).toEqual({ userId: 'user_stand_in_person' });
  });

  test('with none of its settings on the dev Mac, it runs open behind the this-machine check', async () => {
    const signIn = clerkServerSignIn({ env: {}, also: ['OWNER_EMAIL'], log: () => {} });
    expect(signIn.required).toBe(false);
    expect(signIn.hostname).toBe('127.0.0.1');
    expect(() => clerkServerSignIn({ env: { ...ENV, NODE_ENV: 'production' }, also: ['OWNER_EMAIL'] })).toThrow('A hosted server needs OWNER_EMAIL.');
  });
});
