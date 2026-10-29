// Copied from app-kit 0.27.0 by `app-kit extension copy`. Change it in the kit.
// The worker's uncaught errors, kept in storage.local with their time and the
// build they happened in, so a status command can print them: the worker's
// console exists only while its DevTools window is open, and Chrome's own list
// on chrome://extensions keeps old builds' errors with old line numbers. Only
// the newest MAX_ERRORS are kept.

export const ERRORS_KEY = "workerErrors";
export const MAX_ERRORS = 20;

/** @typedef {{ at: string, kind: string, message: string, stack: string | null, build: string | null }} WorkerError */

/**
 * @param {any} error
 * @param {{ kind?: string, build?: string | null, now?: number }} [options]
 */
export async function recordWorkerError(error, { kind = "error", build = null, now = Date.now() } = {}) {
  try {
    const message = error?.message ?? String(error);
    // The first lines of a stack, which name the file and line it came from.
    const stack = typeof error?.stack === "string" ? error.stack.split("\n").slice(1, 4).map((/** @type {string} */ line) => line.trim()).join("\n") : "";
    /** @type {WorkerError} */
    const entry = { at: new Date(now).toISOString(), kind, message, stack: stack || null, build };
    // Errors come in bursts; each write must see the one before it.
    await navigator.locks.request("worker-errors", async () => {
      const kept = await getWorkerErrors();
      await chrome.storage.local.set({ [ERRORS_KEY]: [...kept, entry].slice(-MAX_ERRORS) });
    });
  } catch {
    // Recording an error must never throw one.
  }
}

/** @returns {Promise<WorkerError[]>} */
export async function getWorkerErrors() {
  const { [ERRORS_KEY]: kept } = /** @type {{ [ERRORS_KEY]?: WorkerError[] }} */ (await chrome.storage.local.get(ERRORS_KEY));
  return kept ?? [];
}

/**
 * Records every uncaught error and unhandled rejection on the worker's global
 * scope. Call it first, so an error anywhere after it is kept. Chrome still
 * lists the error itself.
 * @param {EventTarget} scope the worker's global scope, `self`
 * @param {() => string | null} [build] the build to record with each error
 */
export function watchWorkerErrors(scope, build = () => null) {
  scope.addEventListener("unhandledrejection", (event) => {
    recordWorkerError(/** @type {PromiseRejectionEvent} */ (event).reason, { kind: "unhandled rejection", build: build() });
  });
  scope.addEventListener("error", (event) => {
    const { error, message } = /** @type {ErrorEvent} */ (event);
    recordWorkerError(error ?? message, { build: build() });
  });
}
