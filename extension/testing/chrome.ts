// A stand-in for the parts of `chrome` an extension's worker uses, for unit
// tests: the manifest, its own files by URL, reload, storage, alarms, tabs,
// windows, messages from its pages and to its native host, the profile's
// account, optional permissions with origins, and Web Locks, which Bun lacks.
// Importing this module installs it on globalThis. Each test starts from
// reset(). The network is refused unless a test answers it (answerNetwork),
// so a test never depends on the internet without anyone seeing it. What one
// extension alone uses (scripting, the toolbar badge, context menus) it adds
// with extend().

type Files = Record<string, string>
type Alarm = { name: string; periodInMinutes?: number; scheduledTime: number }
type Listener = (...args: any[]) => unknown

/** A chrome event: addListener and the rest, and emit(), which a test calls as Chrome would. */
export class ChromeEvent<L extends Listener = Listener> {
  static all = new Set<ChromeEvent<any>>()
  readonly listeners = new Set<L>()
  constructor() {
    ChromeEvent.all.add(this)
  }
  addListener(listener: L) {
    this.listeners.add(listener)
  }
  removeListener(listener: L) {
    this.listeners.delete(listener)
  }
  hasListener(listener: L) {
    return this.listeners.has(listener)
  }
  hasListeners() {
    return this.listeners.size > 0
  }
  /** Calls every listener at once, as Chrome does, and waits for what they return. */
  emit(...args: Parameters<L>) {
    return Promise.all([...this.listeners].map((listener) => listener(...args)))
  }
}

export type Tab = {
  id: number
  windowId: number
  url: string
  title: string
  active: boolean
  pinned: boolean
  groupId: number
  index: number
  favIconUrl?: string
  pendingUrl?: string
  [property: string]: unknown
}

export type ChromeWindow = { id: number; focused: boolean; state: string; type: string; tabs?: Tab[] }

export type Port = {
  name: string
  posted: unknown[]
  postMessage(message: unknown): void
  disconnect(): void
  onMessage: ChromeEvent
  onDisconnect: ChromeEvent
  /** Delivers a message from the host to the worker's listeners. */
  deliver(message: unknown): Promise<unknown[]>
  /** Closes the port from the host's side, with Chrome's error when one is given (runtime.lastError in the listeners). */
  close(error?: string): void
  closed: boolean
}

export const shim = {
  manifest: {} as Record<string, unknown>,
  /** The extension's files, by path from its root; fetching one that is missing fails. */
  files: {} as Files,
  session: {} as Record<string, unknown>,
  local: {} as Record<string, unknown>,
  reloads: 0,
  alarms: new Map<string, Alarm>(),
  account: { id: '', email: '' },
  /** Optional permissions granted, by name. */
  granted: new Set<string>(),
  /** Origins granted, as match patterns (`https://*.example.com/*`, `<all_urls>`). */
  origins: new Set<string>(),
  tabs: new Map<number, Tab>(),
  windows: new Map<number, ChromeWindow>(),
  /** Every request the worker sent past its own files, answered or not. */
  networkRequests: [] as { url: string; method: string }[],
  /** The test's answer to the network, or null: the network is refused. */
  network: null as ((request: Request) => Response | Promise<Response>) | null,
  /** Every message the worker sent its native host with sendNativeMessage. */
  nativeMessages: [] as { host: string; message: unknown }[],
  /** The native host's answer to sendNativeMessage, or null: no host is registered. */
  nativeHost: null as ((host: string, message: unknown) => unknown) | null,
  /** Every port the worker opened to a native host, newest last. */
  ports: [] as Port[],
  /** Every message the worker sent its own pages with runtime.sendMessage. */
  sentMessages: [] as unknown[],
}

const DEFAULT_MANIFEST = { version: '0.1.0', version_name: '0.1.0-src' }

// Tab and window ids are never reused in a run, as in a Chrome session, so a
// module's state about one tab cannot match a tab of a later test.
let nextTabId = 1
let nextWindowId = 1

export function reset(files: Files = {}, manifest: Record<string, unknown> = { ...DEFAULT_MANIFEST }) {
  shim.manifest = manifest
  shim.files = files
  shim.session = {}
  shim.local = {}
  shim.reloads = 0
  shim.alarms = new Map()
  shim.account = { id: '', email: '' }
  shim.granted = new Set()
  shim.origins = new Set()
  shim.tabs = new Map()
  shim.windows = new Map()
  shim.networkRequests = []
  shim.network = null
  shim.nativeMessages = []
  shim.nativeHost = null
  shim.ports = []
  shim.sentMessages = []
  // A kit worker adds its listeners when it starts, which a test does, so each test starts with none; an extension's own
  // events (made with ChromeEvent) are cleared too.
  for (const event of ChromeEvent.all) event.listeners.clear()
  locks.clear()
}

