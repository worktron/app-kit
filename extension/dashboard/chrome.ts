// The Chrome the Store's dashboard is driven in: Google Chrome with a profile of its own under app-kit's state folder,
// which the owner signs in to by hand once. Chrome refuses every extension on Web Store pages, Claude in Chrome
// included, but not its own DevTools connection, so a run starts this profile headless, with no window, with a
// debugging port and drives it through Playwright. Sign-in is the one time a window opens: it starts the profile with
// no debugging or automation switch at all, so Google's sign-in sees an ordinary browser. Playwright's own launch is not used: it always adds --use-mock-keychain, which encrypts cookies
// with a fixed key instead of the Mac's Keychain, so the profile the owner signed in to would read as signed out.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readlinkSync, unlinkSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import type { Browser } from 'playwright'
import { alive, appendLog, lock, stateFolder } from '../../tauri/state.ts'

/** The folder the dashboard's Chrome profile, its lock, log and each run's screenshots live in. */
export function dashboardFolder(env: Record<string, string | undefined> = process.env): string {
  return stateFolder('store-dashboard', env)
}

/**
 * The developer dashboard's address. Opened bare, it forwards to the signed-in account's publisher page,
 * `/devconsole/<publisher>`, which is how a run learns the publisher. The newer
 * chromewebstore.google.com/u/0/dashboard addresses forward to the Store's home page instead.
 */
export const CONSOLE = 'https://chrome.google.com/webstore/devconsole'

/** The publisher in a developer dashboard address, or undefined when the address is not one. */
export function publisherIn(address: string): string | undefined {
  const url = new URL(address)
  if (url.hostname !== 'chrome.google.com') return undefined
  return /^\/webstore\/devconsole\/([0-9a-f-]{36})(\/|$)/.exec(url.pathname)?.[1]
}

/** The dashboard's address for one item of one publisher. */
export function itemAddress(publisher: string, item: string): string {
  return `${CONSOLE}/${encodeURIComponent(publisher)}/${encodeURIComponent(item)}/edit`
}

/** Thrown when the profile is not signed in, or Google asks to sign in again. */
export class SignedOut extends Error {
  constructor() {
    super('The dashboard profile is not signed in to Google. Run: app-kit extension dashboard sign-in')
  }
}

/** Writes a line to the dashboard's log, with the time. */
export function log(line: string, folder = dashboardFolder()): void {
  appendLog(join(folder, 'dashboard.log'), `${new Date().toISOString()} ${line}`)
}

/**
 * The pid of a Chrome that has the profile open, from the SingletonLock link Chrome keeps in it (`<host>-<pid>`), or
 * undefined when none does.
 */
export function chromeHolding(profile: string): number | undefined {
  try {
    const pid = Number(readlinkSync(join(profile, 'SingletonLock')).split('-').pop())
    return pid && alive(pid) ? pid : undefined
  } catch {
    return undefined
  }
}

/**
 * Runs `work` holding the dashboard's lock, so one run at a time uses the profile. A second run fails at once, naming
 * the process that holds it, as does a run while a Chrome has the profile open (a sign-in window left open).
 */
export async function withProfile<T>(work: (profile: string) => Promise<T>, folder = dashboardFolder()): Promise<T> {
  const file = join(folder, 'profile.lock')
  if (!lock(file)) throw new Error(`Another app-kit dashboard run holds ${file} (process ${readPid(file)}); wait for it to end.`)
  try {
    const profile = join(folder, 'profile')
    const holder = chromeHolding(profile)
    if (holder) throw new Error(`A Chrome (process ${holder}) has the dashboard profile open; quit that Chrome window first.`)
    return await work(profile)
  } finally {
    if (readPid(file) === process.pid && existsSync(file)) unlinkSync(file)
  }
}

function readPid(file: string): number | undefined {
  try {
    return Number(readFileSync(file, 'utf8')) || undefined
  } catch {
    return undefined
  }
}

/**
 * Opens the profile's Chrome at the dashboard, in front, with no debugging or automation switch, and waits for the
 * owner to sign in and quit it. Nothing is connected to it, and nothing is typed into it.
 */
