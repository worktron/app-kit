import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { DESKTOP_SIGN_IN_ROUTES, desktopSignInRoutes, TICKET_KEPT_MS } from '../tauri/sign-in/server';

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
  return { app, made, post, later: (ms: number) => (now += ms) };
}

test("a ticket is made for the caller's own account, and never cached", async () => {
  const { made, post } = server('user_a');
  const res = await post('/ticket');
  expect(res.status).toBe(200);
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect(await res.json()).toEqual({ ticket: 'ticket-1-for-user_a' });
  expect(made).toEqual(['user_a']);
});

test("a request without a bearer token, as another site's through the person's browser cookie, gets no ticket", async () => {
  const { made, post } = server('user_a');
  expect((await post('/ticket', undefined, { Cookie: '__session=from-the-browser' })).status).toBe(401);
  expect(made).toEqual([]);
});

test('signed out, or asked with GET, nothing is made', async () => {
  const signedOut = server(null);
  expect((await signedOut.post('/ticket')).status).toBe(401);
  expect(signedOut.made).toEqual([]);

  const signedIn = server('user_a');
  expect((await signedIn.app.request(`${DESKTOP_SIGN_IN_ROUTES}/ticket`)).status).toBe(404);
  expect(signedIn.made).toEqual([]);
});

test('the browser hears that the app took its ticket, and only that ticket', async () => {
  const { post } = server('user_a');
  const { ticket } = (await (await post('/ticket')).json()) as { ticket: string };
  const { ticket: other } = (await (await post('/ticket')).json()) as { ticket: string };

  expect(await (await post('/status', { ticket })).json()).toEqual({ taken: false });
  expect((await post('/taken', { ticket })).status).toBe(204);
  expect(await (await post('/status', { ticket })).json()).toEqual({ taken: true });
  expect(await (await post('/status', { ticket: other })).json()).toEqual({ taken: false });
});

test('a ticket not made here is never taken, and a request without one is refused', async () => {
  const { post } = server('user_a');
  expect((await post('/taken', { ticket: 'made-elsewhere' })).status).toBe(204);
  expect(await (await post('/status', { ticket: 'made-elsewhere' })).json()).toEqual({ taken: false });
  expect((await post('/taken', {})).status).toBe(400);
  expect((await post('/status')).status).toBe(400);
});

test('a ticket is forgotten two minutes after it was made', async () => {
  const { post, later } = server('user_a');
  const { ticket } = (await (await post('/ticket')).json()) as { ticket: string };
  await post('/taken', { ticket });
  later(TICKET_KEPT_MS - 1);
  expect(await (await post('/status', { ticket })).json()).toEqual({ taken: true });
  later(1);
  expect(await (await post('/status', { ticket })).json()).toEqual({ taken: false });
});
