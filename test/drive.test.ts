// The steps file's checks, which refuse a wrong file before any browser starts, and the rule that keeps the kit's other
// commands working in an app without Playwright. The driver itself runs in web/e2e/drive.e2e.ts.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { contextOptions, readSteps, SIZES } from '../web/drive.ts'

const refusal = (file: object) => {
  try {
    readSteps(JSON.stringify(file))
    return null
  } catch (error) {
    return (error as Error).message
  }
}

test('a good steps file is read with the phone size by default', () => {
  expect(readSteps(JSON.stringify({ steps: [{ clockAt: '2026-11-02T09:00:00Z' }, { goto: '/' }, { advance: 1000 }, { read: 'home' }] })).size).toBe('phone')
})

test('each wrong steps file is refused with what is wrong', () => {
  expect(refusal({ steps: [] })).toBe('The steps file has no steps')
  expect(refusal({ size: 'iphone', steps: [{ goto: '/' }] })).toContain('The size "iphone" is none of phone, desktop, chrome-store')
  expect(refusal({ steps: [{ goto: 'list' }] })).toBe('Step 1: goto takes a path starting with /')
  expect(refusal({ steps: [{ goto: '/', read: 'x' }] })).toContain('Step 1 has goto, read')
  expect(refusal({ steps: [{ tap: 'x' }] })).toContain('Step 1 has tap; a step is one of')
  expect(refusal({ steps: [{ goto: '/' }, { clockAt: '2026-11-02' }] })).toBe("Step 2: clockAt comes before the first goto, since the page's clock is set as it loads")
  expect(refusal({ steps: [{ clockAt: 'Tuesday' }] })).toContain('Step 1: clockAt takes a date')
  expect(refusal({ steps: [{ goto: '/' }, { advance: 1000 }] })).toBe('Step 2: advance needs a clockAt step before it')
  expect(refusal({ steps: [{ signIn: { email: 'ana@example.com' } }] })).toContain('Step 1: signIn types into the sign-in screen')
  expect(refusal({ steps: [{ goto: '/' }, { fill: { role: 'textbox', name: 'Email' } }] })).toBe('Step 2: fill takes the text to type as "value"')
  expect(refusal({ steps: [{ goto: '/' }, { shot: '../home' }] })).toContain('Step 2: shot takes a name of letters')
  expect(refusal({ steps: [{ goto: '/' }, { click: { role: 'button' } }] })).toBe('Step 2: click takes { role, name } or { text }')
})

test("each store size's screen gives that store's pixels, and the App Store's run as the iPhone app", () => {
  const pixels = (size: keyof typeof SIZES) => [SIZES[size].viewport.width * SIZES[size].deviceScaleFactor, SIZES[size].viewport.height * SIZES[size].deviceScaleFactor]
  expect(pixels('chrome-store')).toEqual([1280, 800])
  expect(pixels('iphone-6.3')).toEqual([1206, 2622])
  expect(pixels('iphone-6.9')).toEqual([1320, 2868])
  expect(pixels('ipad-13')).toEqual([2064, 2752])
  expect(contextOptions('iphone-6.9', 'an iPhone').userAgent).toBe('an iPhone')
  expect(contextOptions('chrome-store', 'an iPhone').userAgent).toBeUndefined()
})

test("the driver loads Playwright only when it runs, so the kit's command works in an app without it", () => {
  const source = readFileSync(join(import.meta.dir, '../web/drive.ts'), 'utf8')
  const imports = source.split('\n').filter((line) => line.startsWith('import '))
  expect(imports.filter((line) => !line.startsWith('import type') && !/from 'node:/.test(line))).toEqual([])
})
