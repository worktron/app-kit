import { expect, test } from 'bun:test'
import { Relay } from '../host/relay.ts'

test('a request goes to the extension and its answer comes back by id', async () => {
  const sent: any[] = []
  const lines: string[] = []
  const relay = new Relay({ toExtension: (message) => sent.push(message), log: (line) => lines.push(line), describe: (request, outcome) => `${request.type} ${String(outcome.echoed)}` })
  const answer = relay.request({ type: 'echo', text: 'hi' })
  expect(sent).toEqual([{ type: 'echo', text: 'hi', id: 'r1' }])
  relay.fromExtension({ type: 'answer', id: 'r1', echoed: 'hi' })
  expect(await answer).toEqual({ echoed: 'hi' })
  expect(lines[0]).toEndWith('echo hi')
})

test('a refused request never reaches the extension', async () => {
  const sent: unknown[] = []
  const lines: string[] = []
  const relay = new Relay({ toExtension: (message) => sent.push(message), log: (line) => lines.push(line), refuse: (r) => (r.type === 'buy' ? 'buying is never sent' : null) })
  expect(await relay.request({ type: 'buy' })).toEqual({ refused: 'buying is never sent' })
  expect(sent).toEqual([])
  expect(lines[0]).toEndWith('buy refused: buying is never sent')
})

test('an extension that does not answer gives an error, not a hang', async () => {
  const relay = new Relay({ toExtension: () => {}, timeoutMs: 20 })
  expect(await relay.request({ type: 'echo' })).toEqual({ error: 'The extension did not answer within 0.02 seconds' })
})

test('an answer nobody waits for, or with no id, is dropped', () => {
  const relay = new Relay({ toExtension: () => {} })
  relay.fromExtension({ type: 'answer', id: 'r9' })
  relay.fromExtension({ type: 'answer' })
  relay.fromExtension('not an object')
})

test('hello is logged with the build and commit', () => {
  const lines: string[] = []
  const relay = new Relay({ toExtension: () => {}, log: (line) => lines.push(line) })
  relay.fromExtension({ type: 'hello', version: '0.1.0-src (abc1234)', commit: 'abc1234' })
  expect(lines[0]).toEndWith('extension connected: 0.1.0-src (abc1234) at abc1234')
})

test('status asks the extension for its build, commit and kept errors', async () => {
  const relay: Relay = new Relay({
    toExtension: (message: any) => queueMicrotask(() => relay.fromExtension({ type: 'state', id: message.id, version: '0.1.0-src (abc1234)', commit: 'abc1234', errors: [] })),
  })
  expect(await relay.status()).toMatchObject({ connected: true, since: expect.any(String), extension: { version: '0.1.0-src (abc1234)', commit: 'abc1234', errors: [] } })
})

test('status still answers when the extension does not', async () => {
  const relay = new Relay({ toExtension: () => {}, timeoutMs: 20 })
  expect(await relay.status()).toMatchObject({ connected: true, extension: null, problem: 'The extension did not answer within 0.02 seconds' })
})
