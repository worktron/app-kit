import { afterEach, beforeEach, expect, test } from 'bun:test';
import { generateKeyPairSync, verify } from 'node:crypto';
import {
  applePayload,
  applePushConfig,
  outcomeOf,
  providerToken,
  sendToApple,
  PROVIDER_TOKEN_LIFE_MS,
  type AppleConfig,
  type AppleDeps,
  type AppleRequest,
  type AppleResponse,
} from '../tauri/iphone-notifications/server';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
let keyNumber = 0;
/** Each test its own key id, so the kept provider token of one is never another's. */
const config = (): AppleConfig => ({ keyId: `KEY${++keyNumber}`, teamId: 'TEAM123', key: KEY });

const realError = console.error;
beforeEach(() => {
  console.error = () => {};
});
afterEach(() => {
  console.error = realError;
});

const NOW = Date.UTC(2026, 9, 25, 12);

function deps(answer: (req: AppleRequest) => Promise<AppleResponse>, overrides: Partial<AppleDeps> = {}): AppleDeps & { asked: AppleRequest[] } {
  const asked: AppleRequest[] = [];
  return {
    config: config(),
    post: (req) => {
      asked.push(req);
      return answer(req);
    },
    now: () => NOW,
    timeoutMs: 15_000,
    asked,
    ...overrides,
  };
}

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString());

test('the provider token names the key and team and verifies with the key’s public half', () => {
  const c = config();
  const [header, claims, signature] = providerToken(c, NOW).split('.');
  expect(decode(header)).toEqual({ alg: 'ES256', kid: c.keyId });
  expect(decode(claims)).toEqual({ iss: 'TEAM123', iat: NOW / 1000 });
  const valid = verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'));
  expect(valid).toBe(true);
});

test('a provider token is kept for fifty minutes, since Apple refuses new ones more often than every twenty', () => {
  const c = config();
  const first = providerToken(c, NOW);
  expect(providerToken(c, NOW + PROVIDER_TOKEN_LIFE_MS - 1)).toBe(first);
  expect(providerToken(c, NOW + PROVIDER_TOKEN_LIFE_MS)).not.toBe(first);
  expect(PROVIDER_TOKEN_LIFE_MS).toBe(50 * 60 * 1000);
});

test('the payload carries the alert and the page as a path, query and fragment', () => {
  expect(JSON.parse(applePayload({ title: 'New alert', body: 'Two matches', url: 'https://app.example.com/alerts/3?x=1#top' }))).toEqual({
    aps: { alert: { title: 'New alert', body: 'Two matches' }, sound: 'default' },
    url: '/alerts/3?x=1#top',
  });
  expect(JSON.parse(applePayload({ title: 't', body: 'b', url: '/digest' })).url).toBe('/digest');
  expect(JSON.parse(applePayload({ title: 't', body: 'b' })).url).toBe('/');
});

test('a payload with no badge and no quiet sends the bytes it always sent', () => {
  expect(applePayload({ title: 'New alert', body: 'Two matches', url: '/alerts/3?x=1#top', tag: 'alert-3' })).toBe(
    '{"aps":{"alert":{"title":"New alert","body":"Two matches"},"sound":"default"},"url":"/alerts/3?x=1#top"}',
  );
  expect(applePayload({ title: 't', body: 'b' })).toBe('{"aps":{"alert":{"title":"t","body":"b"},"sound":"default"},"url":"/"}');
  expect(applePayload({ title: 't', body: 'b', quiet: false })).toBe(applePayload({ title: 't', body: 'b' }));
});

test('a quiet alert is passive and has no sound', () => {
  expect(JSON.parse(applePayload({ title: 't', body: 'b', url: '/digest', quiet: true }))).toEqual({
    aps: { alert: { title: 't', body: 'b' }, 'interruption-level': 'passive' },
    url: '/digest',
  });
});

test('a badge on an alert sets the icon’s number beside the alert and its sound', () => {
  expect(JSON.parse(applePayload({ title: 't', body: 'b', url: '/digest', badge: 3 }))).toEqual({
    aps: { alert: { title: 't', body: 'b' }, sound: 'default', badge: 3 },
    url: '/digest',
  });
  expect(JSON.parse(applePayload({ title: 't', body: 'b', quiet: true, badge: 3 }))).toEqual({
    aps: { alert: { title: 't', body: 'b' }, 'interruption-level': 'passive', badge: 3 },
    url: '/',
  });
});

