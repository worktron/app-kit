import type { Context, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { matchedRoutes } from 'hono/route';

/**
 * Who made a request, as the sign-in provider's half reads it: a person signed in in a browser, a person's key for
 * agents, nobody (with why, when a key was refused), or a key the provider could not check because it could not be
 * reached.
 */
export type Caller =
  | { kind: 'session'; personId: string }
  | { kind: 'key'; personId: string; keyId: string; keyName: string }
  | { kind: 'nobody'; reason: string | null }
  | { kind: 'unchecked'; reason: string };

/** A caller let through: a signed-in session, or a key on a route the app lets keys read. */
export type SignedInCaller = Extract<Caller, { kind: 'session' | 'key' }>;

export interface RequireCallerOptions {
  /** Reads the request's caller from the sign-in provider: `clerkCaller` from `app-kit/authentication/clerk/server`. */
  caller: (c: Context) => Caller;
  /**
   * The routes a key may read, each as its method and the path the app registered it with, such as
   * `GET /api/profiles/:id/decisions`, and the catch-alls behind them, such as a not-found answer `ALL /api/*`: every
   * route Hono would run for a key's request must be listed. A key is refused on anything but GET whatever is listed,
   * and a listed route must never write, not even behind a query flag: the list is what decides.
   */
  readableByKey: readonly string[];
  /** Paths answered with no caller at all, such as the health check and an OAuth callback, matched exactly. */
  openPaths?: readonly string[];
  /** Where each decision about a key goes, with the key's id and name, never its secret. `console.log` by default. */
  log?: (line: string) => void;
}

declare module 'hono' {
  interface ContextVariableMap {
    appKitCaller: SignedInCaller;
  }
}

/**
 * Lets a request through only with a caller: a signed-in session reaches every route, and a key reaches only the GET
 * routes listed in `readableByKey`. Which route a key reaches is the one Hono picked to answer the request, read from
 * its own match, so a literal route registered beside a listed `:id` route is never mistaken for it. Mount it once over
 * the app's API, after the provider's middleware and every other middleware: middleware mounted after it could answer
 * a key's request, so a key is refused wherever any matches, unless its method and path are listed. Hono records
 * middleware as `ALL <path>`, as it does an `app.all` route, so listing `ALL /api/*` lets both through.
 */
export function requireCaller(options: RequireCallerOptions): MiddlewareHandler {
  const readable = new Set(options.readableByKey);
  const open = new Set(options.openPaths ?? []);
  const log = options.log ?? console.log;

  return async (c, next) => {
    if (open.has(c.req.path)) return next();
    const caller = options.caller(c);
    if (caller.kind === 'unchecked') {
      log(`key refused for ${c.req.method} ${c.req.path}: ${caller.reason}`);
      return c.json({ error: 'could not check the key with the sign-in provider; try again shortly' }, 503);
    }
    if (caller.kind === 'nobody') {
      if (caller.reason) log(`key refused for ${c.req.method} ${c.req.path}: ${caller.reason}`);
      return c.json({ error: 'unauthorized' }, 401);
    }
    if (caller.kind === 'key') {
      const key = `key ${caller.keyName} (${caller.keyId})`;
      if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
        log(`${key} refused for ${c.req.method} ${c.req.path}: a key only reads`);
        return c.json({ error: 'a key only reads: it is refused on anything but GET' }, 403);
      }
      const route = routeForKey(c, readable);
      if ('refused' in route) {
        log(`${key} refused for ${c.req.method} ${c.req.path}: ${route.refused}`);
        return c.json({ error: 'this route is not one a key may read' }, 403);
      }
      log(`${key} let through for ${c.req.method} ${c.req.path} as ${route.listed}`);
    }
    c.set('appKitCaller', caller);
    return next();
  };
}

/**
 * Whether every route Hono matched after this check is listed, read from Hono's own match. Any of them could run for the
 * request: the first answers unless it passes the request on with `next()`, and so on down the list, and an `app.all`
 * handler cannot be told from middleware. So the kit guesses nothing about what a route does: all must be listed, the
 * app's catch-alls included. A HEAD request is matched against the GET routes, which Hono runs for it.
 */
function routeForKey(c: Context, readable: ReadonlySet<string>): { listed: string } | { refused: string } {
  const routes = matchedRoutes(c)
    .slice(c.req.routeIndex + 1)
    .map((route) => `${route.method} ${route.path}`);
  const unlisted = routes.find((route) => !readable.has(route));
  if (unlisted) return { refused: `${unlisted} could run for this request, and it is not one a key may read` };
  return routes[0] ? { listed: routes[0] } : { refused: 'no route answers' };
}

/** The caller `requireCaller` let through. Throws a 401 when it was never mounted in front, so a handler fails closed. */
export function callerOf(c: Context): SignedInCaller {
  const caller = c.get('appKitCaller');
  if (!caller) throw new HTTPException(401, { res: Response.json({ error: 'unauthorized' }, { status: 401 }) });
  return caller;
}
