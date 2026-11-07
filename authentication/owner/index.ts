import type { Context, MiddlewareHandler } from 'hono';

/** Whether a signed-in user is the one person the app serves, or one of the people it lets in. */
export type OwnerCheck = (userId: string) => Promise<boolean>;

/** The Hono environment behind the owner check: the owner's user id, set on every request it lets through. */
export type OwnerEnv = { Variables: { userId: string } };

/** The Hono environment behind the invited check: the person's user id, set on every request it lets through. */
export type InvitedEnv = OwnerEnv;

/**
 * The owner is whoever has the owner's email address, verified, in any case. `verifiedEmailsOf` reads a user's verified
 * addresses from the sign-in provider: `clerkVerifiedEmails` from `app-kit/authentication/clerk/server`. Each user's
 * answer, yes or no, is kept for the life of the process, and requests that arrive together share one lookup; a lookup
 * that fails is not kept, so the next request asks again.
 */
export function ownerCheckByEmail(ownerEmail: string, verifiedEmailsOf: (userId: string) => Promise<string[]>): OwnerCheck {
  const owner = ownerEmail.trim().toLowerCase();
  return keptPerUser((userId) => verifiedEmailsOf(userId).then((emails) => emails.some((email) => email.toLowerCase() === owner)));
}

/**
 * Who is invited: the addresses as a list, or a function that reads them, such as `clerkAllowlist` from
 * `app-kit/authentication/clerk/server`. An entry `*@example.com` invites every address at example.com, and no other
 * domain, its subdomains included; any other entry is one address, in any case. An entry that is neither, such as a
 * phone number, invites nobody.
 */
export type Invited = readonly string[] | (() => Promise<readonly string[]>);

/** Whether any of the addresses is invited by the entries, as `Invited` says. */
export function isInvited(emails: readonly string[], entries: readonly string[]): boolean {
  const addresses = new Set<string>();
  const domains = new Set<string>();
  for (const entry of entries) {
    const plain = entry.trim().toLowerCase();
    if (plain.startsWith('*@')) domains.add(plain.slice(2));
    else if (plain.includes('@')) addresses.add(plain);
  }
  return emails.some((email) => {
    const plain = email.trim().toLowerCase();
    const at = plain.lastIndexOf('@');
    return at > 0 && (addresses.has(plain) || domains.has(plain.slice(at + 1)));
  });
}

/** How long the invited check holds a user's addresses, and `clerkAllowlist` Clerk's list, before asking again. */
export const INVITED_HOLD_MS = 2 * 60_000;
/** How long a held answer is used after a failure to ask again, before asking once more. */
const RETRY_AFTER_FAILURE_MS = 15_000;

export interface HoldOptions {
  /** How long an answer is held before it is asked for again. */
  holdMs: number;
  /** The time, for tests. */
  now?: () => number;
  /** Told of each failure answered with the answer held before. */
  onStale?: (key: string, error: unknown) => void;
}

/**
 * Each key's answer held for `holdMs`, with asks that arrive together sharing one. When asking fails and an answer was
 * had before, that answer is used, `onStale` is told, and the next ask is 15 seconds later; with none, the failure is
 * the answer and nothing is kept.
 */
export function holdAnswers<T>(ask: (key: string) => Promise<T>, options: HoldOptions): (key: string) => Promise<T> {
  const now = options.now ?? Date.now;
  const held = new Map<string, { answer: T; until: number }>();
  const asking = new Map<string, Promise<T>>();
  return (key) => {
    const kept = held.get(key);
    if (kept && now() < kept.until) return Promise.resolve(kept.answer);
    const pending = asking.get(key);
    if (pending) return pending;
    const answer = ask(key)
      .then(
        (fresh) => {
          held.set(key, { answer: fresh, until: now() + options.holdMs });
          return fresh;
        },
        (error: unknown) => {
          const before = held.get(key);
          if (!before) throw error;
          options.onStale?.(key, error);
          held.set(key, { answer: before.answer, until: now() + RETRY_AFTER_FAILURE_MS });
          return before.answer;
        },
      )
      .finally(() => asking.delete(key));
    asking.set(key, answer);
    return answer;
  };
}

