// The toolbar icon against Chrome's own Light, Dark and Device setting and the Mac's appearance, in the kit's hidden
// Chromium (the harness), with the fixture extension. Chromium is started with followChromeMode, so every page shows the
// mode Chromium gives it, which follows Chrome's setting as its toolbar does: an ordinary tab's media query is what the
// toolbar is, and the icon recorded as shown must match it. The Mac's appearance is never changed: a light Mac is the
// real one, and a dark Mac is Chromium's --force-dark-mode, which Chromium takes as the system's appearance. Chromium has
// no option for a light Mac on a dark one, so on a dark Mac the light-Mac tests are skipped, by name. Where only the
// hidden page's view of the Mac needs to move (a Mac change while Chrome holds a fixed mode), the harness's
// setColorScheme moves it. Run with `bun test ./extension/e2e/toolbar-icon.e2e.ts`, which scripts/gates.sh does.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { launchExtension, until, type LoadedExtension } from '../harness/index.ts'
import { withoutPage } from '../../test/dom.ts'

const FIXTURE = join(import.meta.dir, '../test/fixture')
type Mode = 'light' | 'dark'
type ToolbarIcon = { mode: Mode; path: Record<string, string>; at: string }

/** The Mac's own appearance, from its setting, read once: the light-Mac tests need a light Mac. */
const macIsDark = spawnSync('defaults', ['read', '-g', 'AppleInterfaceStyle'], { encoding: 'utf8' }).stdout.trim() === 'Dark'

let server: ReturnType<typeof Bun.serve>
let pageBack = () => {}
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'app-kit-toolbar-icon-e2e-')))

beforeAll(async () => {
  // The server answers with Bun's own Response, not the unit tests' simulated page's.
  pageBack = await withoutPage()
  server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('<!doctype html><title>a web page</title><p>a web page', { headers: { 'content-type': 'text/html' } }) })
})

afterAll(() => {
  server?.stop(true)
  pageBack()
  rmSync(scratch, { recursive: true, force: true })
})

/** A web page the fixture may reach (its host permission is http://127.0.0.1/*). */
const webPage = (path = '/') => `http://127.0.0.1:${server.port}${path}`

/** The icon the worker last recorded as shown, read from the worker itself, so no extension page opens. */
async function shown(ext: LoadedExtension) {
  return ext.worker
    .evaluate(async () => ((await (globalThis as any).chrome.storage.session.get('toolbarIcon')).toolbarIcon ?? null) as ToolbarIcon | null)
    .catch(() => null)
}

/** Whether Chrome's toolbar is dark, as Chrome tells an ordinary page. */
const toolbarIsDark = (page: Page) => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)

/** Waits until the icon shown is the one for `mode`, set after `since`, and gives it. */
async function iconFor(ext: LoadedExtension, mode: Mode, since = '') {
  const icon = await until(() => shown(ext), (found) => found?.mode === mode && found.at > since, 10_000)
  expect(icon?.mode).toBe(mode)
  return icon!
}

/** The icon's mode for a toolbar that is dark or not. */
const modeFor = (dark: boolean): Mode => (dark ? 'dark' : 'light')

