// The kit's fixture extension (test/fixture) in a hidden Chromium through the
// kit's own harness, with the kit's native host (test/hosts/echo-host.ts). It
// shows what only a browser can: that a worker built on the kit loads from a
// repository root under the ID its key gives, that Chrome starts the host and
// the port carries messages both ways, that the worker's errors reach the
// status, that a new commit in the checkout reloads the worker and restarts the
// host, and that nothing opens a tab.
// Run with `bun test ./extension/e2e/harness.e2e.ts`, which scripts/gates.sh does.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ask, extensionId, hostStatus, type HostStatus } from '../host/index.ts'
import { launchExtension, until, type LoadedExtension } from '../harness/index.ts'

const FIXTURE = join(import.meta.dir, '../test/fixture')
// Short, so the socket path stays under macOS's limit.
const hostDir = realpathSync(mkdtempSync('/tmp/ek-'))
const socket = join(hostDir, 'host.sock')
let ext: LoadedExtension
let pagesAtStart = 0

const status = () => hostStatus(socket).catch(() => null as HostStatus | null)

beforeAll(async () => {
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

test('nothing the extension did opened a tab', () => {
  expect(ext.pages()).toBe(pagesAtStart)
})
