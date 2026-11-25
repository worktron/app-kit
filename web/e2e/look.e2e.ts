import { expect, test, type Page } from '@playwright/test';
import { expectFits, largestTextSize } from '../playwright';
import { CONSOLE, DEFAULT_ACCENT, plainColors } from '../../look';
import { colorVariables } from '../theme';

// The kit's MUI themes (web/theme.ts) on the fixture's settings page (fixture/look.html), in Chromium: the plain theme
// and the console theme, each in the system's light and dark settings. Each draw is kept as a picture beside the test's
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

/** A labeled field's boxes, as drawn: its outlined box, where its text starts, its label, and the gap cut for the label. */
async function fieldBoxes(page: Page, name: string) {
  return page.locator(`[data-field="${name}"]`).evaluate((field) => {
    const box = (element: Element) => {
      const { left, top, right, bottom, height } = element.getBoundingClientRect();
      return { left, top, right, bottom, height };
    };
    const root = field.querySelector('.MuiOutlinedInput-root')!;
    const input = field.querySelector('input:not([aria-hidden]), textarea:not([aria-hidden]), .MuiSelect-select')!;
    const style = getComputedStyle(input);
    const line = parseFloat(style.fontSize) * 1.4375;
    const inputBox = box(input);
    return {
      root: box(root),
      fontSize: parseFloat(style.fontSize),
      labelFontSize: parseFloat(getComputedStyle(field.querySelector('.MuiInputLabel-root')!).fontSize),
      line,
      text: { left: inputBox.left + parseFloat(style.paddingLeft), top: inputBox.top + parseFloat(style.paddingTop) },
      label: box(field.querySelector('.MuiInputLabel-root')!),
      gap: box(field.querySelector('legend > span')!),
      border: parseFloat(getComputedStyle(field.querySelector('fieldset')!).borderTopWidth),
    };
  });
}

/**
 * Every labeled field on the page, empty and filled, at its expected text size and fitting its label: the box is the
 * text's lines with 6 above and below, the resting label sits where the text starts, and the risen label is centered on
 * the top line inside the gap cut for it.
 */
async function expectLabeledFieldsFit(page: Page, fontSize: number) {
  // A menu tells its label it has a value only once it has mounted, so that label starts at rest and moves up: every
  // filled field's label has risen and stopped moving before anything is measured.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-field] .MuiInputLabel-root')].every(
      (label) => label.getAnimations().length === 0 && (!label.closest('[data-field$="filled"]') || label.classList.contains('MuiInputLabel-shrink')),
    ),
  );
  for (const kind of ['small', 'default', 'multi-line', 'menu', 'suggestions']) {
    for (const state of ['empty', 'filled'] as const) {
      const name = `${kind} ${state}`;
      const field = await fieldBoxes(page, name);
      expect(field.fontSize, `${name}: text size`).toBe(fontSize);
      // The label is the text's size, so it rests on the text and its risen size matches the gap the outline cuts.
      expect(field.labelFontSize, `${name}: label size`).toBe(fontSize);
      // A multi-line field is MUI's growing text area, which sizes its rows by a measured row's whole-pixel height.
      const lines = kind === 'multi-line' ? 3 * Math.round(field.line) : field.line;
      expect(Math.abs(field.root.height - (lines + 12)), `${name}: height`).toBeLessThanOrEqual(0.5);
      if (state === 'empty') {
        // At rest the label sits on the first line, where the typed text will start.
        expect(Math.abs(field.label.top - field.text.top), `${name}: label top`).toBeLessThanOrEqual(1);
        expect(Math.abs(field.label.left - field.text.left), `${name}: label left`).toBeLessThanOrEqual(1);
      } else {
        // Risen, the label is centered on the top line, inside the gap cut for it.
        const middle = (field.label.top + field.label.bottom) / 2;
        expect(Math.abs(middle - (field.root.top + field.border / 2)), `${name}: risen label on the line`).toBeLessThanOrEqual(1);
        expect(field.label.left, `${name}: label inside its gap`).toBeGreaterThanOrEqual(field.gap.left - 0.5);
        expect(field.label.right, `${name}: label inside its gap`).toBeLessThanOrEqual(field.gap.right + 0.5);
        expect(Math.abs(field.label.left - field.text.left), `${name}: risen label starts over the text`).toBeLessThanOrEqual(1);
      }
    }
  }
}

for (const scheme of ['light', 'dark'] as const) {
  test(`the plain theme's labeled fields fit their label: resting where the text starts, risen into its gap (${scheme})`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 460, height: 900 });
    await page.goto('/look.html');
    await expect(page.getByText('Beeline 1.0.0, 873623f')).toBeVisible();
    await expectLabeledFieldsFit(page, 12);
    await page.locator('[data-field="small empty"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`web-plain-fields-${scheme}.png`), fullPage: true, animations: 'disabled' });
  });
}

