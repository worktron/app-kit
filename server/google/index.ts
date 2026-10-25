/**
 * What a refusal from Google means for the app that got it, read the same way in every app: reconnect (and why), ask
 * once more with a fresh token, try later, or failed. It takes the answer to a call made with a grant the app holds:
 * any Google API (Gmail, Calendar, Drive), or a refresh at Google's token endpoint. A sign-in's first exchange of its
 * code is not one: Google answers `invalid_grant` there too, for a code that is stale or used, and the sign-in starts
 * again. No React and no packages, so a server imports it.
 *
 * Only refusals with a recorded or Google-documented answer get a meaning. Everything else reads as failed, with
 * Google's own reason attached for the app to log, until a sample of it is recorded.
 */

/** Why a refusal needs the person to connect again. */
export type ReconnectWhy =
  /** The grant is gone: revoked at Google, expired (Testing mode ends it after about 7 days), or the password changed. */
  | 'revoked'
  /** The grant lacks a permission the call needs, usually a box left unticked on Google's consent screen. */
  | 'missingAccess';

interface Said {
  /** Google's own reason, such as `insufficientPermissions` or `invalid_grant`, when it sent one. */
  reason: string | null;
  /** One line for a log: the status, Google's reason and its message, never the raw body. */
  message: string;
}

export type GoogleRefusal = Said &
  (
    | { kind: 'reconnect'; why: ReconnectWhy }
    /** Google refused the access token. Ask for a fresh one once, then read the next refusal with `tokenWasFresh`. */
    | { kind: 'freshToken' }
    /** A rate limit, a quota or Google's own trouble: the same request can work later. */
    | { kind: 'later'; retryAfterMs: number | null }
    /** Anything else. Retrying it fails the same way. */
    | { kind: 'failed' }
  );

export interface GoogleAnswer {
  status: number;
  /** The answer's body as text. */
  body: string;
  /** The Retry-After header, when there was one. */
  retryAfter?: string | null;
  /** True when the token Google refused was a fresh one, so a 401 means the grant itself is gone. */
  tokenWasFresh?: boolean;
}

/** Google says the token carries no permission for this API: the older reason, and the newer one in `details`. */
const MISSING_ACCESS = new Set(['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT']);
/** Google's rate limits and quotas. Gmail and Calendar send them as a 403 as often as a 429. */
const LIMITED = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'RATE_LIMIT_EXCEEDED']);
const GOOGLE_TROUBLE = new Set([429, 500, 502, 503, 504]);

interface Body {
  /** An API's refusal is an object; the token endpoint's is a string such as `invalid_grant`. */
  error?: string | { message?: unknown; errors?: unknown; details?: unknown };
  error_description?: unknown;
}

function parse(body: string): Body {
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? (parsed as Body) : {};
  } catch {
    return {};
  }
}

/** The reasons in a list of Google's errors or details; a body of another shape has none, so it reads as failed. */
function listed(entries: unknown): string[] {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry: unknown) => {
    const reason: unknown = entry && typeof entry === 'object' ? (entry as { reason?: unknown }).reason : undefined;
    return typeof reason === 'string' ? [reason] : [];
  });
}

/** Google's own words on one line, so a log keeps one line per refusal. */
function oneLine(text: unknown): string {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}

/** Reads a refusal from Google. */
export function readGoogleRefusal({ status, body, retryAfter = null, tokenWasFresh = false }: GoogleAnswer, now = Date.now()): GoogleRefusal {
  const { error, error_description } = parse(body);
  const fromTokenEndpoint = typeof error === 'string';
  const reasons = error && typeof error === 'object' ? [...listed(error.errors), ...listed(error.details)] : [];
  const reason = fromTokenEndpoint ? error : (reasons[0] ?? null);
  const googleSaid = oneLine(fromTokenEndpoint ? error_description : error?.message);
  const said: Said = { reason, message: `Google answered ${status}${reason ? ` (${reason})` : ''}${googleSaid ? `: ${googleSaid}` : ''}` };

  if (fromTokenEndpoint && error === 'invalid_grant') return { kind: 'reconnect', why: 'revoked', ...said };
  // The token endpoint's own 401, such as invalid_client, is the app's setup, which no fresh token fixes.
  if (status === 401 && !fromTokenEndpoint) return tokenWasFresh ? { kind: 'reconnect', why: 'revoked', ...said } : { kind: 'freshToken', ...said };
  if (status === 403 && reasons.some((r) => MISSING_ACCESS.has(r))) return { kind: 'reconnect', why: 'missingAccess', ...said };
  if (GOOGLE_TROUBLE.has(status) || reasons.some((r) => LIMITED.has(r))) {
    return { kind: 'later', retryAfterMs: retryAfterMs(retryAfter, now), ...said };
  }
  return { kind: 'failed', ...said };
}

/** Reads a refusal straight from the response of a Google API or of the token endpoint. */
export async function readGoogleResponse(response: Response, options: { tokenWasFresh?: boolean } = {}): Promise<GoogleRefusal> {
  return readGoogleRefusal({
    status: response.status,
    body: await response.text(),
    retryAfter: response.headers.get('Retry-After'),
    tokenWasFresh: options.tokenWasFresh,
  });
}

/** A Retry-After header, in seconds or as a date, in milliseconds from now; null when absent, unreadable or past. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (header.trim() !== '' && Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : null;
  const at = Date.parse(header);
  if (Number.isNaN(at)) return null;
  return at > now ? at - now : null;
}
