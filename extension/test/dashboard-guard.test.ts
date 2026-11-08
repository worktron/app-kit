import { expect, test } from 'bun:test'
import type { Locator } from 'playwright'
import { CERTIFICATIONS, VISIBILITIES } from '../dashboard/fields.ts'
import { mayPress, press, Refused } from '../dashboard/guard.ts'
import { DATA_USES } from '../listing.ts'

test("the buttons that submit, publish, cancel a review or delete are refused, whatever their case", () => {
  for (const name of ['Submit for review', 'Publish', 'Unpublish', 'Cancel review', 'Cancel submission', 'Delete item', 'Remove item', 'Withdraw', 'SUBMIT FOR REVIEW', "Why can't I submit?"]) {
    expect(mayPress(name)).toBe(false)
  }
})

test('every control the fill presses is allowed', () => {
  for (const name of ['Save draft', 'Save changes', 'Upload new package', 'Category* Select a category', 'Shopping', 'English', 'No, I am not using Remote code', 'Yes, I am using Remote code', ...DATA_USES, ...CERTIFICATIONS, ...VISIBILITIES]) {
    expect(mayPress(name)).toBe(true)
  }
})

/** A control with the given label, text and title, recording whether it was clicked. */
function control(names: [string, string, string]): Locator & { clicked: boolean } {
  const stand = { clicked: false, evaluate: async () => names, click: async () => void (stand.clicked = true) }
  return stand as unknown as Locator & { clicked: boolean }
}

test('press reads the label, the text and the title before it clicks, and refuses on any of them', async () => {
  const save = control(['', 'Save draft', ''])
  await press(save)
  expect(save.clicked).toBe(true)
  for (const names of [['Submit for review', '', ''], ['', ' Submit for review ', ''], ['', 'More', 'Publish item']] as [string, string, string][]) {
    const refused = control(names)
    await expect(press(refused)).rejects.toBeInstanceOf(Refused)
    expect(refused.clicked).toBe(false)
  }
})
