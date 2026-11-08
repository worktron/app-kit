// Getting around an item's dashboard without changing it: opening the item, waiting for a page to draw, the addresses
// of its pages, and saving a page's screenshot and accessibility tree to the run's folder. A run's saved trees are how
// the fill's labels were found, and how they are found again when Google changes the dashboard.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { CONSOLE, itemAddress, log, publisherIn, SignedOut } from './chrome.ts'

/** The dashboard's pages for one item, by the names its side menu gives them. */
export const PAGES = ['Package', 'Store listing', 'Privacy', 'Distribution', 'Test instructions'] as const

/** Throws SignedOut when the page has gone to Google's sign-in. */
export function refuseSignIn(page: Page): void {
  if (new URL(page.url()).hostname === 'accounts.google.com') throw new SignedOut()
}

/** Goes to `address` and waits for it to settle, or throws SignedOut. */
export async function visit(page: Page, address: string): Promise<void> {
  await page.goto(address, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  refuseSignIn(page)
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined)
  refuseSignIn(page)
}

/** Opens the item's dashboard, through the signed-in account's publisher page, or throws SignedOut. */
export async function openItem(page: Page, item: string): Promise<void> {
  await visit(page, CONSOLE)
  const publisher = publisherIn(page.url())
  if (!publisher) throw new Error(`The developer dashboard went to ${page.url()}, not a publisher's page; has this account registered as a Chrome Web Store developer?`)
  await visit(page, itemAddress(publisher, item))
  if (!page.url().includes(`/${item}/`)) throw new Error(`The dashboard has no item ${item} for publisher ${publisher}; it went to ${page.url()}.`)
}

/** Saves the page's screenshot and accessibility tree as `<name>.png` and `<name>.yaml` in `folder`. */
export async function record(page: Page, folder: string, name: string): Promise<void> {
  mkdirSync(folder, { recursive: true })
  const file = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  await page.screenshot({ path: join(folder, `${file}.png`), fullPage: true })
  writeFileSync(join(folder, `${file}.yaml`), `# ${page.url()}\n${await page.locator('body').ariaSnapshot()}\n`)
}

/**
 * Waits for the dashboard's own page to be drawn: its item menu, and the main area's first heading below the item's
 * name. The dashboard draws after the network goes quiet, so a quiet network alone saw a blank page.
 */
export async function drawn(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Item menu' }).waitFor({ timeout: 60_000 })
  await page.getByRole('main').getByRole('heading', { level: 2 }).first().waitFor({ timeout: 60_000 })
}

/**
 * The addresses of the item's pages, read from its side menu's links. A run goes to each page's address rather than
 * clicking its link, so reading the dashboard clicks nothing at all.
 */
export async function pageAddresses(page: Page): Promise<Map<string, string>> {
  const menu = page.getByRole('navigation', { name: 'Item menu' })
  const addresses = new Map<string, string>()
  for (const name of PAGES) {
    const link = menu.getByRole('link', { name, exact: true })
    if (!(await link.count())) {
      log(`survey: no link named "${name}"`)
      continue
    }
    // The links are written against the page's <base>, so the address is the one the browser resolved.
    addresses.set(name, await link.first().evaluate((element) => (element as HTMLAnchorElement).href))
  }
  return addresses
}
