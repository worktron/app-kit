import { expect, test } from '@playwright/test';

// The fixture's /privacy, written at build as finished HTML (fixture/public-pages.tsx) and sent by serveBuiltPage with
// publicPages, read as the Chrome Web Store's check reads it, with no JavaScript, and held to the same page as the app
// draws it (fixture/privacy-app.html), at a phone's size and a desktop's, in light and dark.

test('with JavaScript off, /privacy shows its words and title, and loads none of the app', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  const scripts: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(request.url());
  });
  const answer = await page.goto('/privacy');
  expect(answer?.status()).toBe(200);
  await expect(page).toHaveTitle('Privacy policy · Kit fixture');
  await expect(page.getByRole('heading', { name: 'Privacy policy' })).toBeVisible();
  await expect(page.getByText('The shop reads only the orders you open')).toBeVisible();
  expect(scripts).toEqual([]);
  await context.close();
});

for (const scheme of ['light', 'dark'] as const) {
  for (const size of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 800 },
  ]) {
    test(`the finished /privacy looks as the app draws it, at ${size.name} size in ${scheme}`, async ({ browser, baseURL }, testInfo) => {
      const shot = async (javaScriptEnabled: boolean, path: string) => {
        const context = await browser.newContext({ javaScriptEnabled, baseURL, colorScheme: scheme, viewport: size });
        const page = await context.newPage();
        await page.goto(path);
        await expect(page.getByText('The shop reads only the orders you open')).toBeVisible();
        await page.evaluate(() => document.fonts.ready).catch(() => undefined);
        const picture = await page.screenshot({ fullPage: true });
        await context.close();
        return picture;
      };
      const finished = await shot(false, '/privacy');
      const drawn = await shot(true, '/privacy-app.html');
      await testInfo.attach(`finished-${size.name}-${scheme}.png`, { body: finished, contentType: 'image/png' });
      await testInfo.attach(`drawn-${size.name}-${scheme}.png`, { body: drawn, contentType: 'image/png' });
      expect(finished.equals(drawn)).toBe(true);
    });
  }
}