/** Delivers the named alarm to every listener, as Chrome does when it comes due. */
export function fireAlarm(name: string) {
  const alarm = shim.alarms.get(name)
  if (!alarm) throw new Error(`No alarm named ${name}`)
  return chrome.alarms.onAlarm.emit(alarm)
}

/** Grants permissions and origins, as the person would in Chrome's prompt, firing permissions.onAdded. */
export function grant({ permissions = [], origins = [] }: { permissions?: string[]; origins?: string[] }) {
  for (const p of permissions) shim.granted.add(p)
  for (const o of origins) shim.origins.add(o)
  return chrome.permissions.onAdded.emit({ permissions, origins })
}

/** Signs the profile in to an account, or out with null, firing identity.onSignInChanged as Chrome does. */
export function signIn(account: { id: string; email: string } | null) {
  shim.account = account ? { ...account } : { id: '', email: '' }
  return chrome.identity.onSignInChanged.emit({ id: shim.account.id }, account !== null)
}

/** Answers the worker's requests to the network; a request with no answer is refused as when offline. */
export function answerNetwork(answer: (request: Request) => Response | Promise<Response>) {
  shim.network = answer
}

/** A window, the first one made focused, as a browser's first window is. */
export function addWindow(properties: Partial<ChromeWindow> = {}): ChromeWindow {
  const window: ChromeWindow = { id: nextWindowId++, focused: shim.windows.size === 0, state: 'normal', type: 'normal', ...properties }
  if (window.focused) for (const other of shim.windows.values()) other.focused = false
  shim.windows.set(window.id, window)
  return window
}

/**
 * A tab, in the focused window unless one is named (a window is made when there is none). The tab given back is the
 * live one: change its url or title to stand for a page that moved on.
 */
export function addTab(properties: Partial<Tab> = {}): Tab {
  const windowId = properties.windowId ?? focusedWindow()?.id ?? addWindow().id
  if (!shim.windows.has(windowId)) addWindow({ id: windowId, focused: false })
  const index = [...shim.tabs.values()].filter((tab) => tab.windowId === windowId).length
  const tab: Tab = { id: nextTabId++, url: 'about:blank', title: '', active: false, pinned: false, groupId: -1, index, ...properties, windowId }
  if (tab.active) activate(tab)
  shim.tabs.set(tab.id, tab)
  return tab
}

/**
 * Sends a message to the worker as one of its pages would, and gives back the answer: what a listener passed to
 * sendResponse after returning true, or what its promise resolved to (Chrome 148 and later). The first listener to
 * answer is the answer, and a promise rejected with an Error rejects with its message, as Chrome's sendMessage does.
 */
export function sendToWorker(message: unknown, sender: Record<string, unknown> = { id: 'test', origin: PREFIX.slice(0, -1) }) {
  return new Promise<unknown>((resolve, reject) => {
    let answered = false
    let open = false
    const answer = (value: unknown) => {
      if (answered) return
      answered = true
      resolve(value)
    }
    for (const listener of chrome.runtime.onMessage.listeners) {
      const kept = listener(message, sender, answer)
      if (kept === true) open = true
      else if (kept instanceof Promise) {
        open = true
        kept.then(
          (value) => answer(value ?? null),
          (error) => {
            if (answered || !(error instanceof Error)) return
            answered = true
            reject(new Error(error.message))
          },
        )
      }
    }
    if (!open) answer(undefined)
  })
}

const PREFIX = 'chrome-extension://test/'

function focusedWindow() {
  return [...shim.windows.values()].find((window) => window.focused)
}

function activate(tab: Tab) {
  for (const other of shim.tabs.values()) if (other.windowId === tab.windowId) other.active = false
  tab.active = true
}

function liveTab(tabId: number) {
  const tab = shim.tabs.get(tabId)
  if (!tab) throw new Error(`No tab with id: ${tabId}.`)
  return tab
}

function liveWindow(windowId: number) {
  const window = shim.windows.get(windowId)
  if (!window) throw new Error(`No window with id: ${windowId}.`)
  return window
}

