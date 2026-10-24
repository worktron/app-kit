import { Hono } from 'hono';
import { DESKTOP_SIGN_IN_ROUTES } from '../desktop-sign-in/names';
import { desktopSignInRoutes } from '../desktop-sign-in/server';
import { standInTicket } from '../testing';

export interface SentRequest {
  path: string;
  authorization: string | null;
  body: unknown;
}

/**
 * The app's server with the desktop sign-in routes, answering the page's fetch in the test itself. A request counts as
 * signed in only with a bearer token, as the app's server would have it, and then as whoever `signedInAs` names; its
 * tickets are ones the stand-in takes.
 */
export function serveDesktopSignIn(signedInAs: () => string | null) {
  const app = new Hono();
  app.route(
    DESKTOP_SIGN_IN_ROUTES,
    desktopSignInRoutes({
      userId: (c) => (c.req.header('Authorization')?.startsWith('Bearer ') ? signedInAs() : null),
      makeTicket: async (email) => standInTicket(email),
    }),
  );
  const sent: SentRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(new URL(String(input), window.location.origin), init);
    sent.push({
      path: new URL(request.url).pathname,
      authorization: request.headers.get('Authorization'),
      body: await request.clone().json().catch(() => null),
    });
    return app.fetch(request);
  }) as typeof fetch;
  return { sent };
}
