/*
 * The Google Play Developer API calls `app-kit play upload` makes, as Google documents them
 * (https://developers.google.com/android-publisher/edits): every change happens in an edit, opened, changed and then
 * committed, and an edit left open is deleted. Each request carries an access token for the team's service account,
 * got from Google by a token request signed with the account's own key (RS256), as Google's server-to-server sign-in
 * asks (https://developers.google.com/identity/protocols/oauth2/service-account#httprest).
 *
 * Google's refusals the upload acts on, matched by their reason where Google gives one and by their words where it
 * does not, from Google's documentation and its developers' reports, not from a recorded answer: the first real upload
 * (the README's "Shipping to Google Play") is where they are first seen.
 * - "Package not found": the app has never been uploaded; its first build goes up by hand in Play Console.
 * - "Only releases with status draft may be created on draft app": the app's store listing is not finished yet.
 * - A build number Google already holds ("apkUpgradeVersionConflict", "version code ... has already been used").
 */
import { createPrivateKey, sign } from 'node:crypto';

/** What a service account's JSON key holds that the upload needs. */
export type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

export const PLAY_URL = 'https://androidpublisher.googleapis.com';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

/** A refusal from Google, with its status, its reason when it gives one, and its message. */
export class PlayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string,
  ) {
    super(message);
  }

  /** The app has never been uploaded, so Play does not know its package name. */
  get packageNotFound(): boolean {
    return this.status === 404 && /package not found/i.test(this.message);
  }

  /** The app is still a draft in Play Console, which takes only draft releases. */
  get draftApp(): boolean {
    return /draft app/i.test(this.message);
  }

  /** The build number is one Google already holds. */
  get numberTaken(): boolean {
    return this.reason === 'apkUpgradeVersionConflict' || /version code.*already been used/i.test(this.message);
  }
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString('base64url');

/** The signed request Google's token service trades for an access token, good for an hour. */
export function tokenRequest(account: ServiceAccount, nowMs: number): string {
  const iat = Math.floor(nowMs / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: account.token_uri ?? TOKEN_URL, iat, exp: iat + 3600 }));
  const signature = sign('sha256', Buffer.from(`${head}.${body}`), createPrivateKey(account.private_key));
  return `${head}.${body}.${b64url(signature)}`;
}

export type PlayOptions = { playUrl?: string; tokenUrl?: string; now?: () => number; fetch?: typeof fetch };

/** One app's calls, by its package name (tauri.conf.json's identifier). */
export class GooglePlay {
  private token: string | null = null;
  private readonly playUrl: string;
  private readonly tokenUrl: string;
  private readonly now: () => number;
  private readonly fetch: typeof fetch;

  constructor(
    private readonly account: ServiceAccount,
    readonly packageName: string,
    options: PlayOptions = {},
  ) {
    this.playUrl = options.playUrl ?? PLAY_URL;
    this.tokenUrl = options.tokenUrl ?? account.token_uri ?? TOKEN_URL;
    this.now = options.now ?? Date.now;
    this.fetch = options.fetch ?? fetch;
  }

  private async accessToken(): Promise<string> {
    if (this.token) return this.token;
    const answer = await this.fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: tokenRequest(this.account, this.now()) }),
    });
    const body = (await answer.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
    if (!answer.ok || !body.access_token) {
      throw new PlayError(`Google refused the service account ${this.account.client_email}: ${body.error_description ?? body.error ?? answer.status}`, answer.status, body.error ?? '');
    }
    this.token = body.access_token;
    return this.token;
  }

  private async call<T>(method: string, path: string, body?: unknown, upload?: Uint8Array<ArrayBuffer>): Promise<T> {
    const root = upload ? `${this.playUrl}/upload/androidpublisher/v3` : `${this.playUrl}/androidpublisher/v3`;
    const url = `${root}/applications/${encodeURIComponent(this.packageName)}${path}${upload ? '?uploadType=media' : ''}`;
    const headers: Record<string, string> = { authorization: `Bearer ${await this.accessToken()}` };
    if (upload) headers['content-type'] = 'application/octet-stream';
    else if (body !== undefined) headers['content-type'] = 'application/json';
    const answer = await this.fetch(url, { method, headers, body: upload ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const text = await answer.text();
    const parsed = parse(text);
    if (!answer.ok) {
      const error = (parsed as { error?: { message?: string; errors?: { reason?: string }[] } }).error;
      throw new PlayError(error?.message ?? `Google answered ${answer.status}`, answer.status, error?.errors?.[0]?.reason ?? '');
    }
    return parsed as T;
  }

  /** Opens an edit, which holds every change until it is committed. */
  async openEdit(): Promise<string> {
    return (await this.call<{ id: string }>('POST', '/edits', {})).id;
  }

  /** Deletes an edit left open, so it holds nothing back. A failure here is not the upload's: it is ignored. */
  async deleteEdit(edit: string): Promise<void> {
    await this.call('DELETE', `/edits/${edit}`).catch(() => {});
  }

  /** The highest build number of every bundle and APK the app has ever uploaded, or 0 for none. */
  async highestNumber(edit: string): Promise<number> {
    const bundles = await this.call<{ bundles?: { versionCode?: number }[] }>('GET', `/edits/${edit}/bundles`);
    const apks = await this.call<{ apks?: { versionCode?: number }[] }>('GET', `/edits/${edit}/apks`);
    const numbers = [...(bundles.bundles ?? []), ...(apks.apks ?? [])].map((build) => Number(build.versionCode) || 0);
    return Math.max(0, ...numbers);
  }

  /** Uploads a signed Android App Bundle (.aab), giving the build number Google read from it. */
  async uploadBundle(edit: string, bundle: Uint8Array<ArrayBuffer>): Promise<number> {
    return Number((await this.call<{ versionCode?: number }>('POST', `/edits/${edit}/bundles`, undefined, bundle)).versionCode);
  }

  /** Puts the build on a track (internal testing) as its one release, to every tester at once or as a draft. */
  async release(edit: string, track: string, versionCode: number, status: 'completed' | 'draft'): Promise<void> {
    await this.call('PUT', `/edits/${edit}/tracks/${track}`, { track, releases: [{ versionCodes: [String(versionCode)], status }] });
  }

  /** Commits the edit, which is when testers get the build. */
  async commit(edit: string): Promise<void> {
    await this.call('POST', `/edits/${edit}:commit`);
  }
}

/** Google's answer as JSON; an answer that is not, such as a proxy's HTML error page, is read as empty, so its status
 * still names it. */
function parse(text: string): unknown {
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    return {};
  }
}