const WEB_SCHEMES = ['http', 'https', 'ws', 'wss']

/**
 * A match pattern's parts: the scheme (`*` for the web's four), the host (`*`, `*.example.com` or a name), the port
 * (`*` for any, as when none is named) and the path, or null for what is not one.
 */
function parsePattern(pattern: string) {
  const found = /^(\*|[a-z-]+):\/\/([^/]*)(\/.*)$/.exec(pattern)
  if (!found) return null
  const [, scheme, authority, path] = found as unknown as [string, string, string, string]
  // The host, an IPv6 address in brackets included, then the port when one is named.
  const [, host = '', port = '*'] = /^(\[[^\]]*\]|[^:]*)(?::(.*))?$/.exec(authority) ?? []
  if ((host !== '*' && host.slice(host.startsWith('*.') ? 2 : 0).includes('*')) || !/^(\*|\d+)$/.test(port)) return null
  return { scheme, host, port, path }
}

/** A path with `*` for anything, as a regular expression. */
function glob(path: string) {
  return new RegExp(`^${path.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
}

/** Whether a pattern's host covers a name: `*` any, `*.example.com` the name and every one under it. */
function hostCovers(host: string, name: string) {
  if (host === '*' || host === '') return true
  if (!host.startsWith('*.')) return name === host
  const domain = host.slice(2)
  return name === domain || name === host || name.endsWith(`.${domain}`)
}

/** A match pattern (`*://*.example.com/*`, `<all_urls>`) as a test of an address, as Chrome reads one. */
function matches(pattern: string, url: string) {
  if (pattern === '<all_urls>') return /^(https?|wss?|ftp|file|data):/.test(url)
  const parts = parsePattern(pattern)
  if (!parts || !URL.canParse(url)) return false
  const address = new URL(url)
  const scheme = address.protocol.slice(0, -1)
  if (parts.scheme === '*' ? !WEB_SCHEMES.includes(scheme) : parts.scheme !== scheme) return false
  if (!hostCovers(parts.host, address.hostname)) return false
  if (parts.port !== '*' && parts.port !== (address.port || { http: '80', https: '443', ws: '80', wss: '443' }[scheme])) return false
  return glob(parts.path).test(address.pathname + address.search)
}

/** What the extension holds: the manifest's permissions and host permissions, and what was granted since. */
function held() {
  return {
    permissions: new Set([...((shim.manifest.permissions as string[] | undefined) ?? []), ...shim.granted]),
    origins: new Set([...((shim.manifest.host_permissions as string[] | undefined) ?? []), ...shim.origins]),
  }
}

/**
 * Whether the origins held cover a pattern asked about: the same one, `<all_urls>`, or one held that holds every
 * address the asked one names, in its schemes, hosts and ports. A narrower one held never covers a wider ask. The path
 * plays no part: Chrome treats a host permission's path as `/*`, whatever it says.
 */
function covers(origins: Set<string>, pattern: string) {
  if (origins.has(pattern) || origins.has('<all_urls>')) return true
  const asked = parsePattern(pattern)
  if (!asked) return false
  return [...origins].some((origin) => {
    const held = parsePattern(origin)
    if (!held) return false
    const schemes = held.scheme === '*' ? WEB_SCHEMES : [held.scheme]
    const askedSchemes = asked.scheme === '*' ? WEB_SCHEMES : [asked.scheme]
    return (
      askedSchemes.every((scheme) => schemes.includes(scheme)) &&
      (held.host === '*' || hostCovers(held.host, asked.host)) &&
      (asked.host !== '*' || held.host === '*') &&
      (held.port === '*' || held.port === asked.port)
    )
  })
}

/** Whether the extension may see a tab's address: with the `tabs` permission, or an origin that covers the page. */
function visible(tab: Tab) {
  const { permissions, origins } = held()
  // A host permission's path is read as `/*`, as Chrome reads it.
  const anyPath = (origin: string) => origin.replace(/^([^:]+:\/\/[^/]*)\/.*$/, '$1/*')
  return permissions.has('tabs') || [...origins].some((origin) => matches(anyPath(origin), tab.pendingUrl ?? tab.url))
}

/** A tab as the worker sees it: Chrome leaves out its address, title and icon unless the extension may see them. */
function seen(tab: Tab): Tab {
  if (visible(tab)) return structuredClone(tab)
  const { url: _url, title: _title, favIconUrl: _icon, pendingUrl: _pending, ...rest } = structuredClone(tab)
  return rest as Tab
}

function tabsIn(windowId: number) {
  return [...shim.tabs.values()].filter((tab) => tab.windowId === windowId).sort((a, b) => a.index - b.index)
}

/**
 * Closes a tab: the rest of its window move up, the next one (or the one before, for the last) becomes active when it
 * was, and a window left with none closes, as in Chrome.
 */
async function closeTab(tab: Tab, isWindowClosing: boolean) {
  shim.tabs.delete(tab.id)
  const left = tabsIn(tab.windowId)
  left.forEach((other, index) => (other.index = index))
  await chrome.tabs.onRemoved.emit(tab.id, { windowId: tab.windowId, isWindowClosing })
  if (isWindowClosing) return
  if (left.length === 0) return closeWindow(liveWindow(tab.windowId))
  if (!tab.active) return
  const next = left[Math.min(tab.index, left.length - 1)]!
  activate(next)
  await chrome.tabs.onActivated.emit({ tabId: next.id, windowId: next.windowId })
}

/** Closes a window and its tabs; when it was focused, the window opened last of those left takes the focus. */
async function closeWindow(window: ChromeWindow) {
  for (const tab of tabsIn(window.id)) await closeTab(tab, true)
  shim.windows.delete(window.id)
  await chrome.windows.onRemoved.emit(window.id)
  const next = [...shim.windows.values()].at(-1)
  if (window.focused && next) await focus(next)
}

function area(store: () => Record<string, unknown>, replace: (items: Record<string, unknown>) => void) {
  return {
    async get(keys?: string | string[] | Record<string, unknown> | null) {
      const items = store()
      if (keys === null || keys === undefined) return structuredClone(items)
      // An object names its keys with the value to give when one is missing.
      const defaults = typeof keys === 'object' && !Array.isArray(keys) ? keys : {}
      const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys)
      const found: Record<string, unknown> = {}
      for (const name of names) {
        if (name in items) found[name] = structuredClone(items[name])
        else if (name in defaults) found[name] = defaults[name]
      }
      return found
    },
    async set(items: Record<string, unknown>) {
      Object.assign(store(), structuredClone(items))
    },
    async remove(keys: string | string[]) {
      for (const key of ([] as string[]).concat(keys)) delete store()[key]
    },
    async clear() {
      replace({})
    },
  }
}

function fakePort(name: string): Port {
  const port: Port = {
    name,
    posted: [],
    closed: false,
    postMessage(message) {
      if (port.closed) throw new Error('Attempting to use a disconnected port object')
      port.posted.push(structuredClone(message))
    },
    // The worker's own disconnect fires nothing on its side, as in Chrome.
    disconnect() {
      port.closed = true
    },
    onMessage: new ChromeEvent(),
    onDisconnect: new ChromeEvent(),
    deliver: (message) => port.onMessage.emit(structuredClone(message), port),
    close(error) {
      port.closed = true
      chrome.runtime.lastError = error ? { message: error } : undefined
      try {
        void port.onDisconnect.emit(port)
      } finally {
        chrome.runtime.lastError = undefined
      }
    },
  }
  return port
}

const chrome = {
  // No runtime.id: a worker that starts itself only when chrome.runtime.id is
  // set stays still when a test imports it.
  runtime: {
    getManifest: () => shim.manifest,
    getURL: (path: string) => PREFIX + path,
    reload: () => {
      shim.reloads++
    },
    lastError: undefined as { message: string } | undefined,
    onInstalled: new ChromeEvent(),
    onStartup: new ChromeEvent(),
    onMessage: new ChromeEvent<(message: any, sender: any, sendResponse: (answer: unknown) => void) => unknown>(),
    // With no page open to hear it, Chrome's sendMessage rejects so; a test reads what was sent from shim.sentMessages.
    async sendMessage(message: unknown) {
      shim.sentMessages.push(structuredClone(message))
      throw new Error('Could not establish connection. Receiving end does not exist.')
    },
    async sendNativeMessage(host: string, message: unknown) {
      shim.nativeMessages.push({ host, message: structuredClone(message) })
      if (!shim.nativeHost) throw new Error('Specified native messaging host not found.')
      return shim.nativeHost(host, message)
    },
    // Chrome gives back a port even for a host it cannot start, and then closes it with the reason: a test does the
    // same with port.close('Specified native messaging host not found.').
    connectNative(host: string) {
      const port = fakePort(host)
      shim.ports.push(port)
      return port
    },
  },
  storage: {
    session: area(() => shim.session, (items) => (shim.session = items)),
    local: area(() => shim.local, (items) => (shim.local = items)),
  },
  alarms: {
    async get(name: string) {
      return shim.alarms.get(name)
    },
    async getAll() {
      return [...shim.alarms.values()]
    },
    async create(name: string, info: { periodInMinutes?: number; when?: number; delayInMinutes?: number }) {
      const scheduledTime = info.when ?? Date.now() + (info.delayInMinutes ?? info.periodInMinutes ?? 0) * 60_000
      shim.alarms.set(name, { name, scheduledTime, ...(info.periodInMinutes ? { periodInMinutes: info.periodInMinutes } : {}) })
    },
    async clear(name: string) {
      return shim.alarms.delete(name)
    },
    async clearAll() {
      const had = shim.alarms.size > 0
      shim.alarms.clear()
      return had
    },
    onAlarm: new ChromeEvent<(alarm: Alarm) => unknown>(),
  },
  tabs: {
    TAB_ID_NONE: -1,
    async get(tabId: number) {
      return seen(liveTab(tabId))
    },
    async query(info: { url?: string | string[]; active?: boolean; windowId?: number; currentWindow?: boolean; lastFocusedWindow?: boolean; groupId?: number; pinned?: boolean } = {}) {
      const focused = focusedWindow()?.id
      return [...shim.tabs.values()]
        // A tab whose address the extension may not see matches no address, as in Chrome.
        .filter((tab) => info.url === undefined || (visible(tab) && ([] as string[]).concat(info.url).some((pattern) => matches(pattern, tab.pendingUrl ?? tab.url))))
        .filter((tab) => info.active === undefined || tab.active === info.active)
        .filter((tab) => info.windowId === undefined || tab.windowId === info.windowId)
        .filter((tab) => !(info.currentWindow || info.lastFocusedWindow) || tab.windowId === focused)
        .filter((tab) => info.groupId === undefined || tab.groupId === info.groupId)
        .filter((tab) => info.pinned === undefined || tab.pinned === info.pinned)
        .map(seen)
    },
    async create(properties: { url?: string; active?: boolean; windowId?: number; pinned?: boolean } = {}) {
      const tab = addTab({ ...properties, active: properties.active ?? true, url: properties.url ?? 'chrome://newtab/' })
      await chrome.tabs.onCreated.emit(seen(tab))
      if (tab.active) await chrome.tabs.onActivated.emit({ tabId: tab.id, windowId: tab.windowId })
      return seen(tab)
    },
    async update(tabId: number, properties: { url?: string; active?: boolean; pinned?: boolean }) {
      const tab = liveTab(tabId)
      const changed: Record<string, unknown> = {}
      if (properties.url !== undefined && properties.url !== tab.url) changed.url = tab.url = properties.url
      if (properties.pinned !== undefined && properties.pinned !== tab.pinned) changed.pinned = tab.pinned = properties.pinned
      const activated = properties.active === true && !tab.active
      if (activated) activate(tab)
      if (Object.keys(changed).length > 0) await chrome.tabs.onUpdated.emit(tab.id, changed, seen(tab))
      if (activated) await chrome.tabs.onActivated.emit({ tabId: tab.id, windowId: tab.windowId })
      return seen(tab)
    },
    async remove(tabIds: number | number[]) {
      const tabs = ([] as number[]).concat(tabIds).map(liveTab)
      for (const tab of tabs) await closeTab(tab, false)
    },
    onCreated: new ChromeEvent(),
    onUpdated: new ChromeEvent(),
    onActivated: new ChromeEvent(),
    onRemoved: new ChromeEvent(),
  },
  windows: {
    WINDOW_ID_NONE: -1,
    async get(windowId: number, { populate = false } = {}) {
      return windowAsSeen(liveWindow(windowId), populate)
    },
    async getAll({ populate = false } = {}) {
      return [...shim.windows.values()].map((window) => windowAsSeen(window, populate))
    },
    // Chrome throws when no window is open.
    async getLastFocused({ populate = false } = {}) {
      const window = focusedWindow() ?? [...shim.windows.values()].at(-1)
      if (!window) throw new Error('No last-focused window')
      return windowAsSeen(window, populate)
    },
    async create({ url, focused = true }: { url?: string; focused?: boolean } = {}) {
      const window = addWindow({ focused: false })
      if (focused) await focus(window)
      await chrome.windows.onCreated.emit(windowAsSeen(window, false))
      await chrome.tabs.create({ windowId: window.id, url })
      return windowAsSeen(window, true)
    },
    async update(windowId: number, { focused, state }: { focused?: boolean; state?: string }) {
      const window = liveWindow(windowId)
      if (state !== undefined) window.state = state
      if (focused && !window.focused) await focus(window)
      return windowAsSeen(window, false)
    },
    async remove(windowId: number) {
      await closeWindow(liveWindow(windowId))
    },
    onCreated: new ChromeEvent(),
    onRemoved: new ChromeEvent(),
    onFocusChanged: new ChromeEvent<(windowId: number) => unknown>(),
  },
  identity: {
    AccountStatus: { SYNC: 'SYNC', ANY: 'ANY' },
    // Chrome leaves the email empty unless the extension holds identity.email.
    async getProfileUserInfo() {
      return { id: shim.account.id, email: held().permissions.has('identity.email') ? shim.account.email : '' }
    },
    onSignInChanged: new ChromeEvent(),
  },
  permissions: {
    async contains({ permissions = [], origins = [] }: { permissions?: string[]; origins?: string[] }) {
      const holds = held()
      return permissions.every((p) => holds.permissions.has(p)) && origins.every((o) => covers(holds.origins, o))
    },
    async request({ permissions = [], origins = [] }: { permissions?: string[]; origins?: string[] }) {
      await grant({ permissions, origins })
      return true
    },
    async remove({ permissions = [], origins = [] }: { permissions?: string[]; origins?: string[] }) {
      for (const p of permissions) shim.granted.delete(p)
      for (const o of origins) shim.origins.delete(o)
      await chrome.permissions.onRemoved.emit({ permissions, origins })
      return true
    },
    // What the manifest holds and what was granted since, as Chrome lists them.
    async getAll() {
      const { permissions, origins } = held()
      return { permissions: [...permissions], origins: [...origins] }
    },
    onAdded: new ChromeEvent(),
    onRemoved: new ChromeEvent(),
  },
}

function windowAsSeen(window: ChromeWindow, populate: boolean) {
  const { tabs: _tabs, ...rest } = window
  if (!populate) return { ...rest }
  return { ...rest, tabs: [...shim.tabs.values()].filter((tab) => tab.windowId === window.id).map(seen) }
}

async function focus(window: ChromeWindow) {
  for (const other of shim.windows.values()) other.focused = false
  window.focused = true
  await chrome.windows.onFocusChanged.emit(window.id)
}

/**
 * Adds what one extension alone uses to the stand-in: a namespace of its own (`scripting`, `action`, `contextMenus`)
 * or a method the kit's lacks on one it has (`identity.getAuthToken`). Call it once, at the top of a test file or in
 * the test start-up file; what it adds stays across reset(), and its events, made with ChromeEvent, are cleared by it.
 * It refuses to replace what the stand-in already has, so a test never quietly runs against two versions of one call.
 */
export function extend(additions: Record<string, Record<string, unknown>>) {
  const target = chrome as unknown as Record<string, Record<string, unknown>>
  for (const [name, members] of Object.entries(additions)) {
    const existing = (target[name] ??= {})
    for (const [member, value] of Object.entries(members)) {
      if (member in existing) throw new Error(`chrome.${name}.${member} is the stand-in's own; extend adds only what it lacks`)
      existing[member] = value
    }
  }
}

;(globalThis as any).chrome = chrome

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input)
  if (url.startsWith(PREFIX)) {
    const path = url.slice(PREFIX.length)
    if (!(path in shim.files)) throw new TypeError('Failed to fetch')
    return new Response(shim.files[path])
  }
  // A data: or blob: address never leaves the process.
  if (/^(data|blob):/i.test(url)) return realFetch(input, init)
  const request = new Request(input, init)
  shim.networkRequests.push({ url: request.url, method: request.method })
  if (!shim.network) throw new TypeError('Failed to fetch')
  return shim.network(request)
}) as typeof fetch

// Web Locks: one queue per name, as Chrome runs them.
const locks = new Map<string, Promise<unknown>>()
Object.defineProperty(globalThis.navigator, 'locks', {
  configurable: true,
  value: {
    request(name: string, run: () => Promise<unknown>) {
      const next = (locks.get(name) ?? Promise.resolve()).then(run, run)
      locks.set(name, next.catch(() => {}))
      return next
    },
  },
})
