import { ANSWER_TIMEOUT_MS, STATUS_TIMEOUT_MS, type HostStatus, type WorkerState } from './protocol.ts'

type Pending = { resolve: (reply: Record<string, unknown>) => void; timer: ReturnType<typeof setTimeout> }

/** A caller's request without its id: its type and whatever the extension needs. */
export type Request = { type: string } & Record<string, unknown>

export type RelayOptions = {
  /** Writes one message to the extension (framed on the host's stdout). */
  toExtension: (message: unknown) => void
  /** Appends one line to the host's log. */
  log?: (line: string) => void
  /** How long the extension has to answer one request. */
  timeoutMs?: number
  /** The reason a request is refused before the extension sees it, or null to pass it on. */
  refuse?: (request: Request) => string | null
  /** The log line for one request and its outcome, after the time. Keep private data, such as queries, out of it. */
  describe?: (request: Request, outcome: Record<string, unknown>) => string
}

/**
 * The native host's middle: it passes callers' requests to the extension and
 * the extension's answers back, matched by id, and refuses what `refuse`
 * refuses before the extension ever sees it.
 */
export class Relay {
  private pending = new Map<string, Pending>()
  private next = 0
  private readonly since = new Date().toISOString()
  private readonly toExtension: (message: unknown) => void
  private readonly log: (line: string) => void
  private readonly timeoutMs: number
  private readonly refuse: (request: Request) => string | null
  private readonly describe: (request: Request, outcome: Record<string, unknown>) => string

  constructor(options: RelayOptions) {
    this.toExtension = options.toExtension
    this.log = options.log ?? (() => {})
    this.timeoutMs = options.timeoutMs ?? ANSWER_TIMEOUT_MS
    this.refuse = options.refuse ?? (() => null)
    this.describe = options.describe ?? ((request, outcome) => `${request.type} ${'error' in outcome ? `error: ${String(outcome.error)}` : 'refused' in outcome ? `refused: ${String(outcome.refused)}` : 'answered'}`)
  }

  /** Whether the extension is connected, and what it says of itself: its build, commit and kept errors. */
  async status(): Promise<HostStatus> {
    const reply = await this.ask({ type: 'state' }, Math.min(this.timeoutMs, STATUS_TIMEOUT_MS))
    if ('error' in reply) return { connected: true, since: this.since, extension: null, problem: String(reply.error) }
    return { connected: true, since: this.since, extension: reply as WorkerState }
  }

  /** One request for the extension, answered with its reply, a refusal, or an error. */
  async request(request: Request): Promise<Record<string, unknown>> {
    const reason = this.refuse(request)
    const outcome = reason !== null ? { refused: reason } : await this.ask(request, this.timeoutMs)
    this.log(`${new Date().toISOString()} ${this.describe(request, outcome)}`)
    return outcome
  }

  /** Sends one message to the extension and waits for its reply with the same id. */
  private ask(message: Request, timeoutMs: number): Promise<Record<string, unknown>> {
    const id = `r${++this.next}`
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ error: `The extension did not answer within ${timeoutMs / 1000} seconds` })
      }, timeoutMs)
      this.pending.set(id, { timer, resolve })
      this.toExtension({ ...message, id })
    })
  }

  /** One message from the extension. */
  fromExtension(message: unknown) {
    if (!message || typeof message !== 'object') return
    const { type, id } = message as { type?: string; id?: string }
    if (type === 'hello') {
      const { version, commit } = message as { version?: unknown; commit?: unknown }
      this.log(`${new Date().toISOString()} extension connected: ${String(version)} at ${String(commit)}`)
      return
    }
    if ((type !== 'answer' && type !== 'state') || typeof id !== 'string') return
    const waiting = this.pending.get(id)
    if (!waiting) return
    this.pending.delete(id)
    clearTimeout(waiting.timer)
    const { type: _type, id: _id, ...answer } = message as Record<string, unknown>
    waiting.resolve(answer)
  }
}
