import { afterAll, beforeAll, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ask, hostStatus, NotConnected } from '../host/client.ts'
import { startHostAsChrome, type HostAsChrome } from '../testing/host.ts'

// The real host, started the way Chrome starts it, with this test as the extension.
const dir = realpathSync(mkdtempSync('/tmp/ek-'))
const socket = join(dir, 'host.sock')
const logPath = join(dir, 'host.log')
let host: HostAsChrome
// Bigger than any socket buffer, with characters of two, three and four bytes throughout.
const BIG = 'Greek Yogurt® › 32 oz ★ é 🥑 '.repeat(60_000)

const start = () =>
  startHostAsChrome({
    command: [process.execPath, join(import.meta.dir, 'hosts/echo-host.ts')],
    env: { KIT_HOST_DIR: dir },
    logPath,
    state: { version: '9.9.9', commit: null },
    answer: (message) => (message.type === 'echo' ? { echoed: message.text === 'big' ? BIG : message.text } : null),
  })

beforeAll(async () => {
  host = await start()
})

afterAll(async () => {
  await host.stop()
  rmSync(dir, { recursive: true, force: true })
})

test('a caller reaches the extension through the socket and hears its answer', async () => {
  expect(await ask(socket, { type: 'echo', text: 'hello' })).toEqual({ echoed: 'hello' })
  expect(host.seen.at(-1)).toMatchObject({ type: 'echo', text: 'hello' })
})

test('an answer bigger than the socket buffer arrives whole, every character intact', async () => {
  const answer = await ask<{ echoed: string }>(socket, { type: 'echo', text: 'big' })
  expect(answer.echoed.length).toBe(BIG.length)
  expect(answer.echoed === BIG).toBe(true)
})

test('two callers at once each get their own answer', async () => {
  const [one, two] = await Promise.all([ask(socket, { type: 'echo', text: 'one' }), ask(socket, { type: 'echo', text: 'two' })])
  expect(one).toEqual({ echoed: 'one' })
  expect(two).toEqual({ echoed: 'two' })
})

test('the host refuses what it is told to before the extension hears of it', async () => {
  const before = host.seen.length
  expect(await ask(socket, { type: 'forbidden' })).toEqual({ refused: 'forbidden is never sent' })
  expect(host.seen.length).toBe(before)
})

test("a request the extension has no answer for comes back with the port's refusal", async () => {
  expect(await ask(socket, { type: 'unknown' })).toEqual({ refused: 'The extension has no answer for unknown' })
})

test('status names the connected extension, and the log has its hello and each request', async () => {
  expect(await hostStatus(socket)).toMatchObject({ connected: true, extension: { version: '9.9.9', errors: [] } })
  const log = readFileSync(join(dir, 'host.log'), 'utf8')
  expect(log).toContain('extension connected: 9.9.9')
  expect(log).toContain('echo answered')
})

test('with no host listening, a caller hears that Chrome is not connected, in the words it chose', async () => {
  const missing = join(dir, 'nowhere.sock')
  await expect(ask(missing, { type: 'echo' })).rejects.toBeInstanceOf(NotConnected)
  await expect(ask(missing, { type: 'echo' }, { notConnected: 'Open Chrome in the work profile.' })).rejects.toThrow('Open Chrome in the work profile.')
})

test('a host that exits leaves alone the socket a newer host made', async () => {
  const newer = await start()
  const newerSocket = statSync(socket).ino
  await host.stop()
  expect(statSync(socket).ino).toBe(newerSocket)
  await newer.stop()
  expect(existsSync(socket)).toBe(false)
})
