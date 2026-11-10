// The kit's features an app should have once it takes the piece they belong to, for the apps round
// (.claude/skills/apps-round): each says which apps it is for and what in their landed code shows it, so an app that
// took a version but never turned an option on is found, as Argon was with one-tap iPhone sign-in. A change that adds a
// piece or option apps should have adds its entry here (AGENTS.md). test/kit-features.test.ts holds every entry to the
// kit's own names, so a rename fails the kit's tests rather than finding every app lacking or none.
//
// It reads what landed (the ref scripts/apps.ts reads) and Apple's copy of a site's association file; it changes nothing.

/** An app's files as they landed at one ref. */
export type Landed = {
  /** Every tracked path. */
  tracked: string[]
  /** One file's text, or '' when it is not there. */
  show: (file: string) => string
  /** The paths whose text matches a POSIX extended regular expression (no backslash-s: write [[:space:]]), among those `pathspecs` name. */
  grep: (pattern: string, pathspecs: string[]) => string[]
}

/** What Apple's servers answer for a site's association file: its status and body, or why there is no answer. */
export type AppleLookup = (host: string) => Promise<{ status: number; body: string } | { failed: string }>

export type Verdict = 'has' | 'lacks' | { unknown: string }

export type Feature = {
  /** What the app has, in the words the round's brief and page show. */
  feature: string
  /** The README heading that says how. */
  readme: string
  /** Import names and words of the kit's the entry looks for, each held to the kit's own code by its test. */
  names: string[]
  appliesTo: (app: Landed) => boolean
  present: (app: Landed, apple: AppleLookup) => Promise<Verdict>
}

/** Code an app ships, leaving out its tests, its dependencies and dot-folders (plans, tool settings). */
export const SHIPPED = [
  ...['ts', 'tsx', 'js', 'jsx', 'mjs'].map((ext) => `:(glob)**/*.${ext}`),
  ':(exclude,glob)**/node_modules/**',
  ':(exclude,glob)**/.*/**',
  ':(exclude,glob)**/*.test.*',
  ':(exclude,glob)**/*.spec.*',
  ':(exclude,glob)**/test/**',
  ':(exclude,glob)**/tests/**',
  ':(exclude,glob)**/e2e/**',
]

const ONE_TAP: Feature = {
  feature: 'one-tap iPhone sign-in configured',
  readme: 'Sign-in with one tap',
  names: ['app-kit/tauri/iphone-sign-in', 'handBackOverHttps'],
  appliesTo: (app) => app.grep('app-kit/tauri/iphone-sign-in', SHIPPED).length > 0,
  // The page asks for it, the iPhone build's entitlement names a site, and Apple's copy of that site's file names the
  // app built beside that entitlement. Whether a given phone has fetched the file no search can see, which is why this
  // says configured: the README's "Sign-in with one tap" says when iOS still falls back to the click.
  present: async (app, apple) => {
    if (!app.grep('handBackOverHttps[[:space:]]*:[[:space:]]*true', SHIPPED).length) return 'lacks'
    const builds = app.tracked
      .filter((path) => path.endsWith('.entitlements') && path.includes('/gen/apple/'))
      .flatMap((path) => {
        // A site with ?mode=developer is skipped: the README's step 4 says the build names it without, since iOS reads
        // the site's file from Apple's servers only for a site named plainly.
        const host = app.show(path).match(/webcredentials:([a-z0-9.-]+)(?![a-z0-9.?-])/i)?.[1]
        const conf = `${path.slice(0, path.indexOf('/gen/apple/'))}/tauri.conf.json`
        const identifier = (() => {
          try {
            return (JSON.parse(app.show(conf)) as { identifier?: string }).identifier
          } catch {
            return undefined
          }
        })()
        return host && identifier ? [{ host, identifier }] : []
      })
    if (!builds.length) return 'lacks'
    // Every build is asked, so one site Apple did not answer for never hides another that names the app.
    let unread: string | undefined
    for (const { host, identifier } of builds) {
      const answer = await apple(host)
      if ('failed' in answer) {
        unread ??= `Apple's copy of ${host}'s association file could not be read: ${answer.failed}`
        continue
      }
      if (answer.status === 404) continue
      if (answer.status !== 200) {
        unread ??= `Apple answered ${answer.status} for ${host}'s association file`
        continue
      }
      // A file with no webcredentials apps is a site set up for something else, which is a gap; a body that is not
      // JSON, or an apps entry that is there and not a list (null included), is an answer this cannot read.
      const apps = (() => {
        try {
          const credentials = (JSON.parse(answer.body) as { webcredentials?: { apps?: unknown } }).webcredentials
          return { read: credentials && 'apps' in credentials ? credentials.apps : [] }
        } catch {
          return { read: undefined }
        }
      })().read
      if (!Array.isArray(apps)) {
        unread ??= `Apple's copy of ${host}'s association file could not be read as a list of webcredentials apps`
        continue
      }
      if (apps.some((entry) => typeof entry === 'string' && entry.endsWith(`.${identifier}`))) return 'has'
    }
    if (unread) return { unknown: unread }
    return 'lacks'
  },
}

