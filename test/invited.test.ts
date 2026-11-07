/*
 * The invited check: a list of addresses, or a reader of one, against a user's verified addresses, and Clerk's
 * allowlist read through the stand-in for Clerk's Backend API, with Clerk's own client making the calls.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { invitedCheckByEmail, isInvited, requireInvited, type InvitedEnv } from '../authentication/owner';
import { clerkAllowlist } from '../authentication/clerk/server';
import { fakeClerkApi, type FakeClerkApi } from '../authentication/clerk/testing';
import recorded from './fixtures/clerk-allowlist.json';

// The repository holds addresses on example.com alone (test/public.test.ts), so the other cases are made from it here.
const SHOUTED = 'ana@example.com'.toUpperCase();
const SUBDOMAIN = `anyone@mail.${'example.com'}`;
const LOOKALIKE = `anyone@not${'example.com'}`;

describe('isInvited', () => {
  test('an address on the list is invited, in any case and with spaces', () => {
    expect(isInvited([SHOUTED], [' ana@example.com '])).toBe(true);
    expect(isInvited(['ana@example.com'], [` ${SHOUTED} `])).toBe(true);
    expect(isInvited(['bo@example.com'], ['ana@example.com'])).toBe(false);
  });

  test('a domain entry invites every address at that domain and no other, its subdomains included', () => {
    const entries = ['*@example.com'];
    expect(isInvited(['anyone@example.com'], entries)).toBe(true);
    expect(isInvited([SHOUTED], entries)).toBe(true);
    expect(isInvited([SUBDOMAIN], entries)).toBe(false);
    expect(isInvited([LOOKALIKE], entries)).toBe(false);
    expect(isInvited(['example.com'], entries)).toBe(false);
  });

  test('an entry that is neither an address nor a domain, such as a phone number, invites nobody', () => {
    expect(isInvited(['+15555555555'], ['+15555555555'])).toBe(false);
    expect(isInvited(['ana@example.com'], [])).toBe(false);
  });
});

describe('invitedCheckByEmail', () => {
  test('a list given as it is', async () => {
    const check = invitedCheckByEmail(['ana@example.com'], async (userId) => (userId === 'user_ana' ? ['ana@example.com'] : ['bo@example.com']));
    expect(await check('user_ana')).toBe(true);
    expect(await check('user_bo')).toBe(false);
  });

  test("a reader's list is read on every check, so someone taken off it is refused at its next answer", async () => {
    let list = ['ana@example.com'];
    let lookups = 0;
    const check = invitedCheckByEmail(async () => list, async () => {
      lookups++;
      return ['ana@example.com'];
    });
    expect(await check('user_ana')).toBe(true);
    list = [];
    expect(await check('user_ana')).toBe(false);
    list = ['*@example.com'];
    expect(await check('user_ana')).toBe(true);
    expect(lookups).toBe(1);
  });

  test("a user's addresses are asked once, together share one lookup, and a failed one is asked again", async () => {
    let lookups = 0;
    const check = invitedCheckByEmail(['ana@example.com'], async () => {
      lookups++;
      if (lookups === 1) throw new Error('the provider could not be reached');
      return ['ana@example.com'];
    });
    await expect(check('user_ana')).rejects.toThrow('the provider could not be reached');
    expect(await Promise.all([check('user_ana'), check('user_ana')])).toEqual([true, true]);
    expect(await check('user_ana')).toBe(true);
    expect(lookups).toBe(2);
  });

  test('an invited address taken off the account stops counting once its two minutes are up', async () => {
    let clock = 0;
    let addresses = ['bo@example.com', 'ana@example.com'];
    const check = invitedCheckByEmail(['ana@example.com'], async () => addresses, { now: () => clock });
    expect(await check('user_ana')).toBe(true);
    addresses = ['bo@example.com'];
    clock = 119_999;
    expect(await check('user_ana')).toBe(true);
    clock = 120_000;
    expect(await check('user_ana')).toBe(false);
  });

  test('when the addresses cannot be read again, the ones read before are used and logged, and asked again 15 seconds later', async () => {
    let clock = 0;
    let answer: () => Promise<string[]> = async () => ['ana@example.com'];
    const logged: string[] = [];
    const check = invitedCheckByEmail(['ana@example.com'], () => answer(), { now: () => clock, log: (l) => logged.push(l) });
    expect(await check('user_ana')).toBe(true);
    answer = async () => Promise.reject(new Error('the provider could not be reached'));
    clock = 120_000;
    expect(await check('user_ana')).toBe(true);
    expect(logged).toEqual(['[auth] could not read the addresses of user user_ana, so the ones read before are used for now: Error: the provider could not be reached']);
    answer = async () => ['bo@example.com'];
    clock = 134_999;
    expect(await check('user_ana')).toBe(true);
    clock = 135_000;
    expect(await check('user_ana')).toBe(false);
  });

  test('a list that cannot be read refuses with its error', async () => {
    const check = invitedCheckByEmail(async () => Promise.reject(new Error('no list')), async () => ['ana@example.com']);
    await expect(check('user_ana')).rejects.toThrow('no list');
  });
});

describe('requireInvited', () => {
  let logged: string[];
  beforeEach(() => {
    logged = [];
  });

  function appWith(userId: string | null) {
    const isInvited = invitedCheckByEmail(['ana@example.com'], async (id) => (id === 'user_ana' ? ['ana@example.com'] : ['bo@example.com']));
    const app = new Hono<InvitedEnv>();
    app.use('*', requireInvited({ identify: () => userId, isInvited, appName: 'Finances', log: (l) => logged.push(l) }));
    app.get('/who', (c) => c.json({ userId: c.get('userId') }));
    return app;
  }

  test('answers 401 when nobody is signed in', async () => {
    const response = await appWith(null).request('/who');
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Sign in first' });
  });

  test('answers 403 for someone not invited, naming the app, and logs it', async () => {
    const response = await appWith('user_bo').request('/who');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'This account is not allowed to use Finances' });
    expect(logged).toEqual(['[auth] refused GET /who for user user_bo: not on the invited list']);
  });

  test('lets someone invited through and names them', async () => {
    const response = await appWith('user_ana').request('/who');
    expect(await response.json()).toEqual({ userId: 'user_ana' });
    expect(logged).toEqual([]);
  });
});

describe('clerkAllowlist', () => {
  let clerk: FakeClerkApi;
  let logged: string[];
  let clock: number;
  let standIn: typeof fetch;
  beforeEach(() => {
    clerk = fakeClerkApi();
    standIn = globalThis.fetch;
    logged = [];
    clock = 0;
  });
  // A test that put another fetch in front of the stand-in has it taken away first, so restore finds its own.
  afterEach(() => {
    globalThis.fetch = standIn;
    clerk.restore();
  });

  const reader = () => clerkAllowlist({ secretKey: clerk.secretKey, now: () => clock, log: (l) => logged.push(l) });

  test("reads Clerk's recorded answer: the address and the domain", async () => {
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      asked.push(new Request(input).url);
      return Response.json(recorded.body, { status: recorded.status });
    }) as typeof fetch;
    expect(await clerkAllowlist({ secretKey: 'sk_test_stand_in' })()).toEqual(['*@example.org', 'invited@example.com']);
    expect(asked).toEqual(['https://api.clerk.com/v1/allowlist_identifiers?limit=500&paginated=true']);
  });

  test('reads every page, should Clerk answer in pages', async () => {
    const entries = recorded.body.data;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const offset = Number(new URL(new Request(input).url).searchParams.get('offset') ?? 0);
      return Response.json({ data: entries.slice(offset, offset + 1), total_count: entries.length });
    }) as typeof fetch;
    expect(await clerkAllowlist({ secretKey: 'sk_test_stand_in' })()).toEqual(['*@example.org', 'invited@example.com']);
  });

  test('leaves phone numbers out', async () => {
    clerk.setAllowlist(['ana@example.com', '+15555555555', '*@example.org']);
    expect(await reader()()).toEqual(['ana@example.com', '*@example.org']);
  });

  test('holds the answer for two minutes, so a change in Clerk takes effect within them', async () => {
    const read = reader();
    clerk.setAllowlist(['ana@example.com']);
    expect(await read()).toEqual(['ana@example.com']);
    clerk.setAllowlist([]);
    clock = 119_000;
    expect(await read()).toEqual(['ana@example.com']);
    clock = 120_000;
    expect(await read()).toEqual([]);
  });

  test('when Clerk cannot be reached, the list read before is used and logged, and Clerk is asked again 15 seconds later', async () => {
    const read = reader();
    clerk.setAllowlist(['ana@example.com']);
    await read();
    globalThis.fetch = (async () => Response.json({ errors: [{ code: 'unexpected_error' }] }, { status: 503 })) as unknown as typeof fetch;
    clock = 120_000;
    expect(await read()).toEqual(['ana@example.com']);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toStartWith("[auth] could not read Clerk's allowlist, so the one read before is used for now");
    globalThis.fetch = standIn;
    clerk.setAllowlist([]);
    clock = 134_000;
    expect(await read()).toEqual(['ana@example.com']);
    clock = 135_000;
    expect(await read()).toEqual([]);
  });

  test('with no list read yet, a failure to read is the error', async () => {
    globalThis.fetch = (async () => Response.json({ errors: [{ code: 'unexpected_error' }] }, { status: 503 })) as unknown as typeof fetch;
    await expect(reader()()).rejects.toThrow();
  });

  test('checks that arrive together share one read', async () => {
    let reads = 0;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      reads++;
      return standIn(input, init);
    }) as typeof fetch;
    clerk.setAllowlist(['ana@example.com']);
    const read = reader();
    expect(await Promise.all([read(), read(), read()])).toEqual([['ana@example.com'], ['ana@example.com'], ['ana@example.com']]);
    expect(reads).toBe(1);
  });

  test('with the invited check, someone taken off the allowlist is refused once the held answer runs out', async () => {
    clerk.setAllowlist(['ana@example.com']);
    const check = invitedCheckByEmail(reader(), async () => ['ana@example.com']);
    expect(await check('user_ana')).toBe(true);
    clerk.setAllowlist([]);
    clock = 120_000;
    expect(await check('user_ana')).toBe(false);
  });
});
