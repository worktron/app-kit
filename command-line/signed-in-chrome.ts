// Google Chrome with a profile of its own, which the owner signs in to by hand once and a command then drives through
// Playwright, for pages only a signed-in Google account reaches: the Chrome Web Store's developer dashboard, and an app's
// Google verification and demo videos. Sign-in is the one time a window opens in front: it starts the profile with no
// debugging or automation switch at all, so Google's sign-in sees an ordinary browser. A run starts the same profile
// with a debugging port, either headless (no window, nothing on the screen) or with one window at a place the caller
// names, such as the hidden display app-kit's window recording makes, and connects Playwright to it.
//
// Playwright's own launch is not used: it always adds --use-mock-keychain, which encrypts cookies with a fixed key
// instead of the Mac's Keychain, so the profile the owner signed in to would read as signed out. Google Chrome, not
// Chrome for Testing: Chrome for Testing hung at Google's passkey step, which needs the real Chrome's access to the
// Mac's passkeys.
//
// A run with a window shows Google Chrome's icon in the Dock while it lasts. A copy of Chrome marked a background app
// (LSUIElement), which keeps Playwright's WebKit out of the Dock, does not work for Chrome: Chrome takes a background
// app for one of its own helpers and cannot find its resources (tried with Chrome 156 on 2026-11-08). So a command that
// opens a window is one the owner approves first.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readlinkSync, unlinkSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { alive, lock } from '../tauri/state.ts'

/** Google Chrome's program, inside the app macOS installs. */
export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/** Writes one line of what a run decided, to the log of the command that drives Chrome. */
export type Log = (line: string) => void

/**
 * The user agent an ordinary Chrome of this version sends. Headless Chrome names itself HeadlessChrome, which a page
 * can refuse, so a run sends this one, in the reduced form Chrome sends today, its version's first number alone.
 */
export function ordinaryUserAgent(version: string): string {
  const major = /(\d+)\./.exec(version)?.[1] ?? '0'
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
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
 * Runs `work` holding the lock of the profile in `folder` (its `profile` folder), so one run at a time uses it. A
 * second run fails at once, naming the process that holds it, as does a run while a Chrome has the profile open (a
 * sign-in window left open). `name` says whose profile it is in those messages.
 */
export async function withProfile<T>(folder: string, name: string, work: (profile: string) => Promise<T>): Promise<T> {
  const file = join(folder, 'profile.lock')
  if (!lock(file)) throw new Error(`Another run holds the ${name} profile, ${file} (process ${readPid(file)}); wait for it to end.`)
  try {
    const profile = join(folder, 'profile')
    const holder = chromeHolding(profile)
    if (holder) throw new Error(`A Chrome (process ${holder}) has the ${name} profile open; quit that Chrome window first.`)
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
 * Opens the profile's Chrome at `address`, in front, with no debugging or automation switch, and waits for the owner
 * to sign in and quit it. Nothing is connected to it, and nothing is typed into it.
 */
export async function signIn(profile: string, address: string, log: Log): Promise<void> {
  log(`sign-in: opening ${address} in a plain Chrome for the owner`)
  // open(1) starts a new instance in front, which a program started straight from here is not.
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

/** Where a run's one window goes and its size, in the screen's points, measured from the top left of the main display. */
export type WindowPlace = { left: number; top: number; width: number; height: number }

/**
 * Chrome's arguments for a run of `profile` at its inside profile `inside`, with DevTools on `port`. Headless with no
 * `window`; with one, an ordinary Chrome that opens no window of its own, so the run makes its one window where it
 * wants it, and that keeps drawing when nothing on the screen shows it.
 */
export function driveArguments(options: { profile: string; inside: string; port: number; userAgent: string; window?: WindowPlace }): string[] {
  const common = [
    `--user-data-dir=${options.profile}`,
    `--profile-directory=${options.inside}`,
    `--remote-debugging-port=${options.port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-agent=${options.userAgent}`,
    '--no-first-run',
    '--no-default-browser-check',
  ]
  if (!options.window) return ['--headless=new', ...common, '--window-size=1280,2000']
  return [
    ...common,
    // Chrome opens a window of its own at start, in front, taking focus; with none, the run's window is made through
    // DevTools in the background, which leaves focus where it was (tried on 2026-11-08).
    '--no-startup-window',
    '--hide-crash-restore-bubble',
    // A window Chrome thinks is covered or idle stops drawing and slows its timers, which a recording would show.
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ]
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

/** A running Chrome of the profile, connected. `page` is the run's window's page when it has one; `pid` is Chrome's. */
export type Driven = { browser: Browser; page?: Page; pid: number; close: () => Promise<void> }

/**
 * Starts the profile's Chrome with a debugging port on this Mac only and connects Playwright to it: headless, so it
 * opens nothing on the owner's screen, or with one window at `window`. Either way it is Chrome's own program with the
 * same profile and the Mac's Keychain, so the owner's sign-in holds. The port is a fixed number picked free, since port
 * 0 and Chrome's pipe connection, which would need no port, both turn on Chrome's automation flag, which Google's pages
 * can see. The port takes no password, so another program on this Mac could reach it while a run lasts; it is open only
 * that long, and `close` quits that Chrome, which closes it.
 */
export async function drive(profile: string, log: Log, window?: WindowPlace): Promise<Driven> {
  const port = await freePort()
  const inside = lastUsedProfile(profile)
  const version = spawnSync(CHROME, ['--version'], { encoding: 'utf8' })
  if (version.status !== 0) throw new Error(`Google Chrome is not at ${CHROME}; install it from google.com/chrome.`)
  const how = window ? `with one window at ${window.left},${window.top} sized ${window.width} by ${window.height}` : 'headless'
  log(`drive: starting Chrome ${how} at its profile "${inside}" with DevTools on 127.0.0.1:${port}`)
  const chrome = spawn(CHROME, driveArguments({ profile, inside, port, userAgent: ordinaryUserAgent(version.stdout), window }), { stdio: 'ignore' })
  let browser: Browser
  let page: Page | undefined
  try {
    await devtoolsAnswers(port)
    const { chromium } = await import('playwright')
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    if (window) page = await openWindow(browser, window)
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
  return { browser, page, pid: chrome.pid ?? 0, close }
}

/** Makes the run's one window at `window`, in the background, and gives its page. */
async function openWindow(browser: Browser, window: WindowPlace): Promise<Page> {
  const context = browser.contexts()[0]
  if (!context) throw new Error('Chrome has no default context to open a window in.')
  const opened = context.waitForEvent('page', { timeout: 15_000 })
  const session = await browser.newBrowserCDPSession()
  await session.send('Target.createTarget', { url: 'about:blank', newWindow: true, background: true, ...window })
  return await opened
}
