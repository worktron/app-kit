// Steps for an app's Playwright tests that depend on how the kit works inside: how it tells the page came back in front
// (src/page-return.ts) and which build a page is running (src/new-build.ts). Plain JavaScript, typed by playwright.d.ts,
// since Playwright's test runner loads nothing written in TypeScript from inside node_modules.

/** @type {typeof import('./playwright').showPage} */
export async function showPage(page) {
  await page.evaluate(() => {
    // A hidePage's own property shadows the browser's; removing it reads the real, visible state again.
    Reflect.deleteProperty(document, 'visibilityState');
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
}

/** @type {typeof import('./playwright').hidePage} */
export async function hidePage(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
}

const BUILT_ENTRY = /\/assets\/index-[^"]+\.js/;

/** @type {typeof import('./playwright').serveNewerBuild} */
export async function serveNewerBuild(page) {
  // Checked here rather than in the route, where a throw only leaves the page's request hanging.
  const served = await page.request.get('/');
  if (!BUILT_ENTRY.test(await served.text())) throw new Error('serveNewerBuild: the index page names no /assets/index-*.js to rename.');
  /** @param {URL} url */
  const indexPage = (url) => url.pathname === '/';
  /** @type {Parameters<typeof page.route>[1]} */
  const handler = async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace(BUILT_ENTRY, '/assets/index-Newer123.js') });
  };
  await page.route(indexPage, handler);
  return { stop: () => page.unroute(indexPage, handler) };
}
