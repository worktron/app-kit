import { isProxyFailure, markReachable, markUnreachable } from './connection';
import { currentSession } from './sign-in/current';

/** A server that refuses a session this soon after a sign-in on the page refuses every session, so sign-in is not offered again. */
export const SIGN_IN_LOOP_MS = 15_000;

export class ApiError extends Error {
  constructor(
    message: string,
    /** The response's status, or 0 when the server could not be reached. */
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Error bodies are often not the app's JSON (a proxy's HTML 502, a gateway's timeout text), so they are parsed if they can be. */
function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function messageIn(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const { error, message } = body as { error?: unknown; message?: unknown };
  if (typeof error === 'string') return error;
  if (typeof message === 'string') return message;
  return null;
}

/**
 * The token for a send. A keepalive request's first send takes the one the provider holds now, without waiting, so its
 * fetch starts in the same task: a page being left may be gone before a token that has to be asked for arrives. Its
 * retry after a 401 waits for a fresh one, as any request does, since a page that got an answer is still there.
 */
function tokenFor(init: RequestInit, fresh: boolean): string | null | Promise<string | null> {
  const session = currentSession();
  if (!session) return null;
  if (!init.keepalive || fresh) return session.token(fresh ? { fresh: true } : undefined);
  const now = session.tokenNow();
  if (!now) console.log('[app-kit] keepalive: no token held that is still good, sent without one', init.method ?? 'GET');
  return now;
}

function fetchWith(path: string, init: RequestInit, token: string | null | undefined): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(path, { ...init, headers });
}

async function send(path: string, init: RequestInit, fresh: boolean): Promise<Response> {
  const token = tokenFor(init, fresh);
  // A token already in hand, as a keepalive request's first send has it, starts the fetch before any await.
  const response = token instanceof Promise ? fetchWith(path, init, await token) : fetchWith(path, init, token);
  try {
    return await response;
  } catch (error) {
    // Aborted on purpose: not the server's fault.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    markUnreachable();
    throw new ApiError('The server could not be reached.', 0, null);
  }
}

/**
 * The one way an app asks its server for something. It sends the session's token, reads the status before the body,
 * and returns the parsed JSON (null for an empty body). A 401 is asked once more with a fresh token, since the cached
 * one may have just expired; refused again, the sign-in gate brings sign-in up over the current address. A server
 * that cannot be reached, or a proxy saying it is down, shows the server-unreachable line until it is back.
 *
 * A request marked `keepalive`, as one sent while the page is being left, starts at once, with the token the provider
 * holds now: see tokenFor.
 */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await send(path, init, false);
  const session = currentSession();
  if (res.status === 401 && session) res = await send(path, init, true);
  if (isProxyFailure(res.status)) markUnreachable();
  else markReachable();
  const text = await res.text();
  const body = parseBody(text);

  if (res.status === 401) {
    if (session && Date.now() - session.signedInAt > SIGN_IN_LOOP_MS) {
      session.refused();
      throw new ApiError('Signed out: sign in again.', 401, body);
    }
    throw new ApiError(messageIn(body) ?? 'The server refused the session.', 401, body);
  }
  if (!res.ok) throw new ApiError(messageIn(body) ?? `HTTP ${res.status}`, res.status, body);
  if (text && body === text) throw new ApiError(`The server's answer was not JSON (HTTP ${res.status}).`, res.status, text);
  return body as T;
}
