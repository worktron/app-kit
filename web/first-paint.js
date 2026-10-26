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

/** @type {typeof import('./first-paint').firstPaint} */
export function firstPaint(options) {
  const style = firstPaintStyle(options);
  const script = firstPaintScript(options);
  return {
    name: 'app-kit-first-paint',
    // At the end of the head, after the page's own theme-color tag, which a script at its start could not yet find.
    transformIndexHtml: () => [
      { tag: 'style', children: style, injectTo: 'head' },
      { tag: 'script', children: script, injectTo: 'head' },
    ],
  };
}