test.describe('with fields that never zoom, on a phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } });

  for (const scheme of ['light', 'dark'] as const) {
    test(`the plain theme's labeled fields are 16 pixels and still fit their label (${scheme})`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme: scheme });
      // Built as the apps build it: the setting spread into the components, then the app's own outlined field padding.
      await page.goto('/look.html?fields=never-zoom');
      await expect(page.getByText('Beeline 1.0.0, 873623f')).toBeVisible();
      await expectLabeledFieldsFit(page, 16);
      await page.locator('[data-field="small empty"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`web-plain-fields-never-zoom-${scheme}.png`), fullPage: true, animations: 'disabled' });
    });
  }
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the console theme draws the page in the console look's ${scheme} colors in JetBrains Mono, and its role variables follow`, async ({ page }, testInfo) => {
    const colors = CONSOLE[scheme];
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 460, height: 900 });
    await page.goto('/look.html?look=console');
    await expect(page.getByText('Beeline 1.0.0, 873623f')).toBeVisible();
    expect(await color(page, 'body', 'background-color')).toBe(colors.bg);
    expect(await color(page, 'h1', 'color')).toBe(colors.text);
    expect(await page.locator('body').evaluate((body) => getComputedStyle(body).fontFamily)).toMatch(/^"JetBrains Mono"/);
    // An element an app colors by role, with the kit's variables, takes the scheme's value.
    await page.locator('body').evaluate((body, value) => {
      const probe = document.createElement('span');
      probe.id = 'role-probe';
      probe.style.color = value;
      body.append(probe);
    }, colorVariables.secondary);
    expect(await color(page, '#role-probe', 'color')).toBe(colors.secondary);
    await page.screenshot({ path: testInfo.outputPath(`web-console-${scheme}.png`), fullPage: true, animations: 'disabled' });
  });
}

/** The root font size the page draws at, in pixels. */
const rootSize = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);

test("the Text size row draws the page at the size chosen, at once and after a reload, and Standard goes back to the browser's size", async ({ page }, testInfo) => {
  await page.goto('/look.html');
  const menu = page.getByRole('combobox', { name: 'Text size' });
  // Off a phone there is no phone size to follow: the first choice is the browser's own size.
  await expect(menu).toHaveText('Standard');
  expect(await rootSize(page)).toBe('16px');
  await menu.click();
  await expect(page.getByRole('option')).toHaveText(['Standard', '85%', '100%', '115%', '125%', '150%', '175%', '200%']);
  await page.getByRole('option', { name: '150%' }).click();
  await expect(menu).toHaveText('150%');
  expect(await rootSize(page)).toBe('24px');
  await page.screenshot({ path: testInfo.outputPath('text-size-150.png'), fullPage: true, animations: 'disabled' });

  await page.reload();
  await expect(menu).toHaveText('150%');
  expect(await rootSize(page)).toBe('24px');

  await menu.click();
  await page.getByRole('option', { name: 'Standard' }).click();
  await expect(menu).toHaveText('Standard');
  expect(await rootSize(page)).toBe('16px');
});

test("on a phone the first choice names the phone's own size", async ({ page }) => {
  await largestTextSize(page);
  await page.goto('/look.html');
  const menu = page.getByRole('combobox', { name: 'Text size' });
  await expect(menu).toHaveText('Same as the phone');
  await menu.click();
  await expect(page.getByRole('option').first()).toHaveText('Same as the phone312%');
});

