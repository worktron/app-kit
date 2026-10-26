// The native messaging host Chrome starts when the extension connects. It
// serves a unix socket on this Mac for the extension's callers (a command
// line, an MCP server, a server) and relays their requests to the extension
// until Chrome closes its end. Only one host serves the socket: a newer one
// takes it over.

import { appendFileSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { dirname } from 'node:path'
import { frame, Unframer } from './native.ts'
import type { CallerLine } from './protocol.ts'
import { Relay, type RelayOptions } from './relay.ts'

const MAX_LINE = 64 * 1024

export type HostOptions = Pick<RelayOptions, 'refuse' | 'describe' | 'timeoutMs'> & {
  /** The socket callers connect to. Keep its path under 104 bytes: Bun reaches a longer one, but a Node or Python caller on macOS cannot. */
  socketPath: string
  /** One line per start, stop, connection and request. */
  logPath: string
}

/**
 * Runs the host: serves the socket, relays until Chrome closes stdin, then
 * removes the socket if it is still this host's and exits. Call it as the
 * whole of the host's script.
 */
export async function serveHost({ socketPath, logPath, ...relayOptions }: HostOptions): Promise<never> {
  mkdirSync(dirname(socketPath), { recursive: true })
  mkdirSync(dirname(logPath), { recursive: true })
  const log = (line: string) => {
    try {
      appendFileSync(logPath, `${line}\n`)
    } catch {
      // A full disk or a removed folder must not stop the relay.
    }
  }

  const relay = new Relay({ ...relayOptions, toExtension: (message) => process.stdout.write(frame(message)), log })

  // node:net, not Bun.listen: its sockets queue what the kernel cannot take at
  // once, and a reply carrying a web page is far larger than a socket's buffer.
  rmSync(socketPath, { force: true })
  const server = createServer((socket) => {
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', (chunk: string) => {
      buffer += chunk
      if (buffer.length > MAX_LINE) return void socket.destroy()
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        void answer(socket, line)
      }
    })
    socket.on('error', () => {})
  })
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))
  // What this host made, so it removes the socket at exit only while it is still its own.
  const ours = statSync(socketPath).ino

  async function answer(socket: Socket, line: string) {
    let message: CallerLine
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (!message || typeof message.id !== 'string' || typeof message.type !== 'string') return
    const { id, ...request } = message
    const reply = request.type === 'status' ? await relay.status() : await relay.request(request)
    if (!socket.destroyed) socket.write(`${JSON.stringify({ ...reply, id })}\n`)
  }

  log(`${new Date().toISOString()} host started for ${process.argv[2] ?? 'unknown origin'}`)

  const unframer = new Unframer()
  for await (const chunk of Bun.stdin.stream()) {
    for (const message of unframer.push(chunk)) relay.fromExtension(message)
  }

  // Chrome closed the port: the extension is gone, so nobody can be answered.
  // A newer host may have taken the path over already; its socket stays. So no
  // server.close(), which unlinks the path whoever's socket is there now: the
  // exit below ends the server.
  try {
    if (statSync(socketPath).ino === ours) rmSync(socketPath, { force: true })
  } catch {
    // Already gone.
  }
  log(`${new Date().toISOString()} host stopped`)
  process.exit(0)
}
