/*
 * The stand-in for Clerk's Backend API, under Clerk's own middleware and the kit's reading of it: a signed-in session,
 * nobody, a key Clerk accepts and one it does not know read as the same callers they read as against Clerk itself.
 * No module is replaced, so the real @clerk/hono other files test is the one this file runs.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { clerkMiddleware, getAuth } from '@clerk/hono';
import { requireCaller, callerOf } from '../authentication/agent-keys';
import { clerkCaller } from '../authentication/clerk/server';
import { fakeClerkApi, type FakeClerkApi } from '../authentication/clerk/testing';

let clerk: FakeClerkApi;
let logged: string[];
beforeEach(() => {
  clerk = fakeClerkApi();
  logged = [];
});
afterEach(() => clerk.restore());

function app(authorizedParties?: string[]) {
  const a = new Hono();
  // Keys left to the environment, as an app's middleware reads them.
  a.use('/api/*', clerkMiddleware(authorizedParties ? { authorizedParties } : {}));
  a.get('/api/session-only', (c) => c.json({ userId: getAuth(c).userId }));
  a.use('/api/*', requireCaller({ caller: clerkCaller, readableByKey: ['GET /api/items/:id'], log: (line) => logged.push(line) }));
  a.get('/api/items/:id', (c) => c.json({ for: callerOf(c).personId, via: callerOf(c).kind }));
  return a;
}

test('a signed-in session is that person, through Clerk\'s own check of its signed token', async () => {
  const res = await app().request('/api/items/abc', { headers: await clerk.signedIn('user_ana') });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ for: 'user_ana', via: 'session' });
});

test('a token naming an origin is a session where the middleware lists that origin, and nobody where it lists another', async () => {
  const headers = await clerk.signedIn('user_ana', { authorizedParty: 'https://app.example.com' });
  expect((await app(['https://app.example.com']).request('/api/items/abc', { headers })).status).toBe(200);
  expect((await app(['https://other.example.com']).request('/api/items/abc', { headers })).status).toBe(401);
});

test('a session token whose person was changed after signing is nobody, so the signature is what Clerk checked', async () => {
  const { Authorization } = await clerk.signedIn('user_ana');
  const [header, payload, signature] = Authorization.replace('Bearer ', '').split('.');
  const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), sub: 'user_bo' })).toString('base64url');
  const res = await app().request('/api/items/abc', { headers: { Authorization: `Bearer ${header}.${changed}.${signature}` } });
  expect(res.status).toBe(401);
});

test('a request with no token is nobody', async () => {
  expect((await app().request('/api/items/abc')).status).toBe(401);
});

test('a key Clerk accepts is the person its recorded answer names, on a route keys may read', async () => {
  const res = await app().request('/api/items/abc', { headers: clerk.withKey() });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ for: clerk.key.personId, via: 'key' });
  expect(logged).toEqual([`key ${clerk.key.keyName} (${clerk.key.keyId}) let through for GET /api/items/abc as GET /api/items/:id`]);
});

test('a key Clerk does not know is nobody, with why', async () => {
  expect((await app().request('/api/items/abc', { headers: clerk.withKey('notFound') })).status).toBe(401);
  expect(logged).toEqual(['key refused for GET /api/items/abc: the key is revoked, expired or unknown (token-invalid)']);
});

test('a key is signed out to code that accepts only sessions, as getAuth with no options is', async () => {
  const res = await app().request('/api/session-only', { headers: clerk.withKey() });
  expect(await res.json()).toEqual({ userId: null });
});

test('restore puts back the fetch and the environment it found', () => {
  const before = globalThis.fetch;
  clerk.restore();
  expect(globalThis.fetch).not.toBe(before);
  expect(process.env.CLERK_SECRET_KEY).not.toBe(clerk.secretKey);
  clerk = fakeClerkApi();
});
