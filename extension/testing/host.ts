// A native host run the way Chrome runs it, for a host's own tests: the test
// is the extension. Messages go to the host's stdin and come back from its
// stdout in Chrome's framing; the extension's side answers as the kit's port
// (worker/port.js) does: `state` with what it says of itself, every other
// message with `answer`'s reply, its type and id added, or the port's refusal
// when `answer` has none. It resolves once the host logs that it started,
// which it does only once its socket is listening.

import { existsSync, readFileSync } from 'node:fs'
import { frame, Unframer } from '../host/native.ts'
import { noAnswer } from '../worker/port.js'

export type HostAsChromeOptions = {
  /** The command that runs the host, as Chrome's launcher would; the extension's origin is added as its argument. */
  command: string[]
  env?: Record<string, string>
  /** The host's log, the logPath it gave serveHost. */
  logPath: string
  /** The extension's reply to one message, without its type or id; null when it has none. */
  answer?: (message: any) => Record<string, unknown> | null
  /** What the extension says of itself, in its hello and its answer to `state`. */
  state?: { version: string; commit: string | null } & Record<string, unknown>
  /** The extension's origin, which Chrome passes the host. */
  origin?: string
  /**
   * How long a host that is running may take to log its start, 10 seconds unless given. Past it the host is stopped
   * and the start fails saying so, rather than leaving the test waiting on a host that hangs before its socket listens.
   */
  startWithinMs?: number
}

export type HostAsChrome = {
  /** Every message the host sent the extension, in order. */
  seen: any[]
  /** Sends the host one message, as the extension. */
  send: (message: unknown) => void
  /** Closes the host's stdin, as Chrome does when the port closes, and resolves with its exit code. */
  stop: () => Promise<number>
  /** Resolves with the host's exit code. */
  exited: Promise<number>
}

const starts = (logPath: string) => (existsSync(logPath) ? (readFileSync(logPath, 'utf8').match(/host started/g)?.length ?? 0) : 0)

/** Starts the host as Chrome does, says hello as the extension, and resolves once the host's socket is listening. */
export async function startHostAsChrome({ command, env = {}, logPath, answer = () => null, state = { version: 'test', commit: null }, origin = 'chrome-extension://test/', startWithinMs = 10_000 }: HostAsChromeOptions): Promise<HostAsChrome> {
  const before = starts(logPath)
  const host = Bun.spawn([...command, origin], { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit', env: { ...process.env, ...env } })
  const seen: any[] = []
  const send = (message: unknown) => {
    host.stdin.write(frame(message))
    host.stdin.flush()
  }
  send({ ...state, type: 'hello' })
  void (async () => {
    const unframer = new Unframer()
    for await (const chunk of host.stdout) {
      for (const message of unframer.push(chunk) as any[]) {
        seen.push(message)
        if (typeof message?.id !== 'string') continue
        if (message.type === 'state') {
          send({ errors: [], ...state, type: 'state', id: message.id })
          continue
        }
        const reply = answer(message)
        send(reply === null ? { type: 'answer', id: message.id, refused: noAnswer(message.type) } : { ...reply, type: 'answer', id: message.id })
      }
    }
  })()
  let exitCode: number | null = null
  const exited = host.exited.then((code) => (exitCode = code))
  // The host logs its start only once its socket is listening; one that exits first never will.
  const giveUpAt = Date.now() + startWithinMs
  while (starts(logPath) === before && exitCode === null) {
    if (Date.now() > giveUpAt) {
      host.kill()
      await exited
      throw new Error(`The host did not log its start within ${startWithinMs} ms, so it was stopped`)
    }
    await Bun.sleep(10)
  }
  if (exitCode !== null && starts(logPath) === before) throw new Error(`The host exited with ${exitCode} before its socket was listening`)
  return {
    seen,
    send,
    exited,
    async stop() {
      try {
        host.stdin.end()
      } catch {
        // Already closed.
      }
      return exited
    },
  }
}
