import { Hono, type Context, type Env } from 'hono';

// The server imports this entry alone, never the page's, which needs React.
export { DESKTOP_SIGN_IN_ROUTES } from './names';

/*
 * The server's half of the desktop sign-in, mounted at DESKTOP_SIGN_IN_ROUTES. The browser, signed in, asks for a
 * one-time ticket for its own account and hands it to the app; the app, signed in with it, says so; the browser tab
 * asks until it hears that, and closes. Tickets travel only in request bodies, so none is in an address a log keeps.
 */

/** How long a ticket is remembered, past the minute it can be used in. */
export const TICKET_KEPT_MS = 2 * 60_000;

export interface DesktopSignInRoutesOptions<E extends Env> {
  /** The signed-in caller's id, or null. */
  userId(c: Context<E>): string | null;
  /** A one-time ticket that signs this user in elsewhere, good for a minute: Clerk's sign-in token, or another provider's. */
  makeTicket(userId: string, c: Context<E>): Promise<string>;
  /** The clock, for tests. */
  now?: () => number;
}

/**
 * The tickets the browser has handed the app, kept until the app says it signed in with one. Kept in memory: an app runs
 * one server, and a ticket lives a minute, so a restart loses only a tab that stays open instead of closing.
 */
class TicketsHandedOver {
  private readonly tickets = new Map<string, { taken: boolean; until: number }>();

  constructor(private readonly now: () => number) {}

  made(ticket: string) {
    this.forgetOld();
    this.tickets.set(ticket, { taken: false, until: this.now() + TICKET_KEPT_MS });
  }

  /** A ticket not made here, or long gone, changes nothing. */
  taken(ticket: string) {
    this.forgetOld();
    const handed = this.tickets.get(ticket);
    if (handed) handed.taken = true;
  }

  isTaken(ticket: string): boolean {
    this.forgetOld();
    return this.tickets.get(ticket)?.taken ?? false;
  }

  private forgetOld() {
    const now = this.now();
    for (const [ticket, handed] of this.tickets) if (handed.until <= now) this.tickets.delete(ticket);
  }
}

/** The ticket in a request's JSON body. */
async function ticketIn(c: Context): Promise<string | null> {
  const body: unknown = await c.req.json().catch(() => null);
  const ticket = (body as { ticket?: unknown } | null)?.ticket;
  return typeof ticket === 'string' && ticket.length > 0 ? ticket : null;
}

/**
 * `POST /ticket` makes a ticket for the signed-in caller and nobody else; POST with the session's bearer token, so
 * another site cannot have one made through the person's browser. `POST /taken` is the app saying it signed in with
 * one, and `POST /status` the browser tab asking whether it has.
 */
export function desktopSignInRoutes<E extends Env = Env>({ userId, makeTicket, now = Date.now }: DesktopSignInRoutesOptions<E>): Hono<E> {
  const handedOver = new TicketsHandedOver(now);
  const routes = new Hono<E>();

  routes.post('/ticket', async (c) => {
    // A browser sends a cookie to another site's request in some setups, but never a bearer token, so a ticket is made
    // only for a request that carries one, whatever the app's own sign-in check accepts.
    if (!c.req.header('Authorization')?.startsWith('Bearer ')) return c.json({ error: 'Sign in in this browser first.' }, 401);
    const id = userId(c);
    if (!id) return c.json({ error: 'Sign in in this browser first.' }, 401);
    const ticket = await makeTicket(id, c);
    handedOver.made(ticket);
    c.header('Cache-Control', 'no-store');
    return c.json({ ticket });
  });

  routes.post('/taken', async (c) => {
    const ticket = await ticketIn(c);
    if (!ticket) return c.json({ error: 'No ticket.' }, 400);
    handedOver.taken(ticket);
    return c.body(null, 204);
  });

  routes.post('/status', async (c) => {
    const ticket = await ticketIn(c);
    if (!ticket) return c.json({ error: 'No ticket.' }, 400);
    c.header('Cache-Control', 'no-store');
    return c.json({ taken: handedOver.isTaken(ticket) });
  });

  return routes;
}
