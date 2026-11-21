// toolbar-icon.js on the chrome stand-in: which icons it shows for each mode, the hidden page it keeps open, the
// messages it takes from the hidden page (the Mac) and from the extension's pages and tabs (Chrome's own setting), the
// mode it holds when Chrome's setting is fixed, the script it registers for tabs, and what it records when Chrome
// refuses. The hidden-Chromium tests (e2e/harness.e2e.ts, e2e/toolbar-icon.e2e.ts) show the pages reading the modes
// and the worker woken by them; Chrome's own start they cannot show, which the start-up listener here does.
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { addTab, extend, grant, installed, reset, sendToWorker, shim } from '../testing/chrome.ts'
import { getWorkerErrors } from '../worker/errors.js'

const PAGE = new URL('../worker/color-scheme.html', import.meta.url).href
/** The tabs' script as the worker names it: from the extension's root in Chrome, its whole address here, outside one. */
const TAB_SCRIPT = new URL('../worker/color-scheme-tab.js', import.meta.url).href
const FILES = ['icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-16-dark-mode.png', 'icons/icon-32-dark-mode.png']
const MANIFEST = { version: '1.0.0', permissions: ['offscreen'], action: {}, icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 128: 'icons/icon-128.png' } }

/** What the stand-in's Chrome holds for the piece: its hidden pages, the icons setIcon accepted, the scripts registered and run. */
const held = {
  pages: [] as string[],
  icons: [] as Record<string, string>[],
  opens: 0,
  registered: [] as { id: string; js: string[]; matches: string[] }[],
  registers: 0,
  /** Each tab's mode as a script run in it reads it; a tab missing here refuses the script, as one the extension may not reach. */
  tabModes: new Map<number, boolean>(),
  injected: [] as { tabId: number; files: string[] }[],
  busyTabs: new Set<number>(),
}

