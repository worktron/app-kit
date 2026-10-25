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
