// The harness's commands to the extension's hidden page, on a stand-in for the browser's DevTools session: an answer
// resolves its command, the page's error rejects it, and a send Chromium refuses, or a page that never answers, rejects
// it and leaves no command waiting, so no timer rejects later with nobody listening.
import { expect, test } from 'bun:test'
import { pageMessages, type BrowserSession } from '../harness/page-messages.ts'

/** A stand-in session: `refuse` makes the send fail, as Chromium refuses a message to a page that has closed. */
function session(answerWith: (id: number) => object | null, refuse = false) {
  let deliver: (event: { message: string }) => void = () => {}
  const stand: BrowserSession = {
    async send(_method, { message }) {
      if (refuse) throw new Error('No session with given id')
      const { id } = JSON.parse(message) as { id: number }
      const answer = answerWith(id)
      if (answer) queueMicrotask(() => deliver({ message: JSON.stringify({ id, ...answer }) }))
      return {}
    },
    on(_event, listener) {
      deliver = listener
    },
  }
  return stand
}

test("an answer resolves the command, and the page's error rejects it naming the command", async () => {
  const ok = pageMessages(session(() => ({ result: {} })))
  await ok.send('page', 'Emulation.setEmulatedMedia', {})
  expect(ok.waiting()).toBe(0)
  const refused = pageMessages(session(() => ({ error: { message: 'Invalid parameters' } })))
  await expect(refused.send('page', 'Emulation.setEmulatedMedia', {})).rejects.toThrow('Emulation.setEmulatedMedia on the extension\'s hidden page: Invalid parameters')
  expect(refused.waiting()).toBe(0)
})

test('a send Chromium refuses rejects at once and leaves no command waiting with its timer', async () => {
  const messages = pageMessages(session(() => null, true), 50)
  await expect(messages.send('closed', 'Emulation.setEmulatedMedia', {})).rejects.toThrow('No session with given id')
  expect(messages.waiting()).toBe(0)
})

test('a page that never answers rejects naming the command, and leaves nothing waiting', async () => {
  const messages = pageMessages(session(() => null), 50)
  await expect(messages.send('quiet', 'Emulation.setEmulatedMedia', {})).rejects.toThrow('did not answer Emulation.setEmulatedMedia')
  expect(messages.waiting()).toBe(0)
})
