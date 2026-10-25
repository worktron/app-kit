/*
 * The server half of iPhone notifications: sending through Apple's push service. Each send is an HTTP/2 POST to Apple,
 * one per device token, signed with a provider token, a short JWT made from the developer account's push key (a .p8
 * file from Apple's developer site). Where the device tokens are kept is the app's: it passes them in, and removes the
 * ones the result says Apple has retired. Node's http2 and crypto only, so any server on Bun or Node imports it.
 *
 *   APPLE_PUSH_KEY_ID    the key's id, shown next to it on Apple's site
 *   APPLE_PUSH_TEAM_ID   the developer team's id
 *   APPLE_PUSH_KEY       the .p8 file's contents (PEM; \n escapes allowed)
 */
import { connect } from 'node:http2';
import { appleToken } from '../apple-token';
import { ADDRESS_KEY } from './names';

export type AppleEnvironment = 'development' | 'production';
export type AppleDevice = { token: string; environment: AppleEnvironment };
export type AppleConfig = { keyId: string; teamId: string; key: string };

/** What the phone shows, and the page a tap opens. */
export type ApplePayload = {
  title: string;
  body: string;
  /** The page a tap opens: a path, or an address on the app's site. Defaults to '/'. */
  url?: string;
  /** A newer notification with the same tag replaces the older one instead of stacking. */
  tag?: string;
};

export const APPLE_HOSTS: Record<AppleEnvironment, string> = {
  development: 'api.sandbox.push.apple.com',
  production: 'api.push.apple.com',
};

/** The push key from the environment, or null when any part is missing, which sends nothing. */
export function applePushConfig(env: Record<string, string | undefined> = process.env): AppleConfig | null {
  const keyId = env.APPLE_PUSH_KEY_ID;
  const teamId = env.APPLE_PUSH_TEAM_ID;
  const key = env.APPLE_PUSH_KEY;
  if (!keyId || !teamId || !key) return null;
  return { keyId, teamId, key: key.replace(/\\n/g, '\n') };
}

/**
 * Apple takes a provider token for an hour and refuses a new one more often than every twenty minutes, so a token is
 * kept for fifty.
 */
export const PROVIDER_TOKEN_LIFE_MS = 50 * 60 * 1000;
let cached: { token: string; keyId: string; madeAt: number } | null = null;

/** The provider token: an ES256 JWT naming the key and team. */
export function providerToken(config: AppleConfig, nowMs: number): string {
  if (cached && cached.keyId === config.keyId && nowMs - cached.madeAt < PROVIDER_TOKEN_LIFE_MS) return cached.token;
  const token = appleToken(config.keyId, config.key, { iss: config.teamId, iat: Math.floor(nowMs / 1000) });
  cached = { token, keyId: config.keyId, madeAt: nowMs };
  return token;
}

/**
 * Apple's payload: the alert, and the page a tap opens as a path, query and fragment. The page opens only a page of
 * its own site, so the server's own address is left out, and a debug build whose page runs on a dev server opens the
 * same path there.
 */
export function applePayload(payload: ApplePayload): string {
  const url = new URL(payload.url ?? '/', 'https://app.example.com');
  return JSON.stringify({
    aps: { alert: { title: payload.title, body: payload.body }, sound: 'default' },
    [ADDRESS_KEY]: `${url.pathname}${url.search}${url.hash}`,
  });
}

/**
 * Apple's answer for one device. A token Apple calls unregistered, bad or for another app will never work again, so
 * it comes back as gone for the app to remove.
 */
export function outcomeOf(status: number, reason?: string): 'sent' | 'gone' | 'failed' {
  if (status === 200) return 'sent';
  if (status === 410) return 'gone';
  if (status === 400 && (reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic')) return 'gone';
  return 'failed';
}

export type AppleRequest = { host: string; path: string; headers: Record<string, string>; body: string };
export type AppleResponse = { status: number; reason?: string };

/** One POST to Apple, which speaks HTTP/2 only. */
export function http2Post(req: AppleRequest): Promise<AppleResponse> {
  return new Promise((resolve, reject) => {
    const client = connect(`https://${req.host}`);
    client.on('error', reject);
    // A connection that stalls is closed, so a send that `sendToApple` gave up on leaves no socket behind.
    client.setTimeout(30_000, () => client.destroy(new Error('the connection to Apple stalled')));
    const stream = client.request({ ':method': 'POST', ':path': req.path, ...req.headers });
    let status = 0;
    let data = '';
    stream.on('response', (headers) => {
      status = Number(headers[':status']);
    });
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      data += chunk;
    });
    stream.on('end', () => {
      client.close();
      let reason: string | undefined;
      try {
        reason = (JSON.parse(data) as { reason?: string }).reason;
      } catch {
        // 200 has no body
      }
      resolve({ status, reason });
    });
    stream.on('error', (err) => {
      client.close();
      reject(err);
    });
    stream.end(req.body);
  });
}

export type AppleResult = { sent: number; gone: string[]; failed: number };

export type AppleDeps = {
  config: AppleConfig | null;
  post: (req: AppleRequest) => Promise<AppleResponse>;
  now: () => number;
  /** How long one device's send may take before it counts as failed, so a stalled connection never holds the rest. */
  timeoutMs: number;
};

export const defaultAppleDeps = (): AppleDeps => ({ config: applePushConfig(), post: http2Post, now: Date.now, timeoutMs: 15_000 });

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Apple did not answer in ${ms} ms`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * Send one payload to each device. `topic` is the iPhone app's bundle id: Apple delivers only to the app it names.
 * Never throws for a device's failure: it is logged, and a token Apple has retired comes back in `gone`. With no push
 * key configured it sends nothing.
 */
export async function sendToApple(
  devices: AppleDevice[],
  payload: ApplePayload,
  opts: { topic: string; ttlSeconds: number },
  deps: AppleDeps = defaultAppleDeps(),
): Promise<AppleResult> {
  const result: AppleResult = { sent: 0, gone: [], failed: 0 };
  if (!deps.config || devices.length === 0) return result;
  const config = deps.config;
  const body = applePayload(payload);

  await Promise.all(
    devices.map(async (device) => {
      const headers: Record<string, string> = {
        authorization: `bearer ${providerToken(config, deps.now())}`,
        'apns-topic': opts.topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': String(Math.floor(deps.now() / 1000) + opts.ttlSeconds),
      };
      if (payload.tag) headers['apns-collapse-id'] = payload.tag.slice(0, 64);
      const shortToken = `${device.token.slice(0, 12)}…`;
      try {
        const res = await within(deps.post({ host: APPLE_HOSTS[device.environment], path: `/3/device/${device.token}`, headers, body }), deps.timeoutMs);
        const outcome = outcomeOf(res.status, res.reason);
        if (outcome === 'sent') result.sent++;
        else if (outcome === 'gone') {
          result.gone.push(device.token);
          // A token Apple calls bad can be one sent to the wrong service: a release build signed for development says
          // production. Naming the service makes that visible where the device would otherwise just disappear.
          console.error(`[iphone-notifications] Apple retired ${shortToken} (${res.status} ${res.reason ?? ''}) on its ${device.environment} service`);
        }
        else {
          result.failed++;
          console.error(`[iphone-notifications] Apple refused (${res.status} ${res.reason ?? ''}) for ${shortToken}`);
        }
      } catch (err) {
        result.failed++;
        console.error(`[iphone-notifications] Apple send failed for ${shortToken}`, err);
      }
    }),
  );
  return result;
}
