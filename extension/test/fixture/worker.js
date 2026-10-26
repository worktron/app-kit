// A small extension built on the kit, which extension/e2e/harness.e2e.ts loads in a
// hidden Chromium. It reloads itself when its checkout moves, records its
// build and errors, checks each minute on an alarm, and keeps a native port
// open to test/hosts/echo-host.ts, answering `echo` with the text it was sent
// and `fail` by throwing an uncaught error a moment later; the port refuses
// anything else. It starts only inside Chrome, so a unit test can import it.

import { account } from "./kit/account.js";
import { every } from "./kit/alarms.js";
import { buildName, recordBuild } from "./kit/build.js";
import { watchWorkerErrors } from "./kit/errors.js";
import { nativePort } from "./kit/port.js";
import { checkForNewCheckout } from "./kit/self-reload.js";

export const HOST = "com.example.extension_kit_fixture";
export const LOADED_FILES = ["worker.js", "kit/account.js", "kit/alarms.js", "kit/build.js", "kit/errors.js", "kit/port.js", "kit/self-reload.js"];

/** @type {string | null} */
let commit = null;

const port = nativePort({
  host: HOST,
  describe: async () => ({ version: buildName(commit), commit, account: await account() }),
  answer: (/** @type {any} */ message) => {
    if (message?.type === "echo") return { echoed: message.text };
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
  chrome.runtime.onStartup.addListener(start);
  chrome.runtime.onInstalled.addListener(start);
  start();
}