for (const [size, setUp] of [
  ['200% chosen', (page: Page) => page.addInitScript(() => localStorage.setItem('app-kit:text-size', '2'))],
  ["the phone's largest Text Size", (page: Page) => largestTextSize(page)],
] as const) {
  test(`the settings page fits a phone's width at ${size}`, async ({ page }, testInfo) => {
    await setUp(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/look.html');
    await expect(page.getByRole('combobox', { name: 'Text size' })).toBeVisible();
    await expectFits(page);
    await page.screenshot({ path: testInfo.outputPath(`text-size-fits-${size.replace(/\W+/g, '-')}.png`), fullPage: true, animations: 'disabled' });
  });
}

test("on a phone a button naming a long account wraps inside the screen, and a short one beside a row's text stays on one line", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/look.html');
  const long = page.getByRole('button', { name: /^Continue as / });
  await expect(long).toBeVisible();
  const box = (await long.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  // Wrapped onto more than one line, rather than cut or run past the edge.
  const lineHeight = await long.evaluate((button) => parseFloat(getComputedStyle(button).lineHeight));
  expect(box.height).toBeGreaterThan(lineHeight * 1.5);
  // The row's action keeps its word whole and does not shrink beside the row's text.
  const test = page.getByRole('button', { name: 'Test', exact: true });
  const word = (await test.boundingBox())!;
  expect(word.height).toBeLessThan(lineHeight * 1.5);
  await expectFits(page);
  await page.screenshot({ path: testInfo.outputPath('long-account-button.png'), fullPage: true, animations: 'disabled' });
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } });

  test('the Text size menu takes a tap 44 pixels tall, 20 pixels below its words, and its box ends there', async ({ page }) => {
    await page.goto('/look.html');
    // The words' own box, without the padding a touch screen adds, measured as a mouse page draws it.
    const words = page.getByRole('combobox', { name: 'Text size' });
    const padded = (await words.boundingBox())!;
    expect(padded.height).toBeGreaterThanOrEqual(44);
    const box = { x: padded.x, y: padded.y + 9, width: padded.width, height: padded.height - 18 };
    expect(box.height).toBeLessThan(44);
    const middle = box.y + box.height / 2;
    // Past its own text, inside the 44 pixel target.
    await page.touchscreen.tap(box.x + box.width / 2, middle + 20);
    await expect(page.getByRole('option', { name: '150%' })).toBeVisible();
    await page.keyboard.press('Escape');
    // A closed menu fades out, hidden from the accessibility tree but still taking taps until it is gone: a tap then
    // picks the size under it, and the page grows.
    await expect(page.getByRole('listbox', { includeHidden: true })).toHaveCount(0);
    // The target's top pixel is the menu's, and the one past it is not.
    const x = box.x + box.width / 2;
    const menuAt = (y: number) => words.evaluate((menu, point) => menu.contains(document.elementFromPoint(point.x, point.y)), { x, y });
    expect(await menuAt(padded.y)).toBe(true);
    expect(await menuAt(padded.y - 1)).toBe(false);
    // Chrome moves a tap a few pixels off a control onto it, as a phone does: measured, 7 pixels past the target still
    // opens the menu and 13 do not. A tap 13 pixels past it opens nothing and changes nothing.
    await page.touchscreen.tap(x, padded.y - 13);
    await expect(words).toHaveAttribute('aria-expanded', 'false');
    expect(await words.boundingBox(), 'the menu where it was, at the size it was').toEqual(padded);
  });
});

// The Mac window's update line with a release found, on each kit theme in each setting: the band is a tint of the same
// primary color the filled Update is drawn in, read through the theme's CSS variables, so a dark page never gets the
// light setting's color behind its words.
for (const look of ['plain', 'console'] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`a release's update line on the ${look} theme in ${scheme} is a band in a tint of the filled Update's own color`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 460, height: 900 });
      await page.goto(`/look.html?update=release${look === 'console' ? '&look=console' : ''}`);
      const line = page.getByRole('status').filter({ hasText: 'Beeline has an update.' });
      await expect(line).toBeVisible();
      const drawn = await line.evaluate((element) => {
        const channels = (value: string) => value.match(/[\d.]+/g)!.map(Number);
        const band = channels(getComputedStyle(element).backgroundColor);
        const button = channels(getComputedStyle(element.querySelector('button')!).backgroundColor);
        return { band, button, text: getComputedStyle(element).color, body: getComputedStyle(document.querySelector('h1')!).color };
      });
      expect(drawn.band).toEqual([...drawn.button.slice(0, 3), 0.16]);
      expect(drawn.text).toBe(drawn.body);
      // Update is a filled button with room around its word, and keeps its fill under the pointer, where the plain look's
      // words show an underline instead.
      const update = line.getByRole('button', { name: 'Update' });
      const box = await update.evaluate((button) => ({ left: getComputedStyle(button).paddingLeft, fill: getComputedStyle(button).backgroundColor }));
      expect(box.left).not.toBe('0px');
      await update.hover();
      // Read once MUI's eased change of color under the pointer has finished, not partway through it.
      const hovered = await update.evaluate(async (button) => {
        await Promise.all(button.getAnimations().map((animation) => animation.finished));
        return { fill: getComputedStyle(button).backgroundColor, line: getComputedStyle(button).textDecorationLine };
      });
      expect(hovered).toEqual({ fill: expect.not.stringMatching(/^rgba\(\d+, \d+, \d+, 0\)$/), line: 'none' });
      expect(box.fill).not.toBe('rgba(0, 0, 0, 0)');
      if (look === 'plain') {
        // The plain look's text Button is still a word: no padding, nothing filled, an underline under the pointer.
        const word = page.getByRole('button', { name: 'Test', exact: true });
        await word.hover();
        const drawnWord = await word.evaluate(async (button) => {
          await Promise.all(button.getAnimations().map((animation) => animation.finished));
          const style = getComputedStyle(button);
          return { padding: style.padding, fill: style.backgroundColor, line: style.textDecorationLine };
        });
        expect(drawnWord).toEqual({ padding: '0px', fill: 'rgba(0, 0, 0, 0)', line: 'underline' });
      }
      await page.screenshot({ path: testInfo.outputPath(`update-line-${look}-${scheme}.png`), animations: 'disabled' });
    });
  }
}
