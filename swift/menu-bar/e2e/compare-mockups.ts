#!/usr/bin/env bun
/**
 * Checks the menu bar theme against two Studies pages' mockups: the Fleet Menu Studies page's (rev 3, options F and G),
 * five screens in mockups.html in the console look's dark, and the Beeline Menu Studies page's (options D and E), two in
 * beeline-mockups.html in the plain look's light. For each, a headless Chromium draws the screens, the page's own CSS and
 * markup, and measures each box and run of text; the theme draws the same screens in that look and appearance
 * (menu-bar-snapshots render); then menu-bar-snapshots compare holds the theme's to the mockup's size, backgrounds, lines
 * and text, and writes the two side by side.
 *
 *   bun swift/menu-bar/e2e/compare-mockups.ts [folder]   folder defaults to test-results/menu-bar, with a folder in it
 *                                                        for each look
 *
 * Run it by hand after a change to the look; it is not in the gates, since it holds one text engine's letters to
 * another's. Exit codes: 0 every screen within the limits; 1 a screen outside them, or a step failed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const here = import.meta.dir;
const packageFolder = resolve(here, '..');
const out = resolve(process.argv[2] ?? join(here, '..', '..', '..', 'test-results', 'menu-bar'));
/** Each mockups file, the look and appearance its screens are drawn in, and whether it needs the bundled JetBrains Mono. */
const sets = [
  { file: 'mockups.html', look: 'console', appearance: 'dark', mono: true },
  { file: 'beeline-mockups.html', look: 'plain', appearance: 'light', mono: false },
] as const;

const browser = await chromium.launch();
try {
  for (const set of sets) {
    const mockups = join(out, set.look, 'mockups');
    mkdirSync(mockups, { recursive: true });
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 600, height: 800 } });
    await page.goto(`file://${join(here, set.file)}`);
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(() => [400, 600, 700].every((weight) => document.fonts.check(`${weight} 13px "JetBrains Mono"`)));
    if (set.mono && !loaded) throw new Error('the mockups did not load the bundled JetBrains Mono');
    for (const screen of await page.locator('[data-screen]').all()) {
      const name = (await screen.getAttribute('data-screen')) ?? '';
      await screen.screenshot({ path: join(mockups, `${name}.png`) });
      const measured = await screen.evaluate((root) => {
        const hex = (css: string) => {
          const [r, g, b, a] = (css.match(/[\d.]+/g) ?? []).map(Number);
          if (a === 0 || r === undefined) return null;
          return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
        };
        const origin = root.getBoundingClientRect();
        const rect = (r: DOMRect) => ({ x: r.x - origin.x, y: r.y - origin.y, w: r.width, h: r.height });
        const boxes = [...root.querySelectorAll<HTMLElement>('*')].map((element) => {
          const style = getComputedStyle(element);
          return {
            ...rect(element.getBoundingClientRect()),
            name: `${element.tagName.toLowerCase()}.${element.className || '-'} "${(element.textContent ?? '').trim().slice(0, 24)}"`,
            background: hex(style.backgroundColor),
            borderBottom: style.borderBottomWidth === '0px' ? null : hex(style.borderBottomColor),
          };
        });
        const texts: { x: number; y: number; w: number; h: number; color: string; text: string }[] = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent ?? '';
          if (!text.trim() || !node.parentElement) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          // A run that wraps is checked line by line.
          for (const line of range.getClientRects()) texts.push({ ...rect(line), color: hex(getComputedStyle(node.parentElement).color) ?? '#000000', text: text.trim().slice(0, 40) });
        }
        return { boxes, texts };
      });
      writeFileSync(join(mockups, `${name}.json`), JSON.stringify({ scale: 2, ...measured }, null, 2));
    }
    await page.close();
  }
} finally {
  await browser.close();
}

const run = (command: string[]) =>
  Bun.spawnSync(command, { cwd: packageFolder, stdout: 'inherit', stderr: 'inherit' }).exitCode === 0;
if (!run(['swift', 'build', '--product', 'menu-bar-snapshots'])) process.exit(1);
// Every look is compared, so one look's problems never hide the other's.
let failed = false;
for (const set of sets) {
  const folder = join(out, set.look);
  if (!run(['.build/debug/menu-bar-snapshots', 'render', join(folder, 'theme'), set.appearance, set.look])) process.exit(1);
  failed = !run(['.build/debug/menu-bar-snapshots', 'compare', join(folder, 'mockups'), join(folder, 'theme'), join(folder, 'side-by-side'), set.look]) || failed;
  console.log(`side by side: ${join(folder, 'side-by-side')}`);
}
if (failed) process.exit(1);
