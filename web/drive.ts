// `app-kit web drive`: an app's seeded server driven in a fresh hidden Chromium from a steps file, for a persona
// walk-through (practices' persona-walkthrough skill) and for a store's screenshots. The browser ends with the run.
// Only the seeded server is reached: an image from anywhere else gets a stand-in, and any other request is refused and
// printed, so a link to another site is reported, never followed. Every AudioContext runs on the browser's offline
// engine, so no sound reaches the Mac's speakers. At the App Store's sizes the page runs as the app's iPhone build,
// with the kit's stand-in for the Tauri bridge, so it draws the screens the app draws. Generalized from Sightline's
// scripts/persona-look.ts.
//
// The steps file is JSON: { "size"?, "outsideImage"?, "settledWhenGone"?, "cookies"?, "timeZone"?, "locale"?, "initScript"?,
// "steps": [ ... ] }. Paths in it are relative to the steps file. "initScript" is a script of the app's own, run in every
// page before the page's scripts, for a stand-in the page needs, such as the app's browser extension answering it.
// "cookies" ([{ "name", "value" }]) are set on the address before the first step, so a seeded server can tell which
// made-up person a run is. "timeZone" (such as "America/New_York") and "locale" (such as "en-US") fix how the page draws
// dates and times; without them the page takes the Mac's, so a store image made on another Mac could differ. Each step one of
//   { "goto": "/path" }                                   relative to the address
//   { "click": { "role": "button", "name": "Save" } }     the whole name; "partial": true for part of it
//   { "click": { "text": "some visible text" } }          the first element showing that text
//   { "fill": { "role": "textbox", "name": "Email" }, "value": "..." }
//   { "waitFor": { "role": "button", "name": "Stop" } }   waits until it shows
//   { "signIn": { "email": "ana@example.com" } }          on the sign-in screen shown, by the kit's stand-in code
//   { "clockAt": "2026-11-02T09:00:00" }                  the page's clock starts then and runs on; before any goto
//   { "advance": 60000 }                                  the page's clock jumps that many milliseconds
//   { "read": "label" }                                   prints the accessibility tree, saves <label>-<size>.png
//   { "shot": "name" }                                    saves <name>.png, the screen at the size, for a store

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { BrowserContextOptions, Locator, Page } from '@playwright/test'

/** The screen each size draws at. The store sizes give each store's pixels exactly: CSS size times scale. */
export const SIZES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, touch: true, iphoneApp: false },
  desktop: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, touch: false, iphoneApp: false },
  // The Chrome Web Store's screenshot: 1280 by 800.
  'chrome-store': { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, touch: false, iphoneApp: false },
  // The App Store's iPhone with Dynamic Island, medium display: 1206 by 2622.
  'iphone-6.3': { viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, touch: true, iphoneApp: true },
  // The App Store's iPhone 6.9-inch display: 1320 by 2868.
  'iphone-6.9': { viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, touch: true, iphoneApp: true },
  // The App Store's iPad 13-inch display: 2064 by 2752.
  'ipad-13': { viewport: { width: 1032, height: 1376 }, deviceScaleFactor: 2, touch: true, iphoneApp: true },
} as const

export type Size = keyof typeof SIZES

export type Target = { role?: string; name?: string; text?: string; partial?: boolean }

export type Step =
  | { goto: string }
  | { click: Target }
  | { fill: Target; value: string }
  | { waitFor: Target }
  | { signIn: { email: string } }
  | { clockAt: string }
  | { advance: number }
  | { read: string }
  | { shot: string }

export type Cookie = { name: string; value: string }

export type StepsFile = {
  size: Size
  outsideImage?: string
  settledWhenGone?: string
  cookies?: Cookie[]
  timeZone?: string
  locale?: string
  initScript?: string
  steps: Step[]
}

const KINDS = ['goto', 'click', 'fill', 'waitFor', 'signIn', 'clockAt', 'advance', 'read', 'shot'] as const

/** A plain grey square, for an outside image when the steps file names none. */
const GREY = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#bbb"/></svg>'

function isTarget(value: unknown): value is Target {
  if (!value || typeof value !== 'object') return false
  const target = value as Target
  // A role alone would act on the first control of that role, whichever it is.
  return typeof target.text === 'string' || (typeof target.role === 'string' && typeof target.name === 'string')
}

function knownTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

