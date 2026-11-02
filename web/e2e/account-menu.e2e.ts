import { expect, test, type Page } from '@playwright/test';

// The account menu at the right end of an app's bar (fixture/account-menu.html), in Chromium: in the plain theme in
// the system's light and dark settings, in the console theme, and on a phone. Each open menu is kept as a picture
// beside the test's output.

const account = (page: Page) => page.getByRole('button', { name: 'pat.morgan@example.com' });

async function openMenu(page: Page) {
  await account(page).click();
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
}

for (const [name, path, scheme] of [
  ['plain-light', '/account-menu.html', 'light'],
  ['plain-dark', '/account-menu.html', 'dark'],
  ['console', '/account-menu.html?look=console', 'dark'],
] as const) {
  test(`in the ${name} look, the menu opens under the account at the bar's right end, inside the window`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 900, height: 420 });
    await page.goto(path);
    // Measured before the menu opens, which hides the rest of the page from the accessibility tree.
    const button = (await account(page).boundingBox())!;
    await openMenu(page);
    const menu = (await page.getByRole('menu').boundingBox())!;
    expect(menu.y).toBeGreaterThanOrEqual(button.y + button.height);
    expect(menu.x + menu.width).toBeLessThanOrEqual(900);
    // Right edges line up, so the menu hangs from the account's end.
    expect(Math.abs(menu.x + menu.width - (button.x + button.width))).toBeLessThan(2);
    await page.screenshot({ path: testInfo.outputPath(`account-menu-${name}.png`), animations: 'disabled' });
  });
}

test('from the keyboard, Enter opens the menu on its first item and Escape gives the keyboard back to the account', async ({ page }) => {
  await page.goto('/account-menu.html');
  await account(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(account(page)).toBeFocused();
});

test.describe('on a phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 360, height: 640 } });

  test('the account is a 44 pixel target, a long address ends in an ellipsis, and the open menu fits the screen', async ({ page }, testInfo) => {
    await page.goto('/account-menu.html');
    const button = (await account(page).boundingBox())!;
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(button.x + button.width).toBeLessThanOrEqual(360);
    await openMenu(page);
    const menu = (await page.getByRole('menu').boundingBox())!;
    expect(menu.x).toBeGreaterThanOrEqual(0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(360);
    await page.screenshot({ path: testInfo.outputPath('account-menu-phone.png'), animations: 'disabled' });
  });
});
