import { afterAll, afterEach, expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { firstFrameFont, firstPaint, firstPaintScript, firstPaintStyle, type BuiltFiles, type FirstPaintOptions } from '../web/first-paint';

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
  const tags = firstPaint({ schemes: SCHEMES }).transformIndexHtml.handler('<html></html>');
  expect(tags.map((t) => [t.tag, t.injectTo])).toEqual([
    ['style', 'head'],
    ['script', 'head'],
  ]);
});

test('schemes not named light and dark need a chooser, and a variable name must be one', () => {
  expect(() => firstPaint({ schemes: { day: SCHEMES.light } })).toThrow('name them light and dark');
  expect(() => firstPaint({ schemes: SCHEMES, variables: { color: 'red; }' } })).toThrow('not a CSS variable name');
});

const FONT = { family: 'Figtree First Frame', file: 'figtree-latin-wght-normal.woff2' };

/**
 * What Vite 8 built for a page importing @fontsource-variable/figtree, as the fixture's build gives it: the Latin file,
 * its name before the build, and the minified stylesheet with both of fontsource's faces.
 */
function built(): BuiltFiles {
  const face = (subset: string, hash: string, range: string) =>
    `@font-face{font-family:Figtree Variable;font-style:normal;font-display:swap;font-weight:300 900;src:url(/assets/figtree-${subset}-wght-normal-${hash}.woff2)format("woff2-variations");unicode-range:${range}}`;
  return {
    'assets/figtree-latin-wght-normal-D_ZTVpCC.woff2': {
      type: 'asset',
      fileName: 'assets/figtree-latin-wght-normal-D_ZTVpCC.woff2',
      names: ['figtree-latin-wght-normal.woff2'],
      originalFileNames: ['node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2'],
      source: new Uint8Array(),
    },
    'assets/wordmark-DTn5z1Vq.css': {
      type: 'asset',
      fileName: 'assets/wordmark-DTn5z1Vq.css',
      source: face('latin-ext', 'DCwSJGxG', 'U+100-2BA') + face('latin', 'D_ZTVpCC', 'U+??,U+131,U+FEFF,U+FFFD'),
    },
    'assets/wordmark-B9.js': { type: 'chunk', fileName: 'assets/wordmark-B9.js' },
  };
}

test("the first frame's face is its own family on the stylesheet's built file, with block, and the file preloaded", () => {
  expect(firstFrameFont(FONT, built(), '/')).toEqual([
    {
      tag: 'link',
      attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: '/assets/figtree-latin-wght-normal-D_ZTVpCC.woff2', crossorigin: true },
      injectTo: 'head-prepend',
    },
    {
      tag: 'style',
      children:
        "@font-face { font-family: 'Figtree First Frame'; font-display: block; src: url(\"/assets/figtree-latin-wght-normal-D_ZTVpCC.woff2\") format(\"woff2-variations\"); font-style: normal; font-weight: 300 900; unicode-range: U+??,U+131,U+FEFF,U+FFFD; }",
      injectTo: 'head',
    },
  ]);
});

test("the file's address follows the app's base, and a relative base is relative to the page", () => {
  expect(firstFrameFont(FONT, built(), '/app/')[0]?.attrs?.href).toBe('/app/assets/figtree-latin-wght-normal-D_ZTVpCC.woff2');
  expect(firstFrameFont(FONT, built(), './')[0]?.attrs?.href).toBe('./assets/figtree-latin-wght-normal-D_ZTVpCC.woff2');
});

test('a font file the build does not have, one no face uses, or the stylesheet\'s own family name, fails the build', () => {
  expect(() => firstFrameFont({ ...FONT, file: 'figtree-cyrillic-wght-normal.woff2' }, built(), '/')).toThrow('the build has no font file');
  const noFace = built();
  delete noFace['assets/wordmark-DTn5z1Vq.css'];
  expect(() => firstFrameFont(FONT, noFace, '/')).toThrow('no @font-face in the built stylesheets');
  expect(() => firstFrameFont({ ...FONT, family: 'Figtree Variable' }, built(), '/')).toThrow("must not be the stylesheet's own");
  expect(() => firstPaint({ schemes: SCHEMES, font: { ...FONT, family: "x'; } body {" } })).toThrow('not a font family name');
  expect(() => firstPaint({ schemes: SCHEMES, font: { ...FONT, file: 'figtree.woff' } })).toThrow("not a woff2 file's name");
});

test("the font's tags go only into a built page that names the family, and none into a page served in development", () => {
  const plugin = firstPaint({ schemes: SCHEMES, font: FONT });
  plugin.configResolved({ base: '/' });
  const named = "<style>#root:empty::before { font-family: 'Figtree First Frame' }</style>";
  expect(plugin.transformIndexHtml.handler(named, { bundle: built() }).map((t) => t.tag)).toEqual(['style', 'script', 'link', 'style']);
  expect(plugin.transformIndexHtml.handler('<p>no wordmark</p>', { bundle: built() }).map((t) => t.tag)).toEqual(['style', 'script']);
  expect(plugin.transformIndexHtml.handler(named, {}).map((t) => t.tag)).toEqual(['style', 'script']);
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
