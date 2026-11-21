// toolbar-icon.js on the chrome stand-in: which icons it shows for each mode, the hidden page it keeps open, the
// messages it takes, and what it records when Chrome refuses. The hidden-Chromium test (e2e/harness.e2e.ts) shows the
// page reading the mode and the worker woken by it; Chrome's own start it cannot show, which the start-up listener here does.
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { extend, reset, sendToWorker, shim } from '../testing/chrome.ts'
import { getWorkerErrors } from '../worker/errors.js'

const PAGE = new URL('../worker/color-scheme.html', import.meta.url).href
const FILES = ['icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-16-dark-mode.png', 'icons/icon-32-dark-mode.png']
const MANIFEST = { version: '1.0.0', permissions: ['offscreen'], action: {}, icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 128: 'icons/icon-128.png' } }

/** What the stand-in's Chrome holds for the piece: its hidden pages, and the icons setIcon accepted. */
const held = { pages: [] as string[], icons: [] as Record<string, string>[], opens: 0 }

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

let loads = 0
/** A worker start: the module fresh, as Chrome loads it each time it starts the worker. */
async function start() {
  const piece = await import(`../worker/toolbar-icon.js?start=${++loads}`)
  await piece.toolbarIconFollowsMode()
  return piece
}

const fromPage = (dark: boolean, url = PAGE) => sendToWorker({ type: 'app-kit-color-scheme', dark }, { id: 'test', url })
const recorded = () => shim.session.toolbarIcon as { mode: string; path: Record<string, string> } | undefined

beforeEach(() => {
  reset(Object.fromEntries(FILES.map((file) => [file, 'png'])), structuredClone(MANIFEST))
  held.pages = []
  held.icons = []
  held.opens = 0
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

  test('two switches in quick succession end on the later one', async () => {
    await start()
    await Promise.all([fromPage(true), fromPage(false)])
    expect(held.icons.at(-1)).toEqual({ 16: '/icons/icon-16.png', 32: '/icons/icon-32.png' })
    expect(recorded()?.mode).toBe('light')
  })

  test('a message not from its own page, or of another type, is left to the extension', async () => {
    await start()
    chrome.runtime.onMessage.addListener((message: any, _sender: unknown, answer: (value: unknown) => void) => {
      if (message?.type === 'other') answer({ mine: true })
    })
    expect(await sendToWorker({ type: 'other' }, { id: 'test', url: PAGE })).toEqual({ mine: true })
    await fromPage(true, 'chrome-extension://test/popup.html').catch(() => null)
    expect(held.icons).toEqual([])
    expect(recorded()).toBeUndefined()
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