beforeAll(() => {
  extend({
    offscreen: {
      Reason: { MATCH_MEDIA: 'MATCH_MEDIA' },
      async createDocument({ url, reasons }: { url: string; reasons: string[] }) {
        held.opens++
        if (held.pages.length) throw new Error('Only a single offscreen document may be created.')
        expect(reasons).toEqual(['MATCH_MEDIA'])
        held.pages.push(url)
      },
    },
    scripting: {
      async getRegisteredContentScripts({ ids }: { ids: string[] }) {
        return held.registered.filter((script) => ids.includes(script.id))
      },
      async updateContentScripts(scripts: { id: string; js: string[] }[]) {
        for (const script of scripts) {
          const kept = held.registered.find((found) => found.id === script.id)
          if (!kept) throw new Error(`Nonexistent script ID '${script.id}'`)
          kept.js = script.js
        }
      },
      async registerContentScripts(scripts: { id: string; js: string[]; matches: string[] }[]) {
        held.registers++
        for (const script of scripts) {
          if (held.registered.some((kept) => kept.id === script.id)) throw new Error(`Duplicate script ID '${script.id}'`)
          held.registered.push(script)
        }
      },
      async executeScript({ target, func, files }: { target: { tabId: number }; func?: () => unknown; files?: string[] }) {
        // As Chrome does, a page the extension may not reach, and any of Chrome's own, refuses the script.
        if (!held.tabModes.has(target.tabId) || !/^https?:/.test(String(shim.tabs.get(target.tabId)?.url))) throw new Error('Cannot access contents of the page.')
        // A page too busy to run the script never answers.
        if (held.busyTabs.has(target.tabId)) return new Promise(() => {})
        if (files) {
          held.injected.push({ tabId: target.tabId, files })
          return [{ result: undefined }]
        }
        const matchMedia = () => ({ matches: held.tabModes.get(target.tabId) })
        return [{ result: new Function('matchMedia', `return (${func})()`)(matchMedia) }]
      },
    },
    action: {
      // As Chrome does, each image is loaded from its path, and a missing one refuses the call.
      async setIcon({ path }: { path: Record<string, string> }) {
        for (const file of Object.values(path)) if (!(file.replace(/^\//, '') in shim.files)) throw new Error(`Failed to fetch ${file}`)
        held.icons.push(path)
      },
    },
  })
  extend({
    runtime: {
      ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
      async getContexts({ contextTypes }: { contextTypes: string[] }) {
        expect(contextTypes).toEqual(['OFFSCREEN_DOCUMENT'])
        return held.pages.map((documentUrl) => ({ contextType: 'OFFSCREEN_DOCUMENT', documentUrl }))
      },
    },
  })
})

/**
 * A worker start: the module fresh, as Chrome loads it each time it starts the worker. The address is new on every
 * load: a count kept in this file starts again when the file runs again in one process, and would get an old copy.
 */
async function start() {
  const piece = await import(`../worker/toolbar-icon.js?start=${crypto.randomUUID()}`)
  await piece.toolbarIconFollowsMode()
  return piece
}

const fromPage = (dark: boolean, url = PAGE) => sendToWorker({ type: 'app-kit-color-scheme', dark }, { id: 'test', url })
const POPUP = 'chrome-extension://test/popup.html'
/** A reading of Chrome's own setting, from the extension's popup or a tab. */
const fromChrome = (dark: boolean, sender: Record<string, unknown> = { id: 'test', url: POPUP }) => sendToWorker({ type: 'app-kit-color-scheme', dark }, sender)
const SITE_ACCESS = { ...MANIFEST, permissions: ['offscreen', 'scripting'], host_permissions: ['https://*/*'] }
const recorded = () => shim.session.toolbarIcon as { mode: string; path: Record<string, string> } | undefined

beforeEach(() => {
  reset(Object.fromEntries(FILES.map((file) => [file, 'png'])), structuredClone(MANIFEST))
  held.pages = []
  held.icons = []
  held.opens = 0
  held.registered = []
  held.registers = 0
  held.tabModes = new Map()
  held.injected = []
  held.busyTabs = new Set()
})

describe('toolbarIconFollowsMode', () => {
  test('opens its hidden page once across worker starts, and listens for Chrome starting', async () => {
    await start()
    await start()
    expect(held.pages).toEqual([PAGE])
    expect(held.opens).toBe(1)
    expect(chrome.runtime.onStartup.hasListeners()).toBe(true)
    expect(await getWorkerErrors()).toEqual([])
  })

  test('dark mode shows the dark-mode copies and light mode the manifest icons, each path from the root, and records them', async () => {
    await start()
    expect(await fromPage(true)).toEqual({ shown: true })
    expect(held.icons.at(-1)).toEqual({ 16: '/icons/icon-16-dark-mode.png', 32: '/icons/icon-32-dark-mode.png' })
    expect(recorded()).toMatchObject({ mode: 'dark', path: { 16: '/icons/icon-16-dark-mode.png', 32: '/icons/icon-32-dark-mode.png' } })
    expect(await fromPage(false)).toEqual({ shown: true })
    expect(held.icons.at(-1)).toEqual({ 16: '/icons/icon-16.png', 32: '/icons/icon-32.png' })
    expect(recorded()).toMatchObject({ mode: 'light' })
  })

  test("the action's own icons come before the manifest's, a path already from the root is kept, and only the toolbar sizes are set", async () => {
    shim.manifest = { ...MANIFEST, action: { default_icon: { 16: '/icons/icon-16.png', 48: 'icons/icon-48.png' } } }
    const piece = await start()
    expect(piece.toolbarIconPaths()).toEqual({ light: { 16: '/icons/icon-16.png' }, dark: { 16: '/icons/icon-16-dark-mode.png' } })
  })

  test('an icon that is not a .png, which has no dark-mode copy, is recorded as an error, never as dark mode shown', async () => {
    shim.manifest = { ...MANIFEST, icons: { 16: 'icons/Icon16.PNG' } }
    shim.files['icons/Icon16.PNG'] = 'png'
    await start()
    expect(await fromPage(true)).toEqual({ shown: false })
    expect(held.icons).toEqual([])
    expect(recorded()).toBeUndefined()
    expect((await getWorkerErrors())[0]?.message).toContain('icons/Icon16.PNG is not a .png')
  })

  test('two switches in quick succession end on the later one', async () => {
    await start()
    await Promise.all([fromPage(true), fromPage(false)])
    expect(held.icons.at(-1)).toEqual({ 16: '/icons/icon-16.png', 32: '/icons/icon-32.png' })
    expect(recorded()?.mode).toBe('light')
  })

  test('a message of another type is left to the extension, and one from an incognito tab, which sees the device, is not taken', async () => {
    await start()
    chrome.runtime.onMessage.addListener((message: any, _sender: unknown, answer: (value: unknown) => void) => {
      if (message?.type === 'other') answer({ mine: true })
    })
    expect(await sendToWorker({ type: 'other' }, { id: 'test', url: PAGE })).toEqual({ mine: true })
    await fromChrome(true, { id: 'test', url: 'https://example.com/', tab: { id: 1, incognito: true } })
    await sendToWorker({ type: 'app-kit-color-scheme', dark: 'yes' }, { id: 'test', url: POPUP })
    expect(held.icons).toEqual([])
    expect(recorded()).toBeUndefined()
  })

  test("Chrome's mode set against the Mac's is held across Mac changes, and one that agrees follows the Mac", async () => {
    await start()
    await fromPage(false)
    expect(recorded()?.mode).toBe('light')
    // The popup opens on a dark toolbar while the Mac is light: Chrome is set to Dark.
    expect(await fromChrome(true)).toEqual({ shown: true })
    expect(recorded()?.mode).toBe('dark')
    await fromPage(true)
    await fromPage(false)
    expect(recorded()?.mode).toBe('dark')
    expect(shim.local.toolbarIconMode).toBe('dark')
    // Now it agrees with the Mac: Chrome is taken to be on Device, and the icon follows the Mac.
    expect(await fromChrome(false)).toEqual({ shown: true })
    await fromPage(true)
    expect(recorded()?.mode).toBe('dark')
    await fromPage(false)
    expect(recorded()?.mode).toBe('light')
  })

  test("Chrome's reading outlives the worker, and with no Mac read yet it is the icon", async () => {
    await start()
    await fromChrome(true)
    expect(recorded()?.mode).toBe('dark')
    shim.session = {}
    await start()
    await fromPage(false)
    expect(recorded()?.mode).toBe('dark')
  })

  test('the rule: a fixed Chrome mode, else the Mac, else Chrome, else nothing', async () => {
    const { toolbarIsDark } = await start()
    const at = '2026-11-21T00:00:00.000Z'
    expect(toolbarIsDark(false, { dark: true, mac: false, at })).toBe(true)
    expect(toolbarIsDark(true, { dark: false, mac: true, at })).toBe(false)
    expect(toolbarIsDark(true, { dark: false, mac: false, at })).toBe(true)
    expect(toolbarIsDark(false, { dark: true, mac: null, at })).toBe(false)
    expect(toolbarIsDark(null, { dark: true, mac: null, at })).toBe(true)
    expect(toolbarIsDark(false, undefined)).toBe(false)
    expect(toolbarIsDark(null, undefined)).toBe(null)
  })

  describe('with access to websites', () => {
    test('registers the tabs\' script once for every web page, across worker starts', async () => {
      shim.manifest = structuredClone(SITE_ACCESS)
      await start()
      await start()
      expect(held.registered).toEqual([{ id: 'app-kit-color-scheme', js: [TAB_SCRIPT], matches: ['http://*/*', 'https://*/*'], runAt: 'document_start', persistAcrossSessions: true } as any])
      expect(held.registers).toBe(1)
      expect(await getWorkerErrors()).toEqual([])
    })

    test("a registration kept from before the kit's copies moved is pointed at where they are now", async () => {
      shim.manifest = structuredClone(SITE_ACCESS)
      held.registered = [{ id: 'app-kit-color-scheme', js: ['old/kit/color-scheme-tab.js'], matches: ['http://*/*', 'https://*/*'] }]
      await start()
      expect(held.registered.map((script) => script.js)).toEqual([[TAB_SCRIPT]])
      expect(held.registers).toBe(0)
      expect(await getWorkerErrors()).toEqual([])
    })

    test("reads a tab at the session's first start and at each Mac change, so Chrome's fixed mode holds", async () => {
      shim.manifest = structuredClone(SITE_ACCESS)
      const unreachable = addTab({ url: 'https://elsewhere.example.com/', active: true })
      const page = addTab({ url: 'https://example.com/', active: false })
      const incognito = addTab({ url: 'https://example.com/private', incognito: true } as any)
      held.tabModes.set(page.id, true)
      held.tabModes.set(incognito.id, false)
      void unreachable
      await start()
      // The Mac is light and Chrome's tab is dark: Chrome is set to Dark.
      await fromPage(false)
      expect(recorded()?.mode).toBe('dark')
      // Chrome is set to Light while the Mac turns dark: the tab read at the Mac change says so.
      held.tabModes.set(page.id, false)
      await fromPage(true)
      expect(recorded()?.mode).toBe('light')
      expect((shim.local.toolbarIconChrome as { dark: boolean; mac: boolean }).mac).toBe(true)
    })

    test('a tab too busy to answer is passed over for the next, so the icon is not held up', async () => {
      shim.manifest = structuredClone(SITE_ACCESS)
      const busy = addTab({ url: 'https://busy.example.com/', active: true })
      const page = addTab({ url: 'https://example.com/', active: false })
      held.tabModes.set(busy.id, false)
      held.busyTabs.add(busy.id)
      held.tabModes.set(page.id, true)
      await start()
      await fromPage(false)
      expect(recorded()?.mode).toBe('dark')
    })

    test('puts the tabs\' script into the open web tabs at install, never into incognito ones or Chrome\'s own pages', async () => {
      shim.manifest = structuredClone(SITE_ACCESS)
      const page = addTab({ url: 'https://example.com/' })
      const incognito = addTab({ url: 'https://example.com/private', incognito: true } as any)
      const settings = addTab({ url: 'chrome://settings/' })
      for (const tab of [page, incognito, settings]) held.tabModes.set(tab.id, false)
      await start()
      await installed('update')
      expect(held.injected).toEqual([{ tabId: page.id, files: [TAB_SCRIPT] }])
    })

    test('access to websites granted while the worker runs registers the tabs\' script and puts it into the open tabs', async () => {
      shim.manifest = { ...structuredClone(MANIFEST), permissions: ['offscreen', 'scripting'], optional_host_permissions: ['https://*/*'] }
      const page = addTab({ url: 'https://example.com/' })
      held.tabModes.set(page.id, false)
      await start()
      expect(held.registered).toEqual([])
      await grant({ origins: ['https://*/*'] })
      expect(held.registered.map((script) => script.id)).toEqual(['app-kit-color-scheme'])
      expect(held.injected).toEqual([{ tabId: page.id, files: [TAB_SCRIPT] }])
    })

    test('without the "scripting" permission, an error says to add it', async () => {
      shim.manifest = { ...structuredClone(SITE_ACCESS), permissions: ['offscreen'] }
      const scripting = (chrome as any).scripting
      ;(chrome as any).scripting = undefined
      try {
        await start()
      } finally {
        ;(chrome as any).scripting = scripting
      }
      expect((await getWorkerErrors())[0]?.message).toContain('lacks the "scripting" permission')
    })
  })

  test('missing dark-mode icons are recorded as an error saying how to draw them, and the icon stays', async () => {
    reset({ 'icons/icon-16.png': 'png', 'icons/icon-32.png': 'png' }, structuredClone(MANIFEST))
    await start()
    expect(await fromPage(true)).toEqual({ shown: false })
    expect(held.icons).toEqual([])
    expect(recorded()).toBeUndefined()
    const [error] = await getWorkerErrors()
    expect(error?.message).toContain('Chrome refused the dark-mode toolbar icons')
    expect(error?.message).toContain('--toolbar-color')
  })

  test('another hidden page the extension keeps, or no offscreen permission, is recorded as an error naming it', async () => {
    held.pages = ['chrome-extension://test/audio.html']
    await start()
    expect(held.pages).toEqual(['chrome-extension://test/audio.html'])
    expect((await getWorkerErrors())[0]?.message).toContain('already keeps a hidden page (chrome-extension://test/audio.html)')

    reset({}, structuredClone(MANIFEST))
    const offscreen = (chrome as any).offscreen
    ;(chrome as any).offscreen = undefined
    try {
      await start()
    } finally {
      ;(chrome as any).offscreen = offscreen
    }
    expect((await getWorkerErrors())[0]?.message).toContain('needs the "offscreen" permission')
  })
})
