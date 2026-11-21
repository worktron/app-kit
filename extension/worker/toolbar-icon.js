// The toolbar icon follows Chrome's light and dark mode.
//
// Chrome draws an extension's toolbar icon as the extension gave it, in either
// mode, so a dark one-colour icon nearly disappears on a dark toolbar. `app-kit
// icons render --toolbar-color` draws a light copy of the 16 and 32 beside
// them (icon-16-dark-mode.png, icon-32-dark-mode.png), and this shows that copy
// while Chrome is in dark mode and the manifest's own icons in light mode.
//
// A worker has no matchMedia, so it cannot see the mode; a page can. The
// worker keeps one hidden page open (chrome.offscreen, reason MATCH_MEDIA,
// which needs the "offscreen" permission, one Chrome installs without a
// warning), color-scheme.html beside this file. Chrome never draws that page,
// so its media query's change event never fires (requestAnimationFrame never
// runs there either), though what the query matches does change: the page
// reads it every CHECK_MS and tells the worker when it differs from what it
// last told. That message starts a stopped worker, which sets the icon. The
// page lasts until Chrome closes or the extension reloads; the worker makes it
// again at each start, and listens for Chrome's start so it starts then too.
//
// The page sees the mode web pages see, which on a Mac follows the system's
// appearance and may not follow Chrome's own Light or Dark setting when the
// two differ, and never sees a custom theme's colours.
//
// Chrome gives no way to read the toolbar icon back, so each icon Chrome
// accepted (setIcon loads the images, and rejects a file that is not there) is
// recorded in storage.session under TOOLBAR_ICON_KEY, for a test or a status
// to read. Chrome allows one hidden page per extension: an extension that keeps
// its own for something else cannot use this, and its error says so.

import { recordWorkerError } from "./errors.js";

/** The message the hidden page sends the worker: `{ type, dark }`. */
export const COLOR_SCHEME_MESSAGE = "app-kit-color-scheme";
/** How often the hidden page reads the mode. */
export const CHECK_MS = 2000;
/** The storage.session key holding the icon Chrome last accepted. */
export const TOOLBAR_ICON_KEY = "toolbarIcon";
/** The toolbar sizes; the 48 and 128 show on the extensions page and the Store, never the toolbar. */
const SIZES = ["16", "32"];

/** @typedef {{ mode: "light" | "dark", path: Record<string, string>, at: string }} ToolbarIcon */

/** The hidden page, beside this file wherever an extension keeps the kit's copies. */
const PAGE = new URL("./color-scheme.html", import.meta.url).href;

let following = false;
/** Each icon is set after the one before it, so two quick switches end on the later one. */
let setting = Promise.resolve();

/**
 * The manifest's toolbar icons for light mode and their copies for dark mode, each path from the extension's root:
 * Chrome reads a path without the leading slash from the worker's own folder.
 * @returns {{ light: Record<string, string>, dark: Record<string, string> }}
 */
export function toolbarIconPaths() {
  const manifest = chrome.runtime.getManifest();
  const given = manifest.action?.default_icon;
  /** @type {Record<string, string>} */
  const icons = typeof given === "object" && given ? given : (manifest.icons ?? {});
  const sizes = SIZES.filter((size) => typeof icons[size] === "string");
  if (!sizes.length) throw new Error("toolbarIconFollowsMode: the manifest lists no 16 or 32 pixel icon under action.default_icon or icons");
  const fromRoot = (/** @type {string} */ path) => (path.startsWith("/") ? path : `/${path}`);
  const light = Object.fromEntries(sizes.map((size) => [size, fromRoot(icons[size])]));
  const dark = Object.fromEntries(sizes.map((size) => [size, light[size].replace(/\.png$/, "-dark-mode.png")]));
  return { light, dark };
}

/**
 * Shows the dark-mode or light-mode icons, then records them.
 * @param {boolean} dark
 * @returns {Promise<boolean>} whether Chrome accepted them
 */
function show(dark) {
  const shown = setting.then(async () => {
    try {
      const path = toolbarIconPaths()[dark ? "dark" : "light"];
      if (!chrome.action?.setIcon) throw new Error('toolbarIconFollowsMode: the manifest has no "action", so the extension has no toolbar icon to set');
      await chrome.action.setIcon({ path });
      /** @type {ToolbarIcon} */
      const record = { mode: dark ? "dark" : "light", path, at: new Date().toISOString() };
      await chrome.storage.session.set({ [TOOLBAR_ICON_KEY]: record });
      return true;
    } catch (error) {
      const message = /** @type {any} */ (error)?.message ?? String(error);
      await recordWorkerError(message.startsWith("toolbarIconFollowsMode") ? error : new Error(`toolbarIconFollowsMode: Chrome refused the ${dark ? "dark" : "light"}-mode toolbar icons (${message}); run app-kit icons render with --toolbar-color, which draws the dark-mode ones`));
      return false;
    }
  });
  setting = shown.then(() => undefined);
  return shown;
}

/** Opens the hidden page unless it is open. */
async function openPage() {
  try {
    if (!chrome.offscreen?.createDocument) throw new Error('toolbarIconFollowsMode: the manifest needs the "offscreen" permission, which Chrome installs without a warning');
    const open = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
    if (open.some((context) => context.documentUrl === PAGE)) return;
    if (open.length) throw new Error(`toolbarIconFollowsMode: the extension already keeps a hidden page (${open[0]?.documentUrl}), and Chrome allows one, so the toolbar icon cannot follow the mode`);
    await chrome.offscreen.createDocument({
      url: PAGE,
      reasons: [chrome.offscreen.Reason.MATCH_MEDIA],
      justification: "Reads whether Chrome is in light or dark mode, so the toolbar icon stays visible.",
    });
  } catch (error) {
    // Two starts at once: the other one opened it.
    if (/single offscreen document/i.test(/** @type {any} */ (error)?.message ?? "")) return;
    await recordWorkerError(error);
  }
}

/**
 * Has the toolbar icon follow Chrome's light and dark mode. Call it at the top of the worker, as it starts, so the
 * hidden page's message reaches it when it starts the worker. Calling it again does nothing.
 * @returns {Promise<void>} resolves once the hidden page is open, or its failure is recorded
 */
export function toolbarIconFollowsMode() {
  if (following) return Promise.resolve();
  following = true;
  chrome.runtime.onMessage.addListener((message, sender, answer) => {
    if (message?.type !== COLOR_SCHEME_MESSAGE || sender?.url !== PAGE) return false;
    // Answered once the icon is set, so the page knows its message arrived.
    show(message.dark === true).then((shown) => answer({ shown }));
    return true;
  });
  // Chrome starts the worker at its own start only for a listener, and the hidden page does not outlive Chrome.
  chrome.runtime.onStartup.addListener(() => {});
  return openPage();
}
