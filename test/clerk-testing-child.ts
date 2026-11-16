// The Clerk stand-in under plain Bun, run in its own process by clerk-testing.test.ts: bun test's preload swaps in the
// simulated page's Response, so only a process without it shows what an app's own server test meets.
import { Hono } from 'hono';
import { clerkMiddleware } from '@clerk/hono';
import { requireCaller, callerOf } from '../authentication/agent-keys';
import { clerkCaller } from '../authentication/clerk/server';
import { fakeClerkApi } from '../authentication/clerk/testing';

const clerk = fakeClerkApi();
const app = new Hono();
app.use('/api/*', clerkMiddleware());
app.use('/api/*', requireCaller({ caller: clerkCaller, readableByKey: ['GET /api/items/:id'], log: () => {} }));
app.get('/api/items/:id', (c) => c.json({ for: callerOf(c).personId, via: callerOf(c).kind }));

const res = await app.request('/api/items/abc', { headers: clerk.withKey() });
console.log(JSON.stringify({ status: res.status, body: await res.text(), personId: clerk.key.personId }));
clerk.restore();
