import { describe, expect, test } from 'bun:test';
import { readGoogleRefusal, readGoogleResponse, retryAfterMs } from '../google';

/*
 * Each body is one Google really sends: recorded by an app that met it, or quoted from Google's Calendar errors page.
 * Only Google's own fields are kept, and every project, account and calendar is a stand-in.
 */

/** Gmail's answer to a grant made with the Gmail box unticked on Google's consent screen. */
const MISSING_ACCESS_GMAIL = {
  error: {
    code: 403,
    message: 'Request had insufficient authentication scopes.',
    errors: [{ message: 'Insufficient Permission', domain: 'global', reason: 'insufficientPermissions' }],
    status: 'PERMISSION_DENIED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
        domain: 'googleapis.com',
        metadata: { service: 'gmail.googleapis.com', method: 'caribou.api.proto.MailboxService.ListThreads' },
      },
    ],
  },
};

/** Google Calendar's answer to a token without calendar access, which names only the older reason. */
const MISSING_ACCESS_CALENDAR = {
  error: {
    code: 403,
    message: 'Request had insufficient authentication scopes.',
    errors: [{ reason: 'insufficientPermissions', domain: 'global' }],
    status: 'PERMISSION_DENIED',
  },
};

/** Gmail's per-user quota, sent as a 403. */
const GMAIL_QUOTA = {
  error: {
    code: 403,
    message: "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user' of service 'gmail.googleapis.com' for consumer 'project_number:1'.",
    errors: [{ domain: 'usageLimits', reason: 'rateLimitExceeded' }],
    status: 'PERMISSION_DENIED',
    details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'RATE_LIMIT_EXCEEDED' }],
  },
};

/** A Google Calendar refusal as its errors page shows them. */
const calendar = (code: number, reason: string, message: string) => ({
  error: { errors: [{ domain: reason === 'authError' ? 'global' : 'usageLimits', reason, message }], code, message },
});

/** The answer of an API the app's Google Cloud project has not switched on. */
const SERVICE_DISABLED = {
  error: {
    code: 403,
    message: 'Google Calendar API has not been used in project 0 before or it is disabled.',
    errors: [{ message: 'Google Calendar API has not been used in project 0 before or it is disabled.', domain: 'usageLimits', reason: 'accessNotConfigured' }],
    status: 'PERMISSION_DENIED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'SERVICE_DISABLED',
        domain: 'googleapis.com',
        metadata: { service: 'calendar-json.googleapis.com', consumer: 'projects/0' },
      },
    ],
  },
};

const answer = (status: number, body: unknown, more: { retryAfter?: string; tokenWasFresh?: boolean } = {}) =>
  readGoogleRefusal({ status, body: typeof body === 'string' ? body : JSON.stringify(body), ...more }, Date.parse('2026-10-24T12:00:00Z'));

