/*
 * An app's server half of reading Apple Messages: the routes Messages Service talks to, and the limits and shape of a
 * text. The server imports this entry alone, never the page's.
 *
 * The service is a Mac app that holds the one Full Disk Access grant and pushes texts to the server of each app the
 * person connects. Connecting goes: the signed-in page asks for a one-time code (`POST /code`) and opens the service's
 * connect link with it (index.ts connectLink); the service fetches the app's name and the account the code was made
 * for (`GET /about?code=`) and asks the person in its own window, naming this server's host and that account, so a
 * link someone else made for their own account is seen for what it is; on their yes it posts the code and a secret it made (`POST /connect`),
 * which the app keeps for the person the code was made for. From then on the service pushes texts in batches to
 * `POST /texts/<connection>`, each signed with that secret the Standard Webhooks way (standardwebhooks.com: a
 * `webhook-id`, a `webhook-timestamp` within five minutes, and an HMAC `webhook-signature`), and moves its place in
 * the person's texts only on a 2xx answer. The app stores texts keyed by `guid`, so a batch sent again stores nothing
 * twice. Storing, which person a connection is for, and turning a connection off (delete it, and the next push gets
 * 410 and the service stops) are the app's.
 */
import { Hono, type Context, type Env } from 'hono';
import { Webhook } from 'standardwebhooks';
import { HEX_32, randomHex } from '../sign-in/fingerprint';
import type { MacText } from './index';
import {
  BATCH_SIZE,
  CONNECT_CODE_MS,
  LOG_PREFIX,
  MAX_FIELD_UNITS,
  MAX_GUID_UNITS,
  MAX_PARTICIPANTS,
  MAX_SERVICE_UNITS,
  MAX_TEXT_UNITS,
} from './names';

export {
  BATCH_SIZE,
  CONNECT_CODE_MS,
  HOW_FAR_BACK,
  HOW_FAR_BACK_DEFAULT_DAYS,
  MAX_FIELD_UNITS,
  MAX_GUID_UNITS,
  MAX_PARTICIPANTS,
  MAX_SERVICE_UNITS,
  MAX_TEXT_UNITS,
  MESSAGES_SERVICE_ROUTES,
  SERVICE_OPEN_PATHS,
  readFromFor,
} from './names';
export type { MacPerson, MacText, MessagesUpload } from './index';

/** A connection's secret as the service makes it: Standard Webhooks' `whsec_` and 32 random bytes in base64. */
const SECRET = /^whsec_[A-Za-z0-9+/]{43}=$/;
/** A connection's id as the app's `connect` makes it: letters, digits, `-` and `_`, as a uuid is. */
const CONNECTION = /^[A-Za-z0-9_-]{1,100}$/;

export interface MessagesServiceRoutesOptions<E extends Env> {
  /** The app's name, which the service's window shows under the app's host. */
  name: string;
  /** The id of the person signed in with a session, or null. Never a key for agents': a code connects that person's texts. */
  userId(c: Context<E>): string | null;
  /**
   * How the person knows their own account in the app, such as their email: the service's window names it, so a person
   * opening a connect link someone else made sees their texts would go to that someone's account.
   */
  account(userId: string): Promise<string>;
  /** Keep a new connection for `userId` with the service's `secret`, and answer its id (a uuid will do). */
  connect(userId: string, secret: string): Promise<string>;
  /** The connection's person and secret, or null when it is unknown or was turned off. */
  connectionOf(connection: string): Promise<{ userId: string; secret: string } | null>;
  /** Store one batch of texts for the person, keyed by `guid` so a repeat stores nothing twice. */
  store(userId: string, texts: MacText[], connection: string): Promise<void>;
  /** The clock, for tests. */
  now?: () => number;
}

