// Steps for an app's Playwright tests that depend on how the kit works inside: how it tells the page came back in front
// (web/page-return.ts), which build a page is running (web/new-build.ts) and the code the stand-in takes (code.js).
// Plain JavaScript, typed by playwright.d.ts, since Playwright's test runner loads nothing written in TypeScript from
// inside node_modules.

import { STAND_IN_CODE } from './code.js';

export { STAND_IN_CODE };

/** @type {typeof import('./playwright').showPage} */
export async function showPage(page) {
  await page.evaluate(() => {
    // A hidePage's own properties shadow the browser's; removing them reads the real, visible state again.
    Reflect.deleteProperty(document, 'visibilityState');
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
}

/** @type {typeof import('./playwright').hidePage} */
export async function hidePage(page) {
  await page.evaluate(() => {
    // Both ways a page asks: code that reads document.hidden, as older code does, sees the page hidden too.
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
}

/** @type {typeof import('./playwright').lockFor} */
export async function lockFor(page, ms) {
  // Playwright's fake Date says so; without it the page's timers are the real ones, and a jump would reach none of them.
  const fake = await page.evaluate(() => /** @type {{ isFake?: boolean }} */ (/** @type {unknown} */ (Date)).isFake === true);
  if (!fake) throw new Error('lockFor: install the clock with page.clock.install() before the page loads, so the time away fires no timers.');
  await hidePage(page);
  // The page's own time, which a test's installed clock may set to any date, not the test process's.
  const now = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(now + ms);
  await showPage(page);
}

/** @type {typeof import('./playwright').signInByCode} */
export async function signInByCode(page, email, options = {}) {
  const emailField = options.emailField ?? page.getByRole('textbox', { name: 'Email' });
  const codeField = options.codeField ?? page.getByRole('textbox', { name: 'Code' });
  await emailField.fill(email);
  await emailField.press('Enter');
  await codeField.fill(options.code ?? STAND_IN_CODE);
  // Pressed on the keyboard rather than the field: a field that signs in at its last digit is gone by now, and the
  // field's own press would wait for it until the test timed out.
  if (options.submit ?? true) await page.keyboard.press('Enter');
}

// The built entry as src/new-build.ts reads it, with the script tag kept so only its src is renamed.
const BUILT_ENTRY = /(<script\b[^>]*\btype="module"[^>]*\bsrc=")\/assets\/[^"]+\.js"/;

/** @type {typeof import('./playwright').serveNewerBuild} */
export async function serveNewerBuild(page) {
  // Checked here rather than in the route, where a throw only leaves the page's request hanging.
  const served = await page.request.get('/');
  if (!BUILT_ENTRY.test(await served.text())) throw new Error('serveNewerBuild: the index page names no module script under /assets/ to rename.');
  /** @param {URL} url */
  const indexPage = (url) => url.pathname === '/';
  /** @type {Parameters<typeof page.route>[1]} */
  const handler = async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace(BUILT_ENTRY, '$1/assets/newer-build.js"') });
  };
  await page.route(indexPage, handler);
  return { stop: () => page.unroute(indexPage, handler) };
}
