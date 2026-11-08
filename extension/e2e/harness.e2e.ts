// The kit's fixture extension (test/fixture) in a hidden Chromium through the
// kit's own harness, with the kit's native host (test/hosts/echo-host.ts). It
// shows what only a browser can: that a worker built on the kit loads from a
// repository root under the ID its key gives, that Chrome starts the host and
// the port carries messages both ways, that the worker's errors reach the
// status, that a new commit in the checkout reloads the worker and restarts the
// host, that after a reload an alarm still starts the stopped worker, that the plain look's stylesheet draws a page light and dark, that a
// link shown twice opens one tab, and that nothing else opens a tab.
// Run with `bun test ./extension/e2e/harness.e2e.ts`, which scripts/gates.sh does.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ask, extensionId, hostStatus, type HostStatus } from '../host/index.ts'
import { launchExtension, until, type LoadedExtension } from '../harness/index.ts'
import { DEFAULT_ACCENT, plainColors } from '../../look/index.ts'
import { withoutPage } from '../../test/dom.ts'

const FIXTURE = join(import.meta.dir, '../test/fixture')
// In the test process's own folder (app-kit/testing/start-up), whose path stays short: a socket path a Node or Python
// caller can reach on macOS is under 104 bytes, which the test holds.
const hostDir = realpathSync(mkdtempSync(join(tmpdir(), 'ek-')))
const socket = join(hostDir, 'host.sock')
let ext: LoadedExtension
let pagesAtStart = 0
// The fixture's request job asks this server: /hang never answers, /ok does, to the extension's origin.
let server: ReturnType<typeof Bun.serve>
let pageBack = () => {}
const address = (path: string) => `http://127.0.0.1:${server.port}${path}`

type JobRecord = { started: string; ended: string | null; outcome: string; error: string | null }
/** The job's run record as the worker keeps it, or null. */
const record = (name: string) =>
  ext.worker
    .evaluate(async (key) => ((await (globalThis as any).chrome.storage.local.get(key))[key] ?? null) as JobRecord | null, `job:${name}`)
    .catch(() => null)

const status = () => hostStatus(socket).catch(() => null as HostStatus | null)

beforeAll(async () => {
  // The server answers with Bun's own Response, not the unit tests' simulated page's.
  pageBack = await withoutPage()
  server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (request) => (new URL(request.url).pathname === '/hang' ? new Promise<Response>(() => {}) : new Response('ok', { headers: { 'access-control-allow-origin': '*' } })),
  })
  ext = await launchExtension({
    source: FIXTURE,
    nativeHost: {
      name: 'com.example.extension_kit_fixture',
      command: () => [process.execPath, join(import.meta.dir, '../test/hosts/echo-host.ts')],
      env: { KIT_HOST_DIR: hostDir },
    },
  })
  pagesAtStart = ext.pages()
}, 90_000)

afterAll(async () => {
  server?.stop(true)
  pageBack()
  await ext?.close()
  rmSync(hostDir, { recursive: true, force: true })
})

test('the worker loads under the ID its key gives, connects its host, and answers through the socket', async () => {
  const key = JSON.parse(readFileSync(join(FIXTURE, 'manifest.json'), 'utf8')).key
  expect(ext.worker.url()).toBe(`chrome-extension://${extensionId(key)}/worker.js`)

  const first = ext.git('rev-parse', 'HEAD')
  const connected = await until(status, (s) => s?.extension?.commit === first)
  expect(connected).toMatchObject({ connected: true, extension: { version: `0.1.0-src (${first.slice(0, 7)})`, commit: first, errors: [], account: { accountId: '', email: '' } } })
  expect(await ask(socket, { type: 'echo', text: 'through the port' })).toEqual({ echoed: 'through the port' })
  expect(await ask(socket, { type: 'forbidden' })).toEqual({ refused: 'forbidden is never sent' })
  // The worker's answer returns null for it; the port refuses it, where the host would otherwise time out.
  expect(await ask(socket, { type: 'unknown' })).toEqual({ refused: 'The extension has no answer for unknown' })
}, 60_000)

test("the worker's uncaught error reaches the status with its build", async () => {
  expect(await ask(socket, { type: 'fail' })).toEqual({ failing: true })
  const failed = await until(status, (s) => (s?.extension?.errors.length ?? 0) > 0)
  expect(failed?.extension?.errors).toMatchObject([{ kind: 'error', message: expect.stringContaining('the fixture failed on purpose'), build: expect.stringMatching(/^0\.1\.0-src \([0-9a-f]{7}\)$/) }])
}, 60_000)

