/*
 * The App Store Connect calls the TestFlight part makes: the app by its bundle id, the builds it holds, one build's
 * processing, and what signing needs: the team's distribution certificate by its serial number, and each app's App
 * Store provisioning profile, made when the app has none. Each request carries a token made from the team's App Store Connect API key (see key.ts).
 */
import { appleToken } from '../apple-token.ts';

/** The team's App Store Connect API key, as 1Password holds it. */
export type TestFlightKey = { keyId: string; issuerId: string; privateKey: string };

export const APP_STORE_CONNECT_URL = 'https://api.appstoreconnect.apple.com';
/** Apple refuses a token that lives longer than twenty minutes. */
export const TOKEN_LIFE_SECONDS = 15 * 60;

/** The token App Store Connect takes: the key's id and issuer, its audience, and an expiry under twenty minutes. */
export function appStoreConnectToken(key: TestFlightKey, nowMs: number): string {
  const iat = Math.floor(nowMs / 1000);
  return appleToken(key.keyId, key.privateKey, { iss: key.issuerId, iat, exp: iat + TOKEN_LIFE_SECONDS, aud: 'appstoreconnect-v1' }, { typ: 'JWT' });
}

/**
 * One build App Store Connect holds: its build number (CFBundleVersion), how far Apple's processing has got, and when
 * Apple says testers lose it (90 days after its upload), or null when the answer has no date.
 */
export type Build = { number: string; processingState: string; internalState: string | null; expires: string | null };

/** The team's distribution certificate as Apple records it: its id, and the day it expires, or null when Apple gives none. */
export type CertificateRecord = { id: string; expires: string | null };

/** An App Store provisioning profile: its uuid, which Xcode names it by, and its content, the .mobileprovision in base64. */
export type Profile = { uuid: string; content: string };

/** An App Store Connect refusal, with the status it answered. */
export class AppStoreConnectError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Resource = { id: string; type: string; attributes?: Record<string, unknown>; relationships?: Record<string, { data?: { id: string } | { id: string }[] | null }> };
type Page = { data: Resource[]; included?: Resource[]; links?: { next?: string } };
/** What Apple answers: a list, or one resource for a resource made. */
type Answer = { data: Resource | Resource[]; included?: Resource[]; links?: { next?: string } };

export type AppStoreConnectOptions = { baseUrl?: string; now?: () => number; fetch?: typeof fetch };

export class AppStoreConnect {
  private readonly baseUrl: string;
  private readonly now: () => number;
  private readonly fetch: typeof fetch;

  constructor(
    private readonly key: TestFlightKey,
    options: AppStoreConnectOptions = {},
  ) {
    this.baseUrl = options.baseUrl ?? APP_STORE_CONNECT_URL;
    this.now = options.now ?? Date.now;
    this.fetch = options.fetch ?? fetch;
  }

  private async get(pathOrUrl: string): Promise<Page> {
    const answer = await this.request(pathOrUrl);
    return { ...answer, data: Array.isArray(answer.data) ? answer.data : [answer.data] };
  }

