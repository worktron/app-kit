/** The part of Clerk's session token the kit reads: the token itself, and its claims once Clerk has decoded it. */
export interface HeldToken {
  getRawString(): string;
  jwt?: { claims: { exp?: number } };
}

/** How long a token must still be good for to be sent: a request takes a moment to reach the server. */
export const TOKEN_MARGIN_MS = 5_000;

/**
 * The token Clerk last handed out, while it is still good for TOKEN_MARGIN_MS more, else null. Clerk refreshes it
 * about every 50 seconds while the page runs, but a phone pauses a page in the background, so a page just brought
 * back can hold one that has expired; Clerk's own cache checks the expiry against this device's clock the same way.
 */
export function tokenStillGood(token: HeldToken | null | undefined, now = Date.now()): string | null {
  const expires = token?.jwt?.claims.exp;
  if (!token || expires === undefined || expires * 1000 - TOKEN_MARGIN_MS <= now) return null;
  return token.getRawString() || null;
}