/** The fixture without access to any website and without "scripting", as a source folder of its own. */
function fixtureWithoutSiteAccess() {
  const source = join(scratch, 'no-site-access')
  cpSync(FIXTURE, source, { recursive: true })
  const manifestPath = join(source, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  delete manifest.host_permissions
  manifest.permissions = manifest.permissions.filter((name: string) => name !== 'scripting')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  execFileSync('git', ['init', '--quiet'], { cwd: source })
  return source
}

for (const macDark of [false, true]) {
  const mac: Mode = macDark ? 'dark' : 'light'
  // A light Mac is the real one; a dark Mac is Chromium's stand-in on a light Mac, or the real one on a dark Mac.
  const runs = macDark || !macIsDark
  describe.skipIf(!runs)(`with a ${mac} Mac${macDark ? '' : ' (needs this Mac in light mode)'}, an extension with site access`, () => {
    let ext: LoadedExtension
    beforeAll(async () => {
      ext = await launchExtension({ source: FIXTURE, followChromeMode: true, macDark })
    }, 90_000)
    // Closing waits for Chromium to shut down, the browser's work as starting it is, so it gets the start's limit.
    afterAll(async () => {
      await ext?.close()
    }, 90_000)

    test("the icon matches the toolbar in each of Chrome's modes, before any of the extension's pages opens", async () => {
      // Chrome set against the Mac while no web page is open: nothing it may read shows Chrome's mode yet.
      const against: Mode = macDark ? 'light' : 'dark'
      await ext.setChromeMode(against)
      const tab = await ext.context.newPage()
      await tab.goto(webPage('/first'))
      expect(await toolbarIsDark(tab)).toBe(against === 'dark')
      let last = (await iconFor(ext, against)).at

      for (const mode of ['dark', 'light', 'device', 'dark', 'device', 'light'] as const) {
        await ext.setChromeMode(mode)
        const dark = await toolbarIsDark(tab)
        expect(dark).toBe(mode === 'device' ? macDark : mode === 'dark')
        last = (await iconFor(ext, modeFor(dark), last)).at
      }
      await tab.close()
    }, 90_000)

    test('a Mac change while Chrome holds a fixed mode leaves the icon on Chrome\'s mode', async () => {
      const tab = await ext.context.newPage()
      await tab.goto(webPage('/fixed'))
      const fixed: Mode = macDark ? 'light' : 'dark'
      await ext.setChromeMode(fixed)
      let last = (await iconFor(ext, fixed)).at
      // The hidden page sees the Mac turn to Chrome's mode and back: the toolbar stays as Chrome is set.
      for (const seen of [fixed, mac]) {
        await ext.setColorScheme(seen)
        const icon = await until(() => shown(ext), (found) => (found?.at ?? '') > last, 10_000)
        expect(icon?.mode).toBe(fixed)
        last = icon!.at
      }
      await tab.close()
    }, 60_000)

    test('a tab open before the extension reloads still moves the icon when Chrome\'s mode changes', async () => {
      const tab = await ext.context.newPage()
      await tab.goto(webPage('/before-reload'))
      await ext.setChromeMode('light')
      await iconFor(ext, 'light')
      const reloaded = ext.nextWorker()
      await ext.worker.evaluate(() => (globalThis as any).chrome.runtime.reload()).catch(() => {})
      await reloaded
      const after = (await iconFor(ext, 'light')).at
      // Only a script in the open tab can see this change: the Mac stays as it is.
      await ext.setChromeMode('dark')
      expect(await toolbarIsDark(tab)).toBe(true)
      await iconFor(ext, 'dark', after)
      await ext.setChromeMode('device')
      await tab.close()
    }, 90_000)

    test('the worker records no error', async () => {
      const errors = await ext.worker.evaluate(async () => ((await (globalThis as any).chrome.storage.local.get('workerErrors')).workerErrors ?? []) as { message: string }[])
      expect(errors.filter((error) => error.message.includes('toolbarIconFollowsMode'))).toEqual([])
    })
  })
}

describe('an extension without site access', () => {
  let ext: LoadedExtension
  beforeAll(async () => {
    ext = await launchExtension({ source: fixtureWithoutSiteAccess(), followChromeMode: true })
  }, 90_000)
  // Closing waits for Chromium to shut down, the browser's work as starting it is, so it gets the start's limit.
  afterAll(async () => {
    await ext?.close()
  }, 90_000)

  test("takes Chrome's fixed mode from its popup and keeps it across a Mac change", async () => {
    const mac: Mode = macIsDark ? 'dark' : 'light'
    const fixed: Mode = macIsDark ? 'light' : 'dark'
    await ext.setChromeMode(fixed)
    // A web page open, which it may not read.
    const tab = await ext.context.newPage()
    await tab.goto(webPage('/unreachable'))
    await tab.bringToFront()
    const opened = await ext.worker.evaluate(() => (globalThis as any).chrome.action.openPopup().then(() => 'opened', (error: Error) => error.message))
    expect(opened).toBe('opened')
    let last = (await iconFor(ext, fixed)).at
    const popup = ext.context.pages().find((page) => page.url().endsWith('/popup.html'))
    await popup?.close()
    // The popup closed: the hidden page sees the Mac move and come back, and the icon holds Chrome's mode.
    for (const seen of [fixed, mac]) {
      await ext.setColorScheme(seen)
      const icon = await until(() => shown(ext), (found) => (found?.at ?? '') > last, 10_000)
      expect(icon?.mode).toBe(fixed)
      last = icon!.at
    }
    await tab.close()
  }, 90_000)
})
