import { afterAll, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listingChecklist, privacyPolicyAnswers, privacyPolicyLink, readListing, YOURS } from '../listing.ts'

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'app-kit-extension-listing-')))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
let made = 0

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim()

const SUMMARY = 'Reads your orders on example.com for Shelf, and says each request is Shelf’s.'

const MANIFEST = {
  manifest_version: 3,
  name: 'Shelf',
  version: '0.1.0',
  description: SUMMARY,
  icons: { '128': 'extension/icons/icon-128.png' },
  permissions: ['alarms', 'storage'],
  host_permissions: ['https://shop.example.com/*'],
  background: { service_worker: 'extension/worker.js', type: 'module' },
}

const LISTING = `# Shelf in the Chrome Web Store

## Store listing

- Name: Shelf (from the manifest)
- Summary (from the manifest's description): ${SUMMARY}
- Category: Shopping
- Description:

  Shelf keeps the list of things you need.

  It reads nothing until you connect it. Privacy: https://shelf.example.com/privacy

## Privacy practices

- Single purpose: Reads the person's own orders for Shelf.
- \`alarms\`: Reads orders every few hours.
- \`storage\`: Keeps the key Shelf's page gives it.
- Host \`https://shop.example.com/*\`: Reads the person's order history.
- Remote code: No, I am not using remote code.
- Data collected:
  - Website content: the order pages' content.
- Privacy policy: https://shelf.example.com/privacy
`

/** A 1 by 1 PNG's header with the width and height set, which is all the check reads. */
function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12)
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

/** A git checkout holding an extension at its root, with the manifest and listing given. */
function extension(options: { manifest?: object; listing?: string | null; icon?: Buffer } = {}): string {
  const root = join(dir, `extension-${++made}`)
  mkdirSync(join(root, 'extension', 'icons'), { recursive: true })
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(options.manifest ?? MANIFEST))
  if (options.listing !== null) writeFileSync(join(root, 'store-listing.md'), options.listing ?? LISTING)
  writeFileSync(join(root, 'extension', 'icons', 'icon-128.png'), options.icon ?? png(128, 128))
  writeFileSync(join(root, 'extension', 'worker.js'), '')
  git(root, 'init', '--quiet', '--initial-branch=main')
  git(root, 'add', '-A')
  git(root, 'commit', '--quiet', '-m', 'first')
  return root
}

const failures = (folder: string) => listingChecklist(folder).filter((item) => item.result === 'failed').map((item) => item.line)

test('a listing that answers everything the manifest asks passes every check, then lists the dashboard steps', () => {
  const items = listingChecklist(extension())
  expect(items.filter((item) => item.result === 'failed')).toEqual([])
  expect(items.filter((item) => item.result === 'passed').map((item) => item.line)).toEqual([
    'Store listing has its Description answer',
    'Privacy practices has its Single purpose answer',
    'Privacy practices has its Remote code answer',
    'Privacy practices has its Privacy policy answer',
    "The listing's Summary is the manifest's description",
    `The manifest's description is ${SUMMARY.length} of the Store's 132 characters`,
    '`alarms` has its reason',
    '`storage` has its reason',
    '`https://shop.example.com/*` has its reason',
    'The 128 icon is a 128 by 128 PNG',
  ])
  expect(items.slice(-YOURS.length)).toEqual(YOURS)
})

test("a permission the manifest asks for with no reason fails, as does a reason for one it no longer asks for", () => {
  const folder = extension({ manifest: { ...MANIFEST, permissions: ['alarms', 'storage', 'tabs'], host_permissions: [] } })
  expect(failures(folder)).toEqual([
    '`tabs` has no reason under Privacy practices',
    'Privacy practices gives a reason for `https://shop.example.com/*`, which the manifest does not ask for',
  ])
})

test('an optional permission needs its reason too', () => {
  expect(failures(extension({ manifest: { ...MANIFEST, optional_permissions: ['identity.email'] } }))).toEqual(['`identity.email` has no reason under Privacy practices'])
})

test("a Summary that is not the manifest's description fails, and so does a description past 132 characters", () => {
  expect(failures(extension({ listing: LISTING.replace(SUMMARY, 'Reads your orders.') }))).toEqual([
    "The listing's Summary is not the manifest's description, which is what the Store shows",
  ])
  const long = 'Reads orders '.repeat(11).trim()
  expect(failures(extension({ manifest: { ...MANIFEST, description: long }, listing: LISTING.replace(SUMMARY, long) }))).toEqual([
    `The manifest's description is ${long.length} characters, past the Store's 132`,
  ])
})

test('a privacy answer with no web address fails, and an address in a Markdown link or before a full stop is read whole', () => {
  expect(failures(extension({ listing: LISTING.replace('- Privacy policy: https://shelf.example.com/privacy', '- Privacy policy: Coming soon') }))).toEqual([
    'The Privacy policy answer holds no web address',
  ])
  const linked = extension({ listing: LISTING.replace('- Privacy policy: https://shelf.example.com/privacy', '- Privacy policy: [our policy](https://shelf.example.com/privacy).') })
  expect(failures(linked)).toEqual([])
  expect(privacyPolicyLink(linked)).toBe('https://shelf.example.com/privacy')
})