test('a badge with no title or body sends only the badge, with no alert, sound or page', () => {
  expect(applePayload({ badge: 4 })).toBe('{"aps":{"badge":4}}');
  expect(applePayload({ badge: 0 })).toBe('{"aps":{"badge":0}}');
});

test('a badge-only payload keeps a page it was given', () => {
  expect(JSON.parse(applePayload({ badge: 4, url: '/inbox' }))).toEqual({ aps: { badge: 4 }, url: '/inbox' });
});

test('a badge-only send stays an alert push at priority 10 and never asks to wake the app', async () => {
  const d = deps(async () => ({ status: 200 }));
  const result = await sendToApple([{ token: 'phone', environment: 'production' }], { badge: 2 }, { topic: 'com.example.app', ttlSeconds: 3600 }, d);
  expect(result).toEqual({ sent: 1, gone: [], failed: 0 });
  expect(d.asked[0].headers['apns-push-type']).toBe('alert');
  expect(d.asked[0].headers['apns-priority']).toBe('10');
  expect(d.asked[0].body).toBe('{"aps":{"badge":2}}');
});

test('half an alert is refused by the type, and so is a payload with nothing to show', () => {
  // @ts-expect-error a title needs its body
  applePayload({ title: 't', badge: 1 });
  // @ts-expect-error a body needs its title
  applePayload({ body: 'b', badge: 1 });
  // @ts-expect-error quiet describes an alert, and this has none
  applePayload({ badge: 1, quiet: true });
  // @ts-expect-error no alert and no badge is nothing to send
  applePayload({ url: '/digest' });
});

test('Apple’s answers sort into sent, gone and failed', () => {
  expect(outcomeOf(200)).toBe('sent');
  expect(outcomeOf(410, 'Unregistered')).toBe('gone');
  expect(outcomeOf(400, 'BadDeviceToken')).toBe('gone');
  expect(outcomeOf(400, 'DeviceTokenNotForTopic')).toBe('gone');
  expect(outcomeOf(400, 'BadCollapseId')).toBe('failed');
  expect(outcomeOf(403, 'InvalidProviderToken')).toBe('failed');
  expect(outcomeOf(429, 'TooManyRequests')).toBe('failed');
  expect(outcomeOf(500)).toBe('failed');
});

test('each device gets one request to its own service, naming the app, and the tally says what happened', async () => {
  const answers: Record<string, AppleResponse> = { sent: { status: 200 }, gone: { status: 410, reason: 'Unregistered' }, refused: { status: 403, reason: 'InvalidProviderToken' } };
  const d = deps(async (req) => {
    const token = req.path.split('/').pop()!;
    if (token === 'thrown') throw new Error('connection reset');
    return answers[token];
  });
  const result = await sendToApple(
    [
      { token: 'sent', environment: 'production' },
      { token: 'gone', environment: 'development' },
      { token: 'refused', environment: 'production' },
      { token: 'thrown', environment: 'production' },
    ],
    { title: 't', body: 'b', url: '/alerts/1', tag: 'alert-1' },
    { topic: 'com.example.app', ttlSeconds: 3600 },
    d,
  );
  expect(result).toEqual({ sent: 1, gone: ['gone'], failed: 2 });
  const sent = d.asked.find((r) => r.path === '/3/device/sent')!;
  expect(sent.host).toBe('api.push.apple.com');
  expect(d.asked.find((r) => r.path === '/3/device/gone')!.host).toBe('api.sandbox.push.apple.com');
  expect(sent.headers).toMatchObject({
    'apns-topic': 'com.example.app',
    'apns-push-type': 'alert',
    'apns-priority': '10',
    'apns-expiration': String(NOW / 1000 + 3600),
    'apns-collapse-id': 'alert-1',
  });
  expect(sent.headers.authorization).toStartWith('bearer ');
  expect(JSON.parse(sent.body).url).toBe('/alerts/1');
});

