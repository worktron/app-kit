// The hidden page's script (color-scheme.html), which toolbar-icon.js opens:
// it reads whether Chrome is in dark mode every CHECK_MS, since the media
// query's change event never fires on a page Chrome never draws, and tells the
// worker whenever that differs from what it last told it. It remembers what it
// told only once the worker answered, so a message lost while the worker was
// starting is sent again at the next check.

import { CHECK_MS, COLOR_SCHEME_MESSAGE } from "./toolbar-icon.js";

const darkMode = matchMedia("(prefers-color-scheme: dark)");
/** @type {boolean | null} */
let told = null;
let telling = false;

async function check() {
  const dark = darkMode.matches;
  if (telling || dark === told) return;
  telling = true;
  try {
    await chrome.runtime.sendMessage({ type: COLOR_SCHEME_MESSAGE, dark });
    told = dark;
  } catch {
    // The worker could not be reached; the next check tells it.
  } finally {
    telling = false;
  }
}

check();
setInterval(check, CHECK_MS);
