/*
 * The short ES256 token Apple's APIs take: a JWT naming one of the developer account's keys (a .p8 file from Apple's
 * developer site) and signed with it. The push service takes one naming the team (iphone-notifications/server.ts);
 * App Store Connect takes one naming the key's issuer, its audience and an expiry (testflight/app-store-connect.ts).
 * Node's crypto only, so any server on Bun or Node imports it.
 */
import { createPrivateKey, sign } from 'node:crypto';

const b64url = (data: string | Buffer) => Buffer.from(data).toString('base64url');

/**
 * An ES256 JWT with the key id in its header and `claims` as its body, signed with `key`, the .p8 file's PEM text.
 * App Store Connect's documentation also names the type in the header; the push service's does not.
 */
export function appleToken(keyId: string, key: string, claims: Record<string, unknown>, header: { typ?: 'JWT' } = {}): string {
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, ...header }));
  const body = b64url(JSON.stringify(claims));
  const signature = sign('sha256', Buffer.from(`${head}.${body}`), {
    key: createPrivateKey(key),
    dsaEncoding: 'ieee-p1363',
  });
  return `${head}.${body}.${b64url(signature)}`;
}
