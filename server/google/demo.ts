/**
 * A demo Google account set to a known inbox and calendar, for an app's Google verification and demo videos: every
 * message in its Inbox and Sent and every event on its primary calendar goes to Trash (or is deleted, for events), then
 * the fixture file's messages and meetings are added, so each run starts from the same state, including mail the app
 * itself sent last run. It acts only on the account the demo grant was made for, and one run at a time holds each
 * account.
 *
 * The grant is a demo-only one: an Internal OAuth app in a Google Cloud project of its own, in the demo account's
 * Workspace, allowed once by the demo account (`app-kit google demo-grant`), never a service account, which can act as
 * every person in the domain. Its client and refresh token are one 1Password item in the agents vault, "Google demo
 * grant <address>", with the fields `client id`, `client secret` and `refresh token`.
 */
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { opRead } from '../../command-line/index.ts';
import { lock, stateFolder } from '../../tauri/state.ts';
import { readGoogleResponse } from './index.ts';

/** The folder of the Chrome profile signed in to the demo account `address`, which its videos are recorded in. */
export function demoChromeFolder(address: string, env: Record<string, string | undefined> = process.env): string {
  return join(stateFolder('demo-chrome', env), address.toLowerCase())
}

/** What the demo grant may do: insert and trash mail, and create and delete events. */
export const DEMO_SCOPES = ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/calendar.events'];

/** One message the inbox gets, unread unless `read` is set, received `minutesAgo` before the reset. */
export type DemoMessage = { from: string; subject: string; body: string; minutesAgo?: number; read?: boolean };
/** One meeting on the primary calendar, starting `startsInMinutes` from the reset (rounded to the quarter hour). */
export type DemoEvent = { summary: string; startsInMinutes: number; minutes?: number; description?: string; location?: string };
/** The fixture file: the demo account, and what its inbox and calendar hold after a reset. */
export type DemoFixtures = { account: string; mail: DemoMessage[]; events: DemoEvent[] };

/** Reads and checks a fixture file; throws naming what is wrong. */
export function readDemoFixtures(file: string): DemoFixtures {
  const text = readFileSync(file, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not JSON: ${(error as Error).message}`);
  }
  const fixtures = parsed as Partial<DemoFixtures>;
  const problems: string[] = [];
  if (typeof fixtures.account !== 'string' || !fixtures.account.includes('@')) problems.push('"account" is the demo account\'s address');
  if (!Array.isArray(fixtures.mail)) problems.push('"mail" is a list of { from, subject, body, minutesAgo?, read? }');
  if (!Array.isArray(fixtures.events)) problems.push('"events" is a list of { summary, startsInMinutes, minutes?, description?, location? }');
  for (const [at, message] of (fixtures.mail ?? []).entries()) {
    if (!message || typeof message.from !== 'string' || typeof message.subject !== 'string' || typeof message.body !== 'string') problems.push(`mail ${at + 1} needs from, subject and body`);
    else if (message.minutesAgo !== undefined && !(Number.isFinite(message.minutesAgo) && message.minutesAgo >= 0)) problems.push(`mail ${at + 1}'s minutesAgo is a number of minutes, 0 or more`);
    else if (message.read !== undefined && typeof message.read !== 'boolean') problems.push(`mail ${at + 1}'s read is true or false`);
  }
  for (const [at, event] of (fixtures.events ?? []).entries()) {
    if (!event || typeof event.summary !== 'string' || !Number.isFinite(event.startsInMinutes)) problems.push(`event ${at + 1} needs summary and startsInMinutes`);
    else if (event.minutes !== undefined && !(Number.isFinite(event.minutes) && event.minutes > 0)) problems.push(`event ${at + 1}'s minutes is a number of minutes, more than 0`);
    else if ((event.description !== undefined && typeof event.description !== 'string') || (event.location !== undefined && typeof event.location !== 'string')) problems.push(`event ${at + 1}'s description and location are text`);
  }
  if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`);
  return fixtures as DemoFixtures;
}

/** The demo grant's 1Password item. */
export function demoGrantItem(address: string): string {
  return `Google demo grant ${address}`;
}

export type DemoGrant = { clientId: string; clientSecret: string; refreshToken: string };

/** Reads the demo grant of `address` from 1Password's agents vault. */
export async function readDemoGrant(address: string, read: (reference: string) => Promise<string> = opRead): Promise<DemoGrant> {
  const field = async (name: string) => (await read(`op://agents/${demoGrantItem(address)}/${name}`)).trim();
  return { clientId: await field('client id'), clientSecret: await field('client secret'), refreshToken: await field('refresh token') };
}

