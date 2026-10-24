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
  /** Reads the request's caller from the sign-in provider: `clerkCaller` from `app-kit/agent-keys/clerk`. */
  caller: (c: Context) => Caller;
  /**
   * The routes a key may read, each as its method and the path the app registered it with, such as
   * `GET /api/profiles/:id/decisions`. Only GET routes count, and a listed route must never write, not even behind a
   * query flag: the list is what decides.
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
 * its own match, so a literal route registered beside a listed `:id` route is never mistaken for it. Mount it once,
 * after the provider's middleware, over the app's API.
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
      const route = answeringRoute(c);
      if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
        log(`${key} refused for ${c.req.method} ${c.req.path}: a key only reads`);
        return c.json({ error: 'a key only reads: it is refused on anything but GET' }, 403);
      }
      if (!route || !readable.has(route)) {
        log(`${key} refused for ${c.req.method} ${c.req.path}: ${route ?? 'no route'} is not one a key may read`);
        return c.json({ error: 'this route is not one a key may read' }, 403);
      }
      log(`${key} let through for ${c.req.method} ${c.req.path} as ${route}`);
    }
    c.set('appKitCaller', caller);
    return next();
  };
}

/**
 * The route that will answer, as `GET /registered/:path`: the first match that is not middleware, since `app.use`
 * registers for every method. A HEAD request is matched against the GET routes, which Hono runs for it.
 */
function answeringRoute(c: Context): string | null {
  const route = matchedRoutes(c).find((r) => r.method !== 'ALL');
  return route ? `${route.method} ${route.path}` : null;
}

/** The caller `requireCaller` let through. Throws a 401 when it was never mounted in front, so a handler fails closed. */
export function callerOf(c: Context): SignedInCaller {
  const caller = c.get('appKitCaller');
  if (!caller) throw new HTTPException(401, { res: Response.json({ error: 'unauthorized' }, { status: 401 }) });
  return caller;
}
