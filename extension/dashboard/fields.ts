// What the dashboard's boxes should hold, read from store-listing.md and the manifest beside it. Each field names the
// dashboard page it is on and the label the dashboard gives it, which is how the fill finds it and reads it back.
// Nothing here touches a browser.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_USES, LISTING, linkIn, readListing, sectionText } from '../listing.ts'

/** The dashboard pages the fill types into, by the names its side menu gives them. */
export type PageName = 'Store listing' | 'Privacy' | 'Distribution' | 'Test instructions'

/**
 * One box on the dashboard: a text box by its label, a menu by its label and the option to pick, or a checkbox or
 * radio button by its label and whether it is ticked. A radio button is only ever set, never cleared: picking another
 * clears it.
 */
export type Field =
  | { page: PageName; kind: 'text'; label: string; value: string; limit: number }
  | { page: PageName; kind: 'select'; label: string; value: string }
  | { page: PageName; kind: 'checkbox'; label: string; value: boolean }
  | { page: PageName; kind: 'radio'; label: string; value: true }

/** The three statements the Privacy page asks the developer to certify, by their boxes' labels. */
export const CERTIFICATIONS = [
  'I do not sell or transfer user data to third parties, outside of the approved use cases',
  "I do not use or transfer user data for purposes that are unrelated to my item's single purpose",
  'I do not use or transfer user data to determine creditworthiness or for lending purposes',
] as const

/** The visibility a listing names, as the Distribution page's radio buttons name it. */
export const VISIBILITIES = ['Public', 'Unlisted', 'Private'] as const

/** The label of the box the Privacy page gives every host the extension reaches. */
export const HOSTS_BOX = 'Host permission justification*'

type Manifest = {
  icons?: Record<string, string>
  host_permissions?: string[]
  optional_host_permissions?: string[]
  content_scripts?: { matches?: string[] }[]
}

/**
 * Why the fill stops before saving anything, when the item has never been published and the listing names any visibility
 * but Unlisted, or none: an extension's first Web Store release goes out Unlisted (practices' extensions rule), and
 * Public is a later, deliberate step. Undefined when the item may go on. A published item is never held by it.
 */
export function firstVisibility(named: string | undefined, published: boolean): string | undefined {
  if (published || named === 'Unlisted') return undefined
  return `Distribution: an item's first release goes out Unlisted, and store-listing.md's Visibility ${named ? `says ${named}` : 'line is missing'}; make it "- Visibility: Unlisted, to invited testers." (practices' extensions rule)`
}

/** What the fill will type, the image it will upload as the icon, and the visibility the listing names. */
export type Fields = { fields: Field[]; icon?: string; visibility?: Field; problems: string[] }

