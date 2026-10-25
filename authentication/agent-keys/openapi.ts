import { Hono, type Env, type Schema } from 'hono';
import { generateSpecs } from 'hono-openapi';
import type { SignedInCaller } from '.';

/** An OpenAPI description as `hono-openapi` generates it. */
export type OpenApiDescription = Awaited<ReturnType<typeof generateSpecs>>;

export interface OpenApiDescriptionOptions {
  /** The app's name, the description's title. */
  title: string;
  /** A sentence or two on what the API is for, in the app's own words. */
  description?: string;
  /** The API's version, `1` when not given. */
  version?: string;
  /** The same list `requireCaller` takes: the key's description holds only the GET routes in it. */
  readableByKey: readonly string[];
}

export interface OpenApiDescriptions {
  /** Every route the app described, for a signed-in person. */
  forPerson(): Promise<OpenApiDescription>;
  /** Only the GET routes a key may read, with no schema used only by another route, for an agent with a key. */
  forKey(): Promise<OpenApiDescription>;
  /**
   * The one the caller `callerOf` gives may see: a key's, or the whole for a session. Any other caller, signed out or a
   * key that could not be checked, is refused with an error rather than handed the whole description.
   */
  forCaller(caller: SignedInCaller): Promise<OpenApiDescription>;
}

// The kit takes any Hono app the app built, whatever its own environment and schema types.
type AnyApp = Hono<Env, Schema, string>;

/**
 * The app's OpenAPI descriptions, generated from the routes it described with `hono-openapi`'s `describeRoute` on first
 * use, after every route is registered, and kept for the life of the app. The key's description is generated from a copy
 * of the app holding only the GET routes a key may read, so it shows exactly those, by the strings the key check
 * compares, and carries no schema of a route a key cannot call. Both end with how to call the API with a key.
 */
export function openApiDescriptions(app: AnyApp, options: OpenApiDescriptionOptions): OpenApiDescriptions {
  const readable = new Set(options.readableByKey);
  let person: Promise<OpenApiDescription> | null = null;
  let key: Promise<OpenApiDescription> | null = null;

  const forKey = () =>
    (key ??= (async () => {
      const description = await generate(onlyRoutes(app, (route) => route.method === 'GET' && readable.has(route.name)), options);
      return withKeySection(description, options, description);
    })());
  const forPerson = () => (person ??= (async () => withKeySection(await generate(app, options), options, await forKey()))());

  const forCaller = (caller: SignedInCaller) => {
    if (caller.kind === 'key') return forKey();
    if (caller.kind === 'session') return forPerson();
    return Promise.reject(new Error(`no OpenAPI description for a caller who is ${(caller as { kind: string }).kind}`));
  };
  return { forPerson, forKey, forCaller };
}

/**
 * The listed GET routes a key may read that its description would not show with a summary: not described, described
 * with only a validator, or dropped by the generator. Catch-alls in the list (paths with `*`) are skipped, since they
 * answer for addresses no one describes. For an app's own test, which expects an empty list.
 */
export async function undescribedForKey(app: AnyApp, readableByKey: readonly string[]): Promise<string[]> {
  const listed = readableByKey.filter((entry) => entry.startsWith('GET ') && !entry.includes('*'));
  if (listed.length === 0) return ['no GET route is listed for keys'];
  const missing: string[] = [];
  for (const entry of listed) {
    const description = await generate(
      onlyRoutes(app, (route) => route.name === entry),
      { title: 'check' },
    );
    const operations = Object.values(description.paths ?? {}).flatMap((item) => (item?.get ? [item.get] : []));
    if (!operations.some((operation) => operation.summary || operation.description)) missing.push(entry);
  }
  return missing;
}

/**
 * Settings for Scalar's reference page that keep everything on the app's own host, to spread into `Scalar(...)` from
 * `@scalar/hono-api-reference`: its AI agent off (on by default on localhost, it uploads the description to Scalar), its
 * hosted proxy off (by default a test request from a deployed app goes through Scalar's server, with any key typed into
 * the page), its developer toolbar, fonts and telemetry off, and a first frame in the system's light or dark. Its script is pinned to one
 * release: unpinned, every page load would run whatever Scalar published last, on a page that carries the session.
 */
export const REFERENCE_PAGE_SETTINGS = {
  cdn: 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.76.0/dist/browser/standalone.js',
  agent: { disabled: true },
  proxyUrl: '',
  withDefaultFonts: false,
  telemetry: false,
  // Its developer toolbar (Share, Deploy, Generate SDK), which sends the description to Scalar's cloud, shown by
  // default on localhost.
  showDeveloperTools: 'never',
  customCss: ':root { color-scheme: light dark; } body { margin: 0; background: Canvas; color: CanvasText; }',
} as const;

/** A copy of the app holding the routes `keep` chooses, and every middleware entry for the tags and context they give. */
function onlyRoutes(app: AnyApp, keep: (route: { method: string; name: string }) => boolean): AnyApp {
  const copy: AnyApp = new Hono();
  for (const route of app.routes) {
    if (route.method === 'ALL' || keep({ method: route.method, name: `${route.method} ${route.path}` })) {
      copy.on(route.method, route.path, route.handler);
    }
  }
  return copy;
}

function generate(app: AnyApp, options: Pick<OpenApiDescriptionOptions, 'title' | 'description' | 'version'>) {
  return generateSpecs(app, {
    documentation: {
      info: { title: options.title, version: options.version ?? '1', description: options.description ?? '' },
      components: { securitySchemes: { key: { type: 'http', scheme: 'bearer', description: 'A key made in your account settings.' } } },
      security: [{ key: [] }],
    },
    // A path whose last part has a dot, such as /api/export.csv, is a route here, not a static file.
    excludeStaticFile: false,
  });
}

/** The description with a section on calling the API with a key, naming the routes in the key's description. */
function withKeySection(description: OpenApiDescription, options: OpenApiDescriptionOptions, forKey: OpenApiDescription) {
  const routes = Object.entries(forKey.paths ?? {}).flatMap(([path, item]) =>
    item?.get ? [`- \`GET ${path}\`${item.get.summary ? `: ${item.get.summary}` : ''}`] : [],
  );
  const section = [
    '## Calling this API with a key',
    '',
    'Send a key made in your account settings as `Authorization: Bearer <key>`. A key only reads: it reaches these GET routes and nothing else.',
    '',
    ...(routes.length ? routes : ['- none yet']),
    '',
    'A refused request says why: 401 when no key or session is sent, or the key is revoked, expired or unknown; 403 when the route is not one a key may read, or the request is not a GET; 503 when the key could not be checked with the sign-in provider, so try again shortly.',
  ].join('\n');
  return { ...description, info: { ...description.info, description: [options.description, section].filter(Boolean).join('\n\n') } };
}
