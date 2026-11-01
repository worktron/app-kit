import { beforeEach, describe, expect, test } from 'bun:test'
import { addTab, addWindow, answerNetwork, ChromeEvent, extend, fireAlarm, grant, reset, sendToWorker, shim, signIn } from '../testing/chrome.ts'

beforeEach(() => reset())

describe('the network', () => {
  test('a request past the extension is refused as when offline, and recorded', async () => {
    await expect(fetch('https://api.example.com/items', { method: 'POST' })).rejects.toThrow('Failed to fetch')
    expect(shim.networkRequests).toEqual([{ url: 'https://api.example.com/items', method: 'POST' }])
  })

  test('a test that answers the network gets each request, and a data address never leaves the process', async () => {
    answerNetwork((request) => Response.json({ asked: request.url }))
    expect(await (await fetch('https://api.example.com/items')).json()).toEqual({ asked: 'https://api.example.com/items' })
    expect(await (await fetch('data:text/plain,here')).text()).toBe('here')
    expect(shim.networkRequests).toHaveLength(1)
  })

  test("the extension's own files come from shim.files, and one it lacks fails", async () => {
    reset({ 'build.json': '{"commit":"abc"}' })
    expect(await (await fetch(chrome.runtime.getURL('build.json'))).text()).toBe('{"commit":"abc"}')
    await expect(fetch(chrome.runtime.getURL('missing.js'))).rejects.toThrow('Failed to fetch')
    expect(shim.networkRequests).toEqual([])
  })
})

describe('storage', () => {
  test('gets one key, several, with defaults, or all; removes and clears, in both areas', async () => {
    for (const storage of [chrome.storage.local, chrome.storage.session]) {
      await storage.set({ a: 1, b: { deep: [2] }, c: 3 })
      expect(await storage.get('a')).toEqual({ a: 1 })
      expect(await storage.get(['a', 'c', 'none'])).toEqual({ a: 1, c: 3 })
      expect(await storage.get({ a: 0, none: 'given' })).toEqual({ a: 1, none: 'given' })
      expect(await storage.get(null)).toEqual({ a: 1, b: { deep: [2] }, c: 3 })
      // What comes back is a copy, as Chrome's is.
      const { b } = (await storage.get('b')) as { b: { deep: number[] } }
      b.deep.push(9)
      expect(await storage.get('b')).toEqual({ b: { deep: [2] } })
      await storage.remove(['a', 'c'])
      expect(await storage.get(null)).toEqual({ b: { deep: [2] } })
      await storage.clear()
      expect(await storage.get(null)).toEqual({})
    }
    expect(shim.local).toEqual({})
  })
})