/** Whether code the app ships matches the pattern. */
const ships = (app: Landed, pattern: string, also: string[] = []) => app.grep(pattern, [...SHIPPED, ...also]).length > 0
const has = (yes: boolean): Verdict => (yes ? 'has' : 'lacks')
const importing = (name: string) => `from[[:space:]]*['"]${name}['"]`

// The kit's sign-in check for a server, or Clerk's own pieces used on it by hand. An app whose server sets up Clerk and
// decides for itself whether sign-in is on, as Getter's and Sightline's DEV_BYPASS_AUTH switch does, can come up open
// on Railway when a setting is missing; the kit's check refuses to start there.
const HOSTED_SIGN_IN: Feature = {
  feature: 'hosted sign-in decided by the kit',
  readme: 'Sign-in when hosted',
  names: ['app-kit/authentication/clerk/server', 'app-kit/authentication/server-sign-in', 'clerkServerSignIn', 'serverSignIn'],
  appliesTo: (app) =>
    ships(app, importing('(@clerk/(hono|backend|express|fastify)(/[a-z]+)?|@hono/clerk-auth|app-kit/authentication/clerk/server)')),
  present: async (app) => has(ships(app, '(clerkServerSignIn|serverSignIn)\\(')),
}

// The tracked Railway settings an app deploys with: Railway's settings file, .railway/railway.ts, which Railway's command
// line applies to the project (a deploy never reads it), railway.json or railway.toml, which Railway reads on each deploy
// only until 2026-12-01, or a script of its own that sets them through Railway's API, as Sightline's
// scripts/railway-settings.ts does.
const SETTINGS_FILE = /(^|\/)\.railway\/railway\.ts$/
const OLD_FILE = /(^|\/)railway\.(json|toml)$/
const onRailway = (app: Landed) =>
  app.tracked.some((path) => SETTINGS_FILE.test(path) || OLD_FILE.test(path) || /(^|\/)scripts\/[^/]*railway[^/]*$/i.test(path))

// The kit's clean stop runs only when Railway waits for it, and Railway kills the server at once unless the draining
// time is set; a 0 is the same as none. Railway's settings file has no draining option, so it is the service's
// RAILWAY_DEPLOYMENT_DRAINING_SECONDS variable, set in that file's env, by a settings script, or in Railway itself,
// which only the app's own words say, as Urge Surfer's server.ts and README do. railway.json's drainingSeconds is not
// counted: Railway stops reading the file on 2026-12-01. The settings file is searched on its own, since SHIPPED leaves
// out dot-folders and git applies an exclusion after every path it is given.
const DRAINING_VARIABLE = 'RAILWAY_DEPLOYMENT_DRAINING_SECONDS[\'"]?[[:space:]]*[:=][[:space:]]*[\'"]?[1-9]'
const DRAINING: Feature = {
  feature: "Railway's draining time set for the kit's clean stop",
  readme: 'Starting the server',
  names: ['app-kit/server/start', 'listen', 'RAILWAY_DEPLOYMENT_DRAINING_SECONDS'],
  appliesTo: (app) => {
    const callers = new Set(app.grep('(^|[^.[:alnum:]_])listen\\(', SHIPPED))
    return onRailway(app) && app.grep(importing('app-kit/server/start'), SHIPPED).some((path) => callers.has(path))
  },
  present: async (app) =>
    has(ships(app, DRAINING_VARIABLE, [':(glob)*.md']) || app.grep(DRAINING_VARIABLE, [':(glob)**/.railway/railway.ts']).length > 0),
}

