import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { fingerprint, randomHex } from '../tauri/sign-in/fingerprint';
import { CODE_GOOD_MS, CODE_KEPT_MS, DESKTOP_SIGN_IN_OPEN_PATH, DESKTOP_SIGN_IN_ROUTES, desktopSignInRoutes } from '../tauri/sign-in/server';

const realWarn = console.warn;
const realLog = console.log;
const realError = console.error;
let lines: string[] = [];

beforeEach(() => {
  lines = [];
  console.warn = console.log = console.error = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
});

afterEach(() => {
  console.warn = realWarn;
  console.log = realLog;
  console.error = realError;
});

/** An app's server with the routes mounted where the kit asks for them, signed in as `signedInAs`. */
function server(signedInAs: string | null) {
  let now = 1_000_000;
  const made: string[] = [];
  const app = new Hono();
  app.route(
    DESKTOP_SIGN_IN_ROUTES,
    desktopSignInRoutes({
      userId: () => signedInAs,
      makeTicket: async (userId) => {
        made.push(userId);
        return `ticket-${made.length}-for-${userId}`;
      },
      now: () => now,
    }),
  );
  const post = (path: string, body?: object, headers: Record<string, string> = { Authorization: 'Bearer session-token' }) =>
    app.request(`${DESKTOP_SIGN_IN_ROUTES}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
  /** The browser, signed in, asking for a code for the window that holds `secret`. */
  const codeFor = async (secret: string) => ((await (await post('/code', { fingerprint: fingerprint(secret) })).json()) as { code: string }).code;
  /** The window, signed out, turning a code into a ticket with a secret. */
  const redeem = (code: string, secret?: string) => post('/redeem', { code, secret }, {});
  return { app, made, post, codeFor, redeem, later: (ms: number) => (now += ms) };
}

test("a code is made for the caller's own account and the window's fingerprint, and never cached", async () => {
  const { made, post } = server('user_a');
  const res = await post('/code', { fingerprint: fingerprint(randomHex()) });
  expect(res.status).toBe(200);
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect((await res.json()) as { code: string }).toEqual({ code: expect.stringMatching(/^[0-9a-f]{64}$/) });
  // The code is no ticket: none is made until the window redeems it.
  expect(made).toEqual([]);
});

test("a request without a bearer token, as another site's through the person's browser cookie, gets no code", async () => {
  const { post } = server('user_a');
  expect((await post('/code', { fingerprint: fingerprint(randomHex()) }, { Cookie: '__session=from-the-browser' })).status).toBe(401);
});

test('signed out, asked with GET, or asked with no fingerprint, no code is made', async () => {
  const signedOut = server(null);
  expect((await signedOut.post('/code', { fingerprint: fingerprint(randomHex()) })).status).toBe(401);

  const signedIn = server('user_a');
  expect((await signedIn.app.request(`${DESKTOP_SIGN_IN_ROUTES}/code`)).status).toBe(404);
  expect((await signedIn.post('/code', {})).status).toBe(400);
  expect((await signedIn.post('/code', { fingerprint: 'not-a-fingerprint' })).status).toBe(400);
});

test("the window's secret turns its code into one ticket for the person who handed it over, once", async () => {
  const { made, codeFor, redeem } = server('user_a');
  const secret = randomHex();
  const code = await codeFor(secret);
  const res = await redeem(code, secret);
  expect(res.status).toBe(200);
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect(await res.json()).toEqual({ ticket: 'ticket-1-for-user_a' });
  expect(lines).toContain('[desktop-sign-in] a code was turned into a ticket for the window that asked');

  // A code works once.
  expect((await redeem(code, secret)).status).toBe(400);
  expect(made).toEqual(['user_a']);
});

test('a code caught off the link, as by another app that claimed the scheme, gets no ticket without the secret, and stays good for the window', async () => {
  const { made, codeFor, redeem } = server('user_a');
  const secret = randomHex();
  const code = await codeFor(secret);

  expect((await redeem(code)).status).toBe(400);
  expect((await redeem(code, randomHex())).status).toBe(400);
  // The fingerprint is in the browser's address, so it is no secret.
  expect((await redeem(code, fingerprint(secret))).status).toBe(400);
  expect(made).toEqual([]);
  expect(lines).toContain('[desktop-sign-in] no ticket: the secret is not the one the window asked with');

  expect(await (await redeem(code, secret)).json()).toEqual({ ticket: 'ticket-1-for-user_a' });
});

test('a code not made here gets no ticket, and says why in the log', async () => {
  const { made, redeem } = server('user_a');
  expect((await redeem(randomHex(), randomHex())).status).toBe(400);
  expect(made).toEqual([]);
  expect(lines).toContain('[desktop-sign-in] no ticket: the code is unknown, used or expired, or no secret came with it');
});

test('the one route the signed-out window asks is the one the open path names', async () => {
  const { app, codeFor } = server('user_a');
  const secret = randomHex();
  const code = await codeFor(secret);
  const res = await app.request(DESKTOP_SIGN_IN_OPEN_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, secret }) });
  expect(res.status).toBe(200);
});

test('a code gets no ticket once its minute is up', async () => {
  const { made, codeFor, redeem, later } = server('user_a');
  const secret = randomHex();
  const code = await codeFor(secret);
  later(CODE_GOOD_MS);
  expect((await redeem(code, secret)).status).toBe(400);
  expect(made).toEqual([]);
});

test('the browser hears that the app took its code, and only that code', async () => {
  const { post, codeFor } = server('user_a');
  const code = await codeFor(randomHex());
  const other = await codeFor(randomHex());

  expect(await (await post('/status', { code })).json()).toEqual({ taken: false });
  expect((await post('/taken', { code })).status).toBe(204);
  expect(await (await post('/status', { code })).json()).toEqual({ taken: true });
  expect(await (await post('/status', { code: other })).json()).toEqual({ taken: false });
});

test('a code not made here is never taken, and a request without one is refused', async () => {
  const { post } = server('user_a');
  const elsewhere = randomHex();
  expect((await post('/taken', { code: elsewhere })).status).toBe(204);
  expect(await (await post('/status', { code: elsewhere })).json()).toEqual({ taken: false });
  expect((await post('/taken', {})).status).toBe(400);
  expect((await post('/status')).status).toBe(400);
});

test('a code is forgotten two minutes after it was made', async () => {
  const { post, codeFor, later } = server('user_a');
  const code = await codeFor(randomHex());
  await post('/taken', { code });
  later(CODE_KEPT_MS - 1);
  expect(await (await post('/status', { code })).json()).toEqual({ taken: true });
  later(1);
  expect(await (await post('/status', { code })).json()).toEqual({ taken: false });
});

test("the fingerprint is the secret's SHA-256 in hex, as the browser's own hashing makes it", async () => {
  const secret = randomHex();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)));
  expect(fingerprint(secret)).toBe([...digest].map((byte) => byte.toString(16).padStart(2, '0')).join(''));
  expect(fingerprint('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('a ticket maker that fails, as the provider out of reach, answers 502 and says so in the log', async () => {
  const app = new Hono();
  app.route(DESKTOP_SIGN_IN_ROUTES, desktopSignInRoutes({ userId: () => 'user_a', makeTicket: () => Promise.reject(new Error('unreachable')) }));
  const secret = randomHex();
  const asked = await app.request(`${DESKTOP_SIGN_IN_ROUTES}/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session-token' },
    body: JSON.stringify({ fingerprint: fingerprint(secret) }),
  });
  const { code } = (await asked.json()) as { code: string };
  const res = await app.request(DESKTOP_SIGN_IN_OPEN_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, secret }) });
  expect(res.status).toBe(502);
  expect(lines).toContain('[desktop-sign-in] no ticket: the ticket maker failed Error: unreachable');
});