test('a device whose send never answers counts as failed, and the others still go', async () => {
  const d = deps((req) => (req.path.endsWith('/stalled') ? new Promise(() => {}) : Promise.resolve({ status: 200 })), { timeoutMs: 5 });
  const result = await sendToApple(
    [
      { token: 'stalled', environment: 'production' },
      { token: 'fine', environment: 'production' },
    ],
    { title: 't', body: 'b' },
    { topic: 'com.example.app', ttlSeconds: 60 },
    d,
  );
  expect(result).toEqual({ sent: 1, gone: [], failed: 1 });
});

test('with no push key configured nothing is sent', async () => {
  expect(applePushConfig({ APPLE_PUSH_KEY_ID: 'K', APPLE_PUSH_TEAM_ID: 'T' })).toBeNull();
  expect(applePushConfig({ APPLE_PUSH_KEY_ID: 'K', APPLE_PUSH_TEAM_ID: 'T', APPLE_PUSH_KEY: 'a\\nb' })).toEqual({ keyId: 'K', teamId: 'T', key: 'a\nb' });
  const d = deps(async () => ({ status: 200 }), { config: null });
  expect(await sendToApple([{ token: 'x', environment: 'production' }], { title: 't', body: 'b' }, { topic: 'com.example.app', ttlSeconds: 60 }, d)).toEqual({
    sent: 0,
    gone: [],
    failed: 0,
  });
  expect(d.asked).toEqual([]);
});

test('a keep list is a silent update: content-available alone in aps, the list and when it was sent', () => {
  expect(applePayload({ keep: ['thread-1', 'thread-2'] }, NOW)).toBe(`{"aps":{"content-available":1},"keep":["thread-1","thread-2"],"sent":${NOW}}`);
  expect(JSON.parse(applePayload({ keep: [] }, NOW))).toEqual({ aps: { 'content-available': 1 }, keep: [], sent: NOW });
});

test('an alert carries when it was sent and the tags it covers; a badge alone carries neither', () => {
  expect(JSON.parse(applePayload({ title: 't', body: 'b', url: '/digest', tag: 'summary', covers: ['thread-1', 'thread-2'] }, NOW))).toEqual({
    aps: { alert: { title: 't', body: 'b' }, sound: 'default' },
    url: '/digest',
    sent: NOW,
    covers: ['thread-1', 'thread-2'],
  });
  expect(applePayload({ badge: 2 }, NOW)).toBe('{"aps":{"badge":2}}');
});

test('a keep list goes as a background push at priority 5, with no collapse id, alert, badge or sound', async () => {
  const d = deps(async () => ({ status: 200 }));
  const result = await sendToApple([{ token: 'phone', environment: 'production' }], { keep: ['thread-1'] }, { topic: 'com.example.app', ttlSeconds: 3600 }, d);
  expect(result).toEqual({ sent: 1, gone: [], failed: 0 });
  const { headers, body } = d.asked[0];
  expect(headers).toMatchObject({ 'apns-topic': 'com.example.app', 'apns-push-type': 'background', 'apns-priority': '5', 'apns-expiration': String(NOW / 1000 + 3600) });
  expect(headers['apns-collapse-id']).toBeUndefined();
  const aps = JSON.parse(body).aps;
  expect(aps).toEqual({ 'content-available': 1 });
});

test('every alert sendToApple sends carries the time it was sent', async () => {
  const d = deps(async () => ({ status: 200 }));
  await sendToApple([{ token: 'phone', environment: 'production' }], { title: 't', body: 'b', tag: 'thread-1' }, { topic: 'com.example.app', ttlSeconds: 60 }, d);
  expect(JSON.parse(d.asked[0].body).sent).toBe(NOW);
  expect(d.asked[0].headers['apns-push-type']).toBe('alert');
});

test('a keep list takes nothing an alert has, and a badge alone takes no covers', () => {
  // @ts-expect-error a keep list shows nothing
  applePayload({ keep: ['a'], title: 't', body: 'b' });
  // @ts-expect-error a keep list leaves the icon alone
  applePayload({ keep: ['a'], badge: 1 });
  // @ts-expect-error a keep list replaces nothing, so it has no tag
  applePayload({ keep: ['a'], tag: 'x' });
  // @ts-expect-error a badge alone is no notification, so it covers nothing
  applePayload({ badge: 1, covers: ['a'] });
});
