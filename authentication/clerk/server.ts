import type { Context } from 'hono';
import { createClerkClient } from '@clerk/backend';
import { getAuth } from '@clerk/hono';
import type { Caller } from '../agent-keys';

/**
 * A user's verified email addresses as Clerk holds them, for `ownerCheckByEmail` from `app-kit/authentication/owner`.
 * An address Clerk has not verified is left out, so nobody becomes the owner by adding the owner's address unchecked.
 */
export function clerkVerifiedEmails(options: { secretKey: string | undefined }): (userId: string) => Promise<string[]> {
  const clerk = createClerkClient({ secretKey: options.secretKey });
  return async (userId) => {
    const user = await clerk.users.getUser(userId);
    return user.emailAddresses.filter((e) => e.verification?.status === 'verified').map((e) => e.emailAddress);
  };
}

/**
 * Clerk's reasons, on a key it did not accept, that mean Clerk could not answer rather than that the key is no good:
 * it could not be reached or answered with an error, or the server's own secret key was refused.
 */
const COULD_NOT_CHECK = new Set(['unexpected-error', 'secret-key-invalid']);

/**
 * The request's caller as Clerk reads it, for `requireCaller` from `app-kit/authentication/agent-keys`. Mount `clerkMiddleware()` from
 * `@clerk/hono` in front. A session is a person signed in; a key is one of a person's API keys, made in Clerk's own API
 * keys screen; a key owned by an organization, and Clerk's other kinds of token, are nobody.
 */
export function clerkCaller(c: Context): Caller {
  const auth = getAuth(c, { acceptsToken: ['session_token', 'api_key'] });
  if (auth.tokenType === 'session_token') {
    return auth.isAuthenticated ? { kind: 'session', personId: auth.userId } : { kind: 'nobody', reason: null };
  }
  if (auth.tokenType === 'api_key') {
    if (!auth.isAuthenticated) {
      const reason = String(auth.debug().reason ?? 'unknown');
      return COULD_NOT_CHECK.has(reason)
        ? { kind: 'unchecked', reason: `Clerk could not check the key (${reason})` }
        : { kind: 'nobody', reason: `the key is revoked, expired or unknown (${reason})` };
    }
    if (!auth.userId) return { kind: 'nobody', reason: `key ${auth.name} (${auth.id}) belongs to an organization, not a person` };
    return { kind: 'key', personId: auth.userId, keyId: auth.id, keyName: auth.name };
  }
  return { kind: 'nobody', reason: 'the token is neither a session nor a key' };
}
