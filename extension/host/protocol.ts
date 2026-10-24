// What passes between callers on this Mac, the native host and the extension.
//
// A caller writes one JSON line per request to the host's socket, with an `id`
// of its own and a `type`; the host answers with one line carrying that id.
// The type `status` is the host's own; every other type goes to the extension,
// whose reply has the type `answer`.

/** A line a caller sends the host over its socket. */
export type CallerLine = { id: string; type: string } & Record<string, unknown>

/** An error the extension's worker kept (worker/errors.js). */
export type WorkerError = { at: string; kind: string; message: string; stack: string | null; build: string | null }

/** What the worker says of itself (worker/port.js): its build, its commit, its kept errors, and whatever else it adds. */
export type WorkerState = { version: string; commit: string | null; errors: WorkerError[] } & Record<string, unknown>

/** The host's answer to a status line: since when the extension is connected, and what it said of itself. */
export type HostStatus = {
  connected: true
  since: string
  extension: WorkerState | null
  problem?: string
}

/** The host's answer when it gave up on the extension, or refused the request. */
export type HostProblem = { error: string } | { refused: string }

/** How long the host waits for the extension to say its state. */
export const STATUS_TIMEOUT_MS = 5_000

/** How long the extension has to answer one request. */
export const ANSWER_TIMEOUT_MS = 30_000
