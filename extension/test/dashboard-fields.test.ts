import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CERTIFICATIONS, dashboardFields, HOSTS_BOX } from '../dashboard/fields.ts'
import { DATA_USES } from '../listing.ts'

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'app-kit-dashboard-fields-')))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
let made = 0

const MANIFEST = {
  manifest_version: 3,
  name: 'Shelf',
  version: '0.1.0',
  description: 'Reads your orders on example.com for Shelf.',
  icons: { '128': 'extension/icons/icon-128.png' },
  permissions: ['alarms', 'storage'],
  host_permissions: ['https://shop.example.com/*', 'https://shelf.example.com/*'],
}

const LISTING = `# Shelf in the Chrome Web Store

## Store listing

- Summary (from the manifest's description): Reads your orders on example.com for Shelf.
- Category: Shopping
- Language: English
- Description:

  Shelf keeps the list of things you need.

  It reads nothing until you connect it.

## Privacy practices

- Single purpose: Reads the person's own orders for Shelf.
- \`alarms\`: Reads orders every few hours.
- \`storage\`: Keeps the key Shelf's page gives it.
- Host \`https://shop.example.com/*\`: Reads the person's order history.
- Host \`https://shelf.example.com/*\`: Sends those pages to Shelf.
- Remote code: No, I am not using remote code. Its code is all in the package.
- Data collected:
  - Website content: the order pages' content.
  - Web history: which order pages it reads.
- Certifications: all three (not sold; not unrelated; not for lending).
- Privacy policy: https://shelf.example.com/privacy

## Distribution

- Visibility: Private, to trusted testers.

## Test instructions

Shelf is by invitation only. Sign in at https://shelf.example.com,
then click Connect.

Reply for an account.
`

function extension(listing = LISTING): string {
  const root = join(dir, `extension-${++made}`)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(MANIFEST))
  writeFileSync(join(root, 'store-listing.md'), listing)
  return root
}

test("a listing becomes each dashboard box's value, by the page it is on and the label the dashboard gives it", () => {
  const root = extension()
  const { fields, icon, visibility, problems } = dashboardFields(root)
  expect(problems).toEqual([])
  expect(icon).toBe(join(root, 'extension/icons/icon-128.png'))
  expect(visibility).toEqual({ page: 'Distribution', kind: 'radio', label: 'Private', value: true })
  expect(fields.filter((field) => field.kind !== 'checkbox')).toEqual([
    { page: 'Store listing', kind: 'text', label: 'Description*', value: 'Shelf keeps the list of things you need.\n\nIt reads nothing until you connect it.', limit: 16_000 },
    { page: 'Store listing', kind: 'select', label: 'Category*', value: 'Shopping' },
    { page: 'Store listing', kind: 'select', label: 'Language*', value: 'English' },
    { page: 'Privacy', kind: 'text', label: 'Single purpose description*', value: "Reads the person's own orders for Shelf.", limit: 1000 },
    { page: 'Privacy', kind: 'text', label: 'alarms justification*', value: 'Reads orders every few hours.', limit: 1000 },
    { page: 'Privacy', kind: 'text', label: 'storage justification*', value: "Keeps the key Shelf's page gives it.", limit: 1000 },
    {
      page: 'Privacy',
      kind: 'text',
      label: HOSTS_BOX,
      value: "https://shop.example.com/*: Reads the person's order history.\n\nhttps://shelf.example.com/*: Sends those pages to Shelf.",
      limit: 1000,
    },
    { page: 'Privacy', kind: 'radio', label: 'No, I am not using Remote code', value: true },
    { page: 'Privacy', kind: 'text', label: 'Privacy policy URL*', value: 'https://shelf.example.com/privacy', limit: 2048 },
    { page: 'Test instructions', kind: 'text', label: 'Additional instructions', value: 'Shelf is by invitation only. Sign in at https://shelf.example.com, then click Connect.\n\nReply for an account.', limit: 500 },
  ])
})

test('every data-use box is set, ticked only for what the listing names, and the three certifications are ticked', () => {
  const { fields } = dashboardFields(extension())
  const ticked = (label: string) => fields.find((field) => field.kind === 'checkbox' && field.label === label)?.value
  expect(DATA_USES.filter((use) => ticked(use))).toEqual(['Web history', 'Website content'])
  expect(DATA_USES.filter((use) => ticked(use) === false)).toHaveLength(7)
  expect(CERTIFICATIONS.map(ticked)).toEqual([true, true, true])
})

test('remote code answered Yes picks Yes and types the reason after it', () => {
  const { fields } = dashboardFields(extension(LISTING.replace('No, I am not using remote code. Its code is all in the package.', 'Yes, it loads a script. It loads the checkout form from shelf.example.com.')))
  expect(fields.filter((field) => field.page === 'Privacy' && (field.kind === 'radio' || field.label === 'Justification*'))).toEqual([
    { page: 'Privacy', kind: 'radio', label: 'Yes, I am using Remote code', value: true },
    { page: 'Privacy', kind: 'text', label: 'Justification*', value: 'It loads the checkout form from shelf.example.com.', limit: 1000 },
  ])
})

test('an answer the dashboard cannot take is a problem, and nothing is filled for it', () => {
  const listing = LISTING.replace('  - Web history:', '  - Web browsing activity:')
    .replace('Certifications: all three', 'Certifications: two of them')
    .replace('Remote code: No', 'Remote code: Maybe')
    .replace('Visibility: Private', 'Visibility: Hidden')
    .replace('Reply for an account.', 'x'.repeat(500))
  const { fields, visibility, problems } = dashboardFields(extension(listing))
  expect(problems).toEqual([
    'The Remote code answer under Privacy practices starts with neither No nor Yes',
    expect.stringMatching(/^Data collected names "Web browsing activity", which is not one of the dashboard's: /),
    'The Certifications answer under Privacy practices is not "all three", and the dashboard takes no item without all three',
    "the Test instructions section is 588 characters, past the dashboard's 500 for \"Additional instructions\"",
    'The Visibility answer under Distribution starts with "Hidden", not one of Public, Unlisted, Private',
  ])
  expect(fields.some((field) => field.label === 'Additional instructions' || field.label === CERTIFICATIONS[0])).toBe(false)
  expect(visibility).toBeUndefined()
})

test('a listing must name its data uses or say none, so leaving the answer out never clears every box', () => {
  expect(dashboardFields(extension(LISTING.replace(/- Data collected:\n(  - .*\n)+/, ''))).problems).toEqual([
    'Privacy practices has no Data collected answer; name each data use under it, or write "Data collected: none"',
  ])
  expect(dashboardFields(extension(LISTING.replace(/- Data collected:\n(  - .*\n)+/, '- Data collected:\n'))).problems).toEqual([
    'Data collected names no data use and does not say none; write "Data collected: none" for an extension that collects none',
  ])
  const none = dashboardFields(extension(LISTING.replace(/- Data collected:\n(  - .*\n)+/, '- Data collected: none\n')))
  expect(none.problems).toEqual([])
  expect(none.fields.filter((field) => field.kind === 'checkbox' && (DATA_USES as readonly string[]).includes(field.label)).map((field) => field.value)).toEqual(Array(9).fill(false))
})
