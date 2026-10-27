import { Hono, type Context, type Env } from 'hono';
import { fingerprint, HEX_32, randomHex } from './fingerprint';

// The server imports this entry alone, never the page's, which needs React.
export { DESKTOP_SIGN_IN_OPEN_PATH, DESKTOP_SIGN_IN_ROUTES } from './names';

/*
 * The server's half of the desktop sign-in, mounted at DESKTOP_SIGN_IN_ROUTES. The browser, signed in and clicked
 * through, asks for a one-time code made for the fingerprint the window asked with, and hands it to the app over the
 * app's own link; the app's window, still signed out, turns the code into a ticket by showing the secret behind that
 * fingerprint, signs in with the ticket, and says so; the browser tab asks until it hears that, and closes. Any app can
 * claim the link, so the code alone buys nothing: the ticket is made only for the window's secret, which never leaves
 * it. Codes, secrets and tickets travel only in request bodies, so none is in an address a log keeps.
 */

/** How long a code can be turned into a ticket. */
export const CODE_GOOD_MS = 60_000;

/** How long a code is remembered, past the minute it can be used in, for the browser tab asking whether it was taken. */
export const CODE_KEPT_MS = 2 * 60_000;

/** What every log line of the server half starts with. */
export const LOG_PREFIX = '[desktop-sign-in]';

export interface DesktopSignInRoutesOptions<E extends Env> {
  /**
   * The id of the person signed in with a session, or null. Never a key for agents' person: a code signs its holder's
   * window in as that person, so a key that could reach this would buy a whole session. Clerk's `getAuth(c)` reads
   * session tokens only unless told otherwise, and `requireCaller` from `app-kit/authentication/agent-keys` refuses a
   * key on anything but GET.
   */
  userId(c: Context<E>): string | null;
  /** A one-time ticket that signs this user in elsewhere, good for a minute: Clerk's sign-in token, or another provider's. */
  makeTicket(userId: string, c: Context<E>): Promise<string>;
  /** The clock, for tests. */
  now?: () => number;
}

interface CodeMade {
  userId: string;
  fingerprint: string;
  made: number;
  redeemed: boolean;
  taken: boolean;
}

/**
 * The codes the browser has handed the app, kept until the app says it signed in with one. Kept in memory: an app runs
 * one server, and a code lives a minute, so a restart loses only a sign-in under way, which the person starts again.
 */
class CodesHandedOver {
  private readonly codes = new Map<string, CodeMade>();

  constructor(private readonly now: () => number) {}

  made(userId: string, fingerprint: string): string {
    this.forgetOld();
    const code = randomHex();
    this.codes.set(code, { userId, fingerprint, made: this.now(), redeemed: false, taken: false });
    return code;
  }

  /** The code, while it can still be turned into a ticket. */
  good(code: string): CodeMade | null {
    this.forgetOld();
    const handed = this.codes.get(code);
    return handed && !handed.redeemed && this.now() < handed.made + CODE_GOOD_MS ? handed : null;
  }

  /** A code not made here, or long gone, changes nothing. */
  taken(code: string) {
    this.forgetOld();
    const handed = this.codes.get(code);
    if (handed) handed.taken = true;
  }

  isTaken(code: string): boolean {
    this.forgetOld();
    return this.codes.get(code)?.taken ?? false;
  }

  private forgetOld() {
    const now = this.now();
    for (const [code, handed] of this.codes) if (handed.made + CODE_KEPT_MS <= now) this.codes.delete(code);
  }
}

/** The request's JSON body, or an empty one. */
async function bodyOf(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

/** The field `name` of a body when it is 32 bytes in hex, as every code, secret and fingerprint is. */
const hexIn = (body: Record<string, unknown>, name: string) => {
  const value = body[name];
  return typeof value === 'string' && HEX_32.test(value) ? value : null;
};

/**
 * `POST /code` makes a code for the signed-in caller and the fingerprint the window asked with, and nobody else; POST
 * with the session's bearer token, so another site cannot have one made through the person's browser. `POST /redeem`
 * is the window, signed out, turning a code into a ticket with its secret: the one route the app's sign-in check lets
 * through, at DESKTOP_SIGN_IN_OPEN_PATH. `POST /taken` is the app saying it signed in with a code, and `POST /status`
 * the browser tab asking whether it has.
 */
export function desktopSignInRoutes<E extends Env = Env>({ userId, makeTicket, now = Date.now }: DesktopSignInRoutesOptions<E>): Hono<E> {
  const handedOver = new CodesHandedOver(now);
  const routes = new Hono<E>();

  routes.post('/code', async (c) => {
    // A browser sends a cookie to another site's request in some setups, but never a bearer token, so a code is made
    // only for a request that carries one, whatever the app's own sign-in check accepts.
    if (!c.req.header('Authorization')?.startsWith('Bearer ')) return c.json({ error: 'Sign in in this browser first.' }, 401);
    const id = userId(c);
    if (!id) return c.json({ error: 'Sign in in this browser first.' }, 401);
    const asked = hexIn(await bodyOf(c), 'fingerprint');
    if (!asked) return c.json({ error: 'Start from the app.' }, 400);
    c.header('Cache-Control', 'no-store');
    return c.json({ code: handedOver.made(id, asked) });
  });

  routes.post('/redeem', async (c) => {
    const body = await bodyOf(c);
    const code = hexIn(body, 'code');
    const secret = hexIn(body, 'secret');
    const handed = code ? handedOver.good(code) : null;
    if (!handed || !secret) {
      console.warn(`${LOG_PREFIX} no ticket: the code is unknown, used or expired, or no secret came with it`);
      return c.json({ error: 'This sign-in has expired. Sign in again.' }, 400);
    }
    if (fingerprint(secret) !== handed.fingerprint) {
      // Left good for the right secret, so an app that caught the link cannot spoil the window's own sign-in.
      console.warn(`${LOG_PREFIX} no ticket: the secret is not the one the window asked with`);
      return c.json({ error: 'This sign-in did not come from this window. Sign in again.' }, 400);
    }
    // Used up before the ticket is made, so two answers at once never make two.
    handed.redeemed = true;
    const ticket = await makeTicket(handed.userId, c);
    console.log(`${LOG_PREFIX} a code was turned into a ticket for the window that asked`);
    c.header('Cache-Control', 'no-store');
    return c.json({ ticket });
  });

  routes.post('/taken', async (c) => {
    const code = hexIn(await bodyOf(c), 'code');
    if (!code) return c.json({ error: 'No code.' }, 400);
    handedOver.taken(code);
    return c.body(null, 204);
  });

  routes.post('/status', async (c) => {
    const code = hexIn(await bodyOf(c), 'code');
    if (!code) return c.json({ error: 'No code.' }, 400);
    c.header('Cache-Control', 'no-store');
    return c.json({ taken: handedOver.isTaken(code) });
  });

  return routes;
}
