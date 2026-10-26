// The real extension in a hidden Chromium, loaded from a git checkout the way
// the owner's main checkout is, for an extension's own tests to drive. It
// answers what a unit test with a stand-in `chrome` cannot: that the worker
// starts, that Chrome starts the native host and the port carries messages,
// that no tab or window opens, and that a new commit in the checkout reloads
// the worker. Chromium runs headless, so nothing shows on screen. Needs
// Playwright's Chromium: `bunx playwright install chromium`.

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type BrowserContext, type Worker } from 'playwright'
import { extensionId, writeHostLauncher, writeHostManifest } from '../host/install.ts'

export type HarnessOptions = {
  /** The folder whose tracked and untracked-but-not-ignored files become the checkout's root, where manifest.json is. */
  source: string
  /** A native host for Chrome to start: its name, and the command that runs it, given the checkout's folder. */
  nativeHost?: { name: string; command: (checkout: string) => string[]; env?: Record<string, string> }
  /** More Chromium flags, such as `--host-resolver-rules` to send a site to a stand-in. */
  args?: string[]
  /** Link the source's node_modules into the checkout, for a host that runs from it. Defaults to true when there is one. */
  linkPackages?: boolean
  /** Passed to Playwright: ignore certificate errors, for a stand-in site with a self-made certificate. */
  ignoreHTTPSErrors?: boolean
}

export type LoadedExtension = {
  context: BrowserContext
  /** The current service worker; replaced after each reload. */
  worker: Worker
  extensionId: string
  /** The scratch checkout the extension loads from. */
  checkout: string
  /** The scratch Chromium profile. */
  profile: string
  /** Runs git in the checkout, and returns its output, trimmed. */
  git: (...args: string[]) => string
  /** Commits every change in the checkout, and returns the new commit. */
  commit: (message: string) => string
  /** Brings the worker's named alarm forward to half a second from now, keeping its period. */
  fireAlarm: (name: string) => Promise<void>
  /** Resolves once Chrome has started a new worker, which it then holds in `worker`. Call it before whatever reloads the worker, and await it after. */
  nextWorker: (timeoutMs?: number) => Promise<Worker>
  /** The tabs open now, not counting the ones the harness opened and closed. */
  pages: () => number
  close: () => Promise<void>
}

/** Reads until `done` holds or `ms` pass, and returns the last value read. */
export async function until<T>(read: () => T | Promise<T>, done: (value: T) => boolean, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms
  let value = await read()
  while (!done(value) && Date.now() < deadline) {
    await Bun.sleep(200)
    value = await read()
  }
  return value
}

/** Copies `source` into a fresh git checkout, loads it in a hidden Chromium, and waits for its worker. */
export async function launchExtension(options: HarnessOptions): Promise<LoadedExtension> {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'app-kit-extension-')))
  const checkout = join(scratch, 'checkout')
  const profile = join(scratch, 'profile')
  mkdirSync(checkout)

  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=harness', '-c', 'user.email=harness@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: checkout, encoding: 'utf8' }).trim()

  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: options.source, encoding: 'utf8' }).split('\n').filter(Boolean)
  for (const file of files) {
    const from = join(options.source, file)
    // A tracked file deleted in the working tree is not in the checkout either.
    if (!existsSync(from)) continue
    mkdirSync(join(checkout, file, '..'), { recursive: true })
    cpSync(from, join(checkout, file))
  }
  git('init', '--quiet', '--initial-branch=main')
  git('add', '-A')
  git('commit', '--quiet', '-m', 'first')

  const manifest = JSON.parse(readFileSync(join(checkout, 'manifest.json'), 'utf8'))
  if (!manifest.key) throw new Error('The manifest has no key, so the extension has no fixed ID for a native host to name')
  const id = extensionId(manifest.key)

  if (options.nativeHost) {
    const { name, command, env = {} } = options.nativeHost
    const host = writeHostLauncher(join(scratch, 'host'), command(checkout), { env })
    // Chrome finds a native host through the profile's own NativeMessagingHosts folder too.
    writeHostManifest(join(profile, 'NativeMessagingHosts'), { name, description: 'harness', path: host, extensionId: id })
  }
  const packages = join(options.source, 'node_modules')
  if ((options.linkPackages ?? true) && existsSync(packages)) symlinkSync(packages, join(checkout, 'node_modules'))

  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    ignoreHTTPSErrors: options.ignoreHTTPSErrors ?? false,
    args: [`--disable-extensions-except=${checkout}`, `--load-extension=${checkout}`, ...(options.args ?? [])],
  })
  let worker = context.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${id}/`)) ?? (await context.waitForEvent('serviceworker', { timeout: 30_000 }))
  // Chrome brings an unpacked install back from a reload only in Developer mode, which Load unpacked needs anyway.
  const extensions = await context.newPage()
  await extensions.goto('chrome://extensions')
  await extensions.evaluate(() => (globalThis as any).chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }))
  await extensions.close()

  const loaded: LoadedExtension = {
    context,
    get worker() {
      return worker
    },
    extensionId: id,
    checkout,
    profile,
    git,
    commit(message) {
      git('add', '-A')
      git('commit', '--quiet', '-m', message)
      return git('rev-parse', 'HEAD')
    },
    async fireAlarm(name) {
      await worker.evaluate(async (alarm) => {
        const chrome = (globalThis as any).chrome
        const existing = await chrome.alarms.get(alarm)
        await chrome.alarms.create(alarm, { when: Date.now() + 500, periodInMinutes: existing?.periodInMinutes })
      }, name)
    },
    async nextWorker(timeoutMs = 30_000) {
      worker = await context.waitForEvent('serviceworker', { timeout: timeoutMs })
      return worker
    },
    pages: () => context.pages().length,
    async close() {
      await context.close()
      rmSync(scratch, { recursive: true, force: true })
    },
  }
  return loaded
}