describe('tabs', () => {
  test('query matches address patterns, the active tab, a window and the focused one', async () => {
    reset({}, { version: '1.0.0', permissions: ['tabs'] })
    const first = addWindow()
    const second = addWindow({ focused: false })
    const mail = addTab({ url: 'https://mail.example.com/inbox', active: true, windowId: first.id })
    addTab({ url: 'https://docs.example.com/a', windowId: first.id })
    const other = addTab({ url: 'http://example.com/page?x=1', active: true, windowId: second.id })
    const ids = async (info: Parameters<typeof chrome.tabs.query>[0]) => (await chrome.tabs.query(info)).map((tab) => tab.id)
    expect(await ids({ url: '*://*.example.com/*' })).toEqual([mail.id, mail.id + 1, other.id])
    expect(await ids({ url: 'https://mail.example.com/*' })).toEqual([mail.id])
    expect(await ids({ url: ['*://example.com/page*', 'https://docs.example.com/*'] })).toEqual([mail.id + 1, other.id])
    expect(await ids({ active: true })).toEqual([mail.id, other.id])
    expect(await ids({ active: true, currentWindow: true })).toEqual([mail.id])
    expect(await ids({ windowId: second.id })).toEqual([other.id])
  })

  test("a tab's address, title and icon are left out unless the extension holds tabs or an origin that covers it, as in Chrome", async () => {
    const tab = addTab({ url: 'https://mail.example.com/inbox', title: 'Inbox', favIconUrl: 'https://mail.example.com/icon.png' })
    expect(await chrome.tabs.get(tab.id)).not.toHaveProperty('url')
    expect(await chrome.tabs.get(tab.id)).not.toHaveProperty('title')
    await grant({ origins: ['https://*.example.com/*'] })
    expect(await chrome.tabs.get(tab.id)).toMatchObject({ url: 'https://mail.example.com/inbox', title: 'Inbox' })
    reset({}, { version: '1.0.0', host_permissions: ['https://mail.example.com/*'] })
    const covered = addTab({ url: 'https://mail.example.com/inbox' })
    const not = addTab({ url: 'https://docs.example.com/' })
    expect(await chrome.tabs.get(covered.id)).toHaveProperty('url')
    expect(await chrome.tabs.get(not.id)).not.toHaveProperty('url')
  })

  test('create, update and remove change the tabs and fire their events; a tab that is gone throws as Chrome does', async () => {
    reset({}, { version: '1.0.0', permissions: ['tabs'] })
    const heard: string[] = []
    chrome.tabs.onCreated.addListener((tab) => void heard.push(`created ${tab.id}`))
    chrome.tabs.onActivated.addListener(({ tabId }) => void heard.push(`activated ${tabId}`))
    chrome.tabs.onUpdated.addListener((tabId, change) => void heard.push(`updated ${tabId} ${JSON.stringify(change)}`))
    chrome.tabs.onRemoved.addListener((tabId) => void heard.push(`removed ${tabId}`))
    const first = addTab({ url: 'https://example.com/', active: true })
    const made = await chrome.tabs.create({ url: 'https://example.com/new' })
    const madeId = made.id!
    expect(made).toMatchObject({ url: 'https://example.com/new', active: true, windowId: first.windowId })
    expect(shim.tabs.get(first.id)!.active).toBe(false)
    await chrome.tabs.update(first.id, { active: true, url: 'https://example.com/moved' })
    expect(shim.tabs.get(madeId)!.active).toBe(false)
    await chrome.tabs.remove([madeId])
    expect(heard).toEqual([
      `created ${madeId}`,
      `activated ${madeId}`,
      `updated ${first.id} {"url":"https://example.com/moved"}`,
      `activated ${first.id}`,
      `removed ${madeId}`,
    ])
    await expect(chrome.tabs.get(madeId)).rejects.toThrow(`No tab with id: ${madeId}.`)
    await expect(chrome.tabs.remove(madeId)).rejects.toThrow(`No tab with id: ${madeId}.`)
  })

  test('a pattern that names a port matches that port alone, any port with *, and a tab the extension may not see matches no address', async () => {
    reset({}, { version: '1.0.0', host_permissions: ['http://app.example.com:*/*'] })
    const served = addTab({ url: 'http://app.example.com:3000/app' })
    const other = addTab({ url: 'http://app.example.com:4000/app' })
    const hidden = addTab({ url: 'https://mail.example.com/' })
    expect((await chrome.tabs.query({ url: 'http://app.example.com:3000/*' })).map((tab) => tab.id)).toEqual([served.id])
    expect((await chrome.tabs.query({ url: 'http://app.example.com:*/*' })).map((tab) => tab.id)).toEqual([served.id, other.id])
    expect(await chrome.tabs.query({ url: '*://mail.example.com/*' })).toEqual([])
    expect((await chrome.tabs.query({})).map((tab) => tab.id)).toContain(hidden.id)
    // An address with no port is on its scheme's own, and a host of * is any host.
    const plain = addTab({ url: 'https://example.com/' })
    await grant({ origins: ['https://*/*'] })
    expect((await chrome.tabs.query({ url: 'https://example.com:443/*' })).map((tab) => tab.id)).toEqual([plain.id])
    expect((await chrome.tabs.query({ url: 'https://*/*' })).map((tab) => tab.id)).toEqual([hidden.id, plain.id])
  })

  test("a host permission's path is read as /*, as Chrome reads it, so one naming a page shows every page of its site", async () => {
    reset({}, { version: '1.0.0', host_permissions: ['https://mail.example.com/inbox'] })
    expect(await chrome.tabs.get(addTab({ url: 'https://mail.example.com/sent' }).id)).toHaveProperty('url')
  })

  test('closing the active tab makes the next one active, the rest move up, and a window left with none closes', async () => {
    reset({}, { version: '1.0.0', permissions: ['tabs'] })
    const [a, b, c] = [addTab({ url: 'https://example.com/a' }), addTab({ url: 'https://example.com/b', active: true }), addTab({ url: 'https://example.com/c' })]
    const heard: string[] = []
    chrome.tabs.onActivated.addListener(({ tabId }) => void heard.push(`activated ${tabId}`))
    chrome.windows.onRemoved.addListener((windowId) => void heard.push(`window closed ${windowId}`))
    await chrome.tabs.remove(b.id)
    expect(shim.tabs.get(c.id)).toMatchObject({ active: true, index: 1 })
    const d = addTab({ url: 'https://example.com/d' })
    expect(d.index).toBe(2)
    await chrome.tabs.remove([...shim.tabs.keys()].filter((id) => id !== a.id))
    expect(shim.tabs.get(a.id)).toMatchObject({ active: true, index: 0 })
    await chrome.tabs.remove(a.id)
    expect(shim.windows.size).toBe(0)
    // Closing c, then d, each the active one, hands it on: to d, then back to a, the last left.
    expect(heard).toEqual([`activated ${c.id}`, `activated ${d.id}`, `activated ${a.id}`, `window closed ${a.windowId}`])
  })

  test('closing a window closes its tabs, each told the window is closing', async () => {
    const window = addWindow()
    addTab({ windowId: window.id })
    addTab({ windowId: window.id })
    const closing: boolean[] = []
    chrome.tabs.onRemoved.addListener((_tabId, { isWindowClosing }) => void closing.push(isWindowClosing))
    await chrome.windows.remove(window.id)
    expect(closing).toEqual([true, true])
    expect(shim.tabs.size).toBe(0)
    await expect(chrome.windows.get(window.id)).rejects.toThrow(`No window with id: ${window.id}.`)
  })

  test('closing the focused window hands the focus to another, so the current window is never none while one is open', async () => {
    reset({}, { version: '1.0.0', permissions: ['tabs'] })
    const back = addWindow()
    const front = addWindow()
    await chrome.windows.update(front.id, { focused: true })
    const tab = addTab({ windowId: back.id, active: true })
    await chrome.windows.remove(front.id)
    expect((await chrome.windows.getLastFocused()).id).toBe(back.id)
    expect((await chrome.tabs.query({ active: true, currentWindow: true })).map((found) => found.id)).toEqual([tab.id])
  })

  test("tab ids are never used twice in a run, so state kept about one tab cannot match a later test's", () => {
    const before = addTab().id
    reset()
    expect(addTab().id).toBeGreaterThan(before)
  })
})

