import { connect } from 'node:net'
import { STATUS_TIMEOUT_MS, type HostStatus } from './protocol.ts'

/** No host is listening on the socket: Chrome is not open with the extension, or never started its host. */
export class NotConnected extends Error {
  constructor(message = 'Chrome is not running the extension, so its native host is not listening.') {
    super(message)
  }
}

let counter = 0

export type AskOptions = { timeoutMs?: number; notConnected?: string }

/**
 * Sends one line to the host and waits for the answer with the same id.
 * Rejects with NotConnected, carrying `notConnected` as its message, when no
 * host listens. node:net queues the write and decodes UTF-8 across chunks.
 */
export function ask<T>(socketPath: string, line: { type: string } & Record<string, unknown>, { timeoutMs = 45_000, notConnected }: AskOptions = {}): Promise<T> {
  const id = `c${process.pid}-${++counter}`
  const { promise, resolve, reject } = Promise.withResolvers<T>()
  const socket = connect(socketPath)
  socket.setEncoding('utf8')
  let buffer = ''
  let connected = false
  socket.on('connect', () => {
    connected = true
    socket.write(`${JSON.stringify({ ...line, id })}\n`)
  })
  socket.on('data', (chunk: string) => {
    buffer += chunk
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const reply = JSON.parse(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      if (reply.id === id) {
        const { id: _id, ...rest } = reply
        resolve(rest as T)
      }
    }
  })
  socket.on('error', () => reject(connected ? new Error('The connection to the native host broke') : new NotConnected(notConnected)))
  socket.on('close', () => reject(new NotConnected(notConnected)))
  const timer = setTimeout(() => reject(new Error('The native host did not answer in time')), timeoutMs)
  return promise.finally(() => {
    clearTimeout(timer)
    socket.destroy()
  })
}

/**
 * Whether the extension is connected, since when, and what it says of itself:
 * its build, commit and kept errors. Waits past the host's own wait, so the
 * host's answer about a silent extension arrives.
 */
export function hostStatus(socketPath: string, options: Omit<AskOptions, 'timeoutMs'> = {}): Promise<HostStatus> {
  return ask<HostStatus>(socketPath, { type: 'status' }, { ...options, timeoutMs: STATUS_TIMEOUT_MS + 2_000 })
}
