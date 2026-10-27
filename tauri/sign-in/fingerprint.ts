import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/*
 * The window's secret and its fingerprint, which the window and the server both compute here. The window keeps the
 * secret and sends only the fingerprint to the browser; the server turns a code made for that fingerprint into a ticket
 * only for a caller presenting the secret, so a code caught off the app's link, which any app can claim, signs nobody
 * in. Hashed here rather than by the browser's own hashing, which only answers later and would make the window's
 * click wait on it.
 */

/** A secret, a code or a fingerprint: 32 bytes in hex, which the shell's filters take as a ticket and as a nonce. */
export const HEX_32 = /^[0-9a-f]{64}$/;

/** 32 random bytes in hex: the window's secret, or the server's one-time code. */
export function randomHex(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

/** The fingerprint of the window's secret: its SHA-256, in hex. */
export function fingerprint(secret: string): string {
  return bytesToHex(sha256(utf8ToBytes(secret)));
}