describe('windows', () => {
  test('get, getAll, getLastFocused, update and create, with the focus moving and its event fired', async () => {
    await expect(chrome.windows.getLastFocused()).rejects.toThrow('No last-focused window')
    const first = addWindow()
    const second = addWindow()
    expect(first.focused).toBe(true)
    expect(second.focused).toBe(false)
    expect((await chrome.windows.getLastFocused()).id).toBe(first.id)
    const focused: number[] = []
    chrome.windows.onFocusChanged.addListener((id: number) => void focused.push(id))
    await chrome.windows.update(second.id, { focused: true, state: 'maximized' })
    expect(await chrome.windows.get(second.id)).toMatchObject({ focused: true, state: 'maximized' })
    expect((await chrome.windows.get(first.id)).focused).toBe(false)
    const made = (await chrome.windows.create({ url: 'https://example.com/' }))!
    expect(made.focused).toBe(true)
    expect(made.tabs).toHaveLength(1)
    expect(focused).toEqual([second.id, made.id!])
    expect(await chrome.windows.getAll()).toHaveLength(3)
    await expect(chrome.windows.get(999)).rejects.toThrow('No window with id: 999.')
  })
})

describe('messages', () => {
  test("a page's message reaches the worker, answered by sendResponse after returning true or by a promise", async () => {
    chrome.runtime.onMessage.addListener((message: { type: string }, _sender: unknown, sendResponse: (answer: unknown) => void) => {
      if (message.type !== 'late') return false
      setTimeout(() => sendResponse({ late: true }), 1)
      return true
    })
    // Only for the messages it answers: an async listener answers every message, with null when it returns nothing.
    chrome.runtime.onMessage.addListener((message: { type: string }) => {
      if (message.type === 'fails') return Promise.reject(new Error('no such item'))
      if (message.type === 'promised') return Promise.resolve({ promised: true })
      return false
    })
    expect(await sendToWorker({ type: 'late' })).toEqual({ late: true })
    expect(await sendToWorker({ type: 'promised' })).toEqual({ promised: true })
    await expect(sendToWorker({ type: 'fails' })).rejects.toThrow('no such item')
  })

  test('an async listener answers every message, with null when it returns nothing, as in Chrome', async () => {
    chrome.runtime.onMessage.addListener(async () => undefined)
    expect(await sendToWorker({ type: 'anything' })).toBeNull()
  })

  test('a message nobody keeps open is answered with nothing, and the worker sending to its pages with none open is refused', async () => {
    chrome.runtime.onMessage.addListener(() => undefined)
    expect(await sendToWorker({ type: 'ignored' })).toBeUndefined()
    await expect(chrome.runtime.sendMessage({ type: 'refresh' })).rejects.toThrow('Receiving end does not exist')
    expect(shim.sentMessages).toEqual([{ type: 'refresh' }])
  })
})

