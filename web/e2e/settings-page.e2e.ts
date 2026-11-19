import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeTauri, tauriCalls } from '../../tauri/playwright';
import { OPEN_AT_LOGIN_COMMANDS, SETTINGS_PAGE, SETTINGS_PAGE_SETTINGS } from '../../tauri/window/names';

// The kit's Settings window on the Mac (tauri/window/start/settings.html): one switch that opens the app when the
// person logs in, showing what macOS reports. The page is served at an address of its own (page.route), the settings
// are the ones the window plugin hands it (plugin/src/settings.rs), and the plugin's commands are answered by the kit's
// fake Tauri bridge, one load per answer. Chromium draws the switch as a checkbox, so this holds what the page does
// and says; how the Mac draws it is seen on an installed app.

const PAGE = readFileSync(join(import.meta.dirname, '../../tauri/window/start', SETTINGS_PAGE), 'utf8');
const SETTINGS_ADDRESS = 'https://settings.example.com/settings.html';
const DARK = { name: 'Example', background: '#0a0e1f', text: '#e0e2eb' };

// The window's own size (plugin/src/settings.rs).
test.use({ viewport: { width: 460, height: 150 } });

const [STATUS, SET, OPEN_LOGIN_ITEMS] = OPEN_AT_LOGIN_COMMANDS.map((command) => `plugin:app-kit-window|${command}`) as [string, string, string];

type Answer = { state: string; error?: string };

/**
 * The Settings page, with macOS answering `status` when asked and `set` when the switch is changed, or the change
 * refused by the bridge itself (`'refused'`), which the fake bridge does for a command it has no answer for.
 */
async function open(page: Page, status: Answer, set?: Answer | 'refused', settings: Record<string, string> = DARK) {
  const answers: Record<string, unknown> = { [STATUS]: status, [OPEN_LOGIN_ITEMS]: null };
  if (set !== 'refused') answers[SET] = set ?? status;
  await fakeTauri(page, { macApp: true, answers });
  await page.addInitScript(([name, value]) => Object.assign(window, { [name as string]: value }), [SETTINGS_PAGE_SETTINGS, settings] as const);
  await page.route(SETTINGS_ADDRESS, (route) => route.fulfill({ contentType: 'text/html', body: PAGE }));
  await page.goto(SETTINGS_ADDRESS);
}

const toggle = (page: Page) => page.getByRole('switch', { name: 'Open Example when you log in' });
const commands = async (page: Page) => (await tauriCalls(page)).map((call) => call.command);

test('on, as macOS reports it, with nothing more said, in the start page colors', async ({ page }, testInfo) => {
  await open(page, { state: 'enabled' });
  await expect(toggle(page)).toBeChecked();
  await expect(toggle(page)).toBeEnabled();
  await expect(page.getByRole('status')).toBeHidden();
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(10, 14, 31)');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
  await expect(page).toHaveTitle('Example Settings');
  await page.screenshot({ path: testInfo.outputPath('settings-enabled.png') });
});

test('off, which is also what macOS says for an app it knows nothing of, and turning it on shows the state macOS reports after', async ({ page }, testInfo) => {
  await open(page, { state: 'off' }, { state: 'enabled' });
  await expect(toggle(page)).not.toBeChecked();
  await expect(toggle(page)).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('settings-off.png') });
  await toggle(page).click();
  await expect(toggle(page)).toBeChecked();
  await expect(page.getByRole('status')).toBeHidden();
  expect((await tauriCalls(page)).find((call) => call.command === SET)?.args).toEqual({ on: true });
});

test('waiting for approval shows on, says so, and opens Login Items', async ({ page }, testInfo) => {
  await open(page, { state: 'requires-approval' });
  await expect(toggle(page)).toBeChecked();
  await expect(page.getByRole('status')).toHaveText('macOS is waiting for you to allow Example in Login Items.');
  await page.screenshot({ path: testInfo.outputPath('settings-requires-approval.png') });
  await page.getByRole('button', { name: 'Open Login Items' }).click();
  await expect.poll(() => commands(page)).toContain(OPEN_LOGIN_ITEMS);
});

test('a change macOS refuses shows its own words and the state it reports after, not the click', async ({ page }, testInfo) => {
  await open(page, { state: 'off' }, { state: 'off', error: 'Operation not permitted' });
  await toggle(page).click();
  await expect(page.getByRole('status')).toHaveText("Couldn't turn it on: Operation not permitted");
  await expect(toggle(page)).not.toBeChecked();
  await expect(toggle(page)).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('settings-failed.png') });
});

test('a change the bridge refuses keeps its words beside the state macOS reports after', async ({ page }) => {
  await open(page, { state: 'off' }, 'refused');
  await toggle(page).click();
  await expect(page.getByRole('status')).toHaveText(`Couldn't turn it on: Error: no ${SET} here`);
  await expect(toggle(page)).not.toBeChecked();
  await expect(toggle(page)).toBeEnabled();
});

test('turning it off when macOS keeps it on says so and stays on', async ({ page }) => {
  await open(page, { state: 'enabled' }, { state: 'enabled', error: 'Operation not permitted' });
  await toggle(page).click();
  await expect(page.getByRole('status')).toHaveText("Couldn't turn it off: Operation not permitted");
  await expect(toggle(page)).toBeChecked();
});

test('on a macOS before 13 the switch is disabled and says why', async ({ page }) => {
  await open(page, { state: 'not-available' });
  await expect(toggle(page)).toBeDisabled();
  await expect(toggle(page)).not.toBeChecked();
  await expect(page.getByRole('status')).toHaveText('Opening at login needs macOS 13 or later.');
});

test('it reads macOS again when the window comes forward', async ({ page }) => {
  await open(page, { state: 'off' });
  await expect(toggle(page)).toBeEnabled();
  const before = (await commands(page)).filter((command) => command === STATUS).length;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(async () => (await commands(page)).filter((command) => command === STATUS).length).toBe(before + 1);
});

test("an app that opens on no start page gets macOS's own light or dark look", async ({ page }) => {
  await open(page, { state: 'off' }, undefined, { name: 'Example' });
  await expect(toggle(page)).toBeEnabled();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light dark');
});
