/*
 * The Clerk development instance steps, with Clerk's Backend API answered here: users shaped as the recorded one
 * (fixtures/clerk-user.json), and a refusal for too many requests with a Retry-After header, as argon's runs saw Clerk
 * send; that Clerk always sends it is not known, so the steps wait a second when it does not. Signing a page in with a
 * ticket needs a real instance, which the kit has none of: only its refusal without the suite's setup is held here.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createClerkClient } from '@clerk/backend';
import type { Page } from '@playwright/test';
import recordedUser from './fixtures/clerk-user.json';
import { removeThrowawayUsers, signInWithTicket, throwawayUser, withClerkBackoff } from '../authentication/clerk/playwright.js';

const secretKey = 'sk_test_app_kit_steps';
const realFetch = globalThis.fetch;
const HOUR = 60 * 60_000;
const NOW = Date.parse('2026-10-26T12:00:00Z');

/** What the stand-in was asked, as `METHOD /path`, and the users it holds. */
let asked: string[];
let users: { id: string; emails: string[]; createdAt: number }[];
/** How many of the next requests Clerk refuses for too many requests. */
let refusals: number;

/** A user as Clerk's Backend API answers one, from the recorded user with its own id, addresses and age. */
const asClerkUser = (user: (typeof users)[number]) => ({
  ...recordedUser,
  id: user.id,
  created_at: user.createdAt,
  primary_email_address_id: `idn_${user.id}_0`,
  email_addresses: user.emails.map((email, i) => ({ ...recordedUser.email_addresses[0], id: `idn_${user.id}_${i}`, email_address: email })),
});

beforeEach(() => {
  asked = [];
  users = [];
  refusals = 0;
  // Clerk reads the global fetch on each call while NODE_ENV is test, which bun test sets.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== 'https://api.clerk.com') throw new Error(`unexpected request to ${url}`);
    asked.push(`${request.method} ${url.pathname}`);
    if (refusals > 0) {
      refusals--;
      return Response.json({ errors: [{ code: 'too_many_requests', message: 'Too many requests' }] }, { status: 429, headers: { 'retry-after': '3' } });
    }
    if (request.method === 'POST' && url.pathname === '/v1/users') {
      const body = (await request.json()) as { email_address: string[]; password?: string };
      const user = { id: `user_${users.length + 1}`, emails: body.email_address, createdAt: NOW, password: body.password };
      users.push(user);
      return Response.json(asClerkUser(user));
    }
    if (request.method === 'POST' && url.pathname === '/v1/sign_in_tokens') {
      const body = (await request.json()) as { user_id: string };
      return Response.json({ object: 'sign_in_token', id: 'sit_1', user_id: body.user_id, token: `ticket-for-${body.user_id}`, status: 'pending', url: 'https://example.com', created_at: NOW, updated_at: NOW });
    }
    if (request.method === 'GET' && url.pathname === '/v1/users/count') return Response.json({ object: 'total_count', total_count: users.length });
    if (request.method === 'GET' && url.pathname === '/v1/users') {
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 10);
      return Response.json(users.slice(offset, offset + limit).map(asClerkUser));
    }
    const deleting = request.method === 'DELETE' && /^\/v1\/users\/([^/]+)$/.exec(url.pathname)?.[1];
    if (deleting) {
      users = users.filter((user) => user.id !== deleting);
      return Response.json({ object: 'user', id: deleting, deleted: true });
    }
    throw new Error(`no stand-in answer for ${request.method} ${url.pathname}`);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('a refusal for too many requests is waited out as long as Clerk asks, and the call made again', async () => {
  refusals = 2;
  const waits: number[] = [];
  const backend = createClerkClient({ secretKey });
  const count = await withClerkBackoff('getCount', () => backend.users.getCount(), { wait: async (ms) => void waits.push(ms) });
  expect(count).toBe(0);
  expect(waits).toEqual([3000, 3000]);
});

test('a refusal past the limit, or any other error, is thrown as it came', async () => {
  refusals = 3;
  const waits: number[] = [];
  const backend = createClerkClient({ secretKey });
  const past = withClerkBackoff('getCount', () => backend.users.getCount(), { wait: async (ms) => void waits.push(ms), maxWaitMs: 7000 });
  await expect(past).rejects.toMatchObject({ status: 429 });
  expect(waits).toEqual([3000, 3000]);
  await expect(withClerkBackoff('other', () => Promise.reject(new Error('Forbidden')), { wait: async () => expect.unreachable() })).rejects.toThrow('Forbidden');
});

test('a throwaway user has a short +clerk_test address of its own and a random password, and a ticket made from its id', async () => {
  const first = await throwawayUser({ secretKey, domain: 'example.com', prefix: 'steps' });
  const second = await throwawayUser({ secretKey, domain: 'example.com', prefix: 'steps' });
  expect(first.email).toMatch(/^steps-[0-9a-f]{10}\+clerk_test@example\.com$/);
  expect(second.email).not.toBe(first.email);
  const passwords = (users as unknown as { password: string }[]).map((user) => user.password);
  expect(passwords[0]).toHaveLength(39);
  expect(passwords[0]).not.toBe(passwords[1]);
  expect(await first.ticket()).toBe(`ticket-for-${first.userId}`);
  await first.remove();
  expect(users.map((user) => user.id)).toEqual([second.userId]);
});

test('removing throwaway users takes only old ones of the shape it makes, and keeps a fixed test user and a run still going', async () => {
  const old = NOW - 2 * HOUR;
  users = [
    { id: 'user_owner', emails: ['owner+clerk_test@example.com'], createdAt: old },
    { id: 'user_left', emails: ['steps-0123456789+clerk_test@example.com'], createdAt: old },
    { id: 'user_running', emails: ['steps-abcdefabcd+clerk_test@example.com'], createdAt: NOW - 10 * 60_000 },
    { id: 'user_other_app', emails: ['other-0123456789+clerk_test@example.com'], createdAt: old },
    { id: 'user_also_real', emails: ['steps-9876543210+clerk_test@example.com', 'person@example.com'], createdAt: old },
    { id: 'user_other_domain', emails: ['steps-0123456789+clerk_test@worktron.com'], createdAt: old },
  ];
  const removed = await removeThrowawayUsers({ secretKey, domain: 'example.com', prefix: 'steps', now: () => NOW });
  expect(removed).toBe(1);
  expect(users.map((user) => user.id)).toEqual(['user_owner', 'user_running', 'user_other_app', 'user_also_real', 'user_other_domain']);
  expect(asked.filter((line) => line.startsWith('DELETE'))).toEqual(['DELETE /v1/users/user_left']);
});

test('signing in with a ticket without the suite\'s Clerk setup fails saying to run it', async () => {
  const fapi = process.env.CLERK_FAPI;
  delete process.env.CLERK_FAPI;
  try {
    const page = { on: () => {}, context: () => ({}) } as unknown as Page;
    await expect(signInWithTicket(page, 'ticket')).rejects.toThrow('Make sure the clerkSetup function is called during your global setup');
  } finally {
    if (fapi !== undefined) process.env.CLERK_FAPI = fapi;
  }
});