/** The request's JSON body, or an empty one. */
async function bodyOf(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

/** A string no longer than `max` UTF-16 units, as JavaScript counts a string's length. */
const text = (value: unknown, max: number, min = 1): value is string =>
  typeof value === 'string' && value.length >= min && value.length <= max;
const textOrNull = (value: unknown, max: number) => value === null || text(value, max, 0);
const SENDER_KINDS = new Set(['me', 'contact', 'short_code', 'unknown']);

/**
 * The texts of a pushed batch, or why it is refused: at most BATCH_SIZE, each within the limits the reader cuts to, so
 * a batch the reader read is never refused. Only what the reader never sends empty must have a character: the guid,
 * the sender, and each participant's handle; Messages' own chat id and service may be empty.
 */
export function checkTexts(body: unknown): { texts: MacText[] } | { refused: string } {
  const texts = (body as { texts?: unknown } | null)?.texts;
  if (!Array.isArray(texts)) return { refused: 'no texts' };
  if (texts.length > BATCH_SIZE) return { refused: `more than ${BATCH_SIZE} texts` };
  for (const [i, t] of texts.entries()) {
    const x = t as Record<string, unknown>;
    const fine =
      typeof x === 'object' && x !== null &&
      text(x.guid, MAX_GUID_UNITS) &&
      Number.isSafeInteger(x.rowid) && (x.rowid as number) >= 0 &&
      text(x.chatGuid, MAX_FIELD_UNITS, 0) &&
      textOrNull(x.chatName, MAX_FIELD_UNITS) &&
      Array.isArray(x.participants) && x.participants.length <= MAX_PARTICIPANTS &&
      x.participants.every((p: { handle?: unknown; name?: unknown } | null) =>
        typeof p === 'object' && p !== null && text(p.handle, MAX_FIELD_UNITS) && textOrNull(p.name, MAX_FIELD_UNITS)) &&
      text(x.senderHandle, MAX_FIELD_UNITS) &&
      textOrNull(x.senderName, MAX_FIELD_UNITS) &&
      SENDER_KINDS.has(x.senderKind as string) &&
      text(x.service, MAX_SERVICE_UNITS, 0) &&
      Number.isSafeInteger(x.sentAtMs) && (x.sentAtMs as number) > 0 &&
      text(x.text, MAX_TEXT_UNITS, 0);
    if (!fine) return { refused: `text ${i} is not a text within the limits` };
  }
  return { texts: texts as MacText[] };
}

/**
 * The routes Messages Service talks to, mounted at MESSAGES_SERVICE_ROUTES: `app.route(MESSAGES_SERVICE_ROUTES,
 * messagesServiceRoutes(...))`. The app's sign-in check lets through SERVICE_OPEN_PATHS, since the service has no
 * session: `/connect` is proven by its one-time code, and `/texts/<connection>` by the connection's signature. Every
 * refusal logs a line starting `[apple-messages]`, never a text's words.
 */
export function messagesServiceRoutes<E extends Env = Env>(options: MessagesServiceRoutesOptions<E>): Hono<E> {
  const now = options.now ?? Date.now;
  const codes = new Map<string, { userId: string; made: number }>();
  const forgetOld = () => {
    for (const [code, made] of codes) if (made.made + CONNECT_CODE_MS <= now()) codes.delete(code);
  };
  const routes = new Hono<E>();

  routes.get('/about', async (c) => {
    const code = c.req.query('code');
    forgetOld();
    const made = code && HEX_32.test(code) ? codes.get(code) : undefined;
    if (!made) return c.json({ name: options.name });
    c.header('Cache-Control', 'no-store');
    return c.json({ name: options.name, account: await options.account(made.userId) });
  });

  routes.post('/code', (c) => {
    // A browser sends a cookie with another site's request in some setups, never a bearer token, so a code is made
    // only for a request that carries one.
    if (!c.req.header('Authorization')?.startsWith('Bearer ')) return c.json({ error: 'Sign in first.' }, 401);
    const userId = options.userId(c);
    if (!userId) return c.json({ error: 'Sign in first.' }, 401);
    forgetOld();
    // Kept in memory: an app runs one server, and a code lives minutes, so a restart loses only a connect under way.
    const code = randomHex();
    codes.set(code, { userId, made: now() });
    c.header('Cache-Control', 'no-store');
    return c.json({ code });
  });

  routes.post('/connect', async (c) => {
    const body = await bodyOf(c);
    const code = typeof body.code === 'string' && HEX_32.test(body.code) ? body.code : null;
    const secret = typeof body.secret === 'string' && SECRET.test(body.secret) ? body.secret : null;
    forgetOld();
    const made = code ? codes.get(code) : undefined;
    if (!code || !made || !secret) {
      console.warn(`${LOG_PREFIX} not connected: the code is unknown, used or expired, or no secret came with it`);
      return c.json({ error: 'This connect link has expired or was used. Connect again from the app.' }, 400);
    }
    // Used up before the connection is kept, so one code never makes two.
    codes.delete(code);
    const connection = await options.connect(made.userId, secret);
    console.log(`${LOG_PREFIX} Messages Service connected as ${connection}`);
    c.header('Cache-Control', 'no-store');
    return c.json({ connection });
  });

  routes.post('/texts/:connection', async (c) => {
    const connection = c.req.param('connection');
    const known = CONNECTION.test(connection) ? await options.connectionOf(connection) : null;
    if (!known) {
      console.warn(`${LOG_PREFIX} texts refused: no connection ${CONNECTION.test(connection) ? connection : '(malformed)'}; the service stops pushing to it`);
      return c.json({ error: 'This connection was turned off.' }, 410);
    }
    const payload = await c.req.text();
    let body: unknown;
    try {
      body = new Webhook(known.secret).verify(payload, {
        'webhook-id': c.req.header('webhook-id') ?? '',
        'webhook-timestamp': c.req.header('webhook-timestamp') ?? '',
        'webhook-signature': c.req.header('webhook-signature') ?? '',
      });
    } catch (err) {
      console.warn(`${LOG_PREFIX} texts refused for ${connection}: ${err instanceof Error ? err.message : 'bad signature'}`);
      return c.json({ error: 'Not signed by this connection.' }, 401);
    }
    const checked = checkTexts(body);
    if ('refused' in checked) {
      console.warn(`${LOG_PREFIX} texts refused for ${connection}: ${checked.refused}`);
      return c.json({ error: checked.refused }, 400);
    }
    await options.store(known.userId, checked.texts, connection);
    console.log(`${LOG_PREFIX} stored a batch of ${checked.texts.length} from ${connection} (${c.req.header('webhook-id')})`);
    return c.json({ ok: true });
  });

  return routes;
}