function knownLocale(locale: string) {
  try {
    return Intl.getCanonicalLocales(locale).length === 1
  } catch {
    return false
  }
}

/** The steps file read and checked, or an error naming the first thing wrong with it. Its paths are read from `folder`, the steps file's own. */
export function readSteps(text: string, folder = process.cwd()): StepsFile {
  let file: {
    size?: unknown
    outsideImage?: unknown
    settledWhenGone?: unknown
    cookies?: unknown
    timeZone?: unknown
    locale?: unknown
    initScript?: unknown
    steps?: unknown
  }
  try {
    file = JSON.parse(text)
  } catch (error) {
    throw new Error(`The steps file is not JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const size = file.size ?? 'phone'
  if (typeof size !== 'string' || !(size in SIZES)) throw new Error(`The size "${String(size)}" is none of ${Object.keys(SIZES).join(', ')}`)
  if (file.outsideImage !== undefined && typeof file.outsideImage !== 'string') throw new Error('outsideImage is the path of an image file')
  if (file.initScript !== undefined && typeof file.initScript !== 'string') throw new Error('initScript is the path of a script')
  const outsideImage = file.outsideImage === undefined ? undefined : resolve(folder, file.outsideImage)
  const initScript = file.initScript === undefined ? undefined : resolve(folder, file.initScript)
  for (const [name, path] of [['outsideImage', outsideImage], ['initScript', initScript]] as const) {
    if (path && !existsSync(path)) throw new Error(`${name}: there is no file at ${path}`)
  }
  if (file.settledWhenGone !== undefined && typeof file.settledWhenGone !== 'string') throw new Error('settledWhenGone is a regular expression, as text')
  if (
    file.cookies !== undefined &&
    !(Array.isArray(file.cookies) && file.cookies.every((cookie) => typeof cookie?.name === 'string' && cookie.name && typeof cookie.value === 'string'))
  )
    throw new Error('cookies is a list of { "name", "value" }, both text')
  if (file.timeZone !== undefined && !(typeof file.timeZone === 'string' && knownTimeZone(file.timeZone)))
    throw new Error(`The time zone "${String(file.timeZone)}" is not one the browser knows, such as America/New_York or UTC`)
  if (file.locale !== undefined && !(typeof file.locale === 'string' && knownLocale(file.locale)))
    throw new Error(`The locale "${String(file.locale)}" is not a language tag, such as en-US`)
  if (!Array.isArray(file.steps) || !file.steps.length) throw new Error('The steps file has no steps')
  let navigated = false
  let clock = false
  file.steps.forEach((step: unknown, at: number) => {
    const where = `Step ${at + 1}`
    if (!step || typeof step !== 'object') throw new Error(`${where} is not an object`)
    const keys = Object.keys(step).filter((key) => key !== 'value')
    const kind = keys[0] as (typeof KINDS)[number]
    if (keys.length !== 1 || !KINDS.includes(kind)) throw new Error(`${where} has ${keys.join(', ') || 'no kind'}; a step is one of ${KINDS.join(', ')}`)
    const value = (step as Record<string, unknown>)[kind]
    if (kind === 'goto') {
      if (typeof value !== 'string' || !value.startsWith('/')) throw new Error(`${where}: goto takes a path starting with /`)
      navigated = true
    } else if (kind === 'click' || kind === 'fill' || kind === 'waitFor') {
      if (!isTarget(value)) throw new Error(`${where}: ${kind} takes { role, name } or { text }`)
      if (kind === 'fill' && typeof (step as { value?: unknown }).value !== 'string') throw new Error(`${where}: fill takes the text to type as "value"`)
    } else if (kind === 'signIn') {
      if (typeof (value as { email?: unknown })?.email !== 'string') throw new Error(`${where}: signIn takes { email }`)
      if (!navigated) throw new Error(`${where}: signIn types into the sign-in screen, so a goto that shows it comes first`)
    } else if (kind === 'clockAt') {
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error(`${where}: clockAt takes a date, such as 2026-11-02T09:00:00`)
      if (navigated) throw new Error(`${where}: clockAt comes before the first goto, since the page's clock is set as it loads`)
      if (clock) throw new Error(`${where}: the clock is already set`)
      // The date is read on the Mac running the drive, so with no offset it would mean the Mac's own zone.
      if (file.timeZone !== undefined && !/(Z|[+-]\d\d:?\d\d)$/.test(value))
        throw new Error(`${where}: with a timeZone set, clockAt names its offset (2026-11-02T09:00:00-05:00, or Z for UTC), or another Mac reads it in its own zone`)
      clock = true
    } else if (kind === 'advance') {
      if (typeof value !== 'number' || !(value > 0)) throw new Error(`${where}: advance takes milliseconds, more than 0`)
      if (!clock) throw new Error(`${where}: advance needs a clockAt step before it`)
    } else if (typeof value !== 'string' || !/^[\w.-]+$/.test(value)) {
      throw new Error(`${where}: ${kind} takes a name of letters, digits, dots, dashes and underscores`)
    }
  })
  return {
    size: size as Size,
    outsideImage,
    settledWhenGone: file.settledWhenGone as string | undefined,
    cookies: file.cookies as Cookie[] | undefined,
    timeZone: file.timeZone as string | undefined,
    locale: file.locale as string | undefined,
    initScript,
    steps: file.steps as Step[],
  }
}

