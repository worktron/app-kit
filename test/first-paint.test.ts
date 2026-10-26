import { afterAll, afterEach, expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { firstPaint, firstPaintScript, firstPaintStyle, type FirstPaintOptions } from '../web/first-paint';

const SCHEMES = {
  light: { background: '#fff8f0', color: '#2c2420' },
  dark: { background: '#14110f', color: '#efe6dc', dark: true },
};

const realMatchMedia = window.matchMedia;
afterEach(() => {
  Object.defineProperty(window, 'matchMedia', { value: realMatchMedia, configurable: true });
  for (const tag of document.querySelectorAll('meta[name="theme-color"]')) tag.remove();
  document.documentElement.removeAttribute('style');
  delete document.documentElement.dataset.scheme;
});

/** The system's setting, and a way to change it as the person's Mac or phone does at sunset. */
function systemIsDark(dark: boolean) {
  const listeners: (() => void)[] = [];
  const query = { matches: dark, addEventListener: (_: string, listener: () => void) => listeners.push(listener) };
  Object.defineProperty(window, 'matchMedia', { value: () => query, configurable: true });
  return (next: boolean) => {
    query.matches = next;
    for (const listener of listeners) listener();
  };
}

function run(options: FirstPaintOptions) {
  new Function(firstPaintScript(options))();
  const root = document.documentElement;
  return {
    scheme: root.dataset.scheme,
    background: root.style.getPropertyValue('--page-background'),
    colorScheme: root.style.colorScheme,
    bars: [...document.querySelectorAll('meta[name="theme-color"]')].map((tag) => tag.getAttribute('content')),
  };
}

test("follows the system's dark setting, and every theme-color tag takes the scheme's background", () => {
  systemIsDark(true);
  document.head.insertAdjacentHTML('beforeend', '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#fff"><meta name="theme-color" content="#fff">');
  expect(run({ schemes: SCHEMES })).toEqual({ scheme: 'dark', background: '#14110f', colorScheme: 'dark', bars: ['#14110f', '#14110f'] });
});

test('follows the system again when it changes while the page is open', () => {
  const change = systemIsDark(false);
  expect(run({ schemes: SCHEMES }).scheme).toBe('light');
  change(true);
  expect(document.documentElement.dataset.scheme).toBe('dark');
  expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#14110f');
});

test("an app's own chooser picks by its own rule, and a name it does not know, or a throw, takes the first scheme", () => {
  systemIsDark(true);
  const schemes = { day: SCHEMES.light, night: SCHEMES.dark };
  expect(run({ schemes, choose: "'night'" }).scheme).toBe('night');
  expect(run({ schemes, choose: "'dusk'" }).scheme).toBe('day');
  expect(run({ schemes, choose: 'nothing.here' }).scheme).toBe('day');
});

test("a page with no theme-color tag gets one, and the app's own variable names are used", () => {
  systemIsDark(false);
  new Function(firstPaintScript({ schemes: SCHEMES, variables: { background: '--app-paper' } }))();
  expect(document.documentElement.style.getPropertyValue('--app-paper')).toBe('#fff8f0');
  expect(document.documentElement.style.getPropertyValue('--page-color')).toBe('#2c2420');
  expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
});

test("the style paints html and body in the variables, with the first scheme's colors when the script did not run", () => {
  expect(firstPaintStyle({ schemes: SCHEMES })).toBe('html, body { background: var(--page-background, #fff8f0); color: var(--page-color, #2c2420); }');
});

test('the plugin puts the style and the script at the end of the head, after the page\'s own theme-color tag', () => {
  const tags = firstPaint({ schemes: SCHEMES }).transformIndexHtml();
  expect(tags.map((t) => [t.tag, t.injectTo])).toEqual([
    ['style', 'head'],
    ['script', 'head'],
  ]);
});

test('schemes not named light and dark need a chooser, and a variable name must be one', () => {
  expect(() => firstPaint({ schemes: { day: SCHEMES.light } })).toThrow('name them light and dark');
  expect(() => firstPaint({ schemes: SCHEMES, variables: { color: 'red; }' } })).toThrow('not a CSS variable name');
});

const app = mkdtempSync(join(tmpdir(), 'app-kit-first-paint-'));
afterAll(() => rmSync(app, { recursive: true, force: true }));

test("an app's Vite config loads the plugin by its import name with Node, from inside node_modules", () => {
  const kit = join(app, 'node_modules', 'app-kit');
  mkdirSync(join(kit, 'web'), { recursive: true });
  cpSync(join(import.meta.dir, '..', 'package.json'), join(kit, 'package.json'));
  cpSync(join(import.meta.dir, '..', 'web', 'first-paint.js'), join(kit, 'web', 'first-paint.js'));
  const load =
    "const { firstPaint } = await import('app-kit/web/first-paint'); console.log(firstPaint({ schemes: { light: { background: '#fff', color: '#000' }, dark: { background: '#000', color: '#fff' } } }).name);";
  const done = Bun.spawnSync(['node', '--input-type=module', '-e', load], { cwd: app, stdout: 'pipe', stderr: 'pipe' });
  expect(done.stderr.toString()).toBe('');
  expect(done.stdout.toString().trim()).toBe('app-kit-first-paint');
});
