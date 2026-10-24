import type { ProviderSession } from '../src/sign-in/provider';
import { DESKTOP_SIGN_IN_ROUTES } from './names';

/** A well-formed nonce: the window mints one with `crypto.randomUUID()`. */
export const NONCE = /^[0-9a-f-]{36}$/;

/**
 * Asks the app's server's desktop sign-in routes, with the session's own token, never the gate's fetch wrapper: an app
 * may use this part without the gate, and its server checks the bearer token, not only a cookie. Tickets go in the
 * body, so none is in an address a log keeps.
 */
export async function post(session: Pick<ProviderSession, 'token'>, path: string, body: object = {}): Promise<Response> {
  const token = await session.token();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${DESKTOP_SIGN_IN_ROUTES}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}
