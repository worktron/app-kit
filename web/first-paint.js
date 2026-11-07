// The first frame in the app's own colors. Until the app's code loads, a page with no background paints white, or the
// wrong scheme, on every load. A few lines in the head pick the scheme before the first paint and set the page's
// background and text color, `color-scheme` for the browser's own controls, and the phone's bar color (theme-color).
// Plain JavaScript, typed by first-paint.d.ts, since an app's vite.config loads it in Node, which refuses TypeScript
// from inside node_modules, where an app has the kit.

const VARIABLE = /^--[A-Za-z0-9_-]+$/;
const DEFAULT_VARIABLES = { background: '--page-background', color: '--page-color' };
const FOLLOWS_SYSTEM = "window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'";

/** @param {import('./first-paint').FirstPaintOptions} options */
function settled(options) {
  const names = Object.keys(options.schemes ?? {});
  if (names.length === 0) throw new Error('app-kit first paint: give at least one scheme.');
  if (!options.choose && !(names.includes('light') && names.includes('dark'))) {
    throw new Error("app-kit first paint: without `choose`, the schemes follow the system's setting, so name them light and dark.");
  }
  const variables = { ...DEFAULT_VARIABLES, ...options.variables };
  for (const name of Object.values(variables)) {
    if (!VARIABLE.test(name)) throw new Error(`app-kit first paint: ${JSON.stringify(name)} is not a CSS variable name.`);
  }
  return { schemes: options.schemes, choose: options.choose, variables, first: options.schemes[names[0]] };
}

/** @type {typeof import('./first-paint').firstPaintStyle} */
export function firstPaintStyle(options) {
  const { variables, first } = settled(options);
  // The first scheme's colors stand in for the variables, so a page whose script did not run is still painted.
  return `html, body { background: var(${variables.background}, ${first.background}); color: var(${variables.color}, ${first.color}); }`;
}

/** @type {typeof import('./first-paint').firstPaintScript} */
export function firstPaintScript(options) {
  const { schemes, choose, variables } = settled(options);
  return [
    '(function () {',
    `  var schemes = ${JSON.stringify(schemes)};`,
    '  var root = document.documentElement;',
    '  function pick() {',
    '    var name;',
    `    try { name = ${choose ?? FOLLOWS_SYSTEM}; } catch (e) {}`,
    '    return Object.prototype.hasOwnProperty.call(schemes, name) ? name : Object.keys(schemes)[0];',
    '  }',
    '  function paint() {',
    '    var name = pick();',
    '    var scheme = schemes[name];',
    `    root.style.setProperty(${JSON.stringify(variables.background)}, scheme.background);`,
    `    root.style.setProperty(${JSON.stringify(variables.color)}, scheme.color);`,
    "    root.style.colorScheme = scheme.dark ? 'dark' : 'light';",
    '    root.dataset.scheme = name;',
    // Every theme-color tag, since the browser takes the first whose media matches; one is made when the page has none.
    '    var tags = document.querySelectorAll(\'meta[name="theme-color"]\');',
    '    if (tags.length === 0) {',
    "      var tag = document.createElement('meta');",
    "      tag.name = 'theme-color';",
    '      document.head.appendChild(tag);',
    '      tags = [tag];',
    '    }',
    "    for (var i = 0; i < tags.length; i++) tags[i].setAttribute('content', scheme.background);",
    '  }',
    '  paint();',
    choose
      ? ''
      : "  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paint);",
    '})();',
  ]
    .filter(Boolean)
    .join('\n');
}

const FAMILY = /^[A-Za-z0-9 _-]+$/;

/** @param {import('./first-paint').FirstPaintFont} font */
function settledFont(font) {
  if (!FAMILY.test(font.family)) throw new Error(`app-kit first paint: ${JSON.stringify(font.family)} is not a font family name of letters, digits, spaces and dashes.`);
  if (!/^[^/\\]+\.woff2$/.test(font.file)) throw new Error(`app-kit first paint: ${JSON.stringify(font.file)} is not a woff2 file's name, as 'figtree-latin-wght-normal.woff2'.`);
  return font;
}

