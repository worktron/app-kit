// Types store-listing.md's answers into an item's dashboard, one page at a time: set each box, press the page's save
// button, reload the page, and read every box back against the file. Images go up only into an empty slot, and the
// package only when the zip is newer than the dashboard's. It submits nothing: every click goes through the guard.

import { readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { Page } from 'playwright'
import { pngSize } from '../listing.ts'
import { log } from './chrome.ts'
import type { Field, PageName } from './fields.ts'
import { press } from './guard.ts'
import { differences, type Shown } from './readback.ts'
import { drawn, record, visit } from './survey.ts'
import { judgeZip, zipManifest } from './zip.ts'

/** The most screenshots the Store listing takes, and the sizes it takes them at. */
export const SCREENSHOT_LIMIT = 5
const SCREENSHOT_SIZES = ['1280x800', '640x400']

/** The screenshots in `folder` in file-name order, with a problem for each the dashboard would refuse. */
export function screenshotsIn(folder: string): { files: string[]; problems: string[] } {
  const files = readdirSync(folder)
    .filter((name) => ['.png', '.jpg', '.jpeg'].includes(extname(name).toLowerCase()))
    .sort()
    .map((name) => join(folder, name))
  const problems: string[] = []
  if (!files.length) problems.push(`${folder} holds no .png or .jpg screenshot`)
  if (files.length > SCREENSHOT_LIMIT) problems.push(`${folder} holds ${files.length} screenshots; the Store takes ${SCREENSHOT_LIMIT}`)
  for (const file of files.filter((each) => extname(each).toLowerCase() === '.png')) {
    const size = pngSize(file)
    if (size && !SCREENSHOT_SIZES.includes(`${size.width}x${size.height}`)) problems.push(`${file} is ${size.width} by ${size.height}; the Store takes ${SCREENSHOT_SIZES.join(' or ')}`)
  }
  return { files, problems }
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The control a field is set and read through. A required box's label ends in "*" while it is empty and loses it once
 * a value is saved ("Description*", then "Description"), so the star is optional either way.
 */
function control(page: Page, field: Field) {
  const label = `^${escaped(field.label.replace(/\*$/, ''))}\\*?`
  if (field.kind === 'text') return page.getByRole('textbox', { name: new RegExp(`${label}$`) })
  if (field.kind === 'select') return page.getByRole('combobox', { name: new RegExp(`${label}( |$)`) })
  return page.getByRole(field.kind, { name: field.label, exact: true })
}

/** What the dashboard shows for a field now: a box's text, a menu's picked option, or whether it is ticked. */
export async function readField(page: Page, field: Field): Promise<Shown> {
  const box = control(page, field).first()
  if (!(await box.count())) return undefined
  if (field.kind === 'text') return await box.inputValue()
  if (field.kind === 'select') return pickedIn(await box.innerText())
  return await box.isChecked()
}

/** The option a dashboard menu shows as picked: its text's last line, below the label the menu draws over it. */
export function pickedIn(text: string): string {
  return text.trim().split('\n').at(-1)!.trim()
}

/** Sets a field to what the listing says, touching it only when it shows otherwise. Whether it changed anything. */
async function setField(page: Page, field: Field): Promise<boolean> {
  const box = control(page, field).first()
  if (!(await box.count())) return false
  if (field.kind === 'text') {
    if ((await box.inputValue()) === field.value) return false
    await box.fill(field.value)
  } else if (field.kind === 'select') {
    if (pickedIn(await box.innerText()) === field.value) return false
    await press(box)
    await press(page.getByRole('option', { name: field.value, exact: true }).filter({ visible: true }).first())
  } else {
    if ((await box.isChecked()) === field.value) return false
    await press(box)
  }
  return true
}

/**
 * Presses the page's save button and waits for the dashboard to finish saving. After a change the button can take a
 * moment to turn on, so a page with changes waits for it, and one without, whose button stays off, saves nothing.
 */
async function save(page: Page, name: PageName, changed: boolean): Promise<void> {
  const button = page.getByRole('button', { name: name === 'Test instructions' ? 'Save changes' : 'Save draft', exact: true })
  if (!changed) {
    log(`fill: ${name}: nothing changed, nothing to save`)
    return
  }
  if (!(await button.count())) {
    log(`fill: ${name}: the page has no save button`)
    return
  }
  if (await button.isDisabled()) await page.waitForFunction((element) => !(element as HTMLButtonElement).disabled, await button.elementHandle(), { timeout: 10_000 }).catch(() => undefined)
  if (await button.isDisabled()) {
    log(`fill: ${name}: the save button stayed off after the changes`)
    return
  }
  await press(button)
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined)
  // The dashboard confirms in a passing message; its words are logged, while the read-back after a reload is the proof.
  const said = await page.getByRole('alert').or(page.getByRole('status')).allInnerTexts().catch(() => [])
  log(`fill: ${name}: saved${said.length ? `, the dashboard said: ${said.join(' / ').replace(/\s+/g, ' ')}` : ''}`)
  await page.waitForTimeout(1500)
}

/** One page's outcome: each field shown otherwise after the reload, and lines for what was done or left. */
export type PageOutcome = { page: string; differences: string[]; notes: string[] }

/** The dashboard's package version and whether the item was ever published, from its Package page. */
export async function packageState(page: Page): Promise<{ version?: string; published: boolean }> {
  const cell = page.getByRole('row', { name: /^Version / }).first().getByRole('cell')
  const version = (await cell.count()) ? /^\S+/.exec((await cell.first().innerText()).trim())?.[0] : undefined
  const unpublished = await page.getByText('This item is not published yet', { exact: true }).count()
  return { version, published: !unpublished }
}

/** Uploads the zip when it is newer than the dashboard's package, then reads the version back. */
export async function fillPackage(page: Page, address: string, zip: string, name: string): Promise<PageOutcome> {
  await visit(page, address)
  await drawn(page)
  const before = await packageState(page)
  const verdict = judgeZip(zipManifest(zip), name, before.version)
  if (!verdict.upload) return { page: 'Package', differences: verdict.ok ? [] : [verdict.line], notes: [verdict.line] }
  const chooser = page.waitForEvent('filechooser', { timeout: 60_000 })
  await press(page.getByRole('button', { name: 'Upload new package', exact: true }))
  // Since 2026-11-09 the button opens a dialog ("Drop a ZIP or CRX file here or select a file"), and its Select file
  // opens the file chooser; before, the button opened the chooser itself. Whichever comes first is followed.
  const select = page.getByRole('dialog', { name: 'Upload new package' }).getByRole('button', { name: 'Select file', exact: true })
  const opened = await Promise.race([
    chooser.then(() => 'chooser' as const, () => 'none' as const),
    select.waitFor({ timeout: 30_000 }).then(() => 'dialog' as const, () => 'none' as const),
  ])
  if (opened === 'dialog') await press(select)
  await (await chooser).setFiles(zip)
  // Done is the dialog closing once Google has taken the zip (it then moves to the Store listing); reloading before
  // that leaves the dashboard's old version in place.
  const dialog = page.getByRole('dialog', { name: 'Upload new package' })
  const refused =
    opened === 'dialog'
      ? await dialog.waitFor({ state: 'hidden', timeout: 180_000 }).then(
          () => undefined,
          async () => `the upload dialog still shows "${(await dialog.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()}"`,
        )
      : undefined
  await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => undefined)
  await visit(page, address)
  await drawn(page)
  const after = await packageState(page)
  const wanted = zipManifest(zip).version
  return {
    page: 'Package',
    differences: after.version === wanted ? [] : [`Package: the dashboard shows version ${after.version ?? 'none'} after the upload, not ${wanted}${refused ? `; ${refused}` : ''}`],
    notes: [verdict.line, after.version === wanted ? `Uploaded; the dashboard shows version ${wanted}` : 'The upload did not take'],
  }
}

