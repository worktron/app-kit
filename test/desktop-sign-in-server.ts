import { Hono } from 'hono';
import { DESKTOP_SIGN_IN_ROUTES } from '../tauri/sign-in/names';
import { desktopSignInRoutes } from '../tauri/sign-in/server';
import { standInTicket } from '../authentication/stand-in';

export interface SentRequest {
  path: string;
  authorization: string | null;
  body: unknown;
}

/**
 * The app's server with the desktop sign-in routes, answering the page's fetch in the test itself. A request counts as
 * signed in only with a bearer token, as the app's server would have it, and then as whoever `signedInAs` names; its
 * tickets are ones the stand-in takes. `codeFor` is the browser, signed in as `signedInAs`, handing over a code for a
 * window's nonce, asked outside the page's fetch so it is not among what the page sent.
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
  const codeFor = async (nonce: string): Promise<string> => {
    const answer = await app.request(`${DESKTOP_SIGN_IN_ROUTES}/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer browser-session' },
      body: JSON.stringify({ fingerprint: nonce }),
    });
    const { code } = (await answer.json()) as { code?: string };
    if (!code) throw new Error(`no code for ${nonce}: ${answer.status}`);
    return code;
  };
  return { sent, codeFor };
}