/** The options Playwright's context takes for a size. */
export function contextOptions(size: Size, iphoneUserAgent: string): BrowserContextOptions {
  const screen = SIZES[size]
  return {
    viewport: screen.viewport,
    deviceScaleFactor: screen.deviceScaleFactor,
    isMobile: screen.touch,
    hasTouch: screen.touch,
    ...(screen.iphoneApp ? { userAgent: iphoneUserAgent } : {}),
  }
}

/** Writes a file under another name and renames it into place, so nothing reads half of it. */
function writeWhole(path: string, data: Buffer | string) {
  const partial = `${path}.partial`
  writeFileSync(partial, data)
  renameSync(partial, path)
}

/** Drives `address` through the steps into `out`, printing as it goes. 0 when every step ran, 1 when one failed. */
export async function drive(options: { address: string; steps: StepsFile; out: string; print?: (line: string) => void }): Promise<number> {
  const print = options.print ?? ((line: string) => console.log(line))
  const { address, steps: plan, out } = options
  const own = new URL(address).origin
  const outsideImage = plan.outsideImage ? readFileSync(plan.outsideImage) : Buffer.from(GREY)
  const outsideType = plan.outsideImage?.endsWith('.png') ? 'image/png' : plan.outsideImage?.match(/\.jpe?g$/) ? 'image/jpeg' : 'image/svg+xml'

  // Loaded here, not at the top, so the kit's other commands run in an app that has no Playwright.
  const { chromium } = await import('@playwright/test')
  const { offlineAudio } = await import('./playwright-offline-audio.js')
  const { fakeTauri, IPHONE_USER_AGENT } = await import('../tauri/playwright.js')
  const { signInByCode } = await import('../authentication/stand-in/playwright.js')

  // Stopped by SIGINT, SIGTERM or SIGHUP, Playwright's launch closes the browser itself.
  const browser = await chromium.launch({ headless: true })
  // A serve script that starts this with a pipe asks for the watch, so the browser closes when the script ends. Off by
  // default: an agent's shell gives no input at all, and watching it would end every run at once.
  if (process.env.APP_KIT_DRIVE_STOP_WHEN_PARENT_ENDS === 'on') {
    void (async () => {
      for await (const _ of Bun.stdin.stream()) {
        // Only the end of the pipe matters.
      }
      await browser.close()
      process.exit(1)
    })()
  }

  try {
    const context = await browser.newContext({
      ...contextOptions(plan.size, IPHONE_USER_AGENT),
      ...(plan.timeZone ? { timezoneId: plan.timeZone } : {}),
      ...(plan.locale ? { locale: plan.locale } : {}),
    })
    if (plan.cookies?.length) await context.addCookies(plan.cookies.map((cookie) => ({ ...cookie, url: own })))
    await offlineAudio(context)
    await context.route(
      (url) => url.origin !== own,
      (route) => {
        const request = route.request()
        if (request.resourceType() === 'image') return route.fulfill({ status: 200, contentType: outsideType, body: outsideImage })
        print(`[refused an outside ${request.isNavigationRequest() ? 'page' : 'request'}: ${request.url()}]`)
        return route.abort()
      },
    )
    // The page counts its own requests in flight: a click's request, and the reload it starts once it is answered,
    // happen after Playwright's load states are long reached, so those never see them.
    await context.addInitScript(() => {
      const counted = window as unknown as { driveRequests: number }
      counted.driveRequests = 0
      const original = window.fetch
      const counting = async (...args: Parameters<typeof fetch>) => {
        counted.driveRequests++
        try {
          return await original.apply(window, args)
        } finally {
          counted.driveRequests--
        }
      }
      window.fetch = Object.assign(counting, original)
    })
    // After the kit's own, so the app's stand-in sees the page as the kit set it up, and before any of the page's.
    if (plan.initScript) await context.addInitScript({ path: plan.initScript })
    const page: Page = await context.newPage()
    if (SIZES[plan.size].iphoneApp) await fakeTauri(page)
    // Any tab after this one was opened by a link; its address is in the refused line above.
    context.on('page', async (opened) => {
      print('[a link opened a new tab; closed it]')
      await opened.close()
    })

    const locate = (t: Target): Locator =>
      t.text ? page.getByText(t.text, { exact: !t.partial }).first() : page.getByRole(t.role as Parameters<Page['getByRole']>[0], { name: t.name, exact: !t.partial }).first()
    const inFlight = () => page.evaluate(() => (window as unknown as { driveRequests?: number }).driveRequests ?? 0)
    const twoFrames = () => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
    const gone = plan.settledWhenGone ? new RegExp(plan.settledWhenGone) : undefined

    // Settled is no request in flight, still none after the page draws twice (an answer renders, and the reload its
    // effect starts begins, within those frames), and nothing on screen matching settledWhenGone.
    const settle = async () => {
      do {
        await page.waitForFunction(() => ((window as unknown as { driveRequests?: number }).driveRequests ?? 0) === 0)
        await twoFrames()
      } while ((await inFlight()) !== 0)
      if (gone) await page.getByText(gone).first().waitFor({ state: 'hidden' })
    }
    const here = () => page.url().replace(address, '') || '/'

    try {
      for (const step of plan.steps) {
        if ('goto' in step) await page.goto(address + step.goto)
        else if ('click' in step) await locate(step.click).click()
        else if ('fill' in step) await locate(step.fill).fill(step.value)
        else if ('waitFor' in step) await locate(step.waitFor).waitFor()
        else if ('signIn' in step) await signInByCode(page, step.signIn.email)
        else if ('clockAt' in step) {
          // Installed with its time and left running: a paused clock stops the page's frames and timers, and every
          // step after it would wait for a frame that never comes.
          await page.clock.install({ time: new Date(step.clockAt) })
          continue
        } else if ('advance' in step) {
          // A jump fires each timer that falls due once, as a phone does after its screen sleeps; running every
          // timer in turn takes about as long as the time it moves on a page that animates.
          await page.clock.fastForward(step.advance)
        } else if ('read' in step) {
          await settle()
          const file = join(out, `${step.read}-${plan.size}.png`)
          writeWhole(file, await page.screenshot({ fullPage: true }))
          print(`=== ${step.read} at ${here()} (screenshot ${file}) ===`)
          print(await page.locator('body').ariaSnapshot())
          continue
        } else if ('shot' in step) {
          await settle()
          const file = join(out, `${step.shot}.png`)
          const image = await page.screenshot({ animations: 'disabled', caret: 'hide' })
          // A page with no viewport tag is laid out 980 wide on a phone and scaled, a pixel or so off what a store takes.
          const screen = SIZES[plan.size]
          const want = { width: screen.viewport.width * screen.deviceScaleFactor, height: screen.viewport.height * screen.deviceScaleFactor }
          const got = { width: image.readUInt32BE(16), height: image.readUInt32BE(20) }
          if (got.width !== want.width || got.height !== want.height) {
            throw new Error(`The ${step.shot} image is ${got.width} by ${got.height}, not the ${want.width} by ${want.height} ${plan.size} asks for; the page needs <meta name="viewport" content="width=device-width, initial-scale=1">`)
          }
          writeWhole(file, image)
          print(`=== ${step.shot} at ${here()} (${plan.size}, ${file}) ===`)
          continue
        }
        await settle()
      }
      return 0
    } catch (error) {
      print(`[step failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}]`)
      print(`=== the page when it failed, at ${here()} ===`)
      print(await page.locator('body').ariaSnapshot().catch(() => '(unreadable)'))
      return 1
    }
  } finally {
    await browser.close()
  }
}
