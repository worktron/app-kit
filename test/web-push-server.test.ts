import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  encryptFor,
  isPushService,
  makeWebPushKeys,
  outcomeOf,
  sendWebPush,
  signedToken,
  topicFor,
  webPushConfig,
  webPushMessage,
  MAX_MESSAGE_BYTES,
  TOKEN_KEPT_MS,
  type WebPushConfig,
  type WebPushDeps,
  type WebPushRequest,
  type WebPushResponse,
  type WebPushSubscription,
} from '../web/push/server';

const unb64 = (text: string) => Buffer.from(text.replace(/\s+/g, ''), 'base64url');

const realError = console.error;
const logged: string[] = [];
beforeEach(() => {
  logged.length = 0;
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
});
afterEach(() => {
  console.error = realError;
});

// RFC 8291, section 5 and Appendix A: the standard's own example, every value as the RFC prints it.
const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcx aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  header: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8',
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs bI_0LpXMuGvnzQ',
};

/** The phone's side of RFC 8291: what a browser does with a body it receives, written from the standard's steps. */
function decrypt(body: Uint8Array, phonePrivate: Uint8Array, auth: Uint8Array): Buffer {
  const buffer = Buffer.from(body);
  const salt = buffer.subarray(0, 16);
  const keyLength = buffer[20]!;
  const serverKey = buffer.subarray(21, 21 + keyLength);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(phonePrivate);
  const phoneKey = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(serverKey);
  const ikm = Buffer.from(hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), phoneKey, serverKey]), 32));
  const key = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const record = buffer.subarray(21 + keyLength);
  const decipher = createDecipheriv('aes-128-gcm', key, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const padded = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  expect(padded[padded.length - 1]).toBe(2);
  return padded.subarray(0, padded.length - 1);
}

test("encryption gives RFC 8291's example body exactly, from its keys and salt", () => {
  const body = encryptFor(unb64(RFC.plaintext), { p256dh: RFC.uaPublic.replace(/\s+/g, ''), auth: RFC.auth }, { salt: unb64(RFC.salt), privateKey: unb64(RFC.asPrivate) });
  expect(Buffer.from(body).toString('base64url')).toBe(Buffer.concat([unb64(RFC.header), unb64(RFC.ciphertext)]).toString('base64url'));
  // The phone's side, written apart, reads the RFC's own body back.
  expect(decrypt(body, unb64(RFC.uaPrivate), unb64(RFC.auth)).toString()).toBe('When I grow up, I want to be a watermelon');
});

/** A phone: its key pair and auth secret, and the subscription its browser would give the page. */
function phone(endpoint = 'https://fcm.googleapis.com/fcm/send/abc123') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = Buffer.from('0123456789abcdef');
  const subscription: WebPushSubscription = { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  return { subscription, read: (body: Uint8Array) => decrypt(body, ecdh.getPrivateKey(), auth) };
}

/** Each test its own key pair, so the kept token of one is never another's. */
function config(): WebPushConfig {
  return { ...makeWebPushKeys(), contact: 'mailto:owner@example.com' };
}

const NOW = Date.UTC(2026, 10, 9, 12);
const ORIGIN = 'https://app.example.com';

function deps(answer: (req: WebPushRequest) => Promise<WebPushResponse>, overrides: Partial<WebPushDeps> = {}): WebPushDeps & { asked: WebPushRequest[] } {
  const asked: WebPushRequest[] = [];
  return {
    config: config(),
    post: (req) => {
      asked.push(req);
      return answer(req);
    },
    now: () => NOW,
    timeoutMs: 1_000,
    ...overrides,
    asked,
  };
}

test('what is sent decrypts on the phone to the declarative message', async () => {
  const one = phone();
  const d = deps(async () => ({ status: 201, text: '' }));
  const result = await sendWebPush([one.subscription], { title: 'Chore done', body: 'Sam fed the cat', url: '/chores/3' }, { origin: ORIGIN, ttlSeconds: 3600 }, d);
  expect(result).toEqual({ sent: 1, gone: [], failed: 0 });
  expect(JSON.parse(one.read(d.asked[0]!.body).toString())).toEqual({
    web_push: 8030,
    notification: { title: 'Chore done', body: 'Sam fed the cat', navigate: 'https://app.example.com/chores/3' },
  });
});

