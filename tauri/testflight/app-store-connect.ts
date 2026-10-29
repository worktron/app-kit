/*
 * The App Store Connect calls the TestFlight part makes: the app by its bundle id, the builds it holds, and one build's
 * processing. Each request carries a token made from the team's App Store Connect API key (see key.ts).
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

type Resource = { id: string; type: string; attributes?: Record<string, unknown>; relationships?: Record<string, { data?: { id: string } | null }> };
type Page = { data: Resource[]; included?: Resource[]; links?: { next?: string } };

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
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;
    // A timer rather than an abort signal, so a fetch from another realm (the tests' simulated page) takes it too.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`App Store Connect did not answer ${new URL(url).pathname} in a minute`)), 60_000);
    });
    const response = await Promise.race([this.fetch(url, { headers: { authorization: `Bearer ${appStoreConnectToken(this.key, this.now())}` } }), late]).finally(() =>
      clearTimeout(timer),
    );
    if (!response.ok) {
      const body = await response.text();
      let detail = body.slice(0, 300);
      try {
        const error = (JSON.parse(body) as { errors?: { title?: string; detail?: string }[] }).errors?.[0];
        if (error) detail = [error.title, error.detail].filter(Boolean).join(': ');
      } catch {
        // not JSON
      }
      throw new Error(`App Store Connect answered ${response.status} to ${new URL(url).pathname}: ${detail}`);
    }
    return (await response.json()) as Page;
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
}

function buildOf(build: Resource, included: Resource[] = []): Build {
  const detailId = build.relationships?.buildBetaDetail?.data?.id;
  const detail = included.find((r) => r.type === 'buildBetaDetails' && r.id === detailId);
  return {
    number: String(build.attributes?.version ?? ''),
    processingState: String(build.attributes?.processingState ?? 'unknown'),
    internalState: detail ? String(detail.attributes?.internalBuildState ?? 'unknown') : null,
    expires: typeof build.attributes?.expirationDate === 'string' ? build.attributes.expirationDate : null,
  };
}
