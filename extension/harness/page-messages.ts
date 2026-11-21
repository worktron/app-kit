// Commands to a page over a browser-level DevTools session, as the harness sends them to the extension's hidden page:
// Playwright's session takes no child session id, so each command goes in Target.sendMessageToTarget and its answer
// comes back in Target.receivedMessageFromTarget, matched by its id.

/** The part of Playwright's CDPSession this uses, so a test can stand in for it. */
export type BrowserSession = {
  send(method: 'Target.sendMessageToTarget', params: { sessionId: string; message: string }): Promise<unknown>
  on(event: 'Target.receivedMessageFromTarget', listener: (event: { message: string }) => void): unknown
}

/**
 * Sends commands to attached pages and resolves each with its answer. A page that closes before it answers, as on a
 * reload, never answers: after `timeoutMs` that is an error naming the command, not a hang.
 */
export function pageMessages(session: BrowserSession, timeoutMs = 10_000) {
  let nextId = 0
  const waiting = new Map<number, (answer: { error?: { message: string } }) => void>()
  session.on('Target.receivedMessageFromTarget', ({ message }) => {
    const answer = JSON.parse(message) as { id?: number; error?: { message: string } }
    if (answer.id !== undefined) waiting.get(answer.id)?.(answer)
  })
  return {
    /** Runs `method` on the page attached as `sessionId`, rejecting with the page's error, a refused send, or no answer. */
    async send(sessionId: string, method: string, params: Record<string, unknown>): Promise<void> {
      const id = ++nextId
      let timer: ReturnType<typeof setTimeout> | undefined
      const answered = new Promise<{ error?: { message: string } }>((resolve, reject) => {
        waiting.set(id, resolve)
        timer = setTimeout(() => reject(new Error(`The extension's hidden page did not answer ${method} within ${timeoutMs / 1000} seconds; it may have closed, as a reload closes it`)), timeoutMs)
      })
      let answer: { error?: { message: string } }
      try {
        // Both in one try, so a send Chromium refuses leaves no timer behind to reject with nobody listening.
        await session.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) })
        answer = await answered
      } finally {
        clearTimeout(timer)
        waiting.delete(id)
      }
      if (answer.error) throw new Error(`${method} on the extension's hidden page: ${answer.error.message}`)
    },
    /** How many commands wait for an answer, each with its timer. */
    waiting: () => waiting.size,
  }
}
