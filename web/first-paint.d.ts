// The types of first-paint.js, which is plain JavaScript because an app's vite.config loads it in Node, which refuses
// TypeScript from inside node_modules, where an app has the kit.

/** One set of first-frame colors. */
export interface FirstPaintScheme {
  /** The page's background, also the phone's bar color. */
  background: string;
  /** The page's text color. */
  color: string;
  /** Whether the browser's own controls, scrollbars and caret, are drawn dark. */
  dark?: boolean;
}

export interface FirstPaintOptions {
  /** The schemes by name. Without `choose`, name them `light` and `dark`. */
  schemes: Record<string, FirstPaintScheme>;
  /**
   * A JavaScript expression, run in the head before the first paint, that names the scheme, as
   * `"new Date().getHours() >= 20 ? 'night' : 'day'"`. Without it the page follows the system's light or dark setting,
   * and follows it again when it changes. A name it does not know, or an expression that throws, takes the first scheme.
   */
  choose?: string;
  /**
   * The CSS variables the page's colors are set in, for the app's own styles to read and its own code to change later:
   * `--page-background` and `--page-color` unless named here.
   */
  variables?: { background?: string; color?: string };
}

/** What Vite's transformIndexHtml returns: tags to put in the page. */
export interface HtmlTag {
  tag: string;
  children: string;
  injectTo: 'head';
}

/**
 * A Vite plugin that puts, at the end of index.html's head, a style painting the page in the variables and a script
 * setting them, `color-scheme`, `data-scheme` on the root and every theme-color tag, before the first paint.
 */
export function firstPaint(options: FirstPaintOptions): { name: string; transformIndexHtml: () => HtmlTag[] };

/** The script the plugin puts in the head. */
export function firstPaintScript(options: FirstPaintOptions): string;

/** The style the plugin puts in the head: `html, body` in the variables, with the first scheme's colors as fallbacks. */
export function firstPaintStyle(options: FirstPaintOptions): string;