export async function signIn(profile: string, address: string): Promise<void> {
  log(`sign-in: opening ${address} in a plain Chrome for the owner`)
  // open(1) starts a new instance in front, which a program started straight from here is not. Google Chrome, not
  // Chrome for Testing: Chrome for Testing hung at Google's passkey step, which needs the real Chrome's access to the
  // Mac's passkeys.
  const opened = spawnSync('open', ['-n', '-W', '-a', 'Google Chrome', '--args', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', address], { stdio: 'inherit' })
  if (opened.status !== 0) throw new Error(`open could not start Google Chrome (exit ${opened.status}).`)
  log('sign-in: the owner quit Chrome')
}

/**
 * The profile inside the folder that Chrome last used, from its Local State. Signing in to a work account that its
 * organization manages makes Chrome put that account in a profile of its own ("Profile 1"), so the folder's first
 * profile is not always the signed-in one, and a run opens the one the owner was last in.
 */
export function lastUsedProfile(profile: string): string {
  try {
    const state = JSON.parse(readFileSync(join(profile, 'Local State'), 'utf8')) as { profile?: { last_used?: string } }
    return state.profile?.last_used || 'Default'
  } catch {
    return 'Default'
  }
}

/** A port on this Mac that nothing listens on now. */
async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => (address && typeof address === 'object' ? resolve(address.port) : reject(new Error('no port'))))
    })
  })
}

/** Waits until Chrome's DevTools endpoint on `port` answers, or `limit` milliseconds pass for a Chrome that never started. */
async function devtoolsAnswers(port: number, limit = 30_000): Promise<void> {
  const until = Date.now() + limit
  for (;;) {
    try {
      const answer = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })
      if (answer.ok) return
    } catch {
      // not listening yet
    }
    if (Date.now() > until) throw new Error(`Chrome's DevTools on port ${port} never answered; is Google Chrome installed?`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/** Google Chrome's program, inside the app macOS installs. */
export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/**
 * The user agent an ordinary Chrome of this version sends. Headless Chrome names itself HeadlessChrome, which a page
 * can refuse, so a run sends this one, in the reduced form Chrome sends today, its version's first number alone.
 */
export function ordinaryUserAgent(version: string): string {
  const major = /(\d+)\./.exec(version)?.[1] ?? '0'
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
}

/**
 * Starts the profile's Chrome headless, so a run opens no window, no Dock icon and nothing on the owner's screen, with
 * a debugging port on this Mac only, and connects Playwright to it. Headless is Chrome's own program with the same
 * profile and the Mac's Keychain, so the owner's sign-in holds. The port is a fixed number picked free, since port 0
 * and Chrome's pipe connection, which would need no port, both turn on Chrome's automation flag, which Google's pages
 * can see. The port takes no password, so another program on this Mac could reach it while a run lasts; it is open
 * only that long, and `close` quits that Chrome, which closes it.
 */
export async function drive(profile: string): Promise<{ browser: Browser; close: () => Promise<void> }> {
  const port = await freePort()
  const inside = lastUsedProfile(profile)
  const version = spawnSync(CHROME, ['--version'], { encoding: 'utf8' })
  if (version.status !== 0) throw new Error(`Google Chrome is not at ${CHROME}; install it from google.com/chrome.`)
  log(`drive: starting headless Chrome at its profile "${inside}" with DevTools on 127.0.0.1:${port}`)
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--user-data-dir=${profile}`,
      `--profile-directory=${inside}`,
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-agent=${ordinaryUserAgent(version.stdout)}`,
      '--window-size=1280,2000',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    { stdio: 'ignore' },
  )
  let browser: Browser
  try {
    await devtoolsAnswers(port)
    const { chromium } = await import('playwright')
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  } catch (error) {
    // The Chrome this run started would otherwise hold the profile and refuse every later run.
    chrome.kill()
    log(`drive: Chrome never connected, so it was quit: ${error instanceof Error ? error.message : String(error)}`)
    throw error
  }
  const close = async () => {
    try {
      const session = await browser.newBrowserCDPSession()
      await session.send('Browser.close')
    } catch {
      // already gone
    }
    if (chrome.exitCode === null) chrome.kill()
    log('drive: Chrome closed')
  }
  return { browser, close }
}
