/*
 * The Clerk half of the key check, run through Clerk's own middleware with Clerk's Backend API answered from answers
 * recorded against a real development instance (fixtures/clerk-api-key-verify.json). What these do not cover, a
 * session token, was checked live against the same instance: a session reaches every route.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { clerkMiddleware } from '@clerk/hono';
import { callerOf, requireCaller } from '../authentication/agent-keys';
import { clerkCaller } from '../authentication/clerk/server';
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
    if (url !== 'https://api.clerk.com/api_keys/verify') throw new Error(`unexpected request to ${url}`);
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
