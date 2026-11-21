// The toolbar icon follows Chrome's light and dark mode.
//
// Chrome draws an extension's toolbar icon as the extension gave it, in either
// mode, so a dark one-colour icon nearly disappears on a dark toolbar. `app-kit
// icons render --toolbar-color` draws a light copy of the 16 and 32 beside
// them (icon-16-dark-mode.png, icon-32-dark-mode.png), and this shows that copy
// while Chrome's toolbar is dark and the manifest's own icons while it is light.
//
// Chrome tells an extension nothing about its mode, and its two kinds of page
// see different things. A page Chrome draws (a tab, the popup, the options or
// side panel page) sees Chrome's own Light, Dark or Device setting, as the
// toolbar does. A page Chrome never draws sees the Mac's appearance only. A
// worker has no matchMedia, so it reads both through pages:
//
// - The Mac: one hidden page (chrome.offscreen, reason MATCH_MEDIA, which needs
//   the "offscreen" permission, one Chrome installs without a warning),
//   color-scheme.html beside this file. Its media query's change event never
//   fires (Chrome never draws it), though what it matches does change: the
//   page reads it every CHECK_MS and tells the worker when it differs from
//   what it last told, which starts a stopped worker. It lasts until Chrome
//   closes or the extension reloads; the worker makes it again at each start,
//   and listens for Chrome's start so it starts then too.
// - Chrome: the extension's own pages, which load color-scheme.js and tell the
//   worker at load and at each change; and, for an extension with access to
//   websites and the "scripting" permission (no install warning), its open
//   tabs on those sites. The worker reads one such tab at the browser
//   session's first start and at each Mac change, and keeps
//   color-scheme-tab.js registered in every page Chrome lets it reach, which
//   tells it when the page's mode differs from the icon shown or changes. At
//   install or update, and when access to websites is granted, it puts that
//   script into the tabs already open, which a registered script reaches only
//   at their next load.
//
// The last reading from Chrome is kept in storage.local with the Mac's at that
// moment, since Chrome's setting outlives a restart: when the two differed,
// Chrome is set to a fixed Light or Dark and the icon holds that mode; when
// they agreed, Chrome is taken to be on Device, its default, and the icon
// follows the Mac until the next reading says otherwise. An incognito tab sees
// the device's mode whatever Chrome is set to, so its readings are left out. A
// custom theme's colours and Chrome's Page colors setting are never seen.
//
// Chrome gives no way to read the toolbar icon back, so each icon Chrome
// accepted (setIcon loads the images, and rejects a file that is not there) is
// recorded in storage.session under TOOLBAR_ICON_KEY, for a test or a status
// to read, and its mode in storage.local under SHOWN_MODE_KEY, for the tabs'
// script to compare with. Chrome allows one hidden page per extension: an
// extension that keeps its own for something else cannot use this, and its
// error says so.

import { recordWorkerError } from "./errors.js";

/** The message a page sends the worker, `{ type, dark }`: the hidden page for the Mac, any other page for Chrome. */
export const COLOR_SCHEME_MESSAGE = "app-kit-color-scheme";
/** The worker's question to the hidden page, answered `{ dark }` with what it sees at that moment. */
export const MAC_QUESTION = "app-kit-color-scheme-mac";
/** How often the hidden page reads the mode. */
export const CHECK_MS = 2000;
/** The storage.session key holding the icon Chrome last accepted. */
export const TOOLBAR_ICON_KEY = "toolbarIcon";
/** The storage.local key holding the mode of the icon shown, "light" or "dark", which the tabs' script reads. */
export const SHOWN_MODE_KEY = "toolbarIconMode";
/** The storage.local key holding Chrome's last reading. */
export const CHROME_READING_KEY = "toolbarIconChrome";
/** The storage.session key holding the Mac's last reading, for when the hidden page cannot be asked. */
const MAC_KEY = "toolbarIconMac";
/** The storage.session key set once the browser session's first start has read a tab. */
const STARTED_KEY = "toolbarIconStarted";
/** The id the tabs' script is registered under. */
export const TAB_SCRIPT_ID = "app-kit-color-scheme";
/** At most this many tabs are tried for a reading, the active ones first. */
const TABS_TRIED = 10;
/** How long one tab has to answer before the next is tried, so a tab whose page is busy or frozen never holds up the icon. */
export const TAB_READ_MS = 500;
/** The toolbar sizes; the 48 and 128 show on the extensions page and the Store, never the toolbar. */
const SIZES = ["16", "32"];