// An app deploying from railway.json or railway.toml loses those settings when Railway stops reading them on
// 2026-12-01: its start and pre-deploy commands, its health check. It has moved them once Railway's settings file is
// tracked and no old file is; whether the file was applied to Railway no search can see, which the README's steps say.
const RAILWAY_SETTINGS: Feature = {
  feature: "Railway's settings in .railway/railway.ts",
  readme: "Railway's settings",
  names: ['defineRailway'],
  appliesTo: (app) => app.tracked.some((path) => SETTINGS_FILE.test(path) || OLD_FILE.test(path)),
  present: async (app) => has(app.tracked.some((path) => SETTINGS_FILE.test(path)) && !app.tracked.some((path) => OLD_FILE.test(path))),
}

// A server built on Hono: its app made with appServer has the request log, the refusal of writes other websites send,
// the health route and errors as JSON, where one made with new Hono() for itself has what it wrote. A router an app
// mounts on its appServer is a new Hono() too, which is why the check is for appServer anywhere, not for no new Hono().
const APP_SERVER: Feature = {
  feature: "server started with the kit's appServer",
  readme: 'Starting the server',
  names: ['app-kit/server/start', 'appServer'],
  appliesTo: (app) => ships(app, 'new Hono[<(]'),
  present: async (app) => has(ships(app, 'appServer\\(')),
}

const BUILD_MANIFEST: Feature = {
  feature: "Vite's build manifest for serveBuiltPage",
  readme: 'A page open across a deploy',
  names: ['app-kit/web/server', 'serveBuiltPage'],
  appliesTo: (app) => ships(app, 'serveBuiltPage\\('),
  present: async (app) =>
    has(app.tracked.some((path) => /(^|\/)vite\.config\.[cm]?[jt]s$/.test(path) && /manifest\s*:\s*true/.test(app.show(path)))),
}

// The start-up file keeps each test process's temporary files out of the system folder. A preload of the app's own,
// as Friends and Family, Neighbors and Metamax have, is a copy of it written before the kit had one.
const TEST_START_UP: Feature = {
  feature: "the kit's test start-up file",
  readme: 'The test start-up file',
  names: ['app-kit/testing/start-up'],
  appliesTo: (app) => app.grep(importing('bun:test'), [':(glob)**/*', ':(exclude,glob)**/node_modules/**']).length > 0,
  present: async (app) =>
    has(app.tracked.some((path) => /(^|\/)bunfig\.toml$/.test(path) && app.show(path).includes('app-kit/testing/start-up'))),
}

// An app whose schema is Drizzle's Postgres one; an app on SQLite is not asked.
const OPEN_DB: Feature = {
  feature: "Postgres opened with the kit's openDb",
  readme: 'The Postgres database',
  names: ['app-kit/server/postgres', 'openDb'],
  appliesTo: (app) => ships(app, importing('drizzle-orm/pg-core')),
  present: async (app) => has(ships(app, importing('app-kit/server/postgres'))),
}

/** Each opening tag of `name` in the text, from its `<` to its own `>`, reading past a `>` inside braces. */
function openingTags(text: string, name: string): string[] {
  const tags: string[] = []
  for (let at = text.indexOf(`<${name}`); at >= 0; at = text.indexOf(`<${name}`, at + 1)) {
    if (/[\w.]/.test(text[at + name.length + 1] ?? '')) continue
    let depth = 0
    let end = at
    for (; end < text.length; end++) {
      if (text[end] === '{') depth++
      else if (text[end] === '}') depth--
      else if (text[end] === '>' && depth === 0) break
    }
    tags.push(text.slice(at, end + 1))
  }
  return tags
}

// With the sign-in gate, the error boundary draws the gate's placeholder while it asks whether a newer build is out,
// so a crash during a deploy shows one steady screen; given none, the crash screen shows first. One boundary with it
// is enough: a boundary around one part of a page needs none.
const BOUNDARY_PLACEHOLDER: Feature = {
  feature: "the error boundary's placeholder",
  readme: 'A page open across a deploy',
  names: ['ErrorBoundary', 'SignInGate', 'placeholder'],
  appliesTo: (app) => ships(app, '<SignInGate([[:space:]]|>|$)') && ships(app, '<ErrorBoundary([[:space:]]|>|$)'),
  present: async (app) =>
    has(
      app
        .grep('<ErrorBoundary([[:space:]]|>|$)', SHIPPED)
        .some((path) => openingTags(app.show(path), 'ErrorBoundary').some((tag) => /\splaceholder=/.test(tag))),
    ),
}

