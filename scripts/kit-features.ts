// The kit's features an app should have once it takes the piece they belong to, for the apps report
// (.claude/skills/apps-round): each says which apps it is for and what in their landed code shows it, so an app that
// took a version but never turned an option on is found, as Argon was with one-tap iPhone sign-in. A change that adds a
// piece or option apps should have adds its entry here (AGENTS.md). test/kit-features.test.ts holds every entry to the
// kit's own names, so a rename fails the kit's tests rather than finding every app lacking or none.
//
// It reads what landed (the ref scripts/apps.ts reads) and Apple's copy of a site's association file; it changes nothing.

import { posix } from 'node:path'

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
  /** What the app has, in the words the report's page and an upgrade brief show. */
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

// The app's name, drawn by index.html before the code loads, then held by the sign-in gate until the first screen draws:
// never a blank page. Either way of drawing it is right: one picture that the finished screen replaces whole, as
// Getter's, or, for a signed-in screen that shows the name in a bar, a second picture there for a browser signed in last
// time, which firstPaint marks, and the same picture given to the gate. Which one an app needs depends on where its
// screen draws the name, which no search can see, so only a blank page, for either kind of browser, and a second
// picture left half done are lacking. (README, "The name before the code, in one picture or two".)

/** Which browsers a selector for the root's ::before applies to: those signed in last time, the others, or both. */
function browsersOf(selector: string): 'signed in' | 'signed out' | 'both' {
  if (/:not\(\s*\[data-signed-in-before\]\s*\)/.test(selector)) return 'signed out'
  return selector.includes('[data-signed-in-before]') ? 'signed in' : 'both'
}

/** For each kind of browser, whether the page's CSS draws a name in the root's ::before before the code loads. */
function namesDrawn(page: string): { signedIn: boolean; signedOut: boolean; secondPicture: boolean } {
  const drawn = { signedIn: false, signedOut: false, secondPicture: false }
  for (const [, selectors, body] of page.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    // A content of '' or none draws nothing, as no content does.
    if (!/(^|;|\s)content\s*:(?!\s*(''|""|none|normal)\s*(;|!|$))/.test(body!)) continue
    for (const selector of selectors!.split(',').filter((each) => each.includes('#root:empty::before'))) {
      const browsers = browsersOf(selector)
      if (browsers !== 'signed out') drawn.signedIn = true
      if (browsers !== 'signed in') drawn.signedOut = true
      if (browsers === 'signed in') drawn.secondPicture = true
    }
  }
  return drawn
}

