// Steps for an app's Playwright tests of its Tauri builds, run as a web page: a stand-in for the shell's bridge that
// answers the kit's own plugins as they answer, a notification tapped, and desktop sign-in's trip through the browser
// and back. Plain JavaScript, typed by playwright.d.ts, since Playwright's test runner loads nothing written in
// TypeScript from inside node_modules, where an app has the kit; so the names the plugins and the shell share are
// copied below, and test/tauri-playwright-names.test.ts holds each to the names file it comes from.

/** The names, as iphone-notifications/names.ts, iphone-sign-in/names.ts and sign-in/names.ts give them. */
const NAMES = {
  requestPermission: 'plugin:iphone-notifications|request_permission',
  getToken: 'plugin:iphone-notifications|get_token',
  takeTappedAddress: 'plugin:iphone-notifications|take_tapped_address',
  tappedEvent: 'app-kit-notification-tapped',
  authenticate: 'plugin:web-auth|authenticate',
  answerKey: 'callbackUrl',
  linkHost: 'sign-in',
  desktopSignInPath: '/desktop-sign-in',
  desktopSignInEvent: 'app-kit-desktop-sign-in',
  ticketParam: 'desktop_sign_in_ticket',
  nonceParam: 'desktop_sign_in_nonce',
};

/** Where `launchedByTap` leaves the address for the next load, as the plugin holds a tap that launched the app. */
const LAUNCH_TAP_KEY = 'app-kit:launch-tap';

/** @type {typeof import('./playwright').IPHONE_USER_AGENT} */
export const IPHONE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** @typedef {import('./playwright').FakeTauriOptions} FakeTauriOptions */
/** @typedef {import('./playwright').TauriCall} TauriCall */
/** @typedef {{ calls: TauriCall[]; taps: string[]; opened: string[]; macApp: boolean }} Recorded */

/** @type {typeof import('./playwright').fakeTauri} */
export async function fakeTauri(page, options = {}) {
  if (options.iphoneNotifications || options.iphoneSignIn) {
    // The kit's iPhone halves run only in an iPhone's app, which they tell by its user agent.
    const agent = await page.evaluate(() => navigator.userAgent);
    if (!/\b(iPhone|iPad)\b/.test(agent)) {
      throw new Error('fakeTauri: the iPhone plugins answer only an iPhone app; use test.use({ userAgent: IPHONE_USER_AGENT }) first.');
    }
  }
  await page.addInitScript(
    ({ options, names, launchKey }) => {
      /** @type {Recorded} */
      const recorded = { calls: [], taps: [], opened: [], macApp: options.macApp === true };
      // A tap that launched the app, which the plugin holds before the page starts.
      const launched = sessionStorage.getItem(launchKey);
      sessionStorage.removeItem(launchKey);
      if (launched !== null) recorded.taps.push(launched);
      /** @type {Map<number, (data: unknown) => unknown>} */
      const callbacks = new Map();
      /**
       * @param {string} command
       * @param {Record<string, any> | undefined} args
       */
      const answer = (command, args) => {
        const answers = options.answers ?? {};
        if (Object.hasOwn(answers, command)) return answers[command];
        const notifications = options.iphoneNotifications;
        if (notifications) {
          if (command === names.requestPermission) return { granted: notifications.granted ?? true };
          if (command === names.getToken) return { token: notifications.token ?? 'f'.repeat(64), environment: notifications.environment ?? 'development' };
          if (command === names.takeTappedAddress) return recorded.taps.shift() ?? null;
        }
        const sheet = options.iphoneSignIn;
        if (sheet && command === names.authenticate) {
          // What the Swift plugin rejects with when the person closes the sheet.
          if (sheet.nonce === 'cancel') throw new Error("The operation couldn't be completed. (com.apple.AuthenticationServices.WebAuthenticationSession error 1.)");
          const asked = new URL(args?.payload?.url).searchParams.get('nonce') ?? '';
          const query = new URLSearchParams({ ticket: sheet.ticket ?? '', nonce: sheet.nonce === 'other' ? crypto.randomUUID() : asked });
          return { [names.answerKey]: `${args?.payload?.callbackScheme}://${names.linkHost}?${query}` };
        }
        throw new Error(`no ${command} here`);
      };
      Object.assign(window, {
        __appKitTauri: recorded,
        __TAURI_INTERNALS__: {
          /**
           * @param {string} command
           * @param {Record<string, unknown>} [args]
           */
          invoke: async (command, args) => {
            recorded.calls.push({ command, args: args ?? null });
            return answer(command, args);
          },
          // As Tauri's own mocks (@tauri-apps/api/mocks), so a plugin that takes a callback finds the bridge it expects.
          /**
           * @param {(data: unknown) => unknown} callback
           * @param {boolean} [once]
           */
          transformCallback: (callback, once) => {
            const id = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
            callbacks.set(id, (data) => {
              if (once) callbacks.delete(id);
              return callback?.(data);
            });
            return id;
          },
          /** @param {number} id */
          unregisterCallback: (id) => void callbacks.delete(id),
          /**
           * @param {number} id
           * @param {unknown} data
           */
          runCallback: (id, data) => void callbacks.get(id)?.(data),
          callbacks,
        },
      });
      // The Mac app's shell sends a window the page opens to the default browser, so the page stays where it is.
      if (options.macApp) {
        window.open = (url) => {
          recorded.opened.push(String(url ?? ''));
          return null;
        };
      }
    },
    { options, names: NAMES, launchKey: LAUNCH_TAP_KEY },
  );
}

