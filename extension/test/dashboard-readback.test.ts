import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { itemAddress, lastUsedProfile, publisherIn } from '../dashboard/chrome.ts'
import { parse } from '../dashboard/command.ts'
import type { Field } from '../dashboard/fields.ts'
import { pickedIn, screenshotsIn, screenshotsLeft } from '../dashboard/fill.ts'
import { differences, matches } from '../dashboard/readback.ts'

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'app-kit-dashboard-readback-')))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const description: Field = { page: 'Store listing', kind: 'text', label: 'Description*', value: 'One.\n\nTwo.', limit: 16_000 }
const category: Field = { page: 'Store listing', kind: 'select', label: 'Category*', value: 'Shopping' }
const health: Field = { page: 'Privacy', kind: 'checkbox', label: 'Health information', value: false }
const remote: Field = { page: 'Privacy', kind: 'radio', label: 'No, I am not using Remote code', value: true }

test('a box reads back when it holds what the listing says, line endings and edge spaces aside', () => {
  expect(matches(description, 'One.\r\n\r\nTwo.\n')).toBe(true)
  expect(matches(description, 'One. Two.')).toBe(false)
  expect(matches(category, 'Shopping')).toBe(true)
  expect(matches(health, false)).toBe(true)
  expect(matches(health, undefined)).toBe(false)
  expect(matches(remote, true)).toBe(true)
})

test('each box shown otherwise is one line naming its page, its label, what it shows and what the file says', () => {
  const shown = new Map<Field, string | boolean | undefined>([
    [description, ''],
    [category, 'Shopping'],
    [health, true],
    [remote, undefined],
  ])
  expect(differences([description, category, health, remote], (field) => shown.get(field))).toEqual([
    'Store listing: "Description*" shows "" where store-listing.md says "One.\\n\\nTwo."',
    'Privacy: "Health information" shows ticked where store-listing.md says not ticked',
    'Privacy: "No, I am not using Remote code" shows nothing (no such box) where store-listing.md says ticked',
  ])
})

test("a menu's picked option is the last line of its text, below the label drawn over it", () => {
  expect(pickedIn('Category\nSelect a category')).toBe('Select a category')
  expect(pickedIn(' Category\n Shopping \n')).toBe('Shopping')
})

test("the publisher comes from the developer dashboard's address, and an item's address is under it", () => {
  const publisher = '72480e1c-9df1-48ea-94cb-548cf801bd85'
  expect(publisherIn(`https://chrome.google.com/webstore/devconsole/${publisher}`)).toBe(publisher)
  expect(publisherIn(`https://chrome.google.com/webstore/devconsole/${publisher}/abc/edit`)).toBe(publisher)
  expect(publisherIn('https://chromewebstore.google.com/')).toBeUndefined()
  expect(publisherIn('https://chrome.google.com/webstore/devconsole/register')).toBeUndefined()
  expect(itemAddress(publisher, 'abc')).toBe(`https://chrome.google.com/webstore/devconsole/${publisher}/abc/edit`)
})

test('a run opens the profile Chrome last used, and the first one when Chrome has not said', () => {
  const folder = join(dir, 'profile')
  mkdirSync(folder)
  expect(lastUsedProfile(folder)).toBe('Default')
  writeFileSync(join(folder, 'Local State'), JSON.stringify({ profile: { last_used: 'Profile 1' } }))
  expect(lastUsedProfile(folder)).toBe('Profile 1')
})

/** A PNG's header with the width and height set, which is all the check reads. */
function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12)
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

test('screenshots go up in file-name order, five at most, at a size the Store takes', () => {
  const folder = join(dir, 'shots')
  mkdirSync(folder)
  writeFileSync(join(folder, '2-cart.png'), png(1280, 800))
  writeFileSync(join(folder, '1-list.png'), png(640, 400))
  writeFileSync(join(folder, 'notes.txt'), '')
  expect(screenshotsIn(folder)).toEqual({ files: [join(folder, '1-list.png'), join(folder, '2-cart.png')], problems: [] })
  writeFileSync(join(folder, '3-wide.png'), png(1440, 900))
  for (const at of [4, 5, 6]) writeFileSync(join(folder, `${at}.png`), png(1280, 800))
  expect(screenshotsIn(folder).problems).toEqual([`${folder} holds 6 screenshots; the Store takes 5`, `${join(folder, '3-wide.png')} is 1440 by 900; the Store takes 1280x800 or 640x400`])
})

test('screenshots resume after those the dashboard already shows, and none go up past the folder', () => {
  const files = ['1.png', '2.png', '3.png', '4.png']
  expect(screenshotsLeft(files, 0)).toEqual(files)
  expect(screenshotsLeft(files, 2)).toEqual(['3.png', '4.png'])
  expect(screenshotsLeft(files, 4)).toEqual([])
  expect(screenshotsLeft(files, 5)).toEqual([])
})

test('the command takes a folder, an item, a zip, a screenshots folder and --visibility, and nothing else', () => {
  expect(parse(['../shelf', '--zip', 'shelf.zip', '--screenshots', 'shots', '--item', 'abc', '--visibility'])).toEqual({ folder: '../shelf', zip: 'shelf.zip', screenshots: 'shots', item: 'abc', visibility: true })
  expect(parse([])).toEqual({ folder: '.', visibility: false })
  expect(parse(['--zip'])).toBeNull()
  expect(parse(['--submit'])).toBeNull()
  expect(parse(['one', 'two'])).toBeNull()
})