/** @typedef {{ mode: "light" | "dark", path: Record<string, string>, at: string }} ToolbarIcon */
/** @typedef {{ dark: boolean, mac: boolean | null, at: string }} ChromeReading */

/** The hidden page, beside this file wherever an extension keeps the kit's copies. */
const PAGE = new URL("./color-scheme.html", import.meta.url).href;

let following = false;
/** Each icon is chosen and set after the one before it, so two quick switches end on the later one. */
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
  const notPng = sizes.map((size) => icons[size]).find((path) => !path.endsWith(".png"));
  if (notPng) throw new Error(`toolbarIconFollowsMode: the toolbar icon ${notPng} is not a .png, so it has no -dark-mode.png copy; draw the icons with app-kit icons render`);
  const fromRoot = (/** @type {string} */ path) => (path.startsWith("/") ? path : `/${path}`);
  const light = Object.fromEntries(sizes.map((size) => [size, fromRoot(icons[size])]));
  const dark = Object.fromEntries(sizes.map((size) => [size, light[size].replace(/\.png$/, "-dark-mode.png")]));
  return { light, dark };
}

/**
 * Whether Chrome's toolbar is dark: Chrome's fixed mode when its last reading differed from the Mac's, else the Mac's,
 * else Chrome's last reading. Null when nothing has been read.
 * @param {boolean | null} mac
 * @param {ChromeReading | null | undefined} reading
 * @returns {boolean | null}
 */
export function toolbarIsDark(mac, reading) {
  if (reading && reading.mac !== null && reading.dark !== reading.mac) return reading.dark;
  return mac ?? reading?.dark ?? null;
}

/**
 * Shows the dark-mode or light-mode icons, then records them.
 * @param {boolean} dark
 * @returns {Promise<boolean>} whether Chrome accepted them
 */
async function show(dark) {
  try {
    const path = toolbarIconPaths()[dark ? "dark" : "light"];
    if (!chrome.action?.setIcon) throw new Error('toolbarIconFollowsMode: the manifest has no "action", so the extension has no toolbar icon to set');
    await chrome.action.setIcon({ path });
    const mode = dark ? "dark" : "light";
    /** @type {ToolbarIcon} */
    const record = { mode, path, at: new Date().toISOString() };
    await chrome.storage.session.set({ [TOOLBAR_ICON_KEY]: record });
    await chrome.storage.local.set({ [SHOWN_MODE_KEY]: mode });
    return true;
  } catch (error) {
    const message = /** @type {any} */ (error)?.message ?? String(error);
    await recordWorkerError(message.startsWith("toolbarIconFollowsMode") ? error : new Error(`toolbarIconFollowsMode: Chrome refused the ${dark ? "dark" : "light"}-mode toolbar icons (${message}); run app-kit icons render with --toolbar-color, which draws the dark-mode ones`));
    return false;
  }
}

/** The Mac's mode, from the hidden page at this moment, else as it last told; null when it never told. */
async function macIsDark() {
  try {
    const answer = await chrome.runtime.sendMessage({ type: MAC_QUESTION });
    if (typeof answer?.dark === "boolean") {
      await chrome.storage.session.set({ [MAC_KEY]: answer.dark });
      return answer.dark;
    }
  } catch {
    // No hidden page to answer, as while it is being made.
  }
  const { [MAC_KEY]: told } = await chrome.storage.session.get(MAC_KEY);
  return typeof told === "boolean" ? told : null;
}

/** The tabs' script, as a path from the extension's root, which is how scripting names a file. */
function tabScript() {
  const url = new URL("./color-scheme-tab.js", import.meta.url).href;
  const root = chrome.runtime.getURL("");
  return url.startsWith(root) ? url.slice(root.length) : url;
}

