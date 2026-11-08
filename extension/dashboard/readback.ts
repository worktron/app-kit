// The proof that a save took: each field as the dashboard shows it after a reload, against what the listing says.

import type { Field } from './fields.ts'

/** A value the dashboard showed for a field: a text box's or menu's text, or whether a box is ticked. */
export type Shown = string | boolean | undefined

/** Text as a comparison takes it: line endings made `\n`, and no space at either end. */
function plain(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim()
}

/** Whether the dashboard shows what the field should hold. */
export function matches(field: Field, shown: Shown): boolean {
  if (field.kind === 'checkbox' || field.kind === 'radio') return shown === field.value
  return typeof shown === 'string' && plain(shown) === plain(field.value)
}

/** One line per field the dashboard shows otherwise than the listing says, empty when every field matches. */
export function differences(fields: Field[], shown: (field: Field) => Shown): string[] {
  return fields
    .filter((field) => !matches(field, shown(field)))
    .map((field) => {
      const value = shown(field)
      const what = (each: Shown) => (each === undefined ? 'nothing (no such box)' : typeof each === 'boolean' ? (each ? 'ticked' : 'not ticked') : JSON.stringify(each.length > 80 ? `${each.slice(0, 80)}…` : each))
      return `${field.page}: "${field.label}" shows ${what(value)} where store-listing.md says ${what(field.value)}`
    })
}
