/*
 * The server half of notifications for a web app on a phone's Home Screen: sending through each browser's push service
 * (Google's for Chrome, Apple's for Safari, Mozilla's for Firefox). Each send is one POST to the address the phone's
 * subscription names, its body encrypted to that phone's keys (RFC 8291, aes128gcm) and signed with the app's own key
 * pair (RFC 8292, the key pair the standard calls VAPID). Where the subscriptions are kept is the app's: it passes them
 * in, and removes the ones the result says are gone. Node's crypto only, so any server on Bun or Node imports it.
 *
 *   WEB_PUSH_PUBLIC_KEY    the key pair's public half, base64url, which the page subscribes with
 *   WEB_PUSH_PRIVATE_KEY   its private half, base64url
 *   WEB_PUSH_CONTACT       a mailto: or https: address the push services can reach the app's owner at
 *
 * The message goes in the declarative form (`web_push: 8030`), which Safari on iOS 18.4 and later shows with no code
 * running, so it can never count against Safari's limit of three pushes that show nothing; everywhere else the kit's
 * worker (worker.js) reads the same message and shows it.
 */
import { createCipheriv, createECDH, createHash, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign } from 'node:crypto';
import { DECLARATIVE_PUSH, LOG_PREFIX, type WebPushSubscription } from './names';

export type { WebPushSubscription };

export type WebPushConfig = { publicKey: string; privateKey: string; contact: string };

/**
 * What the phone shows, and the page a tap opens. The same fields as the iPhone app's notifications in their alert
 * form, so one message goes to both; a badge alone has no web form, since every web push must show something.
 */
export type WebPushPayload = {
  title: string;
  body: string;
  /** The page a tap opens: a path, or an address on the app's site. Defaults to '/'. */
  url?: string;
  /** A newer notification with the same tag replaces the older one instead of stacking. */
  tag?: string;
  /** No sound and no vibration, where the browser honors it: Chrome does, Safari on an iPhone does not. */
  quiet?: boolean;
  /** The number on the app's icon; 0 clears it. */
  badge?: number;
};

export type WebPushOptions = {
  /** The app's own site, such as `https://app.example.com`, which a tap's page is read against. */
  origin: string;
  /** How long the push service keeps the message for a phone that is off, in seconds; at least 1. */
  ttlSeconds: number;
  /** The notification's picture, a path on the app's site, such as `/icon-192.png`. */
  icon?: string;
};

/**
 * The largest message the kit sends. The encrypted body is the message, one byte of padding, a 16-byte tag and an
 * 86-byte header, and Apple refuses a body over 4096 bytes.
 */
export const MAX_MESSAGE_BYTES = 4096 - 86 - 16 - 1;

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const unb64 = (text: string) => Buffer.from(text, 'base64url');

/**
 * The key pair from the environment, or null when any part is missing, which sends nothing. A part that is there but
 * wrong throws, so a server with a broken setting says so at its first send instead of sending nothing.
 */
export function webPushConfig(env: Record<string, string | undefined> = process.env): WebPushConfig | null {
  const publicKey = env.WEB_PUSH_PUBLIC_KEY;
  const privateKey = env.WEB_PUSH_PRIVATE_KEY;
  const contact = env.WEB_PUSH_CONTACT;
  if (!publicKey || !privateKey || !contact) return null;
  if (unb64(publicKey).length !== 65 || unb64(publicKey)[0] !== 4) throw new Error(`${LOG_PREFIX} WEB_PUSH_PUBLIC_KEY is not an uncompressed P-256 public key in base64url`);
  if (unb64(privateKey).length !== 32) throw new Error(`${LOG_PREFIX} WEB_PUSH_PRIVATE_KEY is not a P-256 private key in base64url`);
  checkContact(contact);
  return { publicKey, privateKey, contact };
}

/** Apple refuses a contact that is not a mailto: or https: address, and one at localhost. */
function checkContact(contact: string): void {
  let url: URL;
  try {
    url = new URL(contact);
  } catch {
    throw new Error(`${LOG_PREFIX} WEB_PUSH_CONTACT is not an address: give a mailto: or https: one`);
  }
  const host = url.protocol === 'mailto:' ? url.pathname.split('@').pop() ?? '' : url.hostname;
  if (url.protocol !== 'mailto:' && url.protocol !== 'https:') throw new Error(`${LOG_PREFIX} WEB_PUSH_CONTACT must be a mailto: or https: address`);
  if (!host || host === 'localhost' || host.endsWith('.localhost')) throw new Error(`${LOG_PREFIX} WEB_PUSH_CONTACT names localhost, which Apple's push service refuses`);
}

/** A new key pair for an app, made once and kept: a new one makes every phone's subscription stop working. */
export function makeWebPushKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  const priv = privateKey.export({ format: 'jwk' });
  return { publicKey: b64(Buffer.concat([Buffer.from([4]), unb64(pub.x!), unb64(pub.y!)])), privateKey: priv.d! };
}

