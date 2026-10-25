import type { Context, MiddlewareHandler } from 'hono';

/** Whether a signed-in user is the one person the app serves. */
export type OwnerCheck = (userId: string) => Promise<boolean>;

/** The Hono environment behind the owner check: the owner's user id, set on every request it lets through. */
export type OwnerEnv = { Variables: { userId: string } };

/**
 * The owner is whoever has the owner's email address, verified, in any case. `verifiedEmailsOf` reads a user's verified
 * addresses from the sign-in provider: `clerkVerifiedEmails` from `app-kit/authentication/clerk/server`. Each user's
 * answer, yes or no, is kept for the life of the process, and requests that arrive together share one lookup; a lookup
 * that fails is not kept, so the next request asks again.
 */
export function ownerCheckByEmail(ownerEmail: string, verifiedEmailsOf: (userId: string) => Promise<string[]>): OwnerCheck {
  const owner = ownerEmail.trim().toLowerCase();
  const known = new Map<string, Promise<boolean>>();
  return (userId) => {
    const cached = known.get(userId);
    if (cached) return cached;
    const answer = verifiedEmailsOf(userId).then((emails) => emails.some((email) => email.toLowerCase() === owner));
    known.set(userId, answer);
    answer.catch(() => known.delete(userId));
    return answer;
  };
}

export interface RequireOwnerOptions {
  /** The signed-in user's id, or null when nobody is signed in: with Clerk, `(c) => getAuth(c).userId ?? null`. */
  identify: (c: Context) => string | null;
  isOwner: OwnerCheck;
  /** The app's name, as the refusal says it: "This account is not allowed to use <appName>". */
  appName: string;
  /** Where each refusal of a signed-in user goes. `console.log` by default. */
  log?: (line: string) => void;
}

/**
 * Lets a request through only when it comes from the owner, and sets their id as `userId` on the context: 401 when
 * nobody is signed in, 403 when someone else is.
 */
export function requireOwner(options: RequireOwnerOptions): MiddlewareHandler<OwnerEnv> {
  const log = options.log ?? console.log;
  return async (c, next) => {
    const userId = options.identify(c);
    if (!userId) return c.json({ error: 'Sign in first' }, 401);
    if (!(await options.isOwner(userId))) {
      log(`[auth] refused ${c.req.method} ${c.req.path} for user ${userId}: not the owner`);
      return c.json({ error: `This account is not allowed to use ${options.appName}` }, 403);
    }
    c.set('userId', userId);
    await next();
  };
}
