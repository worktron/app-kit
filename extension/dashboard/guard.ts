// The buttons the dashboard driver never presses. Submitting, publishing, unpublishing, cancelling a review and
// deleting are the owner's acts, done by their own hand in the dashboard; every click the driver makes goes through
// `press`, which reads the control's name first and refuses these.

import type { Locator } from 'playwright'

/** Names of controls the driver refuses to click, matched against the whole accessible name, ignoring case. */
export const REFUSED = [/submit/i, /publish/i, /\breview\b/i, /\bdelete\b/i, /\bremove item\b/i, /\bwithdraw\b/i, /\bcancel\b.*\b(review|submission)\b/i]

/** Thrown for a click the driver may never make. */
export class Refused extends Error {}

/** Whether a control with this accessible name may be clicked. */
export function mayPress(name: string): boolean {
  return !REFUSED.some((pattern) => pattern.test(name))
}

/** Clicks `control` after checking its accessible name, its text and its title against REFUSED. */
export async function press(control: Locator): Promise<void> {
  const names = await control.evaluate((element) => [element.getAttribute('aria-label') ?? '', element.textContent ?? '', element.getAttribute('title') ?? ''])
  const refused = names.find((name) => name && !mayPress(name.trim()))
  if (refused !== undefined) throw new Refused(`The dashboard driver never presses "${refused.trim()}"; that is the owner's to do.`)
  await control.click()
}