/** The Store listing's images: the page names an uploaded one "Store icon", and screenshots "Screenshot 1" on. */
export async function imagesShown(page: Page): Promise<{ icon: number; screenshots: number }> {
  const assets = page.getByRole('region', { name: 'Graphic assets' })
  return {
    icon: await assets.getByRole('img', { name: 'Store icon', exact: true }).count(),
    screenshots: await assets.getByRole('img', { name: /^Screenshot \d+$/ }).count(),
  }
}

/**
 * Uploads `file` through the slot whose drop button's label starts with `slot`, by the file picker that button opens,
 * and waits for the page to show the image `shown`. Handing the file to the slot's hidden input instead was dropped
 * by the page.
 */
async function upload(page: Page, slot: string, file: string, shown: string): Promise<void> {
  const assets = page.getByRole('region', { name: 'Graphic assets' })
  const chooser = page.waitForEvent('filechooser', { timeout: 30_000 })
  await press(assets.getByRole('button', { name: new RegExp(`^${escaped(slot)}\\b.*Drop (icon|image) here`) }))
  await (await chooser).setFiles(file)
  await assets.getByRole('img', { name: shown, exact: true }).waitFor({ timeout: 60_000 })
}

/**
 * The screenshots still to upload when the dashboard already shows `shown`: those after the first `shown` files, on
 * the reading that an earlier fill put those up in the same order. More shown than the folder holds uploads none.
 */
