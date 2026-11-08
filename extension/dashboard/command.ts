// `app-kit extension dashboard`: signs the dashboard's Chrome profile in, reads an item's dashboard pages against
// store-listing.md, and fills them from it. Nothing it does submits the item: that stays the owner's press.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { extensionId } from '../host/index.ts'
import { layoutProblems } from '../layout.ts'
import { listingChecklist } from '../listing.ts'
import { CONSOLE, dashboardFolder, drive, log, signIn, withProfile } from './chrome.ts'
import { dashboardFields, type Field, type PageName } from './fields.ts'
import { fillPackage, fillPage, imagesShown, packageState, type PageOutcome, readField, screenshotsIn } from './fill.ts'
import { differences, type Shown } from './readback.ts'
import { drawn, openItem, pageAddresses, record, visit } from './survey.ts'
import { judgeZip, zipManifest } from './zip.ts'

/** The item the dashboard is opened at: --item, or the ID the manifest's key gives, which is the Store's. */
function itemFor(folder: string, named: string | undefined): string {
  if (named) return named
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')) as { key?: string }
  if (!manifest.key) throw new Error(`${join(folder, 'manifest.json')} has no key, so the item is not known; pass --item <id>.`)
  return extensionId(manifest.key)
}

type Options = { folder: string; item?: string; zip?: string; screenshots?: string; visibility: boolean }

/** Splits the flags out of the words, leaving the folder. Null for anything else. */
export function parse(words: string[]): Options | null {
  const options: Options = { folder: '.', visibility: false }
  const folders: string[] = []
  for (let at = 0; at < words.length; at++) {
    const word = words[at]!
    if (word === '--visibility') options.visibility = true
    else if (word === '--item' || word === '--zip' || word === '--screenshots') {
      const value = words[++at]
      if (!value) return null
      options[word.slice(2) as 'item' | 'zip' | 'screenshots'] = value
    } else if (word.startsWith('-')) return null
    else folders.push(word)
  }
  if (folders.length > 1) return null
  options.folder = folders[0] ?? '.'
  return options
}

/** A run's folder for its screenshots and accessibility trees. */
function runFolder(): string {
  return join(dashboardFolder(), 'runs', new Date().toISOString().replace(/[:.]/g, '-'))
}

/** Opens the profile's Chrome, the item's dashboard and its pages' addresses, runs `work`, and closes that Chrome. */
async function onItem<T>(item: string, work: (page: Page, addresses: Map<string, string>) => Promise<T>): Promise<T> {
  return await withProfile(async (profile) => {
    const { browser, close } = await drive(profile)
    try {
      const context = browser.contexts()[0] ?? (await browser.newContext())
      // A tab of its own: the one Chrome opens at start can still be loading, and cut a first visit short.
      const page = await context.newPage()
      // A page left with unsaved changes asks before it goes; going on is right, since the read-back then fails.
      page.on('dialog', (dialog) => void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()))
      await openItem(page, item)
      await drawn(page)
      return await work(page, await pageAddresses(page))
    } finally {
      await close()
    }
  })
}

/** The listing's fields with its problems, or the lines that stop a run before Chrome opens. */
function fieldsFor(options: Options): ReturnType<typeof dashboardFields> & { name: string } {
  const layout = layoutProblems(options.folder)
  if (layout.length) throw new Error(layout.join('\n'))
  const manifest = JSON.parse(readFileSync(join(options.folder, 'manifest.json'), 'utf8')) as { name?: string }
  const fields = dashboardFields(options.folder)
  // The listing check first: a permission with no reason, or a summary that is not the manifest's, stops a fill too.
  const checked = listingChecklist(options.folder).filter((item) => item.result === 'failed').map((item) => item.line)
  return { ...fields, problems: [...new Set([...checked, ...fields.problems])], name: manifest.name ?? '' }
}

function report(outcomes: PageOutcome[], problems: string[]): boolean {
  for (const problem of problems) console.log(`failed  ${problem}`)
  for (const outcome of outcomes) {
    for (const note of outcome.notes) console.log(`        ${outcome.page}: ${note}`)
    for (const line of outcome.differences) console.log(`failed  ${line}`)
    if (!outcome.differences.length) console.log(`passed  ${outcome.page}: every box reads back as store-listing.md says`)
  }
  return !problems.length && outcomes.every((outcome) => !outcome.differences.length)
}

const PAGES: PageName[] = ['Store listing', 'Privacy', 'Distribution', 'Test instructions']