describe('a reconnect', () => {
  test('a refresh the token endpoint refuses with invalid_grant is a revoked grant', () => {
    const refusal = answer(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
    expect(refusal).toMatchObject({ kind: 'reconnect', why: 'revoked', reason: 'invalid_grant' });
    expect(refusal.message).toBe('Google answered 400 (invalid_grant): Token has been expired or revoked.');
  });

  test("Gmail's refusal of a grant without Gmail is missing access, read from either of the reasons it carries", () => {
    expect(answer(403, MISSING_ACCESS_GMAIL)).toMatchObject({ kind: 'reconnect', why: 'missingAccess', reason: 'insufficientPermissions' });
    const newerOnly = { error: { ...MISSING_ACCESS_GMAIL.error, errors: [] } };
    expect(answer(403, newerOnly)).toMatchObject({ kind: 'reconnect', why: 'missingAccess', reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' });
  });

  test("Google Calendar's refusal of a token without calendar access is missing access", () => {
    expect(answer(403, MISSING_ACCESS_CALENDAR)).toMatchObject({ kind: 'reconnect', why: 'missingAccess' });
  });

  test('a token refused once asks for a fresh one, and a fresh token refused too is a revoked grant', () => {
    const refused = calendar(401, 'authError', 'Invalid Credentials');
    expect(answer(401, refused)).toMatchObject({ kind: 'freshToken', reason: 'authError' });
    expect(answer(401, refused, { tokenWasFresh: true })).toMatchObject({ kind: 'reconnect', why: 'revoked' });
  });
});

describe('try later', () => {
  test("Gmail's quota sent as a 403 is a rate limit, not lost access", () => {
    expect(answer(403, GMAIL_QUOTA)).toMatchObject({ kind: 'later', reason: 'rateLimitExceeded', retryAfterMs: null });
  });

  test("each of Google Calendar's rate limits and quotas is a rate limit", () => {
    expect(answer(403, calendar(403, 'userRateLimitExceeded', 'User Rate Limit Exceeded'))).toMatchObject({ kind: 'later' });
    expect(answer(403, calendar(403, 'rateLimitExceeded', 'Rate Limit Exceeded'))).toMatchObject({ kind: 'later' });
    expect(answer(403, calendar(403, 'quotaExceeded', 'Calendar usage limits exceeded.'))).toMatchObject({ kind: 'later' });
    expect(answer(429, calendar(429, 'rateLimitExceeded', 'Rate Limit Exceeded'))).toMatchObject({ kind: 'later' });
  });

  test("Google's own trouble is later, whatever the body, and Retry-After says when", () => {
    expect(answer(500, calendar(500, 'backendError', 'Backend Error'))).toMatchObject({ kind: 'later', reason: 'backendError' });
    expect(answer(503, '<html>Service Unavailable</html>', { retryAfter: '7' })).toMatchObject({
      kind: 'later',
      retryAfterMs: 7000,
      reason: null,
      message: 'Google answered 503',
    });
  });
});

describe('failed', () => {
  test('a refusal that only looks like lost access is not a reconnect, since reconnecting cannot fix it', () => {
    expect(answer(403, SERVICE_DISABLED)).toMatchObject({ kind: 'failed', reason: 'accessNotConfigured' });
    const notOrganizer = calendar(403, 'forbiddenForNonOrganizer', 'Shared properties can only be changed by the organizer of the event.');
    expect(answer(403, notOrganizer)).toMatchObject({ kind: 'failed' });
  });

  test("the token endpoint's refusal of the app itself is failed, though it comes as a 401", () => {
    expect(answer(401, { error: 'invalid_client', error_description: 'Unauthorized' })).toMatchObject({ kind: 'failed', reason: 'invalid_client' });
    expect(answer(401, { error: 'deleted_client', error_description: 'The OAuth client was deleted.' })).toMatchObject({ kind: 'failed' });
  });

  test('a sync token Google no longer takes, and a missing item, are failed: the app decides what they mean', () => {
    expect(answer(410, calendar(410, 'fullSyncRequired', 'Sync token is no longer valid, a full sync is required.'))).toMatchObject({
      kind: 'failed',
      reason: 'fullSyncRequired',
    });
    expect(answer(404, calendar(404, 'notFound', 'Not Found'))).toMatchObject({ kind: 'failed', reason: 'notFound' });
  });
});

test('a response is read with its status, body and Retry-After', async () => {
  const response = new Response(JSON.stringify(calendar(429, 'rateLimitExceeded', 'Rate Limit Exceeded')), {
    status: 429,
    headers: { 'Retry-After': '3' },
  });
  expect(await readGoogleResponse(response)).toMatchObject({ kind: 'later', retryAfterMs: 3000 });
  const refused = new Response(JSON.stringify(calendar(401, 'authError', 'Invalid Credentials')), { status: 401 });
  expect(await readGoogleResponse(refused, { tokenWasFresh: true })).toMatchObject({ kind: 'reconnect', why: 'revoked' });
});

test('Retry-After is read in seconds or as a date, and is null when absent, unreadable or past', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  expect(retryAfterMs('2', now)).toBe(2000);
  expect(retryAfterMs('Sat, 24 Oct 2026 12:00:05 GMT', now)).toBe(5000);
  expect(retryAfterMs(null, now)).toBeNull();
  expect(retryAfterMs('', now)).toBeNull();
  expect(retryAfterMs('soon', now)).toBeNull();
  expect(retryAfterMs('-5', now)).toBeNull();
  expect(retryAfterMs('Sat, 24 Oct 2026 11:59:55 GMT', now)).toBeNull();
});
