// The worker's native messaging port to a host on this Mac.
//
// Chrome starts the host named in the port when the worker connects, and stops
// it when the port closes; an open port also keeps the worker running while
// the profile is open. The port reconnects after it closes, and says hello with
// the build it runs, which the host logs. A `state` message is answered here
// with the worker's build, commit and kept errors (errors.js), which is what
// the host's status line prints; every other message goes to the extension's
// own `answer`. Every message with an id is answered, so no caller waits out
// the host's timeout: the port adds the answer's type and id itself, answers
// null with a refusal naming the message's type, and answers a thrown error
// with its message, which it also keeps for the status.

import { getWorkerErrors, recordWorkerError } from "./errors.js";

/** @typedef {{ version: string, commit: string | null } & Record<string, unknown>} WorkerState */
/** @typedef {Record<string, unknown> | null | undefined} Answer */

/**
 * @param {{
 *   host: string,
 *   describe: () => WorkerState | Promise<WorkerState>,
 *   answer: (message: any) => Answer | Promise<Answer>,
 *   reconnectMs?: number,
 *   open?: () => chrome.runtime.Port,
 * }} options `host` is the native host's name; `describe` says the build and
 *   commit this worker runs, and anything else the status should carry;
 *   `answer` resolves to the reply to one message, without its type or id, or
 *   null when the extension has none; `open` is for tests.
 */
export function nativePort({ host, describe, answer, reconnectMs = 5000, open = () => chrome.runtime.connectNative(host) }) {
  /** @type {chrome.runtime.Port | null} */
  let port = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let reconnectTimer = null;

  /**
   * The reply to one message from the host, or null for a message with no id,
   * which nobody waits on.
   * @param {any} message
   */
  async function reply(message) {
    if (typeof message?.id !== "string") return null;
    const { id } = message;
    if (message.type === "state") {
      return { ...(await describe()), errors: await getWorkerErrors(), type: "state", id };
    }
    try {
      const answered = await answer(message);
      if (answered == null) return { type: "answer", id, refused: `The extension has no answer for ${String(message.type)}` };
      return { ...answered, type: "answer", id };
    } catch (error) {
      await recordWorkerError(error);
      return { type: "answer", id, error: String(/** @type {any} */ (error)?.message ?? error) };
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectMs);
  }

  /** Opens the port, unless it is open. */
  function connect() {
    if (port) return port;
    /** @type {chrome.runtime.Port} */
    let opened;
    try {
      opened = open();
    } catch {
      scheduleReconnect();
      return null;
    }
    port = opened;
    opened.onMessage.addListener(async (message) => {
      const answered = await reply(message);
      if (!answered) return;
      try {
        opened.postMessage(answered);
      } catch {
        // The port closed while the request ran; the host has given up on it.
      }
    });
    opened.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (port === opened) port = null;
      scheduleReconnect();
    });
    Promise.resolve(describe()).then((state) => {
      try {
        opened.postMessage({ ...state, type: "hello" });
      } catch {
        // Closed already; the reconnect says hello again.
      }
    });
    return opened;
  }

  return { connect, port: () => port };
}