/** An absolute address on the app's site for a path or an address, or the site's root for one on another site. */
function onSite(address: string, origin: string): string {
  const url = new URL(address, origin);
  return url.origin === new URL(origin).origin ? url.href : new URL('/', origin).href;
}

/**
 * The declarative message, which Safari shows by itself and the kit's worker shows everywhere else. `renotify` makes
 * Chrome sound again for a notification that replaces one with the same tag; Chrome refuses it without a tag, and it is
 * left out of a quiet one.
 */
export function webPushMessage(payload: WebPushPayload, options: Pick<WebPushOptions, 'origin' | 'icon'>): string {
  const notification: Record<string, unknown> = {
    title: payload.title,
    body: payload.body,
    navigate: onSite(payload.url ?? '/', options.origin),
  };
  if (payload.tag) notification.tag = payload.tag;
  if (payload.tag && !payload.quiet) notification.renotify = true;
  if (payload.quiet) notification.silent = true;
  if (options.icon) notification.icon = onSite(options.icon, options.origin);
  const message: Record<string, unknown> = { web_push: DECLARATIVE_PUSH, notification };
  if (payload.badge !== undefined) message.app_badge = payload.badge;
  return JSON.stringify(message);
}

/**
 * The message encrypted to one phone's keys, as RFC 8291 sets out: an ECDH secret between a key pair made for this one
 * message and the phone's key, combined with the phone's auth secret, gives the content key and nonce; the body is the
 * aes128gcm header (salt, record size, the message's public key) and one record ending in the 0x02 delimiter. Tests
 * pass the salt and the message's key to check the standard's own example.
 */
export function encryptFor(
  plaintext: Uint8Array,
  keys: WebPushSubscription['keys'],
  fixed: { salt?: Uint8Array; privateKey?: Uint8Array } = {},
): Uint8Array<ArrayBuffer> {
  const phoneKey = unb64(keys.p256dh);
  const auth = unb64(keys.auth);
  const salt = fixed.salt ?? randomBytes(16);
  const ecdh = createECDH('prime256v1');
  if (fixed.privateKey) ecdh.setPrivateKey(fixed.privateKey);
  else ecdh.generateKeys();
  const serverKey = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(phoneKey);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), phoneKey, serverKey]);
  const ikm = Buffer.from(hkdfSync('sha256', secret, auth, keyInfo, 32));
  const contentKey = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  const cipher = createCipheriv('aes-128-gcm', contentKey, nonce);
  const sealed = Buffer.concat([cipher.update(plaintext), cipher.update(Buffer.from([2])), cipher.final(), cipher.getAuthTag()]);
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096);
  return Buffer.concat([salt, recordSize, Buffer.from([serverKey.length]), serverKey, sealed]);
}

/**
 * Each push service takes a signed token for up to a day, and Apple asks for a new one no more often than once an
 * hour, so a token is made with twelve hours to run and kept for one.
 */
export const TOKEN_KEPT_MS = 60 * 60 * 1000;
export const TOKEN_LIFE_S = 12 * 60 * 60;
const tokens = new Map<string, { token: string; madeAt: number }>();

/** The signed token for one push service (its origin is the audience), an ES256 JWT naming the app's contact. */
export function signedToken(config: WebPushConfig, audience: string, nowMs: number): string {
  const kept = tokens.get(`${config.publicKey} ${audience}`);
  if (kept && nowMs - kept.madeAt < TOKEN_KEPT_MS) return kept.token;
  const pub = unb64(config.publicKey);
  const key = createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: config.privateKey, x: b64(pub.subarray(1, 33)), y: b64(pub.subarray(33)) },
    format: 'jwk',
  });
  const head = b64(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64(Buffer.from(JSON.stringify({ aud: audience, exp: Math.floor(nowMs / 1000) + TOKEN_LIFE_S, sub: config.contact })));
  const signature = sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  const token = `${head}.${body}.${b64(signature)}`;
  tokens.set(`${config.publicKey} ${audience}`, { token, madeAt: nowMs });
  return token;
}

/**
 * A push service's answer for one subscription. 404 and 410 say it will never work again, and so does Apple's 400
 * BadDeviceToken, its answer for an address it never issued (test/fixtures/web-push/apple-unknown.json), so each comes
 * back as gone for the app to remove. Anything else that is not a success is a failure, including Apple's 403
 * VapidPkHashMismatch, which says the app's key is not the one the phone subscribed with: fixing the key brings those
 * phones back, so they are not removed.
 */
export function outcomeOf(status: number, text = ''): 'sent' | 'gone' | 'failed' {
  if (status >= 200 && status < 300) return 'sent';
  if (status === 404 || status === 410) return 'gone';
  if (status === 400 && text.includes('"BadDeviceToken"')) return 'gone';
  return 'failed';
}

export type WebPushRequest = { endpoint: string; headers: Record<string, string>; body: Uint8Array<ArrayBuffer> };
export type WebPushResponse = { status: number; text: string };

