import { beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { addTab, addWindow, reset, shim } from '../testing/chrome.ts'
import { showLink } from '../worker/show.js'

const WITH_TABS = { version: '1.0.0', permissions: ['tabs'] }

beforeEach(() => reset({}, WITH_TABS))

describe('showLink', () => {
  test('a tab already showing the link comes forward, its window raised and brought back from the Dock, and no tab opens', async () => {
    const back = addWindow()
    const front = addWindow({ state: 'minimized' })
    addTab({ windowId: back.id, url: 'https://example.com/other', active: true })
    const showing = addTab({ windowId: front.id, url: 'https://example.com/inbox' })
    expect(await showLink('https://example.com/inbox')).toEqual({ how: 'existing-tab' })
    expect(shim.tabs.get(showing.id)!.active).toBe(true)
    expect(shim.windows.get(front.id)).toMatchObject({ focused: true, state: 'normal' })
    expect(shim.tabs.size).toBe(2)
  })

  test('with none showing it, it opens in a new tab of the last focused window, which is raised', async () => {
    const window = addWindow()
    addTab({ windowId: window.id, url: 'https://example.com/other', active: true })
    expect(await showLink('https://example.com/inbox')).toEqual({ how: 'new-tab' })
    const opened = [...shim.tabs.values()].find((tab) => tab.url === 'https://example.com/inbox')
    expect(opened).toMatchObject({ windowId: window.id, active: true })
    expect(shim.windows.get(window.id)!.focused).toBe(true)
  })

  test('a profile with no window gets one, focused, showing the link', async () => {
    expect(await showLink('https://example.com/inbox')).toEqual({ how: 'new-window' })
    const [window] = shim.windows.values()
    expect(window).toMatchObject({ focused: true })
    expect([...shim.tabs.values()].map((tab) => tab.url)).toEqual(['https://example.com/inbox'])
  })

  test("the extension's own page opens and is found again, and an address of any other kind is refused", async () => {
    const own = chrome.runtime.getURL('settings.html')
    expect(await showLink(own)).toEqual({ how: 'new-window' })
    expect(await showLink(own)).toEqual({ how: 'existing-tab' })
    expect(shim.tabs.size).toBe(1)
    for (const url of ['javascript:alert(1)', 'file:///etc/hosts', 'chrome://settings', 'not an address']) {
      expect(await showLink(url)).toEqual({ how: 'refused' })
    }
    expect(shim.tabs.size).toBe(1)
  })

  test('the link is compared as an address, so the same page written another way is found', async () => {
    addTab({ url: 'https://example.com/', active: true })
    expect(await showLink('HTTPS://EXAMPLE.COM')).toEqual({ how: 'existing-tab' })
  })

  test('a tab the extension skips is never brought forward, and the link opens beside it', async () => {
    const check = addTab({ url: 'https://example.com/inbox', active: true })
    expect(await showLink('https://example.com/inbox', { skip: (tab) => tab.id === check.id })).toEqual({ how: 'new-tab' })
    expect(shim.tabs.size).toBe(2)
  })

  test('the open wraps only a new tab or window, with the address, and the tab it gives back', async () => {
    addTab({ url: 'https://example.com/inbox', active: true })
    const wrapped: { url: string; tabId: number | undefined }[] = []
    const open = async (url: string, opening: () => Promise<number | undefined>) => wrapped.push({ url, tabId: await opening() })
    await showLink('https://example.com/inbox', { open })
    expect(wrapped).toEqual([])
    await showLink('https://example.com/sent', { open })
    const opened = [...shim.tabs.values()].find((tab) => tab.url === 'https://example.com/sent')!
    expect(wrapped).toEqual([{ url: 'https://example.com/sent', tabId: opened.id }])
    reset({}, WITH_TABS)
    await showLink('https://example.com/new', { open })
    expect(wrapped[1]).toEqual({ url: 'https://example.com/new', tabId: [...shim.tabs.keys()][0] })
  })

  test("without tabs or access to the site, no tab's address is readable: the answer says so, the worker logs it once, and the link opens in a new tab", async () => {
    reset({}, { version: '1.0.0' })
    addTab({ url: 'https://example.com/inbox', active: true })
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(await showLink('https://example.com/inbox')).toEqual({ how: 'new-tab', tabsUnreadable: true })
      expect(await showLink('https://example.com/inbox')).toEqual({ how: 'new-tab', tabsUnreadable: true })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]![0])).toContain('tabs permission')
    } finally {
      warn.mockRestore()
    }
    // Access to the site is enough, as Chrome gives the address with it.
    reset({}, { version: '1.0.0', host_permissions: ['https://example.com/*'] })
    addTab({ url: 'https://example.com/inbox', active: true })
    expect(await showLink('https://example.com/inbox')).toEqual({ how: 'existing-tab' })
  })

  test('a refusal from Chrome is answered failed, never thrown', async () => {
    addTab({ url: 'https://example.com/other', active: true })
    const refused = spyOn(chrome.tabs, 'create').mockImplementation(async () => {
      throw new Error('Tabs cannot be edited right now (user may be dragging a tab).')
    })
    try {
      expect(await showLink('https://example.com/inbox')).toEqual({ how: 'failed' })
    } finally {
      refused.mockRestore()
    }
  })
})