test("a content script's sites need a reason like a host permission", () => {
  const manifest = { ...MANIFEST, content_scripts: [{ matches: ['https://cart.example.com/*'], js: ['extension/cart.js'] }] }
  expect(failures(extension({ manifest }))).toEqual(['`https://cart.example.com/*` has no reason under Privacy practices'])
  const listing = LISTING.replace('- Remote code:', '- Host `https://cart.example.com/*`: Reads the cart page the person opens.\n- Remote code:')
  expect(failures(extension({ manifest, listing }))).toEqual([])
})

test('a listing with no remote-code answer fails, since Google rejects an item without one', () => {
  expect(failures(extension({ listing: LISTING.replace(/^- Remote code:.*\n/m, '') }))).toEqual(['Privacy practices has no Remote code answer'])
})

test('an empty answer fails like a missing one', () => {
  expect(failures(extension({ listing: LISTING.replace('- `storage`: Keeps the key Shelf\'s page gives it.', '- `storage`:') }))).toEqual([
    "`storage`'s reason under Privacy practices is empty",
  ])
})

test('a 128 icon that is missing, not a PNG or the wrong size fails', () => {
  expect(failures(extension({ icon: png(96, 96) }))).toEqual(['The 128 icon, extension/icons/icon-128.png, is 96 by 96'])
  expect(failures(extension({ icon: Buffer.from('<svg/>') }))).toEqual(['The 128 icon, extension/icons/icon-128.png, is not a PNG'])
  expect(failures(extension({ manifest: { ...MANIFEST, icons: {} } }))).toEqual(['The manifest names no 128 icon, which the Store shows'])
})

test("a localized description is left to the owner rather than measured as its placeholder", () => {
  const items = listingChecklist(extension({ manifest: { ...MANIFEST, description: '__MSG_description__' } }))
  expect(items.filter((item) => item.result === 'failed')).toEqual([])
  expect(items).toContainEqual({ result: 'yours', line: expect.stringContaining('__MSG_description__, read from _locales') })
})

test('a folder with no listing file, or a manifest not at its checkout root, fails with what to do', () => {
  expect(failures(extension({ listing: null }))).toEqual([expect.stringContaining('There is no store-listing.md beside manifest.json')])
  const root = extension()
  mkdirSync(join(root, 'sub'))
  copyFileSync(join(root, 'manifest.json'), join(root, 'sub', 'manifest.json'))
  expect(failures(join(root, 'sub'))).toEqual([expect.stringContaining('manifest.json is in sub/ of the checkout')])
})

test('a listing missing a whole section says which heading', () => {
  expect(failures(extension({ listing: LISTING.replace('## Privacy practices', '## Privacy') }))).toEqual([
    expect.stringContaining('There is no "## Privacy practices" heading'),
    expect.stringContaining('has no reason'),
    expect.stringContaining('has no reason'),
    expect.stringContaining('has no reason'),
  ])
})

test("the reader joins a bullet's indented lines and keeps nested bullets under it", () => {
  const sections = readListing(LISTING)
  expect(sections.get('Store listing')?.find((bullet) => bullet.label === 'Description')?.value).toBe(
    'Shelf keeps the list of things you need. It reads nothing until you connect it. Privacy: https://shelf.example.com/privacy',
  )
  expect(sections.get('Privacy practices')?.map((bullet) => bullet.label)).toEqual([
    'Single purpose',
    'alarms',
    'storage',
    'https://shop.example.com/*',
    'Remote code',
    'Data collected',
    'Privacy policy',
  ])
})

test("the privacy link is read from the listing, and an answer other than a page fails", async () => {
  expect(privacyPolicyLink(extension())).toBe('https://shelf.example.com/privacy')
  const answering = (status: number) => (async () => new Response('', { status })) as unknown as typeof fetch
  expect((await privacyPolicyAnswers('https://shelf.example.com/privacy', answering(200))).result).toBe('passed')
  expect(await privacyPolicyAnswers('https://shelf.example.com/privacy', answering(404))).toEqual({
    result: 'failed',
    line: 'The privacy policy at https://shelf.example.com/privacy answers 404',
  })
  const refusing = (async () => {
    throw new Error('getaddrinfo ENOTFOUND')
  }) as unknown as typeof fetch
  expect((await privacyPolicyAnswers('https://shelf.example.com/privacy', refusing)).line).toContain('did not answer: getaddrinfo ENOTFOUND')
})

/** `app-kit extension listing` run as a program, with the privacy page served by this test so no request leaves the machine. */
async function runCommand(folder: string, ...flags: string[]) {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, '../../bin/app-kit.ts'), 'extension', 'listing', folder, ...flags], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
  return { stdout, code }
}

test('the command prints each item and exits 0 when every check passes, and 1 when one fails', async () => {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('The privacy policy') })
  try {
    const link = `http://127.0.0.1:${server.port}/privacy`
    const listing = LISTING.replace('- Privacy policy: https://shelf.example.com/privacy', `- Privacy policy: ${link}`)
    const passing = await runCommand(extension({ listing }))
    expect(passing.code).toBe(0)
    expect(passing.stdout).toContain(`passed  The privacy policy at ${link} answers`)
    expect(passing.stdout).toContain('yours   The dashboard says what store-listing.md says, field by field')

    const failing = await runCommand(extension({ listing, manifest: { ...MANIFEST, permissions: ['alarms', 'storage', 'tabs'] } }), '--json')
    expect(failing.code).toBe(1)
    expect((JSON.parse(failing.stdout) as { result: string; line: string }[]).filter((item) => item.result === 'failed')).toEqual([
      { result: 'failed', line: '`tabs` has no reason under Privacy practices' },
    ])
  } finally {
    server.stop(true)
  }
})
