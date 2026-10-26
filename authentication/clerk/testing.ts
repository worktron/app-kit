/*
 * A stand-in for Clerk's Backend API, for an app's server tests under Bun: Clerk's own middleware runs as it does in
 * production, and only its calls to api.clerk.com are answered here. A session is a token signed with a key the stand-in
 * serves as Clerk's key set; a key for agents is answered with Clerk's recorded answers
 * (test/fixtures/clerk-api-key-verify.json). Nothing is put in place of a module, so nothing reaches another test file:
 * Bun keeps a module replaced with `mock.module` replaced for every file after it in the same run.
 */
import recorded from '../../test/fixtures/clerk-api-key-verify.json';

const CLERK_API = 'https://api.clerk.com';
/** The instance the tokens say they come from, which the publishable key names. */
const FRONTEND_API = 'example.clerk.accounts.dev';
const ISSUER = `https://${FRONTEND_API}`;
const SECRET_KEY = 'sk_test_app_kit_stand_in';
const PUBLISHABLE_KEY = `pk_test_${btoa(`${FRONTEND_API}$`)}`;
/** The two keys an agent might send: one Clerk accepts, and one it does not know, which is also what a revoked key gets. */
const KEY_SECRETS = { valid: `ak_app_kit_valid_${'v'.repeat(24)}`, notFound: `ak_app_kit_unknown_${'u'.repeat(22)}` } as const;

export interface FakeClerkApi {
  /** The secret key Clerk's middleware is to use; also set as `CLERK_SECRET_KEY` until `restore`. */
  secretKey: string;
  /** The publishable key Clerk's middleware is to use; also set as `CLERK_PUBLISHABLE_KEY` until `restore`. */
  publishableKey: string;
  /** The person, key id and name Clerk's recorded answer gives the valid key. */
  key: { personId: string; keyId: string; keyName: string };
  /**
   * Headers for a request from `personId` signed in, as a session token in the Authorization header. With
   * `authorizedParty`, the token names that origin as Clerk's do, for a middleware given `authorizedParties`.
   */
  signedIn(personId: string, options?: { authorizedParty?: string }): Promise<Record<string, string>>;
  /** Headers for a request with a key for agents: one Clerk accepts (`valid`, by default), or one it does not know. */
  withKey(which?: keyof typeof KEY_SECRETS): Record<string, string>;
  /** Puts back the fetch and the environment it found. Call it after each test. */
  restore(): void;
}

let signingKey: Promise<{ kid: string; privateKey: CryptoKey; jwk: JsonWebKey }> | null = null;

/** One key for the whole process, since Clerk keeps the key set it fetched for its secret key. */
function key() {
  signingKey ??= (async () => {
    const pair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    );
    return { kid: `ins_app_kit_${crypto.randomUUID()}`, privateKey: pair.privateKey, jwk: await crypto.subtle.exportKey('jwk', pair.publicKey) };
  })();
  return signingKey;
}

const base64url = (bytes: Uint8Array | string) =>
  Buffer.from(typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes).toString('base64url');

async function sessionToken(personId: string, authorizedParty: string | undefined): Promise<string> {
  const { kid, privateKey } = await key();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const payload = base64url(
    JSON.stringify({
      sub: personId,
      sid: `sess_app_kit_${personId}`,
      iss: ISSUER,
      iat: now,
      nbf: now - 5,
      exp: now + 60,
      v: 2,
      ...(authorizedParty ? { azp: authorizedParty } : {}),
    }),
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

/** Puts the stand-in in front of Clerk's Backend API; every other address is fetched as before. */
export function fakeClerkApi(): FakeClerkApi {
  const realFetch = globalThis.fetch;
  const env = { secret: process.env.CLERK_SECRET_KEY, publishable: process.env.CLERK_PUBLISHABLE_KEY };
  process.env.CLERK_SECRET_KEY = SECRET_KEY;
  process.env.CLERK_PUBLISHABLE_KEY = PUBLISHABLE_KEY;

  const answer = async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);
    if (request.headers.get('authorization') !== `Bearer ${SECRET_KEY}`) return Response.json({ errors: [{ code: 'authentication_invalid' }] }, { status: 401 });
    if (pathname === '/v1/jwks') {
      const { kid, jwk } = await key();
      return Response.json({ keys: [{ ...jwk, kid, use: 'sig', alg: 'RS256' }] });
    }
    if (pathname === '/api_keys/verify') {
      const { secret } = (await request.json()) as { secret?: string };
      const sample = secret === KEY_SECRETS.valid ? recorded.valid : recorded.notFound;
      return Response.json(sample.body, { status: sample.status });
    }
    throw new Error(`fakeClerkApi: no stand-in answer for ${request.method} ${pathname}`);
  };

  // Clerk reads the global fetch on each call while NODE_ENV is test, which bun test sets.
  const fake = Object.assign(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      return request.url.startsWith(`${CLERK_API}/`) ? answer(request) : realFetch(input, init);
    },
    { preconnect: realFetch.preconnect },
  ) as typeof fetch;
  globalThis.fetch = fake;

  return {
    secretKey: SECRET_KEY,
    publishableKey: PUBLISHABLE_KEY,
    key: { personId: recorded.valid.body.subject, keyId: recorded.valid.body.id, keyName: recorded.valid.body.name },
    signedIn: async (personId, options = {}) => ({ Authorization: `Bearer ${await sessionToken(personId, options.authorizedParty)}` }),
    withKey: (which = 'valid') => ({ Authorization: `Bearer ${KEY_SECRETS[which]}` }),
    restore: () => {
      if (globalThis.fetch === fake) globalThis.fetch = realFetch;
      for (const [name, value] of [
        ['CLERK_SECRET_KEY', env.secret],
        ['CLERK_PUBLISHABLE_KEY', env.publishable],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    },
  };
}