/** Keeps a reading of Chrome's mode with the Mac's at that moment. */
async function keepChromeReading(/** @type {boolean} */ dark, /** @type {boolean | null} */ mac) {
  /** @type {ChromeReading} */
  const reading = { dark, mac, at: new Date().toISOString() };
  await chrome.storage.local.set({ [CHROME_READING_KEY]: reading });
}

/** Shows the icon for the toolbar as the readings kept say it is. Resolves whether Chrome accepted it, null when nothing was read. */
async function showKept() {
  const mac = /** @type {boolean | null} */ ((await chrome.storage.session.get(MAC_KEY))[MAC_KEY] ?? null);
  const reading = /** @type {ChromeReading | undefined} */ ((await chrome.storage.local.get(CHROME_READING_KEY))[CHROME_READING_KEY]);
  const dark = toolbarIsDark(mac, reading);
  return dark === null ? null : show(dark);
}

/**
 * Runs one change of readings and the icon it gives, after the one before it.
 * @param {() => Promise<void>} change
 * @returns {Promise<boolean | null>}
 */
function update(change) {
  const shown = setting.then(async () => {
    try {
      await change();
    } catch (error) {
      await recordWorkerError(error);
    }
    return showKept();
  });
  setting = shown.then(() => undefined);
  return shown;
}

/** Whether the extension may reach some http or https pages. */
async function reachesWebsites() {
  const { origins = [] } = await chrome.permissions.getAll();
  return origins.some((origin) => /^(<all_urls>|(\*|https?):\/\/)/.test(origin));
}

/** The open tabs a reading may come from: not incognito, not discarded, on a web page when the address is known, the active ones first. */
async function readableTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter((tab) => tab.id !== undefined && !tab.incognito && !tab.discarded && (tab.url === undefined || /^https?:/.test(tab.url)))
    .sort((a, b) => Number(b.active) - Number(a.active))
    .slice(0, TABS_TRIED);
}

/** Chrome's mode as one open tab sees it, or null when the extension may read none. */
async function readATab() {
  if (!chrome.scripting?.executeScript || !(await reachesWebsites())) return null;
  for (const tab of await readableTabs()) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    try {
      // At once, not when the page is done loading; and a page too busy to answer in TAB_READ_MS counts as unreadable.
      const read = chrome.scripting.executeScript({ target: { tabId: /** @type {number} */ (tab.id) }, func: () => matchMedia("(prefers-color-scheme: dark)").matches, injectImmediately: true });
      /** @type {Promise<never>} */
      const late = new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("the tab did not answer")), TAB_READ_MS);
      });
      const [result] = await Promise.race([read, late]);
      if (typeof result?.result === "boolean") return result.result;
    } catch {
      // A tab the extension may not reach, one closing, or one too busy to answer; the next one may do.
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** Keeps color-scheme-tab.js registered for every web page Chrome lets the extension reach. */
async function registerTabScript() {
  try {
    if (!(await reachesWebsites())) return;
    if (!chrome.scripting?.registerContentScripts) throw new Error('toolbarIconFollowsMode: the extension reaches websites but lacks the "scripting" permission, which Chrome installs without a warning, so the toolbar icon cannot follow Chrome\'s own Light or Dark setting from its tabs');
    const [registered] = await chrome.scripting.getRegisteredContentScripts({ ids: [TAB_SCRIPT_ID] });
    const js = [tabScript()];
    // Kept across Chrome's restarts, so a registration from before the kit's copies moved is pointed at where they are now.
    if (registered) {
      if (registered.js?.join() !== js.join()) await chrome.scripting.updateContentScripts([{ id: TAB_SCRIPT_ID, js }]);
      return;
    }
    // Chrome runs it only where the extension has access, checked at each page's load, so once registered a change of
    // access needs nothing here; access first granted while the worker runs registers it (permissions.onAdded).
    await chrome.scripting.registerContentScripts([{ id: TAB_SCRIPT_ID, js, matches: ["http://*/*", "https://*/*"], runAt: "document_start", persistAcrossSessions: true }]);
  } catch (error) {
    // Two starts at once: the other one registered it.
    if (/duplicate script id/i.test(/** @type {any} */ (error)?.message ?? "")) return;
    await recordWorkerError(error);
  }
}

/** Puts color-scheme-tab.js into the open tabs it may reach, which a registered script reaches only at their next load. */
async function putTabScriptInOpenTabs() {
  if (!chrome.scripting?.executeScript || !(await reachesWebsites())) return;
  for (const tab of await chrome.tabs.query({})) {
    if (tab.id === undefined || tab.incognito || tab.discarded || (tab.url !== undefined && !/^https?:/.test(tab.url))) continue;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [tabScript()], injectImmediately: true }).catch(() => {});
  }
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
      justification: "Reads whether the Mac is in light or dark mode, so the toolbar icon stays visible.",
    });
  } catch (error) {
    // Two starts at once: the other one opened it.
    if (/single offscreen document/i.test(/** @type {any} */ (error)?.message ?? "")) return;
    await recordWorkerError(error);
  }
}

