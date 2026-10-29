import { expect, test, type Page } from '@playwright/test';
import { CONSOLE, DEFAULT_ACCENT, plainColors } from '../../look';

// The kit's MUI themes (web/theme.ts) on the fixture's settings page (fixture/look.html), in Chromium: the plain theme
// in the system's light and dark settings, and the console theme. Each draw is kept as a picture beside the test's
// output, for the comparison with the Plain Look Studies page.

/** A CSS color as #rrggbb. */
async function color(page: Page, selector: string, property: string): Promise<string> {
  const value = await page.locator(selector).first().evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);
  const [r, g, b] = value.match(/\d+/g)!.map(Number);
  return `#${[r, g, b].map((part) => part!.toString(16).padStart(2, '0')).join('')}`;
}

for (const scheme of ['light', 'dark'] as const) {
  test(`the plain theme draws the page in the tokens' ${scheme} colors, in the system typeface, with the kit's switch`, async ({ page }, testInfo) => {
    const colors = plainColors()[scheme];
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 460, height: 900 });
    await page.goto('/look.html');
    await expect(page.getByText('Beeline 1.0.0, 873623f')).toBeVisible();
    expect(await color(page, 'body', 'background-color')).toBe(colors.bg);
    expect(await color(page, 'h1', 'color')).toBe(colors.text);
    expect(await color(page, 'h2', 'color')).toBe(colors.muted);
    expect(await color(page, 'li', 'border-bottom-color')).toBe(colors.border);
    expect(await page.locator('body').evaluate((body) => getComputedStyle(body).fontFamily)).toMatch(/^-apple-system/);
    // The switch that is on fills in the accent with a paper knob; the one that is off is a muted outline.
    expect(await color(page, '.Mui-checked + .MuiSwitch-track', 'background-color')).toBe(DEFAULT_ACCENT[scheme]);
    expect(await color(page, '.Mui-checked .MuiSwitch-thumb', 'background-color')).toBe(colors.bg);
    expect(await color(page, '.MuiSwitch-switchBase:not(.Mui-checked) + .MuiSwitch-track', 'border-top-color')).toBe(colors.muted);
    expect(await page.locator('.MuiSwitch-root').first().evaluate((element) => [element.clientWidth, element.clientHeight])).toEqual([28, 16]);
    // Actions are words in the accent, the removal in the error color, with nothing filled.
    expect(await color(page, 'button:has-text("Test")', 'color')).toBe(DEFAULT_ACCENT[scheme]);
    expect(await color(page, 'button:has-text("Forget all")', 'color')).toBe(colors.error);
    expect(await page.locator('button:has-text("Test")').evaluate((button) => getComputedStyle(button).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    // The status words say what they mean in their colors.
    expect(await color(page, ':text-is("Connected")', 'color')).toBe(colors.ok);
    expect(await color(page, ':text-is("Quiet")', 'color')).toBe(colors.warn);
    // The switch flips on a click.
    await page.getByRole('switch', { name: 'Make Beeline the default browser' }).click();
    await expect(page.getByRole('switch', { name: 'Make Beeline the default browser' })).toBeChecked();
    await page.getByRole('switch', { name: 'Make Beeline the default browser' }).click();
    await expect(page.getByRole('switch', { name: 'Make Beeline the default browser' })).not.toBeChecked();
    // A row's action sits beside its text, never over it.
    const action = (await page.getByRole('button', { name: 'Forget all' }).boundingBox())!;
    const detail = (await page.getByText('Learned from where links opened').boundingBox())!;
    expect(detail.x + detail.width).toBeLessThanOrEqual(action.x);
    // On one line: an action never wraps.
    expect(action.height).toBeLessThan(24);
    expect(await color(page, 'html', 'background-color')).toBe(colors.bg);
    await page.screenshot({ path: testInfo.outputPath(`web-plain-${scheme}.png`), fullPage: true, animations: 'disabled' });
  });
}

test("the console theme draws the page in the console apps' dark colors in JetBrains Mono", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 460, height: 900 });
  await page.goto('/look.html?look=console');
  await expect(page.getByText('Beeline 1.0.0, 873623f')).toBeVisible();
  expect(await color(page, 'body', 'background-color')).toBe(CONSOLE.dark.bg);
  expect(await color(page, 'h1', 'color')).toBe(CONSOLE.dark.text);
  expect(await page.locator('body').evaluate((body) => getComputedStyle(body).fontFamily)).toMatch(/^"JetBrains Mono"/);
  await page.screenshot({ path: testInfo.outputPath('web-console.png'), fullPage: true, animations: 'disabled' });
});