/**
 * Runs `work` holding the demo account's lock, so one run at a time resets or records it: a second fails at once,
 * naming the process that holds it.
 */
export async function withDemoAccount<T>(address: string, work: () => Promise<T>, env: Record<string, string | undefined> = process.env): Promise<T> {
  const file = join(stateFolder('google-demo', env), `${address.toLowerCase()}.lock`);
  if (!lock(file)) throw new Error(`Another run holds the demo account ${address} (${file}); wait for it to end.`);
  try {
    return await work();
  } finally {
    try {
      if (Number(readFileSync(file, 'utf8')) === process.pid) unlinkSync(file);
    } catch {
      // already gone
    }
  }
}

/** Google's endpoints; tests point them at a stand-in. */
export type GoogleEndpoints = { token: string; gmail: string; calendar: string };
export const GOOGLE: GoogleEndpoints = {
  token: 'https://oauth2.googleapis.com/token',
  gmail: 'https://gmail.googleapis.com/gmail/v1/users/me',
  calendar: 'https://www.googleapis.com/calendar/v3/calendars/primary',
};

/** What a reset did, for its one line. */
export type ResetDone = { trashed: number; deletedEvents: number; added: number; addedEvents: number };

/** A call to Google that throws Google's own reason, in the kit's words for it, when it is refused. */
async function call(url: string, init: RequestInit, what: string): Promise<Response> {
  const answer = await fetch(url, init);
  if (answer.ok) return answer;
  const refusal = await readGoogleResponse(answer);
  const hint =
    refusal.reason === 'invalid_grant'
      ? ' The demo grant is gone (revoked, the demo account\'s password changed, or unused for 6 months): run app-kit google demo-grant again.'
      : refusal.reason === 'admin_policy_enforced'
        ? ' The Workspace admin console restricts this API: mark the demo app Trusted under Security, API controls.'
        : '';
  throw new Error(`${what}: ${refusal.message}.${hint}`);
}

/** An access token for the grant. */
async function accessToken(grant: DemoGrant, endpoints: GoogleEndpoints): Promise<string> {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: grant.refreshToken, client_id: grant.clientId, client_secret: grant.clientSecret });
  const answer = await call(endpoints.token, { method: 'POST', body }, 'Google refused the demo grant');
  return ((await answer.json()) as { access_token: string }).access_token;
}