/**
 * A Mac reading from the hidden page: kept, then a tab read for Chrome's, which a Mac change may have moved. A Chrome
 * reading taken before the Mac was ever read takes this one as the Mac's at its moment.
 */
function fromMac(/** @type {boolean} */ dark) {
  return update(async () => {
    await chrome.storage.session.set({ [MAC_KEY]: dark });
    const tab = await readATab();
    if (tab !== null) return keepChromeReading(tab, dark);
    const reading = /** @type {ChromeReading | undefined} */ ((await chrome.storage.local.get(CHROME_READING_KEY))[CHROME_READING_KEY]);
    if (reading && reading.mac === null) await chrome.storage.local.set({ [CHROME_READING_KEY]: { ...reading, mac: dark } });
  });
}

/** A reading of Chrome's mode from one of the extension's pages or a tab, kept with the Mac's at that moment. */
function fromChrome(/** @type {boolean} */ dark) {
  return update(async () => keepChromeReading(dark, await macIsDark()));
}

/** The browser session's first start: a tab read for Chrome's mode, since one may have changed while the worker was gone. */
function firstStart() {
  return update(async () => {
    if ((await chrome.storage.session.get(STARTED_KEY))[STARTED_KEY]) return;
    await chrome.storage.session.set({ [STARTED_KEY]: true });
    const tab = await readATab();
    if (tab !== null) await keepChromeReading(tab, await macIsDark());
  });
}

/**
 * Has the toolbar icon follow Chrome's light and dark mode. Call it at the top of the worker, as it starts, so a page's
 * message reaches it when it starts the worker. Calling it again does nothing.
 * @returns {Promise<void>} resolves once the hidden page is open and the first reading taken, or a failure recorded
 */
export function toolbarIconFollowsMode() {
  if (following) return Promise.resolve();
  following = true;
  chrome.runtime.onMessage.addListener((message, sender, answer) => {
    if (message?.type !== COLOR_SCHEME_MESSAGE || typeof message.dark !== "boolean") return false;
    // An incognito tab sees the device's mode, not Chrome's setting.
    if (sender?.tab?.incognito) return false;
    // Answered once the icon is set, so the page knows its message arrived.
    (sender?.url === PAGE ? fromMac(message.dark) : fromChrome(message.dark)).then((shown) => answer({ shown: shown === true }));
    return true;
  });
  // Chrome starts the worker at its own start only for a listener, and the hidden page does not outlive Chrome.
  chrome.runtime.onStartup.addListener(() => {});
  chrome.runtime.onInstalled.addListener(() => putTabScriptInOpenTabs().catch(recordWorkerError));
  // Access to websites granted while the worker runs, as an optional permission is: the open tabs on them count from now.
  chrome.permissions.onAdded.addListener(({ origins = [] }) => {
    if (!origins.length) return undefined;
    return registerTabScript()
      .then(() => putTabScriptInOpenTabs())
      .catch(recordWorkerError);
  });
  return Promise.all([openPage(), registerTabScript()]).then(() => firstStart().then(() => undefined));
}
