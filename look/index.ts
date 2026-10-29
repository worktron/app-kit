// The kit's two looks, the only owner of their values: every web theme, extension stylesheet and Swift view takes its
// colors and sizes from here, and test/look-swift.test.ts holds the Swift package's copy equal to this file.
//
// Plain is the system typeface on warm paper with the app's one accent, for people who never open a terminal, from the
// Plain Look Studies page's option C. Console is JetBrains Mono on near-black, the console family's colors, for the
// agent tools. An app picks one look, and in plain sets its accent; nothing else is the app's to set.

/** What each color says. Each one means one thing, in both looks. */
export type Role =
  | 'text'
  | 'secondary'
  | 'muted'
  | 'ok'
  | 'warn'
  | 'error'
  | 'info'
  | 'bg'
  | 'surface'
  | 'surfaceHi'
  | 'border'
  | 'borderHi'
  /** The selected line's fill: the line the arrow keys or the pointer are on. */
  | 'hover';

/** A color for every role, as #rrggbb. */
export type Colors = Record<Role, string>;

/** The plain look's one color, in light and in dark: actions, links, and the info tone. */
export type Accent = { light: string; dark: string };

/** The blue the Plain Look Studies page draws in, Beeline's. */
export const DEFAULT_ACCENT: Accent = { light: '#2f5fa7', dark: '#8fb0e6' };

export type Look = { name: 'plain'; accent?: Accent } | { name: 'console' };

/** The console look's colors. Its web apps draw only in dark; the menu bar panel follows the Mac's setting. */
export const CONSOLE: { light: Colors; dark: Colors } = {
  dark: {
    text: '#d4d4d4',
    secondary: '#888888',
    muted: '#555555',
    ok: '#89d185',
    warn: '#e2c08d',
    error: '#f48771',
    info: '#6cb6ff',
    bg: '#050505',
    surface: '#0e0e0e',
    surfaceHi: '#141414',
    border: '#1c1c1c',
    borderHi: '#282828',
    hover: '#222222',
  },
  // Neutral greys, with every tone but muted reading at least 4.5 to 1 on the panel, a code box and a selected line.
  light: {
    text: '#1f1f1f',
    secondary: '#5e5e5e',
    muted: '#9e9e9e',
    ok: '#276f2b',
    warn: '#825400',
    error: '#b72f1c',
    info: '#0a5cb8',
    bg: '#fbfbfb',
    surface: '#f0f0f0',
    surfaceHi: '#e8e8e8',
    border: '#e6e6e6',
    borderHi: '#d0d0d0',
    hover: '#e5e5e5',
  },
};

/**
 * The plain look's colors with `accent` as info: Beeline's paper and graphites, with no boxes, so bg and surface are the
 * same paper. Every tone but muted reads at least 4.5 to 1 on the paper and on a selected line, in light and in dark,
 * for which ok in light is a shade darker than the Studies page's #2e7d4f.
 */
export function plainColors(accent: Accent = DEFAULT_ACCENT): { light: Colors; dark: Colors } {
  return {
    light: {
      text: '#2a2c30',
      secondary: '#5c5f65',
      muted: '#8e9197',
      ok: '#2a774b',
      warn: '#9a5b00',
      error: '#b3261e',
      info: accent.light,
      bg: '#f6f5f2',
      surface: '#f6f5f2',
      surfaceHi: '#efeee9',
      border: '#e2e0da',
      borderHi: '#d3d1ca',
      hover: '#ecebe6',
    },
    dark: {
      text: '#e6e4df',
      secondary: '#a3a6ab',
      muted: '#74777d',
      ok: '#7cc49a',
      warn: '#e0b46a',
      error: '#f2a39c',
      info: accent.dark,
      bg: '#1d1e20',
      surface: '#1d1e20',
      surfaceHi: '#242628',
      border: '#323438',
      borderHi: '#3c3e42',
      hover: '#2a2c2f',
    },
  };
}

/** A look's colors, light and dark. */
export function colorsOf(look: Look): { light: Colors; dark: Colors } {
  return look.name === 'console' ? CONSOLE : plainColors(look.accent);
}

/** The typeface each look draws text in, as a CSS font-family; plain's `code` is for a command to copy. */
export const FONTS = {
  plain: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif',
  code: 'ui-monospace, "SF Mono", Menlo, monospace',
  console: '"JetBrains Mono", "SF Mono", "Cascadia Code", "Fira Code", Menlo, monospace',
} as const;

/**
 * The plain look's sizes, in pixels on the web and points on the Mac, on a 4 pixel grid. A popup is an extension's
 * toolbar page or a menu bar panel; a window is a Mac window or a web page.
 */
export const PLAIN_SIZES = {
  /** A page's title: 17 in a window, 15 in a popup. */
  titleWindow: 17,
  titlePopup: 15,
  body: 13,
  /** A row's detail, a status word, a foot note and the build line. */
  small: 12,
  /** A section's label, in muted. */
  label: 12,
  labelWeight: 600,
  /** Weight of a row's name and an action word. */
  strongWeight: 600,
  lineHeight: 1.4,
  /** Left and right padding: 20 in a popup, 24 in a window. */
  sidePopup: 20,
  sideWindow: 24,
  /** Room above a section's label, and from the label to what it labels. */
  sectionGap: 24,
  labelGap: 8,
  /** A row's least height: 44 in a popup, 48 in a window, with 10 above and below its text. */
  rowPopup: 44,
  rowWindow: 48,
  rowPadding: 10,
  /** The hairline between rows. */
  line: 1,
  /** A text field's corners and its padding inside. */
  fieldCorner: 4,
  fieldPaddingVertical: 6,
  fieldPaddingHorizontal: 10,
  /** The switch: 28 by 16, its knob 10 across. */
  switchWidth: 28,
  switchHeight: 16,
  switchKnob: 10,
} as const;

/** The console look's sizes, the menu bar panel's and the console web apps'. */
export const CONSOLE_SIZES = {
  body: 13,
  small: 12,
  note: 11,
  row: 44,
  header: 40,
  footer: 36,
  side: 14,
  corner: 3,
} as const;
