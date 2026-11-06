// The Chrome Web Store listing an extension keeps beside its manifest, store-listing.md, held to that manifest. Google's
// API sets none of the listing (text, privacy answers, screenshots, visibility), so the owner types this file's answers
// into the Store's dashboard, and Google can remove an extension whose answers disagree with what it does. These checks
// compare the file with the manifest: a permission with no reason, a reason for a permission it no longer asks for, a
// summary that is not the manifest's description or runs past the Store's 132 characters, a missing remote-code
// answer. Whether each sentence is true, and whether the dashboard says what the file says, stays the owner's to read.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { layoutProblems } from './layout.ts'

/** The listing file's name, beside manifest.json. */
export const LISTING = 'store-listing.md'

/** The longest summary the Store takes: the manifest's description, as Chrome's manifest reference says. */
export const SUMMARY_LIMIT = 132

/** One line of the checklist: a check that passed or failed, or a step only the owner can take in the dashboard. */
export type ListingItem = { result: 'passed' | 'failed' | 'yours'; line: string }

type Manifest = {
  description?: string
  icons?: Record<string, string>
  permissions?: string[]
  optional_permissions?: string[]
  host_permissions?: string[]
  optional_host_permissions?: string[]
  content_scripts?: { matches?: string[] }[]
}

/** A top-level bullet, `- Label: value`, with its label and its value joined with the indented lines under it. */
type Bullet = { label: string; quoted: boolean; value: string }

/** The bullets under each `## ` heading, by heading. Indented bullets belong to the bullet above them. */
export function readListing(text: string): Map<string, Bullet[]> {
  const sections = new Map<string, Bullet[]>()
  let bullets: Bullet[] | undefined
  let last: Bullet | undefined
  for (const line of text.split('\n')) {
    const heading = /^## (.+)$/.exec(line)
    if (heading) {
      bullets = []
      sections.set(heading[1]!.trim(), bullets)
      last = undefined
      continue
    }
    if (!bullets) continue
    // A quoted label is a permission or a host: `alarms`: or Host `https://example.com/*`:
    const quoted = /^- (?:Host )?`([^`]+)`:\s*(.*)$/.exec(line)
    const plain = quoted ? null : /^- ([^:`(]+?)(?: \([^)]*\))?:\s*(.*)$/.exec(line)
    const found = quoted ?? plain
    if (found) {
      last = { label: found[1]!.trim(), quoted: Boolean(quoted), value: found[2]!.trim() }
      bullets.push(last)
    } else if (last && /^\s+\S/.test(line)) {
      last.value = `${last.value} ${line.trim()}`.trim()
    } else if (/^\S/.test(line)) {
      last = undefined
    }
  }
  return sections
}

/** The width and height a PNG's header gives, or null for a file that is not a PNG. The image itself is not decoded. */
function pngSize(file: string): { width: number; height: number } | null {
  const bytes = readFileSync(file)
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24 || signature.some((byte, at) => bytes[at] !== byte)) return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

/** The steps only the owner can take, printed on every run, since the Store's API reads and sets none of them. */
export const YOURS: ListingItem[] = [
  'The dashboard says what store-listing.md says, field by field',
  "The store icon (the same file as the manifest's 128 icon) and at least one 1280 by 800 screenshot are uploaded; promo tiles are optional",
  'The data-use answers and the three certifications are set under Privacy practices',
  'Visibility and its testers are set under Distribution',
  'The first release, and the first after any visibility change made in the dashboard, is submitted for review in the dashboard; the API publishes the rest',
].map((line) => ({ result: 'yours', line }))

/** The first web address in an answer, stopping before a Markdown link's closing parenthesis or a sentence's last mark. */
export function linkIn(answer: string): string | undefined {
  return /https?:\/\/[^\s)<>\]]+/.exec(answer)?.[0].replace(/[.,;:!?]+$/, '')
}

/** The privacy policy's address from the listing, for the command's check that it answers. */
export function privacyPolicyLink(folder = '.'): string | undefined {
  const file = join(folder, LISTING)
  if (!existsSync(file)) return undefined
  const value = readListing(readFileSync(file, 'utf8')).get('Privacy practices')?.find((bullet) => !bullet.quoted && bullet.label === 'Privacy policy')?.value
  return value ? linkIn(value) : undefined
}

/**
 * The checklist for the extension whose manifest is in `folder`: each check that passed or failed, then the steps
 * that are the owner's. It reads files only; the privacy link's answer is the command's to check.
 */
