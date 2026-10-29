import { Hono, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';

/** Where a line goes: console.log unless a test or an app wants it elsewhere. */
export type Print = (line: string) => void;

/** A request's path as the log shows it: a query is replaced whole, since on an OAuth callback it is a live sign-in code. */
function loggedPath(url: string): string {
  const { pathname, search } = new URL(url);
  return search ? `${pathname}?[redacted]` : pathname;
}

/**
 * One line per request once it is answered: `GET /api/items?[redacted] 200 12ms`. Hono's own logger prints the query
 * as it came, so a sign-in code on a callback lands in the hosted log.
 */
export function requestLog(print: Print = console.log): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now();
    await next();
    print(`${c.req.method} ${loggedPath(c.req.url)} ${c.res.status} ${Math.round(performance.now() - start)}ms`);
  };
}

/** The methods that only read, which another site's page may send: a route that changes something takes another. */
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Why a request another website's page sent may not act here, or null when it may. A page on any site the person has
 * open can send a write to any server, the app's own on this machine included, and a browser's cross-origin rules stop
 * the page reading the answer, never the write itself. So a write, or a websocket's opening, passes only when the
 * browser says it came from the server's own page (`Sec-Fetch-Site: same-origin`, or `none` for one the person typed
 * or an extension sent), from a site in `otherSites`, or from no browser at all: a request with neither
 * `Sec-Fetch-Site` nor `Origin` is a script, a webhook or curl, since every browser names one on a cross-site write.
 * Without `Sec-Fetch-Site`, an `Origin` passes on the host and port the request was sent to, not its scheme, since
 * Railway ends TLS in front of the app. Go's http.CrossOriginProtection makes the same choices; the body's type is not
 * looked at, so a server's own cross-origin rule cannot open what this closes.
 */
export function otherSiteRefusal(request: Request, otherSites: readonly string[] = []): string | null {
  const opensSocket = request.headers.get('upgrade')?.toLowerCase() === 'websocket';
  if (READS.has(request.method) && !opensSocket) return null;
  const origin = request.headers.get('origin');
  if (origin !== null && otherSites.includes(origin)) return null;
  const site = request.headers.get('sec-fetch-site');
  if (site !== null) {
    return site === 'same-origin' || site === 'none' ? null : `sent from ${origin ?? 'another site'} (Sec-Fetch-Site: ${site})`;
  }
  if (origin === null) return null;
  return URL.canParse(origin) && new URL(origin).host === new URL(request.url).host ? null : `sent from ${origin}`;
}

/** The check `appServer` puts on every request, for an app whose server is not yet on it. */
export function otherSiteCheck(otherSites: readonly string[] = [], print: Print = console.log): MiddlewareHandler {
  return async (c, next) => {
    const refusal = otherSiteRefusal(c.req.raw, otherSites);
    if (refusal) {
      print(`refused ${c.req.method} ${loggedPath(c.req.url)}: ${refusal}`);
      return c.json({ error: 'This server takes no writes sent from another website.' }, 403);
    }
    await next();
  };
}

export interface AppServerOptions {
  /** The service's name, which the health route answers with. */
  service: string;
  /** Where the request log and errors go. */
  print?: Print;
  /**
   * Other websites whose pages may call this server, as origins (`http://192.168.1.20:5900`). They may write, and their
   * cross-origin questions get an answer; no other site gets either. An extension's worker calling with host
   * permissions is not held to cross-origin rules and needs no listing unless its writes are refused.
   */
  otherSites?: readonly string[];
}

/**
 * The Hono app every server starts from: the request log; the refusal of writes other websites send (otherSiteRefusal),
 * with cross-origin answers for `otherSites` alone; `GET /api/health` answering `{ ok, service, commit }`, the commit
 * being the one Railway built from (null elsewhere), so a check can confirm which code production serves; an error
 * answered as JSON; and a JSON 404 under `/api/`. The app's own routes go on it after, its sign-in check included, so
 * the health route answers before the check runs.
 */
export function appServer({ service, print = console.log, otherSites = [] }: AppServerOptions): Hono {
  const app = new Hono();
  app.use(requestLog(print));
  if (otherSites.length > 0) app.use(cors({ origin: [...otherSites] }));
  app.use(otherSiteCheck(otherSites, print));
  app.get('/api/health', (c) => c.json({ ok: true, service, commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? null }));
  app.onError((error, c) => {
    // An answer a route chose to throw, such as the agent keys' 401 with its own body, goes out as it was made.
    if (error instanceof HTTPException) return error.getResponse();
    print(`${c.req.method} ${loggedPath(c.req.url)} failed: ${error.stack ?? error.message}`);
    return c.json({ error: 'Something went wrong on the server.' }, 500);
  });
  app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found' }, 404) : c.text('Not found', 404)));
  return app;
}

/** How long open requests have to finish once the server is told to stop, before what is still open is closed. */
export const GRACE_MS = 5_000;

export type ListenOptions<WebSocketData> = Omit<Bun.Serve.HostnamePortServeOptions<WebSocketData>, 'port'> & {
  /** The port, PORT from the environment when none is given, then 3000. */
  port?: number;
  websocket?: Bun.WebSocketHandler<WebSocketData>;
  /** Runs once the server has stopped, before the process exits: a database's close(), a repeating job's stop. */
  onStop?: () => void | Promise<void>;
  /** How long open requests have to finish, GRACE_MS unless given. */
  graceMs?: number;
  print?: Print;
};

/**
 * Serves the app with Bun.serve, handing it every option given as it is (hostname, websocket, maxRequestBodySize,
 * idleTimeout), and logs the address once. On SIGTERM or SIGINT it stops taking requests, gives open ones the grace to
 * finish, closes what is still open (a live-update stream never ends by itself, and Bun's stop() waits for every
 * connection), runs onStop and exits. Railway sends SIGKILL at once unless the service sets `deploy.drainingSeconds`.
 */
export function listen<WebSocketData = undefined>(
  app: { fetch: (request: Request, server: Bun.Server<WebSocketData>) => Response | Promise<Response> },
  { onStop, graceMs = GRACE_MS, print = console.log, port, websocket, ...serve }: ListenOptions<WebSocketData>,
): Bun.Server<WebSocketData> {
  const chosenPort = port ?? (Number(process.env.PORT) || 3000);
  const fetch = (request: Request, server: Bun.Server<WebSocketData>) => app.fetch(request, server);
  const server = websocket
    ? Bun.serve<WebSocketData>({ ...serve, port: chosenPort, fetch, websocket })
    : Bun.serve<WebSocketData>({ ...serve, port: chosenPort, fetch });
  print(`listening on ${server.url}`);

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    print(`${signal}: stopping, open requests have ${graceMs}ms to finish`);
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([server.stop(), new Promise((resolve) => (graceTimer = setTimeout(resolve, graceMs)))]);
    clearTimeout(graceTimer);
    await server.stop(true);
    try {
      await onStop?.();
    } catch (error) {
      print(`stopping failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      process.exit(1);
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
  return server;
}
