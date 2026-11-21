// Tells the worker the light or dark mode a web page sees, which follows Chrome's own Light, Dark or Device setting as
// the toolbar does, for toolbar-icon.js. The worker registers it in every page Chrome lets the extension reach and puts
// it into the tabs already open at install. It tells the worker as the page loads only when that mode differs from the
// icon shown, so an ordinary page load wakes no worker, and at each change. A classic script, not a module, since
// Chrome runs content scripts so, and it repeats the names toolbar-icon.js gives them. Once the extension reloads, this
// copy can no longer reach it and stops; the new one put in at install takes over.

(() => {
  const MESSAGE = "app-kit-color-scheme";
  const SHOWN_MODE_KEY = "toolbarIconMode";
  const self = /** @type {any} */ (globalThis);
  // One per extension load in a page: a copy put in at install beside the registered one, or put in twice, stays quiet.
  if (typeof self.appKitColorSchemeTab === "function" && self.appKitColorSchemeTab()) return;
  const runtime = chrome.runtime;
  self.appKitColorSchemeTab = () => Boolean(runtime?.id);
  const darkMode = matchMedia("(prefers-color-scheme: dark)");
  const stop = () => darkMode.removeEventListener("change", changed);
  const tell = () => {
    if (!runtime?.id) return stop();
    try {
      runtime.sendMessage({ type: MESSAGE, dark: darkMode.matches }).catch(() => {});
    } catch {
      stop();
    }
  };
  function changed() {
    tell();
  }
  darkMode.addEventListener("change", changed);
  chrome.storage.local
    .get(SHOWN_MODE_KEY)
    .then((kept) => {
      if (kept[SHOWN_MODE_KEY] !== (darkMode.matches ? "dark" : "light")) tell();
    })
    .catch(() => {});
})();