/** @param {import('@playwright/test').Page} page */
async function recorded(page) {
  const found = await page.evaluate(() => /** @type {{ __appKitTauri?: Recorded }} */ (/** @type {unknown} */ (window)).__appKitTauri ?? null);
  if (!found) throw new Error('This page has no fakeTauri bridge; call fakeTauri(page) before page.goto.');
  return found;
}

/** @type {typeof import('./playwright').tauriCalls} */
export async function tauriCalls(page) {
  return (await recorded(page)).calls;
}

/** @type {typeof import('./playwright').tapNotification} */
export async function tapNotification(page, address) {
  await recorded(page);
  await page.evaluate(
    ({ address, event }) => {
      /** @type {{ __appKitTauri: Recorded }} */ (/** @type {unknown} */ (window)).__appKitTauri.taps.push(address);
      window.dispatchEvent(new Event(event));
    },
    { address, event: NAMES.tappedEvent },
  );
}

/** @type {typeof import('./playwright').launchedByTap} */
export async function launchedByTap(page, address) {
  await page.evaluate(({ key, address }) => sessionStorage.setItem(key, address), { key: LAUNCH_TAP_KEY, address });
}

/** @type {typeof import('./playwright').windowAsksForSignIn} */
export async function windowAsksForSignIn(page, click) {
  const fake = await page.evaluate(() => /** @type {{ __appKitTauri?: Recorded }} */ (/** @type {unknown} */ (window)).__appKitTauri ?? null);
  if (fake?.macApp) {
    // The fake shell keeps what the page asked to open.
    const before = fake.opened.length;
    await click();
    const handle = await page
      .waitForFunction((count) => {
        const opened = /** @type {{ __appKitTauri: Recorded }} */ (/** @type {unknown} */ (window)).__appKitTauri.opened;
        return opened.length > count ? opened[opened.length - 1] : null;
      }, before)
      .catch((/** @type {Error} */ error) => {
        throw new Error(`windowAsksForSignIn: the click opened no window (${error.message})`);
      });
    return nonceOf(String(await handle.jsonValue()));
  }
  // Otherwise the browser page loads, in this page or in a window it opened; it is cancelled rather than answered with
  // No Content: Playwright 1.64 reports a 204 for a page load in Chromium as finished, and the click then waits for a
  // page that never comes (microsoft/playwright#43279, fixed for 1.65 by failing the load, as cancelling it does).
  const context = page.context();
  /** @param {URL} url */
  const browserPage = (url) => url.pathname === NAMES.desktopSignInPath;
  /** @type {Parameters<typeof context.route>[1]} */
  const cancel = (route) => route.abort('aborted');
  await context.route(browserPage, cancel);
  try {
    const asked = context.waitForEvent('request', { predicate: (request) => browserPage(new URL(request.url())) });
    await click();
    const request = await asked.catch((/** @type {Error} */ error) => {
      throw new Error(`windowAsksForSignIn: the click opened no ${NAMES.desktopSignInPath} page (${error.message})`);
    });
    return nonceOf(request.url());
  } finally {
    await context.unroute(browserPage, cancel);
  }
}

/** @param {string} address */
function nonceOf(address) {
  const url = new URL(address);
  const nonce = url.searchParams.get('nonce');
  if (url.pathname !== NAMES.desktopSignInPath || !nonce) throw new Error(`windowAsksForSignIn: ${address} is not the sign-in page with a nonce`);
  return nonce;
}

/** @type {typeof import('./playwright').handOverSignIn} */
export async function handOverSignIn(page, link) {
  await page.evaluate(({ event, link }) => window.dispatchEvent(new CustomEvent(event, { detail: link })), { event: NAMES.desktopSignInEvent, link });
}

/** @type {typeof import('./playwright').loadWithSignIn} */
export async function loadWithSignIn(page, { ticket, nonce }, path = '/') {
  // The shell does this only for a page still on its way, which reads the fragment as it loads; a loaded page would only
  // move to the fragment, so the page is left first.
  await page.goto('about:blank');
  await page.goto(`${path}#${new URLSearchParams({ [NAMES.ticketParam]: ticket, [NAMES.nonceParam]: nonce })}`);
}