/** The dashboard's fields for the extension in `folder`, with each problem that keeps one from being filled. */
export function dashboardFields(folder: string): Fields {
  const text = readFileSync(join(folder, LISTING), 'utf8')
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')) as Manifest
  const sections = readListing(text)
  const problems: string[] = []
  const fields: Field[] = []
  const answer = (section: string, label: string) => sections.get(section)?.find((bullet) => !bullet.quoted && bullet.label === label)
  const typed = (page: PageName, label: string, value: string | undefined, limit: number, from: string) => {
    if (!value) return problems.push(`${LISTING} has no ${from}, which the dashboard's "${label}" needs`)
    if (value.length > limit) return problems.push(`${from} is ${value.length} characters, past the dashboard's ${limit} for "${label}"`)
    fields.push({ page, kind: 'text', label, value, limit })
  }
  const picked = (page: PageName, label: string, value: string | undefined, from: string) => {
    if (!value) return problems.push(`${LISTING} has no ${from}, which the dashboard's "${label}" needs`)
    fields.push({ page, kind: 'select', label, value })
  }

  typed('Store listing', 'Description*', answer('Store listing', 'Description')?.value, 16_000, 'Store listing Description')
  picked('Store listing', 'Category*', answer('Store listing', 'Category')?.value, 'Store listing Category')
  picked('Store listing', 'Language*', answer('Store listing', 'Language')?.value, 'Store listing Language')

  typed('Privacy', 'Single purpose description*', answer('Privacy practices', 'Single purpose')?.value, 1000, 'Privacy practices Single purpose')
  const hosts = new Set([
    ...(manifest.host_permissions ?? []),
    ...(manifest.optional_host_permissions ?? []),
    ...(manifest.content_scripts ?? []).flatMap((script) => script.matches ?? []),
  ])
  const reasons = (sections.get('Privacy practices') ?? []).filter((bullet) => bullet.quoted)
  for (const reason of reasons.filter((each) => !hosts.has(each.label))) {
    typed('Privacy', `${reason.label} justification*`, reason.value, 1000, `the reason for \`${reason.label}\``)
  }
  const hostReasons = reasons.filter((each) => hosts.has(each.label))
  if (hostReasons.length) {
    typed('Privacy', HOSTS_BOX, hostReasons.map((each) => `${each.label}: ${each.value}`).join('\n\n'), 1000, 'the hosts\' reasons together')
  }
  const remote = answer('Privacy practices', 'Remote code')?.value ?? ''
  if (/^no\b/i.test(remote)) fields.push({ page: 'Privacy', kind: 'radio', label: 'No, I am not using Remote code', value: true })
  else if (/^yes\b/i.test(remote)) {
    fields.push({ page: 'Privacy', kind: 'radio', label: 'Yes, I am using Remote code', value: true })
    typed('Privacy', 'Justification*', remote.replace(/^yes\b[^.]*\.\s*/i, ''), 1000, 'the Remote code answer after its Yes')
  } else problems.push('The Remote code answer under Privacy practices starts with neither No nor Yes')

  // Leaving Data collected out would clear every box, so the file says none in words rather than by omission.
  const data = answer('Privacy practices', 'Data collected')
  if (!data) problems.push('Privacy practices has no Data collected answer; name each data use under it, or write "Data collected: none"')
  else if (!data.children.length && !/^none\b/i.test(data.value)) problems.push('Data collected names no data use and does not say none; write "Data collected: none" for an extension that collects none')
  const collected = (data?.children ?? []).map((each) => each.label)
  for (const named of collected) {
    if (!(DATA_USES as readonly string[]).includes(named)) problems.push(`Data collected names "${named}", which is not one of the dashboard's: ${DATA_USES.join(', ')}`)
  }
  for (const use of DATA_USES) fields.push({ page: 'Privacy', kind: 'checkbox', label: use, value: collected.includes(use) })
  const certified = answer('Privacy practices', 'Certifications')?.value ?? ''
  if (/^all three\b/i.test(certified)) for (const label of CERTIFICATIONS) fields.push({ page: 'Privacy', kind: 'checkbox', label, value: true })
  else problems.push('The Certifications answer under Privacy practices is not "all three", and the dashboard takes no item without all three')
  typed('Privacy', 'Privacy policy URL*', linkIn(answer('Privacy practices', 'Privacy policy')?.value ?? ''), 2048, 'Privacy practices Privacy policy address')

  const instructions = sectionText(text, 'Test instructions')
  if (instructions !== undefined) typed('Test instructions', 'Additional instructions', instructions, 500, 'the Test instructions section')

  const named = /^(\w+)/.exec(answer('Distribution', 'Visibility')?.value ?? '')?.[1]
  const visibility = VISIBILITIES.find((each) => each.toLowerCase() === named?.toLowerCase())
  if (named && !visibility) problems.push(`The Visibility answer under Distribution starts with "${named}", not one of ${VISIBILITIES.join(', ')}`)

  const icon = manifest.icons?.['128']
  return {
    fields,
    icon: icon ? join(folder, icon) : undefined,
    visibility: visibility ? { page: 'Distribution', kind: 'radio', label: visibility, value: true } : undefined,
    problems,
  }
}