/**
 * Whether an endpoint is at a browser's push service: Google's (Chrome, and the browsers built on it), Apple's
 * (Safari), Mozilla's (Firefox) or Microsoft's (Edge on Windows), over https on its usual port. The endpoint comes from
 * the page, so a server that sent to any address would POST wherever a signed-in caller pointed it, its own network
 * included; a route that keeps subscriptions refuses any other, and `sendWebPush` never sends to one.
 */
export function isPushService(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.port === '' && !url.username && !url.password && PUSH_SERVICE_HOST.test(url.hostname);
}
const PUSH_SERVICE_HOST = /^(fcm\.googleapis\.com|[a-z0-9-]+\.push\.apple\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)$/;

/** One POST to a push service, which never follows a redirect: the endpoint checked is the one sent to. */
export async function fetchPost(req: WebPushRequest, signal: AbortSignal): Promise<WebPushResponse> {
  const res = await fetch(req.endpoint, { method: 'POST', headers: req.headers, body: req.body, signal, redirect: 'error' });
  return { status: res.status, text: await res.text() };
}

export type WebPushResult = { sent: number; gone: string[]; failed: number };

export type WebPushDeps = {
  config: WebPushConfig | null;
  post: (req: WebPushRequest, signal: AbortSignal) => Promise<WebPushResponse>;
  now: () => number;
  /** How long one subscription's send may take before it counts as failed, so a stalled service never holds the rest. */
  timeoutMs: number;
};

export const defaultWebPushDeps = (): WebPushDeps => ({ config: webPushConfig(), post: fetchPost, now: Date.now, timeoutMs: 15_000 });

/** The Topic header for a tag: a push service keeps only the newest undelivered message with one topic. */
export function topicFor(tag: string): string {
  return createHash('sha256').update(tag).digest('base64url').slice(0, 32);
}

/** The endpoint shortened for a log line: enough to tell which service and which phone, never the whole address. */
const shortEndpoint = (endpoint: string) => `${endpoint.slice(0, 48)}…`;

/**
 * Send one notification to each subscription. Never throws for a subscription's failure: it is logged, and one the
 * push service calls gone comes back in `gone`. With no key pair configured it sends nothing. A success answer is
 * not proof the phone shows it: Apple's service has been seen answering one for phones that will never show anything,
 * which is why the page checks in at every start and the README has the app keep when it last did.
 */
export async function sendWebPush(
  subscriptions: WebPushSubscription[],
  payload: WebPushPayload,
  options: WebPushOptions,
  deps: WebPushDeps = defaultWebPushDeps(),
): Promise<WebPushResult> {
  const result: WebPushResult = { sent: 0, gone: [], failed: 0 };
  if (!(options.ttlSeconds >= 1)) throw new Error(`${LOG_PREFIX} ttlSeconds must be at least 1`);
  if (!deps.config || subscriptions.length === 0) return result;
  const config = deps.config;
  const message = Buffer.from(webPushMessage(payload, options));
  if (message.length > MAX_MESSAGE_BYTES) throw new Error(`${LOG_PREFIX} the message is ${message.length} bytes, over the ${MAX_MESSAGE_BYTES} a push service takes`);

  await Promise.all(
    subscriptions.map(async (subscription) => {
      const short = shortEndpoint(subscription.endpoint);
      if (!isPushService(subscription.endpoint)) {
        result.failed++;
        console.error(`${LOG_PREFIX} refused to send to ${short}: not a browser's push service`);
        return;
      }
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      // The race ends the wait even for a post that never reads the signal; the abort ends fetch's own connection.
      const late = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`no answer in ${deps.timeoutMs} ms`);
          controller.abort(error);
          reject(error);
        }, deps.timeoutMs);
      });
      try {
        const audience = new URL(subscription.endpoint).origin;
        const headers: Record<string, string> = {
          Authorization: `vapid t=${signedToken(config, audience, deps.now())}, k=${config.publicKey}`,
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: String(Math.floor(options.ttlSeconds)),
          // High asks for delivery now, even to a phone saving power; a quiet one can wait for the phone's next wake.
          Urgency: payload.quiet ? 'normal' : 'high',
        };
        if (payload.tag) headers.Topic = topicFor(payload.tag);
        const res = await Promise.race([deps.post({ endpoint: subscription.endpoint, headers, body: encryptFor(message, subscription.keys) }, controller.signal), late]);
        const outcome = outcomeOf(res.status, res.text);
        if (outcome === 'sent') result.sent++;
        else if (outcome === 'gone') {
          result.gone.push(subscription.endpoint);
          console.error(`${LOG_PREFIX} ${short} is gone (${res.status} ${res.text.slice(0, 200)})`);
        } else {
          result.failed++;
          console.error(`${LOG_PREFIX} refused (${res.status} ${res.text.slice(0, 200)}) for ${short}`);
        }
      } catch (err) {
        result.failed++;
        console.error(`${LOG_PREFIX} send failed for ${short}`, err);
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return result;
}