export function listingChecklist(folder = '.'): ListingItem[] {
  const passed = (line: string): ListingItem => ({ result: 'passed', line })
  const failed = (line: string): ListingItem => ({ result: 'failed', line })
  const layout = layoutProblems(folder)
  if (layout.length) return layout.map(failed)
  const file = join(folder, LISTING)
  if (!existsSync(file)) return [failed(`There is no ${LISTING} beside manifest.json; the README's "The Store listing" gives its template`)]

  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')) as Manifest
  const sections = readListing(readFileSync(file, 'utf8'))
  const items: ListingItem[] = []
  const bullet = (section: string, label: string) => sections.get(section)?.find((each) => !each.quoted && each.label === label)

  for (const [section, label] of [
    ['Store listing', 'Summary'],
    ['Store listing', 'Description'],
    ['Privacy practices', 'Single purpose'],
    ['Privacy practices', 'Remote code'],
    ['Privacy practices', 'Privacy policy'],
  ] as const) {
    if (!sections.has(section)) {
      if (!items.some((item) => item.line.startsWith(`There is no "## ${section}"`))) items.push(failed(`There is no "## ${section}" heading in ${LISTING}`))
      continue
    }
    const answer = bullet(section, label)?.value
    if (!answer) items.push(failed(`${section} has no ${label} answer`))
    else if (label === 'Privacy policy' && !linkIn(answer)) items.push(failed('The Privacy policy answer holds no web address'))
    else if (label !== 'Summary') items.push(passed(`${section} has its ${label} answer`))
  }

  const description = manifest.description ?? ''
  const summary = bullet('Store listing', 'Summary')?.value
  if (/^__MSG_\w+__$/.test(description)) {
    items.push({ result: 'yours', line: `The summary is ${description}, read from _locales, which this check does not read; keep it within ${SUMMARY_LIMIT} characters` })
  } else if (!description) {
    items.push(failed("The manifest has no description, which the Store shows as the summary"))
  } else {
    if (summary !== undefined && summary !== description.trim()) items.push(failed("The listing's Summary is not the manifest's description, which is what the Store shows"))
    else if (summary !== undefined) items.push(passed("The listing's Summary is the manifest's description"))
    if (description.length > SUMMARY_LIMIT) items.push(failed(`The manifest's description is ${description.length} characters, past the Store's ${SUMMARY_LIMIT}`))
    else items.push(passed(`The manifest's description is ${description.length} of the Store's ${SUMMARY_LIMIT} characters`))
  }

  // A content script's sites are host access too, which the Store asks a reason for like a host permission.
  const asked = [
    ...new Set([
      ...(manifest.permissions ?? []),
      ...(manifest.optional_permissions ?? []),
      ...(manifest.host_permissions ?? []),
      ...(manifest.optional_host_permissions ?? []),
      ...(manifest.content_scripts ?? []).flatMap((script) => script.matches ?? []),
    ]),
  ]
  const reasons = new Map((sections.get('Privacy practices') ?? []).filter((each) => each.quoted).map((each) => [each.label, each.value]))
  for (const permission of asked) {
    if (!reasons.has(permission)) items.push(failed(`\`${permission}\` has no reason under Privacy practices`))
    else if (!reasons.get(permission)) items.push(failed(`\`${permission}\`'s reason under Privacy practices is empty`))
    else items.push(passed(`\`${permission}\` has its reason`))
  }
  for (const named of reasons.keys()) {
    if (!asked.includes(named)) items.push(failed(`Privacy practices gives a reason for \`${named}\`, which the manifest does not ask for`))
  }

  const icon = manifest.icons?.['128']
  if (!icon) items.push(failed('The manifest names no 128 icon, which the Store shows'))
  else if (!existsSync(join(folder, icon))) items.push(failed(`The 128 icon, ${icon}, is not there`))
  else {
    const size = pngSize(join(folder, icon))
    if (!size) items.push(failed(`The 128 icon, ${icon}, is not a PNG`))
    else if (size.width !== 128 || size.height !== 128) items.push(failed(`The 128 icon, ${icon}, is ${size.width} by ${size.height}`))
    else items.push(passed(`The 128 icon is a 128 by 128 PNG`))
  }

  return [...items, ...YOURS]
}

/** Whether the privacy policy's address answers with a page, within five seconds. */
export async function privacyPolicyAnswers(link: string, fetcher: typeof fetch = fetch): Promise<ListingItem> {
  try {
    const response = await fetcher(link, { redirect: 'follow', signal: AbortSignal.timeout(5000) })
    if (response.ok) return { result: 'passed', line: `The privacy policy at ${link} answers` }
    return { result: 'failed', line: `The privacy policy at ${link} answers ${response.status}` }
  } catch (error) {
    return { result: 'failed', line: `The privacy policy at ${link} did not answer: ${error instanceof Error ? error.message : String(error)}` }
  }
}
