// Copied from app-kit 0.32.0 by `app-kit extension copy`. Change it in the kit.
// Showing a link: a tab already showing its address comes forward, with its
// window raised (and brought back when minimized), before a new tab opens.
// Otherwise it opens in a new tab of the profile's last focused window, or in
// a new window when the profile has none, and that window is focused.
//
// Chrome gives a tab's address only to an extension holding the "tabs"
// permission or access to that page's site, and ignores tabs.query's url
// filter without one, so this reads every tab and compares each address
// itself. An extension with neither for the link's site cannot find the tab
// already open: the answer says so (tabsUnreadable), the worker logs it once,
// and the link opens in a new tab. A link opens only when it is a web address
// (http or https) or one of the extension's own pages. Requests for one link
// take turns: the second, with its own options, finds the tab the first opened
// when the extension may read it, so two at once open one tab.
// Unreadable, each opens its own, as every request does then.

/** @typedef {"existing-tab" | "new-tab" | "new-window" | "refused" | "failed"} How */

/**
 * @typedef {object} ShowOptions
 * @property {(tab: chrome.tabs.Tab) => boolean} [skip] Tabs never brought forward, such as the extension's own check tabs.
 * @property {(url: string, opening: () => Promise<number | undefined>) => Promise<unknown>} [open]
 *   Wraps the opening of a new tab or window, as a hold that lets this link through does; `opening` opens it and
 *   gives back the new tab's id.
 */

let warned = false;

/** The last request for each address, which the next for that address waits for. */
const showing = new Map();

/**
 * The link as an address to show, or null for one never opened: anything but a web address or the extension's own page.
 * @param {string} url
 */
export function showable(url) {
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  const own = chrome.runtime.getURL("");
  if (parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.href.startsWith(own)) return parsed.href;
  return null;
}

/** @param {number} windowId */
async function raise(windowId) {
  const window = await chrome.windows.get(windowId);
  await chrome.windows.update(windowId, { focused: true, ...(window.state === "minimized" ? { state: "normal" } : {}) });
}

async function lastFocusedWindow() {
  try {
    return await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
  } catch {
    // Chrome throws when the profile has no window.
    return null;
  }
}

/**
 * Whether Chrome gives the extension the address of a tab showing `address`: with the tabs permission, or access to
 * its site.
 * @param {string} address
 */
async function canRead(address) {
  if (await chrome.permissions.contains({ permissions: ["tabs"] })) return true;
  // Site access is for web addresses; the extension's own pages count only under tabs.
  if (address.startsWith(chrome.runtime.getURL(""))) return false;
  return chrome.permissions.contains({ origins: [`${new URL(address).origin}/*`] });
}

/**
 * Shows `url` and says how: "existing-tab", "new-tab", "new-window", "refused" for an address it never opens, or
 * "failed" when Chrome refused. `tabsUnreadable` is set when the extension may not read the address of a tab on the
 * link's site, so a tab already showing it could not be found.
 * @param {string} url
 * @param {ShowOptions} [options]
 * @returns {Promise<{ how: How, tabsUnreadable?: true }>}
 */
export function showLink(url, options = {}) {
  const address = showable(url);
  if (!address) return Promise.resolve({ how: /** @type {const} */ ("refused") });
  const answer = (showing.get(address) ?? Promise.resolve()).then(() => show(address, options));
  showing.set(address, answer);
  void answer.then(() => {
    if (showing.get(address) === answer) showing.delete(address);
  });
  return answer;
}

/**
 * @param {string} address
 * @param {ShowOptions} options
 * @returns {Promise<{ how: How, tabsUnreadable?: true }>}
 */
async function show(address, { skip = () => false, open = (_url, opening) => opening() }) {
  try {
    const unreadable = !(await canRead(address));
    if (unreadable && !warned) {
      warned = true;
      console.warn("showLink: the addresses of open tabs are not readable; the manifest needs the tabs permission or access to the sites it shows");
    }
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find((tab) => (tab.url === address || tab.pendingUrl === address) && !skip(tab));
    const said = unreadable ? { tabsUnreadable: /** @type {const} */ (true) } : {};
    if (existing?.id !== undefined) {
      await chrome.tabs.update(existing.id, { active: true });
      await raise(existing.windowId);
      return { how: "existing-tab", ...said };
    }
    const window = await lastFocusedWindow();
    if (window?.id === undefined) {
      await open(address, async () => (await chrome.windows.create({ url: address, focused: true }))?.tabs?.[0]?.id);
      return { how: "new-window", ...said };
    }
    const windowId = window.id;
    await open(address, async () => (await chrome.tabs.create({ windowId, url: address, active: true })).id);
    await raise(windowId);
    return { how: "new-tab", ...said };
  } catch {
    return { how: "failed" };
  }
}