export interface InvitedCheckOptions {
  /** How long a user's addresses are held, `INVITED_HOLD_MS` by default. */
  holdMs?: number;
  /** The time, for tests. */
  now?: () => number;
  log?: (line: string) => void;
}

/**
 * The invited are whoever has an invited address, verified. `verifiedEmailsOf` reads a user's verified addresses, as for
 * `ownerCheckByEmail`. Each user's addresses are held for two minutes, so an invited address taken off an account
 * stops counting within them; requests that arrive together share one lookup, and when a lookup fails the addresses
 * read before are used, with a log line, or with none the request fails. The list is read on every check, so a reader's
 * change takes effect at its next answer: `clerkAllowlist` holds Clerk's answer for two minutes too. A list that cannot
 * be read fails the request with the reader's error.
 */
export function invitedCheckByEmail(
  invited: Invited,
  verifiedEmailsOf: (userId: string) => Promise<string[]>,
  options: InvitedCheckOptions = {},
): OwnerCheck {
  const read = typeof invited === 'function' ? invited : async () => invited;
  const log = options.log ?? console.log;
  const emailsOf = holdAnswers(verifiedEmailsOf, {
    holdMs: options.holdMs ?? INVITED_HOLD_MS,
    now: options.now,
    onStale: (userId, error) => log(`[auth] could not read the addresses of user ${userId}, so the ones read before are used for now: ${String(error)}`),
  });
  return async (userId) => {
    const [emails, entries] = await Promise.all([emailsOf(userId), read()]);
    return isInvited(emails, entries);
  };
}

/** Each user's answer kept for the life of the process, with requests that arrive together sharing one, and a failure not kept. */
function keptPerUser<T>(lookup: (userId: string) => Promise<T>): (userId: string) => Promise<T> {
  const known = new Map<string, Promise<T>>();
  return (userId) => {
    const cached = known.get(userId);
    if (cached) return cached;
    const answer = lookup(userId);
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
  return letThroughOnly(options.identify, options.isOwner, options.appName, options.log, 'not the owner');
}

export interface RequireInvitedOptions {
  /** The signed-in user's id, or null when nobody is signed in: with Clerk, `(c) => getAuth(c).userId ?? null`. */
  identify: (c: Context) => string | null;
  /** `invitedCheckByEmail`, or the app's own. */
  isInvited: OwnerCheck;
  /** The app's name, as the refusal says it: "This account is not allowed to use <appName>". */
  appName: string;
  /** Where each refusal of a signed-in user goes. `console.log` by default. */
  log?: (line: string) => void;
}

/**
 * Lets a request through only when it comes from someone invited, and sets their id as `userId` on the context: 401
 * when nobody is signed in, 403 when someone not invited is.
 */
export function requireInvited(options: RequireInvitedOptions): MiddlewareHandler<InvitedEnv> {
  return letThroughOnly(options.identify, options.isInvited, options.appName, options.log, 'not on the invited list');
}

function letThroughOnly(
  identify: (c: Context) => string | null,
  allowed: OwnerCheck,
  appName: string,
  log: ((line: string) => void) | undefined,
  reason: string,
): MiddlewareHandler<OwnerEnv> {
  const say = log ?? console.log;
  return async (c, next) => {
    const userId = identify(c);
    if (!userId) return c.json({ error: 'Sign in first' }, 401);
    if (!(await allowed(userId))) {
      say(`[auth] refused ${c.req.method} ${c.req.path} for user ${userId}: ${reason}`);
      return c.json({ error: `This account is not allowed to use ${appName}` }, 403);
    }
    c.set('userId', userId);
    await next();
  };
}
