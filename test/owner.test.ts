import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { ownerCheckByEmail, requireOwner, type OwnerEnv } from '../authentication/owner';
import { clerkVerifiedEmails } from '../authentication/clerk/server';
import recordedUser from './fixtures/clerk-user.json';

const OWNER = 'owner@example.com';

describe('ownerCheckByEmail', () => {
  test('accepts a user with the owner email, in any case', async () => {
    const isOwner = ownerCheckByEmail(OWNER, async () => ['OWNER@example.com']);
    expect(await isOwner('user_1')).toBe(true);
  });

  test('accepts an owner email given with spaces or capitals', async () => {
    const isOwner = ownerCheckByEmail(' OWNER@example.com ', async () => [OWNER]);
    expect(await isOwner('user_1')).toBe(true);
  });

  test('refuses a user without the owner email', async () => {
    const isOwner = ownerCheckByEmail(OWNER, async () => ['someone@example.com']);
    expect(await isOwner('user_2')).toBe(false);
  });

  test('asks for a user email once, whatever the answer', async () => {
    let lookups = 0;
    const isOwner = ownerCheckByEmail(OWNER, async (userId) => {
      lookups++;
      return userId === 'user_1' ? [OWNER] : [];
    });
    await isOwner('user_1');
    await isOwner('user_1');
    await isOwner('user_2');
    await isOwner('user_2');
    expect(lookups).toBe(2);
  });

  test('requests that arrive together share one lookup', async () => {
    let lookups = 0;
    let answer = (_emails: string[]) => {};
    const isOwner = ownerCheckByEmail(OWNER, () => {
      lookups++;
      return new Promise((resolve) => (answer = resolve));
    });
    const together = [isOwner('user_1'), isOwner('user_1'), isOwner('user_1')];
    answer([OWNER]);
    expect(await Promise.all(together)).toEqual([true, true, true]);
    expect(lookups).toBe(1);
  });

  test('a lookup that fails is asked again on the next request', async () => {
    let lookups = 0;
    const isOwner = ownerCheckByEmail(OWNER, async () => {
      lookups++;
      if (lookups === 1) throw new Error('the provider could not be reached');
      return [OWNER];
    });
    await expect(isOwner('user_1')).rejects.toThrow('the provider could not be reached');
    expect(await isOwner('user_1')).toBe(true);
    expect(lookups).toBe(2);
  });
});

let logged: string[];
beforeEach(() => {
  logged = [];
});

function appWith(userId: string | null, owner: boolean) {
  const app = new Hono<OwnerEnv>();
  app.use('*', requireOwner({ identify: () => userId, isOwner: async () => owner, appName: 'getter', log: (l) => logged.push(l) }));
  app.get('/who', (c) => c.json({ userId: c.get('userId') }));
  return app;
}

describe('requireOwner', () => {
  test('answers 401 when nobody is signed in', async () => {
    const response = await appWith(null, false).request('/who');
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Sign in first' });
  });

  test('answers 403 for a signed-in user who is not the owner, naming the app, and logs it', async () => {
    const response = await appWith('user_2', false).request('/who');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'This account is not allowed to use getter' });
    expect(logged).toEqual(['[auth] refused GET /who for user user_2: not the owner']);
  });

  test('lets the owner through and names them', async () => {
    const response = await appWith('user_1', true).request('/who');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId: 'user_1' });
    expect(logged).toEqual([]);
  });
});

/*
 * Clerk's Backend API answered with the user Clerk records for @clerk/backend's own tests (fixtures/clerk-user.json, from
 * packages/backend/src/fixtures/user.json in clerk/javascript, addresses moved to example.com), plus a second address
 * copied from its first with the status Clerk gives an address not yet verified.
 */
describe('clerkVerifiedEmails', () => {
  const realFetch = globalThis.fetch;
  let asked: string[];

  beforeEach(() => {
    asked = [];
    const [verified] = recordedUser.email_addresses;
    const unverified = { ...verified, id: 'idn_unverified', email_address: OWNER, verification: { ...verified.verification, status: 'unverified' } };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      asked.push(url);
      return Response.json({ ...recordedUser, email_addresses: [verified, unverified] });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("reads a user's verified addresses from Clerk and leaves the unverified out", async () => {
    const emailsOf = clerkVerifiedEmails({ secretKey: 'sk_test_stand_in' });
    expect(await emailsOf('user_cafebabe')).toEqual(['person@example.com']);
    expect(asked).toEqual(['https://api.clerk.com/v1/users/user_cafebabe']);
  });

  test('an unverified owner address does not make the owner', async () => {
    const isOwner = ownerCheckByEmail(OWNER, clerkVerifiedEmails({ secretKey: 'sk_test_stand_in' }));
    expect(await isOwner('user_cafebabe')).toBe(false);
  });
});
