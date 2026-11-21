// Tells the worker the light or dark mode this page sees, for toolbar-icon.js.
//
// On the hidden page (color-scheme.html, which toolbar-icon.js opens) that is
// the Mac's appearance. Chrome never draws that page, so its media query's
// change event never fires: it reads the mode every CHECK_MS and tells the
// worker whenever that differs from what it last told it, and it answers the
// worker's question with what it sees at that moment. It remembers what it
// told only once the worker answered, so a message lost while the worker was
// starting is sent again at the next check.
//
// On any of the extension's own pages Chrome draws (the popup, the options or
// side panel page), which load this script with
// `<script type="module" src="kit/color-scheme.js"></script>`, that is
// Chrome's own Light, Dark or Device setting, as the toolbar sees it: it tells
// the worker as the page loads and at each change.

import { CHECK_MS, COLOR_SCHEME_MESSAGE, MAC_QUESTION } from "./toolbar-icon.js";

const darkMode = matchMedia("(prefers-color-scheme: dark)");
const hidden = location.href === new URL("./color-scheme.html", import.meta.url).href;

/** Tells the worker; resolves whether it answered. */
async function tell(/** @type {boolean} */ dark) {
  try {
    await chrome.runtime.sendMessage({ type: COLOR_SCHEME_MESSAGE, dark });
    return true;
  } catch {
    // The worker could not be reached.
    return false;
  }
}

if (hidden) {
  /** @type {boolean | null} */
  let told = null;
  let telling = false;
  const check = async () => {
    const dark = darkMode.matches;
    if (telling || dark === told) return;
    telling = true;
    if (await tell(dark)) told = dark;
    telling = false;
  };
  chrome.runtime.onMessage.addListener((message, _sender, answer) => {
    if (message?.type !== MAC_QUESTION) return false;
    answer({ dark: darkMode.matches });
    return false;
  });
  check();
  setInterval(check, CHECK_MS);
} else {
  tell(darkMode.matches);
  darkMode.addEventListener("change", () => tell(darkMode.matches));
}
