// A native host built on the kit, for the kit's tests: it keeps its socket and
// log in KIT_HOST_DIR, and refuses the request type `forbidden`.

import { join } from 'node:path'
import { serveHost } from '../../host/index.ts'

const dir = process.env.KIT_HOST_DIR
if (!dir) throw new Error('KIT_HOST_DIR names the folder for the socket and the log')

await serveHost({
  socketPath: join(dir, 'host.sock'),
  logPath: join(dir, 'host.log'),
  refuse: (request) => (request.type === 'forbidden' ? 'forbidden is never sent' : null),
  timeoutMs: Number(process.env.KIT_HOST_TIMEOUT_MS ?? 30_000),
})
