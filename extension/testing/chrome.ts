// A stand-in for the parts of `chrome` a worker built on the kit uses, for
// unit tests: the manifest, its own files by URL, reload, storage, alarms, the
// profile's account and optional permissions, and Web Locks, which Bun lacks.
// Importing this module installs it on globalThis. Each test starts from reset().

type Files = Record<string, string>
type Alarm = { name: string; periodInMinutes?: number; scheduledTime: number }

export const shim = {
  manifest: {} as Record<string, unknown>,
  /** The extension's files, by path from its root; fetching one that is missing fails. */
  files: {} as Files,
  session: {} as Record<string, unknown>,
  local: {} as Record<string, unknown>,
  reloads: 0,
  alarms: new Map<string, Alarm>(),
  account: { id: '', email: '' },
  granted: new Set<string>(),
}

const alarmListeners: ((alarm: Alarm) => void)[] = []

export function reset(files: Files = {}, manifest: Record<string, unknown> = { version: '0.1.0', version_name: '0.1.0-src' }) {
  shim.manifest = manifest
  shim.files = files
  shim.session = {}
  shim.local = {}
  shim.reloads = 0
  shim.alarms = new Map()
  shim.account = { id: '', email: '' }
  shim.granted = new Set()
  alarmListeners.length = 0
}

/** Delivers the named alarm to every listener, as Chrome does when it comes due. */
export function fireAlarm(name: string) {
  const alarm = shim.alarms.get(name)
  if (!alarm) throw new Error(`No alarm named ${name}`)
  for (const listener of alarmListeners) listener(alarm)
}

function area(store: () => Record<string, unknown>) {
  return {
    async get(key: string) {
      return key in store() ? { [key]: structuredClone(store()[key]) } : {}
    },
    async set(items: Record<string, unknown>) {
      Object.assign(store(), structuredClone(items))
    },
  }
}

const PREFIX = 'chrome-extension://test/'

;(globalThis as any).chrome = {
  // No runtime.id: a worker that starts itself only when chrome.runtime.id is
  // set stays still when a test imports it.
  runtime: {
    getManifest: () => shim.manifest,
    getURL: (path: string) => PREFIX + path,
    reload: () => {
      shim.reloads++
    },
  },
  storage: { session: area(() => shim.session), local: area(() => shim.local) },
  alarms: {
    async get(name: string) {
      return shim.alarms.get(name)
    },
    async create(name: string, info: { periodInMinutes?: number; when?: number; delayInMinutes?: number }) {
      const scheduledTime = info.when ?? Date.now() + (info.delayInMinutes ?? info.periodInMinutes ?? 0) * 60_000
      shim.alarms.set(name, { name, scheduledTime, ...(info.periodInMinutes ? { periodInMinutes: info.periodInMinutes } : {}) })
    },
    onAlarm: {
      addListener: (listener: (alarm: Alarm) => void) => alarmListeners.push(listener),
    },
  },
  identity: {
    AccountStatus: { SYNC: 'SYNC', ANY: 'ANY' },
    // Chrome leaves the email empty unless identity.email is granted.
    async getProfileUserInfo() {
      return { id: shim.account.id, email: shim.granted.has('identity.email') ? shim.account.email : '' }
    },
  },
  permissions: {
    async contains({ permissions = [] }: { permissions?: string[] }) {
      return permissions.every((p) => shim.granted.has(p))
    },
    async request({ permissions = [] }: { permissions?: string[] }) {
      for (const p of permissions) shim.granted.add(p)
      return true
    },
  },
}

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input)
  if (!url.startsWith(PREFIX)) return realFetch(input, init)
  const path = url.slice(PREFIX.length)
  if (!(path in shim.files)) throw new TypeError('Failed to fetch')
  return new Response(shim.files[path])
}) as typeof fetch

// Web Locks: one queue per name, as Chrome runs them.
const queues = new Map<string, Promise<unknown>>()
Object.defineProperty(globalThis.navigator, 'locks', {
  configurable: true,
  value: {
    request(name: string, run: () => Promise<unknown>) {
      const next = (queues.get(name) ?? Promise.resolve()).then(run, run)
      queues.set(name, next.catch(() => {}))
      return next
    },
  },
})
