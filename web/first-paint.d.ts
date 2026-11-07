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
  /**
   * A face for the page's own first-frame text, such as `#root:empty::before`'s wordmark, that is never drawn in a
   * fallback, and the preload of its file. In a build, on each page whose HTML names `family`.
   */
  font?: FirstPaintFont;
}

/** The first frame's face: a family of its own on the same built file as the app's stylesheet. */
export interface FirstPaintFont {
  /**
   * The family the page's first-frame text names first, as `'Figtree First Frame'`, never the stylesheet's own: a
   * later face of the same family drawn with `swap` would win over this one.
   */
  family: string;
  /**
   * The woff2 file by the name it has before the build, as the stylesheet's package names it:
   * `'figtree-latin-wght-normal.woff2'` for `@fontsource-variable/figtree`'s Latin letters.
   */
  file: string;
}

/** What Vite's transformIndexHtml returns: tags to put in the page. */
export interface HtmlTag {
  tag: string;
  attrs?: Record<string, string | boolean>;
  children?: string;
  injectTo: 'head' | 'head-prepend';
}

/** The parts of Vite's built output the font option reads: each file's name, its names before the build, and its contents. */
export type BuiltFiles = Record<
  string,
  { type: 'asset'; fileName: string; names?: string[]; originalFileNames?: string[]; source: string | Uint8Array } | { type: 'chunk'; fileName: string }
>;

/** The part of Vite's transformIndexHtml context the plugin reads: the build's output, which a dev server has none of. */
export interface HtmlContext {
  bundle?: BuiltFiles;
}

/**
 * A Vite plugin that puts, at the end of index.html's head, a style painting the page in the variables and a script
 * setting them, `color-scheme`, `data-scheme` on the root and every theme-color tag, before the first paint. With
 * `font`, in a build, it also puts the preload of the font's built file at the start of the head and the first frame's
 * face beside the style.
 */
export function firstPaint(options: FirstPaintOptions): {
  name: string;
  configResolved: (config: { base: string }) => void;
  transformIndexHtml: { handler: (html: string, context?: HtmlContext) => HtmlTag[] };
};

/**
 * The tags for the first frame's font: the preload of the built file, and a face named `font.family` on it with
 * `font-display: block` and every other descriptor copied from the built stylesheet's face for that file. Throws when
 * the build has no such file or no face uses it, or when `font.family` is the stylesheet's own.
 */
export function firstFrameFont(font: FirstPaintFont, bundle: BuiltFiles, base: string): HtmlTag[];

/** The script the plugin puts in the head. */
export function firstPaintScript(options: FirstPaintOptions): string;

/** The style the plugin puts in the head: `html, body` in the variables, with the first scheme's colors as fallbacks. */
export function firstPaintStyle(options: FirstPaintOptions): string;