/**
 * The last part of a path.
 * @param {string} path
 */
const baseName = (path) => path.split(/[\\/]/).pop() ?? path;

/**
 * The declarations of a CSS block, in order, as [name, value]. A face's values hold no semicolons: its url is the
 * built file's, never a data URL.
 * @param {string} body
 */
function declarations(body) {
  return body
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const colon = part.indexOf(':');
      return /** @type {[string, string]} */ ([part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim()]);
    });
}

/** @type {typeof import('./first-paint').firstFrameFont} */
export function firstFrameFont(font, bundle, base) {
  const { family, file } = settledFont(font);
  const assets = Object.values(bundle).filter((output) => output.type === 'asset');
  const built = assets.find((asset) => [...(asset.originalFileNames ?? []), ...(asset.names ?? [])].some((name) => baseName(name) === file));
  if (!built) throw new Error(`app-kit first paint: the build has no font file ${file}. Name a woff2 the app's stylesheet uses, as its package names it.`);
  const builtName = baseName(built.fileName);
  /** @type {[string, string][] | undefined} */
  let face;
  for (const sheet of assets.filter((asset) => asset.fileName.endsWith('.css'))) {
    const source = typeof sheet.source === 'string' ? sheet.source : new TextDecoder().decode(sheet.source);
    for (const [, body] of source.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      if (body.includes(builtName)) face = declarations(body);
      if (face) break;
    }
    if (face) break;
  }
  if (!face) throw new Error(`app-kit first paint: no @font-face in the built stylesheets uses ${file}, so there are no descriptors to copy.`);
  const theirs = face.find(([name]) => name === 'font-family')?.[1].replace(/^['"]|['"]$/g, '');
  if (theirs === family) {
    throw new Error(`app-kit first paint: the first frame's family must not be the stylesheet's own, ${family}: the stylesheet's later face, drawn with swap, would win.`);
  }
  const href = `${base === '' || base.startsWith('.') ? './' : base}${built.fileName}`;
  const src = face.find(([name]) => name === 'src')?.[1] ?? '';
  const format = src.match(/format\([^)]*\)/)?.[0] ?? "format('woff2')";
  const kept = face.filter(([name]) => !['font-family', 'font-display', 'src'].includes(name));
  const rules = [
    `font-family: '${family}'`,
    // Nothing until the file is in, for up to about three seconds, rather than the fallback and a swap.
    'font-display: block',
    `src: url(${JSON.stringify(href)}) ${format}`,
    ...kept.map(([name, value]) => `${name}: ${value}`),
  ];
  return [
    // At the start of the head, so the file is asked for before anything else, with the bare crossorigin a font's own
    // fetch uses, or the browser fetches it twice.
    { tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href, crossorigin: true }, injectTo: 'head-prepend' },
    { tag: 'style', children: `@font-face { ${rules.join('; ')}; }`, injectTo: 'head' },
  ];
}

/** @type {typeof import('./first-paint').firstPaint} */
export function firstPaint(options) {
  const style = firstPaintStyle(options);
  const script = firstPaintScript(options);
  const font = options.font && settledFont(options.font);
  let base = '/';
  return {
    name: 'app-kit-first-paint',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      // At the end of the head, after the page's own theme-color tag, which a script at its start could not yet find.
      // The font's tags only in a build, where the bundle names the built file, and only on a page that names the
      // first frame's family.
      handler(html, context) {
        /** @type {import('./first-paint').HtmlTag[]} */
        const tags = [
          { tag: 'style', children: style, injectTo: 'head' },
          { tag: 'script', children: script, injectTo: 'head' },
        ];
        if (font && context?.bundle && html.includes(font.family)) tags.push(...firstFrameFont(font, context.bundle, base));
        return tags;
      },
    },
  };
}