describe('the native host', () => {
  test('sendNativeMessage is refused with no host, and answered by the one a test sets', async () => {
    await expect(chrome.runtime.sendNativeMessage('com.example.host', { type: 'ping' })).rejects.toThrow('Specified native messaging host not found.')
    shim.nativeHost = (_host, message) => ({ ok: true, heard: message })
    expect(await chrome.runtime.sendNativeMessage('com.example.host', { type: 'ping' })).toEqual({ ok: true, heard: { type: 'ping' } })
    expect(shim.nativeMessages).toEqual([
      { host: 'com.example.host', message: { type: 'ping' } },
      { host: 'com.example.host', message: { type: 'ping' } },
    ])
  })

  test('a port records what the worker posts, delivers what the host sends, and closes with the reason in lastError', async () => {
    const port = chrome.runtime.connectNative('com.example.host')
    const heard: unknown[] = []
    let reason: string | undefined
    port.onMessage.addListener((message: unknown) => void heard.push(message))
    port.onDisconnect.addListener(() => (reason = chrome.runtime.lastError?.message))
    port.postMessage({ type: 'hello' })
    await shim.ports[0]!.deliver({ type: 'welcome' })
    shim.ports[0]!.close('Specified native messaging host not found.')
    expect(shim.ports[0]!.posted).toEqual([{ type: 'hello' }])
    expect(heard).toEqual([{ type: 'welcome' }])
    expect(reason).toBe('Specified native messaging host not found.')
    expect(chrome.runtime.lastError).toBeUndefined()
    expect(() => port.postMessage({ type: 'again' })).toThrow('disconnected port')
  })
})