test("the request carries the token, the app's public key, the encoding, the TTL and high urgency", async () => {
  const d = deps(async () => ({ status: 201, text: '' }));
  await sendWebPush([phone().subscription], { title: 'T', body: 'B' }, { origin: ORIGIN, ttlSeconds: 90.7 }, d);
  const { headers, endpoint } = d.asked[0]!;
  expect(endpoint).toBe('https://fcm.googleapis.com/fcm/send/abc123');
  expect(headers['Content-Encoding']).toBe('aes128gcm');
  expect(headers['Content-Type']).toBe('application/octet-stream');
  expect(headers.TTL).toBe('90');
  expect(headers.Urgency).toBe('high');
  expect(headers.Topic).toBeUndefined();
  const [, token, key] = headers.Authorization!.match(/^vapid t=([^,]+), k=(.+)$/)!;
  expect(key).toBe(d.config!.publicKey);

  const [head, body, signature] = token!.split('.');
  expect(JSON.parse(unb64(head!).toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
  expect(JSON.parse(unb64(body!).toString())).toEqual({ aud: 'https://fcm.googleapis.com', exp: NOW / 1000 + 12 * 3600, sub: 'mailto:owner@example.com' });
  const pub = unb64(key!);
  const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
  expect(verify('sha256', Buffer.from(`${head}.${body}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, unb64(signature!))).toBe(true);
});

test('a quiet notification is normal urgency, silent, and never renotifies', async () => {
  const one = phone();
  const d = deps(async () => ({ status: 201, text: '' }));
  await sendWebPush([one.subscription], { title: 'T', body: 'B', tag: 'chores', quiet: true }, { origin: ORIGIN, ttlSeconds: 60 }, d);
  expect(d.asked[0]!.headers.Urgency).toBe('normal');
  expect(JSON.parse(one.read(d.asked[0]!.body).toString()).notification).toEqual({ title: 'T', body: 'B', navigate: 'https://app.example.com/', tag: 'chores', silent: true });
});

test('a tag replaces the older notification with sound, and names the topic the push service collapses on', async () => {
  const message = JSON.parse(webPushMessage({ title: 'T', body: 'B', tag: 'more-time', badge: 2 }, { origin: ORIGIN, icon: '/icon-192.png' }));
  expect(message).toEqual({
    web_push: 8030,
    notification: { title: 'T', body: 'B', navigate: 'https://app.example.com/', tag: 'more-time', renotify: true, icon: 'https://app.example.com/icon-192.png' },
    app_badge: 2,
  });
  expect(topicFor('more-time')).toMatch(/^[A-Za-z0-9_-]{32}$/);
  expect(topicFor('more-time')).toBe(topicFor('more-time'));
  expect(topicFor('more-time')).not.toBe(topicFor('chores'));
});

test("a tap's page on another site is the app's root", () => {
  expect(JSON.parse(webPushMessage({ title: 'T', body: 'B', url: 'https://elsewhere.example.com/x' }, { origin: ORIGIN })).notification.navigate).toBe('https://app.example.com/');
  expect(JSON.parse(webPushMessage({ title: 'T', body: 'B', url: '//elsewhere.example.com/x' }, { origin: ORIGIN })).notification.navigate).toBe('https://app.example.com/');
  expect(JSON.parse(webPushMessage({ title: 'T', body: 'B', url: '/a?b=1#c' }, { origin: ORIGIN })).notification.navigate).toBe('https://app.example.com/a?b=1#c');
});

test('a token is kept for an hour for each push service, then made again', async () => {
  const c = config();
  const first = signedToken(c, 'https://web.push.apple.com', NOW);
  expect(signedToken(c, 'https://web.push.apple.com', NOW + TOKEN_KEPT_MS - 1)).toBe(first);
  expect(signedToken(c, 'https://fcm.googleapis.com', NOW)).not.toBe(first);
  expect(signedToken(c, 'https://web.push.apple.com', NOW + TOKEN_KEPT_MS)).not.toBe(first);
});

test('the outcome of each status', () => {
  expect([200, 201, 202].map((status) => outcomeOf(status))).toEqual(['sent', 'sent', 'sent']);
  expect([404, 410].map((status) => outcomeOf(status))).toEqual(['gone', 'gone']);
  expect([400, 403, 413, 429, 500, 503].map((status) => outcomeOf(status))).toEqual(['failed', 'failed', 'failed', 'failed', 'failed', 'failed']);
  expect(outcomeOf(400, '{"reason":"BadDeviceToken"}')).toBe('gone');
  expect(outcomeOf(403, '{"reason":"VapidPkHashMismatch"}')).toBe('failed');
});

type Recorded = { service: string; kind: string; synthetic?: boolean; request: string; status: number; text: string; outcome: 'sent' | 'gone' | 'failed' };
const recordedFolder = join(import.meta.dir, 'fixtures/web-push');
const recorded = readdirSync(recordedFolder)
  .filter((name) => name.endsWith('.json'))
  .map((name) => ({ name, ...(JSON.parse(readFileSync(join(recordedFolder, name), 'utf8')) as Recorded) }));

test('the recorded answers cover each push service, and only a success no service was recorded giving is synthetic', () => {
  expect(new Set(recorded.map((r) => r.service))).toEqual(new Set(['fcm.googleapis.com', 'web.push.apple.com', 'updates.push.services.mozilla.com']));
  for (const r of recorded.filter((r) => r.synthetic)) expect(r.outcome).toBe('sent');
});

for (const answer of recorded) {
  test(`${answer.service}, ${answer.kind}: ${answer.outcome}${answer.synthetic ? ' (synthetic)' : ''}`, async () => {
    const one = phone(`https://${answer.service}/made-up`);
    const d = deps(async () => ({ status: answer.status, text: answer.text }));
    const result = await sendWebPush([one.subscription], { title: 'T', body: 'B' }, { origin: ORIGIN, ttlSeconds: 60 }, d);
    expect(result).toEqual({ sent: answer.outcome === 'sent' ? 1 : 0, gone: answer.outcome === 'gone' ? [one.subscription.endpoint] : [], failed: answer.outcome === 'failed' ? 1 : 0 });
  });
}

test("Apple's key mismatch is a failure logged with its reason, never gone", async () => {
  // Not recorded: it needs a real subscription made with another key. The reason is the one Apple's documentation
  // names, in the shape apple-bad-token.json shows its refusals take.
  const d = deps(async () => ({ status: 403, text: '{"reason":"VapidPkHashMismatch"}' }));
  const result = await sendWebPush([phone('https://web.push.apple.com/QH').subscription], { title: 'T', body: 'B' }, { origin: ORIGIN, ttlSeconds: 60 }, d);
  expect(result).toEqual({ sent: 0, gone: [], failed: 1 });
  expect(logged.join('\n')).toContain('VapidPkHashMismatch');
});

test('one subscription failing, gone or stalled never holds or spoils the rest', async () => {
  const sent = phone('https://fcm.googleapis.com/fcm/send/ok');
  const gone = phone('https://fcm.googleapis.com/fcm/send/gone');
  const stalled = phone('https://fcm.googleapis.com/fcm/send/stalled');
  const broken = phone('https://fcm.googleapis.com/fcm/send/broken');
  const d = deps(async (req) => {
    if (req.endpoint.endsWith('/gone')) return { status: 410, text: 'push subscription has unsubscribed or expired.' };
    if (req.endpoint.endsWith('/stalled')) return new Promise<WebPushResponse>(() => {});
    if (req.endpoint.endsWith('/broken')) throw new Error('connection reset');
    return { status: 201, text: '' };
  }, { timeoutMs: 20 });
  const result = await sendWebPush([sent, gone, stalled, broken].map((p) => p.subscription), { title: 'T', body: 'B' }, { origin: ORIGIN, ttlSeconds: 60 }, d);
  expect(result).toEqual({ sent: 1, gone: ['https://fcm.googleapis.com/fcm/send/gone'], failed: 2 });
  // The whole endpoint is never logged.
  expect(logged.join('\n')).not.toContain('/fcm/send/gone ');
});

test('with no key pair it sends nothing', async () => {
  const d = deps(async () => ({ status: 201, text: '' }), { config: null });
  expect(await sendWebPush([phone().subscription], { title: 'T', body: 'B' }, { origin: ORIGIN, ttlSeconds: 60 }, d)).toEqual({ sent: 0, gone: [], failed: 0 });
  expect(d.asked).toEqual([]);
});

test('a TTL under one second and a message too large for a push service are refused', async () => {
  const d = deps(async () => ({ status: 201, text: '' }));
  await expect(sendWebPush([phone().subscription], { title: 'T', body: 'B' }, { origin: ORIGIN, ttlSeconds: 0 }, d)).rejects.toThrow('ttlSeconds');
  await expect(sendWebPush([phone().subscription], { title: 'T', body: 'x'.repeat(MAX_MESSAGE_BYTES) }, { origin: ORIGIN, ttlSeconds: 60 }, d)).rejects.toThrow('bytes');
  expect(d.asked).toEqual([]);
});

test('the key pair comes from the environment, and a wrong part says which', () => {
  const keys = makeWebPushKeys();
  const env = { WEB_PUSH_PUBLIC_KEY: keys.publicKey, WEB_PUSH_PRIVATE_KEY: keys.privateKey, WEB_PUSH_CONTACT: 'https://app.example.com/contact' };
  expect(webPushConfig(env)).toEqual({ publicKey: keys.publicKey, privateKey: keys.privateKey, contact: 'https://app.example.com/contact' });
  expect(webPushConfig({ ...env, WEB_PUSH_CONTACT: undefined })).toBeNull();
  expect(() => webPushConfig({ ...env, WEB_PUSH_PUBLIC_KEY: keys.privateKey })).toThrow('WEB_PUSH_PUBLIC_KEY');
  expect(() => webPushConfig({ ...env, WEB_PUSH_PRIVATE_KEY: keys.publicKey })).toThrow('WEB_PUSH_PRIVATE_KEY');
  expect(() => webPushConfig({ ...env, WEB_PUSH_CONTACT: 'owner@example.com' })).toThrow('WEB_PUSH_CONTACT');
  expect(() => webPushConfig({ ...env, WEB_PUSH_CONTACT: 'http://app.example.com' })).toThrow('mailto: or https:');
  expect(() => webPushConfig({ ...env, WEB_PUSH_CONTACT: 'mailto:owner@localhost' })).toThrow('localhost');
  expect(() => webPushConfig({ ...env, WEB_PUSH_CONTACT: 'https://localhost/contact' })).toThrow('localhost');
});

test("only a browser's push service is sent to, so a caller's own address never gets the server's request", async () => {
  for (const endpoint of [
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://web.push.apple.com/QH',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
    'https://wns2-by3p.notify.windows.com/w/?token=x',
  ])
    expect(isPushService(endpoint)).toBe(true);
  for (const endpoint of [
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    // A name before the host, joined here so the line names no address.
    ['https://someone', 'fcm.googleapis.com/fcm/send/abc'].join('@'),
    'https://fcm.googleapis.com.example.com/x',
    'https://push.apple.com.example.com/x',
    'https://10.0.0.5/push',
    'https://localhost/push',
    'not an address',
  ])
    expect(isPushService(endpoint)).toBe(false);

  const d = deps(async () => ({ status: 201, text: '' }));
  const inside = phone('https://internal.example.com/admin');
  const result = await sendWebPush([inside.subscription, phone().subscription], { title: 'T', body: 'B' }, { origin: ORIGIN, ttlSeconds: 60 }, d);
  expect(result).toEqual({ sent: 1, gone: [], failed: 1 });
  expect(d.asked.map((r) => r.endpoint)).toEqual(['https://fcm.googleapis.com/fcm/send/abc123']);
  expect(logged.join('\n')).toContain("not a browser's push service");
});