test('a new commit in the checkout reloads the worker and restarts the host on it', async () => {
  const manifestPath = join(ext.checkout, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify({ ...JSON.parse(readFileSync(manifestPath, 'utf8')), version_name: '0.1.0-second' }, null, 2))
  const second = ext.commit('second')
  ext.git('pack-refs', '--all')

  // The worker's own one-minute alarm, brought forward; the rest is the worker.
  const reloaded = ext.nextWorker()
  await ext.fireAlarm('check')
  await reloaded

  const after = await until(status, (s) => s?.extension?.commit === second)
  expect(after?.extension).toMatchObject({ version: `0.1.0-second (${second.slice(0, 7)})`, commit: second })
  expect(readFileSync(join(hostDir, 'host.log'), 'utf8').match(/host started/g)?.length).toBeGreaterThanOrEqual(2)
}, 60_000)

test('the job on a clock runs on the reloaded worker, and its record moves', async () => {
  const before = await until(() => record('check'), (found) => found !== null)
  await ext.fireAlarm('check')
  const after = await until(() => record('check'), (found) => found !== null && found.started > before!.started && found.outcome === 'ok')
  expect(after).toMatchObject({ outcome: 'ok', error: null })
}, 60_000)

test('a request that never answers ends at its limit, is kept as an error, and the next run goes ahead', async () => {
  expect(await ask(socket, { type: 'request-address', url: address('/hang'), ms: 2000 })).toEqual({ kept: true })
  await ext.fireAlarm('request')
  const hung = await until(() => record('request'), (found) => found?.outcome === 'failed')
  expect(hung).toMatchObject({ outcome: 'failed', error: expect.stringContaining('TimeoutError') })
  const kept = await until(status, (s) => (s?.extension?.errors ?? []).some((error) => error.kind === 'job'))
  expect(kept?.extension?.errors).toContainEqual(expect.objectContaining({ kind: 'job', message: expect.stringContaining('request failed: TimeoutError') }))

  expect(await ask(socket, { type: 'request-address', url: address('/ok') })).toEqual({ kept: true })
  await ext.fireAlarm('request')
  const answered = await until(() => record('request'), (found) => found?.outcome === 'ok')
  expect(answered).toMatchObject({ outcome: 'ok', error: null })
}, 60_000)

test('a worker stopped in the middle of a run leaves it cut short, and the next run takes the lock', async () => {
  const lines: string[] = []
  ext.worker.on('console', (message) => lines.push(message.text()))
  expect(await ask(socket, { type: 'request-address', url: address('/hang'), ms: 25_000 })).toEqual({ kept: true })
  const last = (await record('request'))!
  await ext.fireAlarm('request')
  const running = await until(() => record('request'), (found) => found !== null && found.started > last.started && found.outcome === 'running')
  expect(running?.outcome).toBe('running')

  await ext.stopWorker()
  // Set once the stop is reported, so it can only reach the next worker, which setting it starts.
  await ext.fireAlarm('request')
  const next = await until(() => record('request'), (found) => found !== null && found.started > running!.started, 30_000)
  expect(next?.outcome).toBe('running')
  await until(() => lines, (seen) => seen.some((line) => line.startsWith('job cut short')))
  expect(lines.some((line) => line.startsWith('job cut short'))).toBe(true)
  expect(await ask(socket, { type: 'request-address', url: address('/ok') })).toEqual({ kept: true })
}, 60_000)

/** A CSS color as #rrggbb. */
const hex = (value: string) => `#${value.match(/\d+/g)!.slice(0, 3).map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`

