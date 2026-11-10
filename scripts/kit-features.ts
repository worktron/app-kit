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
      // JSON, or an apps entry that is not a list, is an answer this cannot read.
      const apps = (() => {
        try {
          return { read: (JSON.parse(answer.body) as { webcredentials?: { apps?: unknown } }).webcredentials?.apps ?? [] }
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

export const FEATURES: Feature[] = [ONE_TAP]

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
