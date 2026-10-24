import { afterAll, beforeAll, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ask, hostStatus, NotConnected } from '../host/client.ts'
import { frame, Unframer } from '../host/native.ts'

// The real host, started the way Chrome starts it, with this test as the extension.
// Short, so the socket path stays under macOS's limit.
const dir = realpathSync(mkdtempSync('/tmp/ek-'))
const socket = join(dir, 'host.sock')
const HOST = join(import.meta.dir, 'hosts/echo-host.ts')
let host: Bun.Subprocess<'pipe', 'pipe', 'inherit'>
const seen: any[] = []
// Bigger than any socket buffer, with characters of two, three and four bytes throughout.
const BIG = 'Greek Yogurt® › 32 oz ★ é 🥑 '.repeat(60_000)

const start = () => Bun.spawn(['bun', HOST, 'chrome-extension://test/'], { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit', env: { ...process.env, KIT_HOST_DIR: dir } })
const started = () => (existsSync(join(dir, 'host.log')) ? readFileSync(join(dir, 'host.log'), 'utf8').match(/host started/g)?.length ?? 0 : 0)

beforeAll(async () => {
  host = start()
  host.stdin.write(frame({ type: 'hello', version: '9.9.9', commit: null }))
  host.stdin.flush()
  void (async () => {
    const unframer = new Unframer()
    for await (const chunk of host.stdout) {
      for (const message of unframer.push(chunk) as any[]) {
        seen.push(message)
        const reply =
          message.type === 'state'
            ? { type: 'state', id: message.id, version: '9.9.9', commit: null, errors: [] }
            : { type: 'answer', id: message.id, echoed: message.text === 'big' ? BIG : message.text }
        host.stdin.write(frame(reply))
        host.stdin.flush()
      }
    }
  })()
  // The host logs its start only once its socket is listening.
  while (started() === 0) await Bun.sleep(10)
})

afterAll(async () => {
  try {
    host.stdin.end()
  } catch {
    // The last test ended it.
  }
  await host.exited
  rmSync(dir, { recursive: true, force: true })
})

test('a caller reaches the extension through the socket and hears its answer', async () => {
  expect(await ask(socket, { type: 'echo', text: 'hello' })).toEqual({ echoed: 'hello' })
  expect(seen.at(-1)).toMatchObject({ type: 'echo', text: 'hello' })
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
  const before = seen.length
  expect(await ask(socket, { type: 'forbidden' })).toEqual({ refused: 'forbidden is never sent' })
  expect(seen.length).toBe(before)
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
  const startsBefore = started()
  const newer = start()
  while (started() === startsBefore) await Bun.sleep(10)
  const newerSocket = statSync(socket).ino
  host.stdin.end()
  await host.exited
  expect(statSync(socket).ino).toBe(newerSocket)
  newer.stdin.end()
  await newer.exited
  expect(existsSync(socket)).toBe(false)
})