/** A message as Gmail takes it raw: RFC 2822 headers and a plain text body, base64url encoded. */
export function rawMessage(message: DemoMessage, to: string, now: number): string {
  const date = new Date(now - (message.minutesAgo ?? 0) * 60_000).toUTCString().replace('GMT', '+0000');
  const subject = /^[\x20-\x7e]*$/.test(message.subject) ? message.subject : `=?UTF-8?B?${Buffer.from(message.subject).toString('base64')}?=`;
  const lines = [`From: ${message.from}`, `To: ${to}`, `Subject: ${subject}`, `Date: ${date}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(message.body).toString('base64')];
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

/** The quarter hour at or after `at`. */
function quarterHour(at: number): number {
  const quarter = 15 * 60_000;
  return Math.ceil(at / quarter) * quarter;
}

/** Every id a Gmail or Calendar list gives, page after page. */
async function everyId(url: string, token: string, key: 'messages' | 'items', what: string): Promise<string[]> {
  const ids: string[] = [];
  let page: string | undefined;
  do {
    const address = new URL(url);
    if (page) address.searchParams.set('pageToken', page);
    const answer = (await (await call(address.toString(), { headers: { authorization: `Bearer ${token}` } }, what)).json()) as Record<string, unknown>;
    for (const each of (answer[key] as { id: string }[] | undefined) ?? []) ids.push(each.id);
    page = answer.nextPageToken as string | undefined;
  } while (page);
  return ids;
}

/**
 * Empties the demo account's Inbox, Sent and primary calendar, then adds the fixtures. Refuses when the grant's
 * account is not `fixtures.account`.
 */
export async function resetDemoAccount(fixtures: DemoFixtures, grant: DemoGrant, endpoints: GoogleEndpoints = GOOGLE, now = Date.now()): Promise<ResetDone> {
  const token = await accessToken(grant, endpoints);
  const auth = { authorization: `Bearer ${token}` };
  const json = { ...auth, 'content-type': 'application/json' };
  const profile = (await (await call(`${endpoints.gmail}/profile`, { headers: auth }, 'Gmail refused to name the demo account')).json()) as { emailAddress: string };
  if (profile.emailAddress.toLowerCase() !== fixtures.account.toLowerCase()) {
    throw new Error(`The demo grant is for ${profile.emailAddress}, not ${fixtures.account}, so nothing was changed.`);
  }

  const messages = new URL(`${endpoints.gmail}/messages`);
  messages.searchParams.set('q', 'in:inbox OR in:sent');
  messages.searchParams.set('maxResults', '500');
  const trashed = await everyId(messages.toString(), token, 'messages', 'Gmail refused to list the demo inbox');
  for (const id of trashed) await call(`${endpoints.gmail}/messages/${id}/trash`, { method: 'POST', headers: auth }, 'Gmail refused to trash a demo message');

  const events = new URL(`${endpoints.calendar}/events`);
  events.searchParams.set('maxResults', '2500');
  const deleted = await everyId(events.toString(), token, 'items', 'Calendar refused to list the demo calendar');
  for (const id of deleted) await call(`${endpoints.calendar}/events/${id}`, { method: 'DELETE', headers: auth }, 'Calendar refused to delete a demo event');

  for (const message of fixtures.mail) {
    const labels = message.read ? ['INBOX'] : ['INBOX', 'UNREAD'];
    await call(
      `${endpoints.gmail}/messages?internalDateSource=dateHeader`,
      { method: 'POST', headers: json, body: JSON.stringify({ raw: rawMessage(message, fixtures.account, now), labelIds: labels }) },
      'Gmail refused to add a demo message',
    );
  }
  for (const event of fixtures.events) {
    const start = quarterHour(now + event.startsInMinutes * 60_000);
    const end = start + (event.minutes ?? 30) * 60_000;
    const body = { summary: event.summary, description: event.description, location: event.location, start: { dateTime: new Date(start).toISOString() }, end: { dateTime: new Date(end).toISOString() } };
    await call(`${endpoints.calendar}/events`, { method: 'POST', headers: json, body: JSON.stringify(body) }, 'Calendar refused to add a demo event');
  }
  return { trashed: trashed.length, deletedEvents: deleted.length, added: fixtures.mail.length, addedEvents: fixtures.events.length };
}

/** Google's consent page for the demo grant, sent back to `redirect` on this Mac. */
export function demoConsentAddress(clientId: string, address: string, redirect: string, state: string): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: DEMO_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    login_hint: address,
    state,
  }).toString();
  return url.toString();
}

/** Trades the consent's code for the grant's refresh token. */
export async function refreshTokenFor(code: string, clientId: string, clientSecret: string, redirect: string, endpoints: GoogleEndpoints = GOOGLE): Promise<string> {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect });
  const answer = (await (await call(endpoints.token, { method: 'POST', body }, 'Google refused the consent\'s code')).json()) as { refresh_token?: string };
  if (!answer.refresh_token) throw new Error('Google gave no refresh token; remove the demo app\'s access at myaccount.google.com/connections in the demo account and run demo-grant again.');
  return answer.refresh_token;
}