export function screenshotsLeft(files: string[], shown: number): string[] {
  return shown >= files.length ? [] : files.slice(shown)
}

/**
 * Fills one page: sets its fields (and on the Store listing page, its empty image slots), saves, reloads, records the
 * page in `run`, and reads every field back.
 */
export async function fillPage(page: Page, name: PageName, address: string, fields: Field[], run: string, images?: { icon?: string; screenshots: string[] }): Promise<PageOutcome> {
  await visit(page, address)
  await drawn(page)
  const notes: string[] = []
  let changed = false
  for (const field of fields) changed = (await setField(page, field)) || changed
  if (images) {
    const shown = await imagesShown(page)
    if (images.icon && !shown.icon) {
      await upload(page, 'Store icon', images.icon, 'Store icon')
      notes.push(`Uploaded the icon, ${images.icon}`)
      changed = true
    } else if (images.icon) notes.push('The icon slot already holds an image; left as it is')
    const left = screenshotsLeft(images.screenshots, shown.screenshots)
    for (const [at, file] of left.entries()) await upload(page, 'Screenshots', file, `Screenshot ${shown.screenshots + at + 1}`)
    if (left.length) {
      notes.push(`Uploaded ${left.length} screenshots${shown.screenshots ? `, after the ${shown.screenshots} the dashboard already had` : ''}`)
      changed = true
    } else if (images.screenshots.length) notes.push(`The dashboard already has ${shown.screenshots} screenshots, as many as the folder or more; left as they are`)
  }
  await save(page, name, changed)
  await visit(page, address)
  await drawn(page)
  await record(page, run, name)
  const shown = new Map<Field, Shown>()
  for (const field of fields) shown.set(field, await readField(page, field))
  const missed = differences(fields, (field) => shown.get(field))
  if (images) {
    const after = await imagesShown(page)
    if (images.icon && !after.icon) missed.push('Store listing: the icon slot is empty after the save')
    if (images.screenshots.length && after.screenshots < images.screenshots.length) missed.push(`Store listing: ${after.screenshots} screenshots show after the save, not ${images.screenshots.length}`)
    notes.push(`The page shows ${after.icon ? 'an icon' : 'no icon'} and ${after.screenshots} screenshots`)
  }
  return { page: name, differences: missed, notes }
}
