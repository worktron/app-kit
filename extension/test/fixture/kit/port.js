// Copied from app-kit 0.4.0 by `app-kit extension copy`. Change it in the kit.
// The worker's native messaging port to a host on this Mac.
//
// Chrome starts the host named in the port when the worker connects, and stops
// it when the port closes; an open port also keeps the worker running while
// the profile is open. The port reconnects after it closes, and says hello with
// the build it runs, which the host logs. A `state` message is answered here
// with the worker's build, commit and kept errors (errors.js), which is what
// the host's status line prints; every other message goes to the extension's
// own `answer`.

import { getWorkerErrors } from "./errors.js";

/** @typedef {{ version: string, commit: string | null } & Record<string, unknown>} WorkerState */

/**
 * @param {{
 *   host: string,
 *   describe: () => WorkerState | Promise<WorkerState>,
 *   answer: (message: any) => unknown,
 *   reconnectMs?: number,
 *   open?: () => chrome.runtime.Port,
 * }} options `host` is the native host's name; `describe` says the build and
 *   commit this worker runs, and anything else the status should carry;
 *   `answer` resolves to the reply to one message, or null for none; `open` is
 *   for tests.
 */
export function nativePort({ host, describe, answer, reconnectMs = 5000, open = () => chrome.runtime.connectNative(host) }) {
  /** @type {chrome.runtime.Port | null} */
  let port = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let reconnectTimer = null;

  /** @param {any} message */
  async function reply(message) {
    if (message?.type === "state" && typeof message.id === "string") {
      return { ...(await describe()), errors: await getWorkerErrors(), type: "state", id: message.id };
    }
    return answer(message);
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