export async function dashboard([command, ...args]: string[]): Promise<boolean> {
  const options = parse(args)
  if (!options) return false
  if (command === 'sign-in') {
    await withProfile(async (profile) => await signIn(profile, `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(CONSOLE)}`))
    console.log('Signed in. Run: app-kit extension dashboard read')
    return true
  }
  if (command !== 'read' && command !== 'fill') return false

  const { fields, icon, visibility, problems, name } = fieldsFor(options)
  if (options.zip && !existsSync(options.zip)) problems.push(`There is no zip at ${options.zip}`)
  const screenshots = options.screenshots ? screenshotsIn(options.screenshots) : { files: [], problems: [] }
  problems.push(...screenshots.problems)
  const item = itemFor(options.folder, options.item)
  const run = runFolder()

  if (command === 'read') {
    // Read only: each page's boxes against the file, the package against the zip, and nothing pressed.
    const outcomes = await onItem(item, async (page, addresses) => {
      const outcomes: PageOutcome[] = []
      for (const each of ['Package', ...PAGES]) {
        if (!addresses.has(each)) outcomes.push({ page: each, differences: [`${each}: the dashboard's side menu has no such page, so nothing on it was compared`], notes: [] })
      }
      if (options.zip && addresses.has('Package')) {
        await visit(page, addresses.get('Package')!)
        await drawn(page)
        const state = await packageState(page)
        const verdict = judgeZip(zipManifest(options.zip), name, state.version)
        const behind = verdict.upload ? [`Package: the dashboard is behind the zip; fill uploads it`] : []
        outcomes.push({ page: 'Package', differences: verdict.ok ? behind : [verdict.line], notes: [verdict.line, state.published ? 'The item has been published' : 'The item has never been published'] })
      }
      for (const each of PAGES) {
        const address = addresses.get(each)
        if (!address) continue
        await visit(page, address)
        await drawn(page)
        await record(page, run, each)
        const wanted = [...fields.filter((field) => field.page === each), ...(visibility?.page === each ? [visibility] : [])]
        const shown = new Map<Field, Shown>()
        for (const field of wanted) shown.set(field, await readField(page, field))
        const notes = each === 'Store listing' ? [`The page shows ${(await imagesShown(page)).icon ? 'an icon' : 'no icon'} and ${(await imagesShown(page)).screenshots} screenshots`] : []
        outcomes.push({ page: each, differences: differences(wanted, (field) => shown.get(field)), notes })
      }
      return outcomes
    })
    const same = report(outcomes, problems)
    log(`read: ${item}, ${same ? 'matches' : 'differs from'} store-listing.md, saved in ${run}`)
    console.log(`Read ${item}'s dashboard, changing nothing. Its pages are saved in ${run}`)
    if (!same) process.exit(1)
    return true
  }

  // fill
  if (problems.length) {
    report([], problems)
    console.log('Nothing was typed into the dashboard.')
    process.exit(1)
  }
  const outcomes = await onItem(item, async (page, addresses) => {
    const outcomes: PageOutcome[] = []
    const address = (each: string) => {
      const found = addresses.get(each)
      if (!found) throw new Error(`The dashboard's side menu has no "${each}" page; run read to see what it has.`)
      return found
    }
    await visit(page, address('Package'))
    await drawn(page)
    const { published } = await packageState(page)
    if (options.zip) outcomes.push(await fillPackage(page, address('Package'), options.zip, name))
    for (const each of PAGES) {
      const wanted = fields.filter((field) => field.page === each)
      if (each === 'Distribution') {
        if (!visibility) continue
        if (!options.visibility) {
          await visit(page, address(each))
          await drawn(page)
          const shown = await readField(page, visibility)
          outcomes.push(
            shown
              ? { page: each, differences: [], notes: [`Visibility is ${visibility.label}, as the file says`] }
              : { page: each, differences: [`Distribution: visibility is not ${visibility.label}, which store-listing.md names; set it in the dashboard, or rerun with --visibility once the owner says yes to that change`], notes: [] },
          )
          continue
        }
        if (published) {
          outcomes.push({ page: each, differences: ['Distribution: --visibility is refused on an item that has been published; change its visibility in the dashboard'], notes: [] })
          continue
        }
        wanted.push(visibility)
      }
      if (!wanted.length) continue
      const images = each === 'Store listing' ? { icon, screenshots: screenshots.files } : undefined
      outcomes.push(await fillPage(page, each, address(each), wanted, run, images))
    }
    return outcomes
  })
  const same = report(outcomes, [])
  log(`fill: ${item}, ${same ? 'every box read back' : 'some boxes did not read back'}, saved in ${run}`)
  console.log(`Pages saved in ${run}`)
  console.log(`Nothing was submitted. Read the draft, then press Submit for review yourself: ${CONSOLE}`)
  if (!same) process.exit(1)
  return true
}