/** A script in the page setting the mark itself. */
const PAGE_SETS_MARK = /<script[^>]*>[^<]*(data-signed-in-before|signedInBefore)/
const NAME_BEFORE_THE_CODE: Feature = {
  feature: 'the name drawn before the code, never a blank page',
  readme: 'The name before the code, in one picture or two',
  names: ['SignInGate', 'whileReturning', 'data-signed-in-before', 'app-kit/web/first-paint'],
  appliesTo: (app) => ships(app, 'SignInGate') && ships(app, importing('app-kit/web')),
  present: async (app) => {
    const pages = app.tracked
      .filter((path) => /(^|\/)index\.html$/.test(path) && !path.includes('node_modules/'))
      .map((path) => app.show(path))
      .filter((text) => /id=["']root["']/.test(text))
    // The page that draws the name; any one does, as an app with a second page for another purpose has.
    const drawn = pages.map(namesDrawn).find((each) => each.signedIn && each.signedOut)
    if (!drawn) return 'lacks'
    // Rendered under any name, as Timescale renders the kit's gate as KitSignInGate, so the setting is looked for anywhere.
    if (ships(app, 'whileReturning[[:space:]]*=[[:space:]]*\\{[[:space:]]*null[[:space:]]*\\}')) return 'lacks'
    if (!drawn.secondPicture) return 'has'
    const marked = ships(app, 'firstPaint\\(') || ships(app, 'data-signed-in-before') || pages.some((text) => PAGE_SETS_MARK.test(text))
    return has(marked && ships(app, 'whileReturning[[:space:]]*='))
  },
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

// A privacy policy or terms page drawn by the app reaches a reader that runs no JavaScript as the empty index page: the
// Chrome Web Store's check of a privacy link refused Getter's for that. An app on the kit's web part with such an
// address writes its public pages at build and has its server send them.
const PUBLIC_PAGES: Feature = {
  feature: 'public pages sent as finished HTML',
  readme: 'Public pages as finished HTML',
  names: ['app-kit/web/public-pages', 'writePublicPages', 'publicPages'],
  appliesTo: (app) => ships(app, importing('app-kit/web(/[a-z-]+)?')) && ships(app, '[\'"`]/(privacy|terms)[\'"`/?#]'),
  present: async (app) => has(ships(app, importing('app-kit/web/public-pages')) && ships(app, 'publicPages[[:space:]]*:[[:space:]]*true')),
}

/** A shell's Rust, leaving out its dependencies and tests. */
const SHELL_RUST = [':(glob)**/*.rs', ':(exclude,glob)**/node_modules/**', ':(exclude,glob)**/target/**', ':(exclude,glob)**/tests/**']
const OPENS_THE_SITE = 'WebviewUrl::External'

const START_PAGE: Feature = {
  feature: "the window opens on the kit's start page",
  readme: 'A window onto the hosted site',
  names: ['tauri-plugin-app-kit-window', 'start_page_window', OPENS_THE_SITE],
  // A window onto the site that opens straight on it is blank with no connection; a shell with a bundled page of its
  // own, as Timescale's, metamax's phone app's and urge-surfer's, is not asked.
  appliesTo: (app) =>
    app.grep('tauri-plugin-app-kit-window', [':(glob)**/Cargo.toml', ':(exclude,glob)**/node_modules/**']).length > 0 &&
    app.grep(`(${OPENS_THE_SITE}|start_page_window)`, SHELL_RUST).length > 0,
  present: async (app) => has(app.grep(OPENS_THE_SITE, SHELL_RUST).length === 0),
}

// A Mac app on the window plugin's menu opens when the person logs in, which practices' desktop app rule asks of every
// Mac app, through the kit's Settings window. Only an app whose window opens on the kit's start page can take it, since
// the window is a page bundled beside it; an app whose bundle is its hosted site, as Argon's, is not asked. The
// autostart plugin is not counted: its switch can say on after System Settings turned it off.
const OPEN_AT_LOGIN_CALL = 'settings_window'
const OPEN_AT_LOGIN: Feature = {
  feature: 'opens at login on the Mac, from Settings',
  readme: 'A window onto the hosted site',
  names: ['tauri-plugin-app-kit-window', 'AppMenu', OPEN_AT_LOGIN_CALL],
  appliesTo: (app) =>
    app.grep('tauri-plugin-app-kit-window', [':(glob)**/Cargo.toml', ':(exclude,glob)**/node_modules/**']).length > 0 &&
    app.grep('AppMenu::new', SHELL_RUST).length > 0 &&
    app.tracked.some((path) => /(^|\/)tauri\.conf\.json$/.test(path) && app.show(path).includes('app-kit/tauri/window/start')),
  present: async (app) => has(app.grep(`\\.${OPEN_AT_LOGIN_CALL}\\(`, SHELL_RUST).length > 0),
}

// An extension whose toolbar icons are drawn in one colour (--toolbar-color in a package.json script) shows them dark on
// a dark toolbar unless its worker turns on toolbar-icon.js. The kit's copy of that file defines the function and the
// copied hidden page imports from it, so what counts is a file that imports it and calls it. Chrome's own Light or Dark
// setting reaches the worker only from pages Chrome draws: each of the extension's own pages its manifest names (popup,
// options, side panel) loads color-scheme.js, and an extension with access to websites, or one it may ask for, holds
// "scripting", which lets the worker read its tabs.
const TOOLBAR_ICON_CALL = 'toolbarIconFollowsMode'
const TOOLBAR_ICON_PAGE_SCRIPT = 'color-scheme.js'
const TOOLBAR_ICON: Feature = {
  feature: 'toolbar icon that follows dark mode',
  readme: 'Toolbar icon in dark mode',
  names: [TOOLBAR_ICON_CALL, '--toolbar-color', 'toolbar-icon.js', TOOLBAR_ICON_PAGE_SCRIPT],
  appliesTo: (app) => app.tracked.some((path) => /(^|\/)package\.json$/.test(path) && !path.includes('node_modules/') && app.show(path).includes('--toolbar-color')),
  present: async (app) => {
    const calls = app.grep(importing(`[^'"]*/toolbar-icon\\.js`), SHIPPED).some((path) => new RegExp(`\\b${TOOLBAR_ICON_CALL}\\s*\\(`).test(app.show(path)))
    const manifests = extensionManifests(app)
    return has(calls && manifests.length > 0 && manifests.every(({ folder, manifest }) => toolbarIconWired(app, folder, manifest)))
  },
}

type ExtensionManifest = {
  permissions?: string[]
  host_permissions?: string[]
  optional_host_permissions?: string[]
  action?: { default_popup?: string }
  options_page?: string
  options_ui?: { page?: string }
  side_panel?: { default_path?: string }
}

/** Each extension manifest the app tracks, with the folder its paths start from. */
function extensionManifests(app: Landed): { folder: string; manifest: ExtensionManifest }[] {
  return app.tracked
    // The manifests an app ships, never a test's fixture extension, as SHIPPED leaves out tests.
    .filter((path) => /(^|\/)manifest\.json$/.test(path) && !/(^|\/)(node_modules|test|tests|e2e|\.[^/]+)\//.test(path))
    .flatMap((path) => {
      try {
        const manifest = JSON.parse(app.show(path)) as ExtensionManifest & { manifest_version?: number }
        return manifest.manifest_version ? [{ folder: path.slice(0, path.length - 'manifest.json'.length), manifest }] : []
      } catch {
        return []
      }
    })
}

/**
 * Whether every page the manifest names loads color-scheme.js, by a script tag or from a script of its own that imports
 * it, and an extension reaching websites holds "scripting".
 */
function toolbarIconWired(app: Landed, folder: string, manifest: ExtensionManifest) {
  const pages = [manifest.action?.default_popup, manifest.options_page, manifest.options_ui?.page, manifest.side_panel?.default_path].filter((page): page is string => typeof page === 'string')
  const named = new RegExp(`(^|/)${TOOLBAR_ICON_PAGE_SCRIPT.replace('.', '\\.')}$`)
  const imported = new RegExp(`(import|from)\\s*\\(?\\s*["'][^"']*/${TOOLBAR_ICON_PAGE_SCRIPT.replace('.', '\\.')}["']`)
  const loadsScript = pages.every((page) => {
    const path = posix.normalize(folder + page.replace(/^\//, ''))
    const sources = [...app.show(path).matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/g)].map((match) => match[1]!)
    return sources.some((source) => named.test(source) || imported.test(app.show(posix.normalize(source.startsWith('/') ? folder + source.slice(1) : posix.join(posix.dirname(path), source)))))
  })
  // Access it may be granted later counts too: the worker registers its tab script once it is.
  const reachesWebsites = [...(manifest.host_permissions ?? []), ...(manifest.optional_host_permissions ?? [])].some((origin) => /^(<all_urls>|(\*|https?):\/\/)/.test(origin))
  return loadsScript && (!reachesWebsites || (manifest.permissions ?? []).includes('scripting'))
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
  NAME_BEFORE_THE_CODE,
  GOOGLE_ANSWERS,
  FIELDS_NEVER_ZOOM,
  PUBLIC_PAGES,
  START_PAGE,
  OPEN_AT_LOGIN,
  TOOLBAR_ICON,
]

/**
 * An app's files at `ref` in the checkout `dir`. One git process lists them, the first question reads every file's text
 * in one more, and every question is answered in memory: a git process per question took the entries' tests past bun's
 * 5 seconds on a busy Mac, where starting a process costs 10 to 100 ms. `grep` answers as `git grep -l -E` does in the
 * C locale, which test/kit-features-landed.test.ts holds for every search the entries make. `env` is git's environment;
 * the tests pass one with git itself first on the path, since Xcode's /usr/bin/git looks git up again on every call,
 * three times git's own cost.
 */
export function landedAt(dir: string, ref: string, env: Record<string, string | undefined> = process.env): Landed {
  const git = (args: string[], stdin?: string) =>
    Bun.spawnSync(['git', '-C', dir, ...args], { env, stdin: stdin === undefined ? undefined : Buffer.from(stdin), stdout: 'pipe', stderr: 'pipe' })
  const listed = git(['ls-tree', '-r', '-z', ref])
  const entries = (listed.exitCode === 0 ? listed.stdout.toString() : '')
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const tab = record.indexOf('\t')
      const [mode = '', type = '', id = ''] = record.slice(0, tab).split(' ')
      return { path: record.slice(tab + 1), mode, type, id }
    })
  const byPath = new Map(entries.map((entry) => [entry.path, entry]))
  let read: Map<string, Buffer> | undefined
  // Every blob's bytes by its id, read in one git process the first time any is asked for.
  const bytes = (id: string): Buffer => {
    if (!read) {
      read = new Map()
      const ids = [...new Set(entries.filter((entry) => entry.type === 'blob').map((entry) => entry.id))]
      if (ids.length) {
        const p = git(['cat-file', '--batch'], `${ids.join('\n')}\n`)
        if (p.exitCode !== 0) throw new Error(`git cat-file in ${dir}: ${p.stderr.toString()}`)
        const out = p.stdout
        for (let at = 0; at < out.length; ) {
          const end = out.indexOf(10, at)
          const [each = '', type = '', size = '0'] = out.subarray(at, end).toString().split(' ')
          const body = type === 'missing' ? Buffer.alloc(0) : out.subarray(end + 1, end + 1 + Number(size))
          read.set(each, body)
          at = type === 'missing' ? end + 1 : end + 1 + Number(size) + 1
        }
      }
    }
    return read.get(id) ?? Buffer.alloc(0)
  }
  return {
    tracked: entries.map((entry) => entry.path),
    show: (file) => {
      const entry = byPath.get(file)
      return entry?.type === 'blob' ? bytes(entry.id).toString('utf8') : ''
    },
    grep: (pattern, pathspecs) => {
      const matches = pathspecMatcher(pathspecs)
      const expression = ereToRegExp(pattern)
      // git grep searches regular files only: never a symlink's target or a submodule.
      const candidates = entries.filter((entry) => (entry.mode === '100644' || entry.mode === '100755') && matches(entry.path))
      return candidates
        .filter((entry) => {
          // Byte for character, as git reads them in the C locale. Lines end at \n alone, so a \r stays on its line, and the
          // end after a file's last \n is one more, empty line, as git's search of the whole file finds `^$` there.
          return bytes(entry.id)
            .toString('latin1')
            .split('\n')
            .some((line) => expression.test(line))
        })
        .map((entry) => entry.path)
    },
  }
}

/**
 * Whether a path is among those `pathspecs` name, as git reads `:(glob)` and `:(exclude,glob)` pathspecs, the only forms
 * the entries use: kept when it matches any include (or there is none) and no exclude.
 */
export function pathspecMatcher(pathspecs: string[]): (path: string) => boolean {
  const includes: RegExp[] = []
  const excludes: RegExp[] = []
  for (const pathspec of pathspecs) {
    const form = /^:\((glob|exclude,glob)\)(.+)$/.exec(pathspec)
    if (!form) throw new Error(`landedAt reads only :(glob) and :(exclude,glob) pathspecs, not ${pathspec}`)
    ;(form[1] === 'glob' ? includes : excludes).push(globToRegExp(form[2]!))
  }
  return (path) => (includes.length === 0 || includes.some((glob) => glob.test(path))) && !excludes.some((glob) => glob.test(path))
}

/**
 * git's glob pathspec as a regular expression over the whole path: a double star as a whole folder name matches no
 * folder or any, one at the end everything inside, and `*` and `?` stop at a slash. Any other double star or a bracket
 * throws.
 */
function globToRegExp(glob: string): RegExp {
  let source = ''
  for (let at = 0; at < glob.length; at++) {
    if (glob.startsWith('**/', at) && (at === 0 || glob[at - 1] === '/')) {
      source += '(?:.*/)?'
      at += 2
    } else if (glob.startsWith('/**', at) && at + 3 === glob.length) {
      source += '/.*'
      at += 2
    } else if (glob[at] === '*') {
      if (glob[at + 1] === '*') throw new Error(`landedAt reads ** only as a whole folder name, not in ${glob}`)
      source += '[^/]*'
    } else if (glob[at] === '?') source += '[^/]'
    else if (glob[at] === '[' || glob[at] === '\\') throw new Error(`landedAt reads no brackets or backslashes in a pathspec, as in ${glob}`)
    else source += glob[at]!.replace(/[.+^$(){}|\]]/, '\\$&')
  }
  return new RegExp(`^${source}$`)
}

// The POSIX classes in the C locale, ASCII only.
const CLASSES: Record<string, string> = { space: ' \\t\\n\\r\\f\\v', alnum: 'A-Za-z0-9', alpha: 'A-Za-z', digit: '0-9', upper: 'A-Z', lower: 'a-z' }

/**
 * A POSIX extended regular expression as JavaScript reads it the same way, line by line. What the two read differently
 * throws rather than answering wrong: a class it does not know, a backslash before a letter or digit (`\s` is git's
 * own extension under -E, `\b` and `\w` differ), a bracket opening with `]`, and any character outside ASCII.
 */
export function ereToRegExp(pattern: string): RegExp {
  const refuse = (why: string) => new Error(`landedAt cannot read ${pattern} as git does: ${why}`)
  let source = ''
  for (let at = 0; at < pattern.length; at++) {
    const c = pattern[at]!
    if (c.charCodeAt(0) > 0x7e || c.charCodeAt(0) < 0x20) throw refuse('a character outside printable ASCII')
    if (c === '\\') {
      const next = pattern[at + 1]
      if (next === undefined || /[A-Za-z0-9]/.test(next)) throw refuse(`\\${next ?? ''}`)
      source += `\\${next}`
      at++
    } else if (c === '[') {
      let end = at + 1
      let body = ''
      if (pattern[end] === '^') body += pattern[end++]
      if (pattern[end] === ']') throw refuse('a bracket opening with ]')
      for (; end < pattern.length && pattern[end] !== ']'; end++) {
        if (pattern.startsWith('[:', end)) {
          const close = pattern.indexOf(':]', end + 2)
          const name = close < 0 ? '' : pattern.slice(end + 2, close)
          if (!CLASSES[name]) throw refuse(`the class [:${name}:]`)
          body += CLASSES[name]
          end = close + 1
        } else if (pattern.startsWith('[.', end) || pattern.startsWith('[=', end)) throw refuse('a collating element')
        else if (pattern[end] === '[' || pattern[end] === '\\') body += `\\${pattern[end]}`
        else body += pattern[end]
      }
      if (end >= pattern.length) throw refuse('a bracket that never closes')
      source += `[${body}]`
      at = end
    } else source += c
  }
  // `s`, since in git's expressions `.` matches a \r, and the lines searched never hold a \n.
  return new RegExp(source, 's')
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