describe('permissions, the account and alarms', () => {
  test('origins are granted, held, listed and removed, with their events', async () => {
    const added: unknown[] = []
    chrome.permissions.onAdded.addListener((change: unknown) => void added.push(change))
    expect(await chrome.permissions.contains({ origins: ['https://api.example.com/*'] })).toBe(false)
    await chrome.permissions.request({ permissions: ['identity.email'], origins: ['https://api.example.com/*'] })
    expect(await chrome.permissions.contains({ permissions: ['identity.email'], origins: ['https://api.example.com/*'] })).toBe(true)
    expect(await chrome.permissions.getAll()).toEqual({ permissions: ['identity.email'], origins: ['https://api.example.com/*'] })
    await chrome.permissions.remove({ origins: ['https://api.example.com/*'] })
    expect(await chrome.permissions.contains({ origins: ['https://api.example.com/*'] })).toBe(false)
    expect(added).toEqual([{ permissions: ['identity.email'], origins: ['https://api.example.com/*'] }])
    await grant({ origins: ['<all_urls>'] })
    expect(await chrome.permissions.contains({ origins: ['https://other.example.com/*'] })).toBe(true)
  })

  test("what the manifest holds counts, and a wider origin covers a narrower one, as tabs' addresses already do", async () => {
    reset({}, { version: '1.0.0', permissions: ['storage'], host_permissions: ['https://api.example.com/*'] })
    expect(await chrome.permissions.contains({ permissions: ['storage'], origins: ['https://api.example.com/*'] })).toBe(true)
    await grant({ origins: ['https://*.example.com/*'] })
    expect(await chrome.permissions.contains({ origins: ['https://mail.example.com/*'] })).toBe(true)
    expect(await chrome.permissions.contains({ origins: ['http://mail.example.com/*'] })).toBe(false)
    expect(await chrome.permissions.contains({ origins: ['*://*.example.com/*'] })).toBe(false)
    expect(await chrome.permissions.getAll()).toEqual({ permissions: ['storage'], origins: ['https://api.example.com/*', 'https://*.example.com/*'] })
    // A narrower origin held never covers a wider ask, of other hosts or plain http. A host permission's path is read as
    // /*, as Chrome reads it, so the path asked plays no part.
    reset({}, { version: '1.0.0', host_permissions: ['https://example.com/'] })
    await grant({ origins: ['https://api.example.com/*'] })
    expect(await chrome.permissions.contains({ origins: ['https://*.example.com/*'] })).toBe(false)
    expect(await chrome.permissions.contains({ origins: ['*://api.example.com/*'] })).toBe(false)
    expect(await chrome.permissions.contains({ origins: ['https://example.com/*'] })).toBe(true)
    expect(await chrome.permissions.contains({ origins: ['https://api.example.com/v1/*'] })).toBe(true)
    // Any host and any port, held, cover a named one; a named port, held, covers only itself, the default included.
    reset({}, { version: '1.0.0', host_permissions: ['*://*/*', 'https://app.example.com:8443/*'] })
    expect(await chrome.permissions.contains({ origins: ['https://*/*', 'http://example.com:3000/*'] })).toBe(true)
    reset({}, { version: '1.0.0', host_permissions: ['https://app.example.com:8443/*', 'https://example.com:443/*'] })
    expect(await chrome.permissions.contains({ origins: ['https://app.example.com:8443/*'] })).toBe(true)
    expect(await chrome.permissions.contains({ origins: ['https://app.example.com/*'] })).toBe(false)
    expect(await chrome.permissions.contains({ origins: ['https://*/*'] })).toBe(false)
  })

  test('the email comes with identity.email held by the manifest as with one granted', async () => {
    reset({}, { version: '1.0.0', permissions: ['identity', 'identity.email'] })
    shim.account = { id: '1234', email: 'someone@example.com' }
    expect(await chrome.identity.getProfileUserInfo({})).toEqual({ id: '1234', email: 'someone@example.com' })
  })

  test('signing the profile in or out fires onSignInChanged as Chrome does', async () => {
    const heard: unknown[] = []
    chrome.identity.onSignInChanged.addListener((account: unknown, signedIn: boolean) => void heard.push([account, signedIn]))
    await signIn({ id: '1234', email: 'someone@example.com' })
    await signIn(null)
    expect(heard).toEqual([
      [{ id: '1234' }, true],
      [{ id: '' }, false],
    ])
  })

  test('alarms are listed and cleared, one or all', async () => {
    await chrome.alarms.create('a', { periodInMinutes: 1 })
    await chrome.alarms.create('b', { delayInMinutes: 5 })
    expect((await chrome.alarms.getAll()).map((alarm) => alarm.name)).toEqual(['a', 'b'])
    expect(await chrome.alarms.clear('a')).toBe(true)
    expect(await chrome.alarms.clear('a')).toBe(false)
    expect(await chrome.alarms.clearAll()).toBe(true)
    expect(() => fireAlarm('b')).toThrow('No alarm named b')
  })
})

describe('extend', () => {
  test("an extension adds a namespace of its own and a method the kit's lacks, which stay across reset; its events are cleared", async () => {
    const onClicked = new ChromeEvent()
    let badge = ''
    extend({
      action: { setBadgeText: async ({ text }: { text: string }) => void (badge = text) },
      contextMenus: { onClicked },
      identity: { getAuthToken: async () => ({ token: 'token-1' }) },
    })
    const kit = chrome as unknown as Record<string, Record<string, (...args: never[]) => Promise<unknown>>>
    await kit.action!.setBadgeText!({ text: '3' } as never)
    expect(badge).toBe('3')
    onClicked.addListener(() => undefined)
    reset()
    expect(onClicked.hasListeners()).toBe(false)
    expect(await kit.identity!.getAuthToken!()).toEqual({ token: 'token-1' })
  })

  test('it refuses to replace what the stand-in has, so a test never runs against two versions of one call', () => {
    expect(() => extend({ tabs: { query: async () => [] } })).toThrow('chrome.tabs.query is the stand-in')
  })
})
