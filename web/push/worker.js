// The kit's notification worker: it shows each push as a notification and opens the notification's page on a tap. A
// plain classic script with no imports, so the Vite plugin (vite.js) serves it as it is at /push-worker.js, and an app
// with a service worker of its own takes it in with importScripts('/push-worker.js').
//
// It never calls skipWaiting or clients.claim: a new version takes over on the next launch, never under an open page.
// It has no fetch handler, so it never answers for the page, and the new-deploy line and the crash reload work as
// they do without it.
//
// Safari removes a site's subscription after three pushes that show nothing, and a push shows nothing when its event
// ends before showNotification is called or when the promise it waits on rejects. So every push shows a notification
// inside event.waitUntil, whatever its data, and the promise never rejects.
//
// The server half sends the declarative form ({ web_push: 8030, notification: { title, navigate, ... } }), which Safari
// on iOS 18.4 and later shows with no code running; this worker shows the same message everywhere else.

// Checked by its own tsconfig.json beside it, under the service worker's types rather than the page's.
const worker = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

/**
 * What the worker shows. `navigate` is the declarative form's page, which Safari reads; `renotify` sounds again for a
 * notification that replaces one with the same tag, which Chrome reads.
 * @typedef {NotificationOptions & { data: { url: string }, navigate?: string, renotify?: boolean }} Shown
 * @typedef {{ title: string, options: Shown, badge?: number }} Message
 */

const DECLARATIVE_PUSH = 8030;
const LOG_PREFIX = '[web-push]';

/**
 * The page a notification opens: an address on this worker's own site, or the site's root for anything else.
 * @param {unknown} address
 */
function onSite(address) {
  const origin = worker.location.origin;
  try {
    const url = new URL(typeof address === 'string' && address ? address : '/', origin);
    if (url.origin === origin) return url.href;
    console.warn(`${LOG_PREFIX} refused ${address}: not a page of ${origin}`);
  } catch {
    console.warn(`${LOG_PREFIX} refused ${String(address)}: not an address`);
  }
  return new URL('/', origin).href;
}

/**
 * The title, options and icon number a push carries: the declarative form, a plain one, or text.
 * @param {PushMessageData | null} data
 * @returns {Message}
 */
function read(data) {
  const fallbackTitle = worker.location.hostname;
  if (!data) return { title: fallbackTitle, options: { data: { url: onSite('/') } } };
  let message;
  try {
    message = data.json();
  } catch {
    return { title: fallbackTitle, options: { body: data.text(), data: { url: onSite('/') } } };
  }
  const declarative = message && message.web_push === DECLARATIVE_PUSH && message.notification;
  const fields = declarative ? message.notification : message || {};
  const url = onSite(declarative ? fields.navigate : fields.url);
  /** @type {Shown} */
  const options = { body: typeof fields.body === 'string' ? fields.body : '', data: { url }, navigate: url };
  if (typeof fields.tag === 'string' && fields.tag) {
    options.tag = fields.tag;
    // Chrome replaces a notification with the same tag without a sound unless told to renotify, and refuses renotify
    // without a tag.
    if (!fields.silent && !fields.quiet) options.renotify = true;
  }
  if (fields.silent || fields.quiet) options.silent = true;
  if (typeof fields.icon === 'string') options.icon = fields.icon;
  const badge = declarative ? message.app_badge : fields.badge;
  return {
    title: typeof fields.title === 'string' && fields.title ? fields.title : fallbackTitle,
    options,
    badge: typeof badge === 'number' ? badge : undefined,
  };
}

/** @param {PushMessageData | null} data */
async function show(data) {
  /** @type {Message} */
  let message;
  try {
    message = read(data);
  } catch (error) {
    console.error(`${LOG_PREFIX} could not read a push`, error);
    message = { title: worker.location.hostname, options: { data: { url: onSite('/') } } };
  }
  if (message.badge !== undefined && 'setAppBadge' in navigator) {
    try {
      await (message.badge === 0 ? navigator.clearAppBadge() : navigator.setAppBadge(message.badge));
    } catch (error) {
      console.warn(`${LOG_PREFIX} could not set the icon's number`, error);
    }
  }
  try {
    await worker.registration.showNotification(message.title, message.options);
  } catch (error) {
    // An option this browser refuses: the title and body alone still show, so the push is never silent.
    console.error(`${LOG_PREFIX} could not show a notification with its options`, error);
    try {
      await worker.registration.showNotification(message.title, { body: message.options.body, data: message.options.data });
    } catch (again) {
      console.error(`${LOG_PREFIX} could not show a notification`, again);
    }
  }
}

worker.addEventListener('push', (event) => {
  event.waitUntil(show(event.data));
});

/**
 * Open the page: a window this worker controls is brought forward and moved to it, since only a controlled window can
 * be navigated from here. A window opened before notifications were turned on is not controlled until it reloads, so
 * it, and a navigation that fails, gets a window of its own.
 * @param {unknown} address
 */
async function openPage(address) {
  const url = onSite(address);
  const controlled = await worker.clients.matchAll({ type: 'window' });
  const client = controlled.find((c) => new URL(c.url).origin === worker.location.origin);
  if (client) {
    try {
      const focused = await client.focus();
      await (focused || client).navigate(url);
      return;
    } catch (error) {
      console.warn(`${LOG_PREFIX} could not move the open window to ${url}`, error);
    }
  }
  try {
    await worker.clients.openWindow(url);
  } catch (error) {
    console.error(`${LOG_PREFIX} could not open ${url}`, error);
  }
}

worker.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data;
  event.waitUntil(openPage(data && data.url));
});
