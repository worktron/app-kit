// The Chrome the Store's dashboard is driven in: Google Chrome with a profile of its own under app-kit's state folder,
// which the owner signs in to by hand once (command-line/signed-in-chrome.ts). Chrome refuses every extension on Web
// Store pages, Claude in Chrome included, but not its own DevTools connection, so a run starts this profile headless,
// with no window, and drives it through Playwright.

import { join } from 'node:path'
import * as signedIn from '../../command-line/signed-in-chrome.ts'
import { appendLog, stateFolder } from '../../tauri/state.ts'

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
 * Runs `work` holding the dashboard's lock, so one run at a time uses the profile. A second run fails at once, naming
 * the process that holds it, as does a run while a Chrome has the profile open (a sign-in window left open).
 */
export async function withProfile<T>(work: (profile: string) => Promise<T>, folder = dashboardFolder()): Promise<T> {
  return await signedIn.withProfile(folder, 'dashboard', work)
}

/** Opens the profile's Chrome at `address` for the owner to sign in, and waits for them to quit it. */
export async function signIn(profile: string, address: string): Promise<void> {
  await signedIn.signIn(profile, address, (line) => log(line))
}

/** Starts the profile's Chrome headless and connects Playwright to it. */
export async function drive(profile: string): Promise<signedIn.Driven> {
  return await signedIn.drive(profile, (line) => log(line))
}
