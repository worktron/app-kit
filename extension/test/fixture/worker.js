// A small extension built on the kit, which extension/e2e/harness.e2e.ts loads in a
// hidden Chromium. It reloads itself when its checkout moves, records its
// build and errors, checks each minute on an alarm, and keeps a native port
// open to test/hosts/echo-host.ts, answering `echo` with the text it was sent
// and `fail` by throwing an uncaught error a moment later, and `show` by
// showing the link it names, and `request-address` by keeping the address its
// `request` job asks, every half hour so only the test's alarms run it, with the
// request's limit; the port refuses anything else. It starts only inside Chrome, so a unit test can import it.

import { account } from "./kit/account.js";
import { every, within } from "./kit/alarms.js";
import { buildName, recordBuild } from "./kit/build.js";
import { watchWorkerErrors } from "./kit/errors.js";
import { nativePort } from "./kit/port.js";
import { checkForNewCheckout } from "./kit/self-reload.js";
import { showLink } from "./kit/show.js";

export const HOST = "com.example.extension_kit_fixture";
export const LOADED_FILES = ["worker.js", "kit/account.js", "kit/alarms.js", "kit/build.js", "kit/errors.js", "kit/port.js", "kit/self-reload.js", "kit/show.js"];

const REQUEST_KEY = "fixtureRequest";

/** @type {string | null} */
let commit = null;

/** Asks the address the test last sent, if any, within the limit it named. */
async function request(/** @type {AbortSignal} */ signal) {
  const { [REQUEST_KEY]: asked } = /** @type {{ [REQUEST_KEY]?: { url: string, ms: number } }} */ (await chrome.storage.local.get(REQUEST_KEY));
  if (!asked) return;
  const answer = await fetch(asked.url, { signal: within(signal, asked.ms) });
  if (!answer.ok) throw new Error(`the test's server said ${answer.status}`);
}

const port = nativePort({
  host: HOST,
  describe: async () => ({ version: buildName(commit), commit, account: await account() }),
  answer: (/** @type {any} */ message) => {
    if (message?.type === "echo") return { echoed: message.text };
    if (message?.type === "show") return showLink(String(message.url));
    if (message?.type === "request-address") {
      return chrome.storage.local.set({ [REQUEST_KEY]: { url: String(message.url), ms: Number(message.ms ?? 2000) } }).then(() => ({ kept: true }));
    }
    if (message?.type === "fail") {
      setTimeout(() => {
        throw new Error("the fixture failed on purpose");
      });
      return { failing: true };
    }
    return null;
  },
});

async function start() {
  const checked = await checkForNewCheckout(LOADED_FILES);
  commit = checked.commit;
  if (checked.reloading) return;
  await recordBuild(commit);
  port.connect();
}

if (globalThis.chrome?.runtime?.id) {
  // First, so an error anywhere below is kept for the status.
  watchWorkerErrors(self, () => buildName(commit));
  every("check", 1, start);
  every("request", 30, request, { limitMs: 30_000 });
  chrome.runtime.onStartup.addListener(start);
  chrome.runtime.onInstalled.addListener(start);
  start();
}