  private async request(pathOrUrl: string, body?: unknown): Promise<Answer> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;
    // A timer rather than an abort signal, so a fetch from another realm (the tests' simulated page) takes it too.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`App Store Connect did not answer ${new URL(url).pathname} in a minute`)), 60_000);
    });
    const headers: Record<string, string> = { authorization: `Bearer ${appStoreConnectToken(this.key, this.now())}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const init = body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) };
    const response = await Promise.race([this.fetch(url, init), late]).finally(() => clearTimeout(timer));
    if (!response.ok) {
      const text = await response.text();
      let detail = text.slice(0, 300);
      try {
        const error = (JSON.parse(text) as { errors?: { title?: string; detail?: string }[] }).errors?.[0];
        if (error) detail = [error.title, error.detail].filter(Boolean).join(': ');
      } catch {
        // not JSON
      }
      throw new AppStoreConnectError(`App Store Connect answered ${response.status} to ${new URL(url).pathname}: ${detail}`, response.status);
    }
    return (await response.json()) as Answer;
  }

  /** The app's id in App Store Connect, or null when no app has the bundle id: its record is made once, by hand. */
  async appId(bundleId: string): Promise<string | null> {
    const page = await this.get(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=bundleId`);
    return page.data.find((app) => app.attributes?.bundleId === bundleId)?.id ?? null;
  }

  /** Every build the app has, in the server's order, which is not by number. */
  async builds(appId: string): Promise<Build[]> {
    const builds: Build[] = [];
    let next: string | undefined = `/v1/builds?filter[app]=${encodeURIComponent(appId)}&limit=200&fields[builds]=version,processingState,expirationDate`;
    for (let pages = 0; next && pages < 50; pages++) {
      const page: Page = await this.get(next);
      builds.push(...page.data.map((build) => buildOf(build, page.included)));
      next = page.links?.next;
    }
    return builds;
  }

  /** Build `number` with its TestFlight state, or null when App Store Connect does not list it yet. */
  async build(appId: string, number: string): Promise<Build | null> {
    const page = await this.get(
      `/v1/builds?filter[app]=${encodeURIComponent(appId)}&filter[version]=${encodeURIComponent(number)}&include=buildBetaDetail`,
    );
    const build = page.data.find((b) => b.attributes?.version === number);
    return build ? buildOf(build, page.included) : null;
  }

  /**
   * The team's distribution certificate whose serial number is `serial`, or null when Apple lists none: it was revoked,
   * or never made for this team. Apple writes the serial in capitals with no leading zeros, as openssl need not.
   */
  async distributionCertificate(serial: string): Promise<CertificateRecord | null> {
    const plain = (text: string) => text.toUpperCase().replace(/^0+/, '');
    const page = await this.get('/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=200&fields[certificates]=serialNumber,expirationDate');
    const found = page.data.find((certificate) => plain(String(certificate.attributes?.serialNumber ?? '')) === plain(serial));
    if (!found) return null;
    const expires = found.attributes?.expirationDate;
    return { id: found.id, expires: typeof expires === 'string' ? expires : null };
  }

  /** The id of the bundle id resource for `identifier`, or null when the team has not registered it. */
  async bundleId(identifier: string): Promise<string | null> {
    const page = await this.get(`/v1/bundleIds?filter[identifier]=${encodeURIComponent(identifier)}&limit=200&fields[bundleIds]=identifier`);
    return page.data.find((bundle) => bundle.attributes?.identifier === identifier)?.id ?? null;
  }

  /** The active App Store profile for the bundle id that signs with the certificate, or null when there is none. */
  async appStoreProfile(bundleId: string, certificateId: string): Promise<Profile | null> {
    const page = await this.get(
      `/v1/bundleIds/${encodeURIComponent(bundleId)}/profiles?limit=200&fields[profiles]=profileType,profileState,uuid,profileContent,certificates&include=certificates&limit[certificates]=50`,
    );
    for (const profile of page.data) {
      const a = profile.attributes ?? {};
      if (a.profileType !== 'IOS_APP_STORE' || a.profileState !== 'ACTIVE') continue;
      const linked = profile.relationships?.certificates?.data;
      const certificates = Array.isArray(linked) ? linked : linked ? [linked] : [];
      if (certificates.some((c) => c.id === certificateId) && typeof a.uuid === 'string' && typeof a.profileContent === 'string') {
        return { uuid: a.uuid, content: a.profileContent };
      }
    }
    return null;
  }

  /** Makes the App Store profile for the bundle id with the certificate. Apple refuses a key whose role may not. */
  async createAppStoreProfile(bundleId: string, identifier: string, certificateId: string): Promise<Profile> {
    const made = await this.request('/v1/profiles', {
      data: {
        type: 'profiles',
        attributes: { name: `app-kit ${identifier} ${certificateId}`, profileType: 'IOS_APP_STORE' },
        relationships: { bundleId: { data: { type: 'bundleIds', id: bundleId } }, certificates: { data: [{ type: 'certificates', id: certificateId }] } },
      },
    });
    const a = (Array.isArray(made.data) ? made.data[0] : made.data)?.attributes ?? {};
    if (typeof a.uuid !== 'string' || typeof a.profileContent !== 'string') throw new Error(`App Store Connect made the profile for ${identifier} without its uuid or content`);
    return { uuid: a.uuid, content: a.profileContent };
  }
}

function buildOf(build: Resource, included: Resource[] = []): Build {
  const link = build.relationships?.buildBetaDetail?.data;
  const detailId = Array.isArray(link) ? link[0]?.id : link?.id;
  const detail = included.find((r) => r.type === 'buildBetaDetails' && r.id === detailId);
  return {
    number: String(build.attributes?.version ?? ''),
    processingState: String(build.attributes?.processingState ?? 'unknown'),
    internalState: detail ? String(detail.attributes?.internalBuildState ?? 'unknown') : null,
    expires: typeof build.attributes?.expirationDate === 'string' ? build.attributes.expirationDate : null,
  };
}