// Calls Google's APIs with a grant the app holds: Gmail, Calendar, Drive, Docs, Sheets, Tasks, People and the token
// endpoint. A key-only API (Books) and Google's fonts are not, and a scope's address (www.googleapis.com/auth/…) is a
// name, not a call. Only the server's code: the reader is for an app's server, and an extension's is left out.
const GOOGLE_ANSWERS: Feature = {
  feature: "Google's answers read by the kit",
  readme: 'What a refusal from Google means',
  names: ['app-kit/server/google', 'readGoogleResponse'],
  appliesTo: (app) =>
    app.grep('https://((gmail|oauth2|people|drive|docs|sheets|tasks)\\.googleapis\\.com|www\\.googleapis\\.com/(calendar|gmail|drive|tasks|oauth2))', [
      ...SHIPPED,
      ':(exclude,glob)**/extension/**',
      ':(exclude,glob)**/chrome-extension/**',
    ]).length > 0,
  present: async (app) => has(ships(app, importing('app-kit/server/google'))),
}

// An iPhone app on MUI: a field under 16 pixels makes the iPhone zoom into it as it takes focus. A field set to 16
// pixels by hand stops the zoom but no longer grows with Text Size, which fieldsNeverZoom's max(16px, 1rem) does.
const FIELDS_NEVER_ZOOM: Feature = {
  feature: 'fields that never zoom on the iPhone',
  readme: 'Text size',
  names: ['fieldsNeverZoom', 'FIELD_FONT_SIZE'],
  appliesTo: (app) => app.tracked.some((path) => path.includes('/gen/apple/')) && ships(app, importing('@mui/material(/[A-Za-z]+)?')),
  present: async (app) => has(ships(app, '(fieldsNeverZoom|FIELD_FONT_SIZE)')),
}

export const FEATURES: Feature[] = [
  ONE_TAP,
  HOSTED_SIGN_IN,
  DRAINING,
  RAILWAY_SETTINGS,
  APP_SERVER,
  BUILD_MANIFEST,
  TEST_START_UP,
  OPEN_DB,
  BOUNDARY_PLACEHOLDER,
  GOOGLE_ANSWERS,
  FIELDS_NEVER_ZOOM,
]

/** An app's files at `ref` in the checkout `dir`, through git. */
export function landedAt(dir: string, ref: string): Landed {
  const git = (args: string[]) => {
    const p = Bun.spawnSync(['git', '-C', dir, ...args], { stdout: 'pipe', stderr: 'pipe' })
    return { ok: p.exitCode === 0, out: p.stdout.toString() }
  }
  const tracked = git(['ls-tree', '-r', '--name-only', ref]).out.split('\n').filter(Boolean)
  return {
    tracked,
    show: (file) => {
      const shown = git(['show', `${ref}:${file}`])
      return shown.ok ? shown.out : ''
    },
    // git grep exits 1 for no match, which is an answer, not a failure.
    grep: (pattern, pathspecs) =>
      git(['grep', '-l', '-E', pattern, ref, '--', ...pathspecs])
        .out.split('\n')
        .filter(Boolean)
        .map((line) => line.slice(ref.length + 1)),
  }
}

/** Apple's servers, which iOS reads a site's association file from (README, "Sign-in with one tap", step 2). */
export const appleServers: AppleLookup = async (host) => {
  try {
    const response = await fetch(`https://app-site-association.cdn-apple.com/a/v1/${host}`, { signal: AbortSignal.timeout(15_000) })
    return { status: response.status, body: await response.text() }
  } catch (error) {
    return { failed: error instanceof Error ? error.message : String(error) }
  }
}

/** The features an app should have and lacks, and those whose answer could not be read, each with why. */
export async function featuresOf(app: Landed, apple: AppleLookup): Promise<{ lacks: string[]; unknown: string[] }> {
  const lacks: string[] = []
  const unknown: string[] = []
  for (const entry of FEATURES) {
    if (!entry.appliesTo(app)) continue
    const verdict = await entry.present(app, apple)
    if (verdict === 'lacks') lacks.push(entry.feature)
    else if (verdict !== 'has') unknown.push(`${entry.feature}: ${verdict.unknown}`)
  }
  return { lacks, unknown }
}