// The fault behind a silent day in an extension of ours, suspected and tried by extension/e2e/reload-alarms.ts: after
// a reload, an alarm that reaches no saved listener starts nothing. So nothing attached may start the worker here:
// the record is read and the alarm set from an extension page, never through the worker, which DevTools would start.
test('after a self-reload, an alarm starts the stopped worker and its job runs', async () => {
  const origin = `chrome-extension://${ext.extensionId}/`
  writeFileSync(join(ext.checkout, 'landing.txt'), 'a landing\n')
  ext.commit('a landing')
  const reloaded = ext.nextWorker()
  await ext.fireAlarm('check')
  await reloaded

  const page = await ext.context.newPage()
  try {
    await page.goto(`${origin}look.html`)
    const readRecord = () => page.evaluate(async (key) => ((await (globalThis as any).chrome.storage.local.get(key))[key] ?? null) as JobRecord | null, 'job:check')
    const session = await ext.context.newCDPSession(page)
    const starts: number[] = []
    session.on('ServiceWorker.workerVersionUpdated', ({ versions }: { versions: { scriptURL: string; runningStatus: string }[] }) => {
      if (versions.some((version) => version.scriptURL.startsWith(origin) && version.runningStatus === 'starting')) starts.push(Date.now())
    })
    await session.send('ServiceWorker.enable')
    // A reload deletes the alarm, so one here was made again by the reloaded worker's job, which the clock rests on.
    const remade = await until(() => page.evaluate(async () => ((await (globalThis as any).chrome.alarms.get('check')) ?? null) as { periodInMinutes?: number } | null), (found) => found !== null)
    expect(remade?.periodInMinutes).toBe(1)

    await ext.stopWorker()
    const stopped = Date.now()
    const before = await readRecord()
    // Brought forward once the stop is reported, from the page, so only the alarm can start the worker.
    const due = await page.evaluate(async () => {
      const when = Date.now() + 1500
      await (globalThis as any).chrome.alarms.create('check', { when, periodInMinutes: 1 })
      return when
    })
    const after = await until(readRecord, (found) => found !== null && found.started > (before?.started ?? '') && found.outcome === 'ok', 10_000)
    expect(after).toMatchObject({ outcome: 'ok', error: null })
    // The worker started for the alarm, not for the page's reads before it was due.
    const firstStart = starts.find((at) => at >= stopped)
    expect(firstStart).toBeGreaterThanOrEqual(due)
    await session.detach()
  } finally {
    await page.close()
  }
}, 30_000)

for (const scheme of ['light', 'dark'] as const) {
  test(`the copied stylesheet draws the fixture's popup in the tokens' ${scheme} colors, with the kit's controls`, async () => {
    const colors = plainColors()[scheme]
    const page = await ext.context.newPage()
    try {
      await page.emulateMedia({ colorScheme: scheme })
      await page.setViewportSize({ width: 380, height: 800 })
      await page.goto(`chrome-extension://${ext.extensionId}/look.html`)
      const style = (selector: string, property: string) =>
        page.locator(selector).first().evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property)
      expect(hex(await style('body', 'background-color'))).toBe(colors.bg)
      expect(hex(await style('.title', 'color'))).toBe(colors.text)
      expect(hex(await style('.label', 'color'))).toBe(colors.muted)
      expect(await style('.label', 'font-weight')).toBe('600')
      expect(hex(await style('.rows', 'border-top-color'))).toBe(colors.border)
      expect(hex(await style('.row + .row', 'border-top-color'))).toBe(colors.border)
      expect(await style('.row', 'min-height')).toBe('44px')
      expect(hex(await style('.status.ok', 'color'))).toBe(colors.ok)
      expect(hex(await style('.action', 'color'))).toBe(DEFAULT_ACCENT[scheme])
      expect(hex(await style('.action.remove', 'color'))).toBe(colors.error)
      expect(hex(await style('.switch:checked', 'background-color'))).toBe(DEFAULT_ACCENT[scheme])
      expect(hex(await style('.switch:not(:checked)', 'border-top-color'))).toBe(colors.muted)
      expect(hex(await style('.field', 'border-top-color'))).toBe(colors.border)
      expect(hex(await style('.menu', 'border-bottom-color'))).toBe(colors.border)
      expect(hex(await style('.build', 'color'))).toBe(colors.secondary)
      // Chrome's own controls and scrollbars follow the scheme.
      expect(await style(':root', 'color-scheme')).toBe('light dark')
      // A page's own accent is the one thing it sets.
      await page.addStyleTag({ content: ':root { --accent-light: #7a2fa7; --accent-dark: #d29be6 }' })
      expect(hex(await style('.action', 'color'))).toBe(scheme === 'light' ? '#7a2fa7' : '#d29be6')
      await page.addStyleTag({ content: ':root { --accent-light: initial; --accent-dark: initial }' })
      await page.screenshot({ path: join(process.env.LOOK_PICTURES ?? tmpdir(), `extension-${scheme}.png`), fullPage: true })
    } finally {
      await page.close()
    }
  }, 30_000)
}

test('a link shown twice opens one tab, and the second time brings that tab forward', async () => {
  const link = `chrome-extension://${ext.extensionId}/look.html`
  const before = ext.pages()
  expect(await ask(socket, { type: 'show', url: link })).toEqual({ how: 'new-tab' })
  await until(() => ext.context.pages().filter((page) => page.url() === link).length, (count) => count === 1)
  expect(await ask(socket, { type: 'show', url: link })).toEqual({ how: 'existing-tab' })
  expect(ext.context.pages().filter((page) => page.url() === link)).toHaveLength(1)
  expect(ext.pages()).toBe(before + 1)
  await Promise.all(ext.context.pages().filter((page) => page.url() === link).map((page) => page.close()))
}, 30_000)

test('nothing the extension did opened a tab', () => {
  expect(ext.pages()).toBe(pagesAtStart)
})
