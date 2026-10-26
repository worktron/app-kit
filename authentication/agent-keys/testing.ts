/*
 * A check for an app's server tests that `requireCaller` guards every route it registered: it walks the routes the app's
 * Hono app holds and asks each one as nobody and with a key, and says which answered otherwise than the check would.
 * Whoever calls comes from the test's `as`, so it works with any sign-in provider's stand-in, such as
 * `fakeClerkApi` from `app-kit/authentication/clerk/testing`.
 */

export interface RouteCheck {
  /** The app, as Hono gives its routes: `app.routes` and `app.request`. */
  app: { routes: readonly { method: string; path: string }[]; request: (path: string, init?: RequestInit) => Response | Promise<Response> };
  /** Where the guarded routes start, such as `/api`. */
  prefix: string;
  /** The paths answered with no caller, as given to `requireCaller`, matched exactly. */
  openPaths?: readonly string[];
  /** The routes a key may read, as given to `requireCaller`. */
  readableByKey: readonly string[];
  /** The headers of a request from nobody, or with a person's key. */
  as: (who: 'nobody' | 'key') => Record<string, string> | Promise<Record<string, string>>;
}

/** A path for a route pattern: each parameter a well-formed uuid, each wildcard a literal segment. */
const concrete = (pattern: string) => pattern.replace(/:[^/{]+(\{[^}]*\})?/g, '00000000-0000-4000-8000-000000000000').replace(/\*/g, 'anything');

/**
 * Asks every route under `prefix` and returns a line for each that answered otherwise than the check would, none when
 * all are right. Nobody gets 401 everywhere but the open paths. A key gets 403 on anything but GET, and on a GET route
 * it is not listed for; on a listed route, GET or ALL, its GET gets past the check, so anything but 401 or 403. A route
 * registered as ALL is asked with GET and POST. No route under `prefix` is a line too, since a check that walked
 * nothing proves nothing.
 */
export async function routesLetThrough(check: RouteCheck): Promise<string[]> {
  const open = new Set(check.openPaths ?? []);
  const listed = new Set(check.readableByKey);
  const seen = new Set<string>();
  const routes = check.app.routes.filter((route) => {
    const name = `${route.method} ${route.path}`;
    if (!route.path.startsWith(check.prefix) || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
  if (routes.length === 0) return [`no route is registered under ${check.prefix}, so nothing was checked`];

  const wrong: string[] = [];
  const nobody = await check.as('nobody');
  const key = await check.as('key');
  for (const route of routes) {
    const path = concrete(route.path);
    if (open.has(path)) continue;
    const name = `${route.method} ${route.path}`;
    const methods = route.method === 'ALL' ? ['GET', 'POST'] : [route.method];
    for (const method of methods) {
      const signedOut = (await check.app.request(path, { method, headers: nobody })).status;
      if (signedOut !== 401) wrong.push(`nobody: ${method} ${path} (${name}) answered ${signedOut}, not 401`);

      const withKey = (await check.app.request(path, { method, headers: key })).status;
      const reads = method === 'GET' || method === 'HEAD';
      if (reads && listed.has(name)) {
        if (withKey === 401 || withKey === 403) wrong.push(`key: ${method} ${path} (${name}) is listed for keys but answered ${withKey}`);
      } else if (withKey !== 403) {
        wrong.push(`key: ${method} ${path} (${name}) answered ${withKey}, not 403, ${reads ? 'and is not listed for keys' : 'and a key only reads'}`);
      }
    }
  }
  return wrong;
}
