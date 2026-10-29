import type { Context, MiddlewareHandler } from 'hono';

/** Where a server listens when it runs open: this machine only. */
export const THIS_MACHINE = '127.0.0.1';
/** Where a server listens when it requires sign-in: every interface, as a host such as Railway reaches it. */
export const EVERY_INTERFACE = '0.0.0.0';

/** The variables that say the server is hosted rather than on the dev Mac: any of Railway's, or a production build. */
const RAILWAY_NAMES = ['RAILWAY_ENVIRONMENT', 'RAILWAY_ENVIRONMENT_NAME', 'RAILWAY_PROJECT_ID'];

export type ServerSignIn =
  | { required: true; values: Record<string, string>; hostname: typeof EVERY_INTERFACE }
  | { required: false; hostname: typeof THIS_MACHINE; middleware: MiddlewareHandler };

export interface ServerSignInOptions {
  /** The server's environment, `process.env`. */
  env: Record<string, string | undefined>;
  /** Every setting sign-in needs, as `['CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY', 'OWNER_EMAIL']`. */
  settings: string[];
  /** Where the decision and its reason go. `console.log` by default. */
  log?: (line: string) => void;
  /** The port the server listens on, for the log line that names the open server's address. */
  port?: number;
}

/** Whether the environment says this server runs hosted rather than on the dev Mac. */
export function isHosted(env: Record<string, string | undefined>): boolean {
  return RAILWAY_NAMES.some((name) => Boolean(env[name]?.trim())) || env.NODE_ENV === 'production';
}

/**
 * Whether this server requires sign-in, from its environment. With every setting set, it does, and listens on every
 * interface. With none set on the dev Mac, it runs open: it listens on this machine only, and its `middleware` refuses
 * a request from any other machine, so an app that forgets to pass `hostname` to its server still fails closed. It
 * refuses to start when hosted without every setting, or anywhere with only some of them, naming what is missing. A
 * setting that is blank counts as unset.
 */
export function serverSignIn({ env, settings, log = console.log, port }: ServerSignInOptions): ServerSignIn {
  const values: Record<string, string> = {};
  for (const name of settings) {
    const value = env[name]?.trim();
    if (value) values[name] = value;
  }
  const missing = settings.filter((name) => !(name in values));
  if (missing.length === 0) {
    log(`[sign-in] required: ${settings.join(', ')} are set`);
    return { required: true, values, hostname: EVERY_INTERFACE };
  }
  if (isHosted(env)) {
    throw new Error(`A hosted server needs ${missing.join(', ')}. Refusing to start without a sign-in.`);
  }
  if (missing.length < settings.length) {
    throw new Error(`Sign-in is half set: ${missing.join(', ')} missing. Set all of ${settings.join(', ')}, or none to run open on this machine.`);
  }
  const address = `http://${THIS_MACHINE}${port === undefined ? '' : `:${port}`}`;
  log(`[sign-in] open: none of ${settings.join(', ')} is set, so only this machine is let in, at ${address}`);
  return { required: false, hostname: THIS_MACHINE, middleware: onlyThisMachine(log) };
}

/** The addresses this machine calls itself by, as Bun reports a caller's address. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * The caller's address as Bun reports it. Bun hands its server to Hono as the environment of each request, and
 * `requestIP` reads the socket's peer; anything else, as a request made in a test without a server, has none.
 */
function peerAddress(c: Context): string | null {
  const env = c.env as { requestIP?: (request: Request) => { address: string } | null } | undefined;
  return env?.requestIP?.(c.req.raw)?.address ?? null;
}

/**
 * Whether a request's host is a name that, dialed on this machine, reaches only this machine. A page on another site
 * whose own name it points at 127.0.0.1 (DNS rebinding) is the same site as this server to the browser, so its writes
 * pass the server start's check of which site sent them; the name it was sent to, its own, is what gives it away.
 */
function isThisMachinesName(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || /^127(\.\d{1,3}){3}$/.test(hostname);
}

/**
 * Lets a request through only from this machine: its socket's peer is loopback, and so is every address a proxy on
 * this machine, such as Caddy, names in `X-Forwarded-For` for whoever called it, and it was sent to one of this
 * machine's own names. Anything else gets 403 and a log line.
 */
export function onlyThisMachine(log: (line: string) => void = console.log): MiddlewareHandler {
  return async (c, next) => {
    const { hostname } = new URL(c.req.url);
    if (!isThisMachinesName(hostname)) {
      log(`[sign-in] refused ${c.req.method} ${c.req.path} sent to ${hostname}: an open server answers only to localhost and 127.0.0.1`);
      return c.json({ error: "This server runs without sign-in and answers only to this machine's own names." }, 403);
    }
    const peer = peerAddress(c);
    const forwarded = (c.req.header('X-Forwarded-For') ?? '')
      .split(',')
      .map((address) => address.trim())
      .filter(Boolean);
    const outsider = peer === null ? 'an unknown address' : [peer, ...forwarded].find((address) => !LOOPBACK.has(address));
    if (outsider) {
      log(`[sign-in] refused ${c.req.method} ${c.req.path} from ${outsider}: an open server lets in only this machine`);
      return c.json({ error: 'This server runs without sign-in and lets in only the machine it runs on.' }, 403);
    }
    await next();
  };
}
