// The kit's two looks, the only owner of their values: every web theme, extension stylesheet and Swift view takes its
// colors and sizes from here, and test/look-swift.test.ts holds the Swift package's copy equal to this file.
//
// Plain is the system typeface on warm paper with the app's one accent, for people who never open a terminal, from the
// Plain Look Studies page's option C. Console is JetBrains Mono on near-black, the console family's colors, for the
// agent tools. An app picks one look, and in plain may set its accent, and its paper with its highlight; the text tones
// stay the kit's, and the kit refuses an app's colors when any of them reads under 4.5 to 1 (`unreadable`).

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

/** A color in light and in dark, as #rrggbb. */
export type LightDark = { light: string; dark: string };

/** The plain look's accent, in light and in dark: actions, links, and the info tone. */
export type Accent = LightDark;

/** The blue the Plain Look Studies page draws in, Beeline's. */
export const DEFAULT_ACCENT: Accent = { light: '#2f5fa7', dark: '#8fb0e6' };

/**
 * The plain look's paper, the ground of every panel, window and page, and its highlight, the selected line's fill, set
 * together, since the highlight is what has to read on that paper. The lines are worked out from the paper.
 */
export type Background = { paper: LightDark; highlight: LightDark };

/**
 * Beeline's paper and graphites from the Plain Look Studies page's option C, and the Beeline Menu Studies page's darker
 * selected line, #dfddd6 and #36383c, since #ecebe6 measured 1.09 to 1 on the paper.
 */
export const DEFAULT_BACKGROUND: Background = {
  paper: { light: '#f6f5f2', dark: '#1d1e20' },
  highlight: { light: '#dfddd6', dark: '#36383c' },
};

/** What an app may choose in the plain look: its accent, and its paper with its highlight. */
export type PlainChoices = { accent?: Accent; background?: Background };

export type Look = ({ name: 'plain' } & PlainChoices) | { name: 'console' };

/** The console look's colors, light and dark, by the system's setting on the web and the Mac's in the menu bar panel. */
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
 * How far the plain look's raised surface and its lines sit from the paper toward the text, so they follow an app's own
 * paper: fitted to the Plain Look Studies page's values on the kit's paper, light and dark.
 */
export const PLAIN_LINE_MIX = { surfaceHi: 0.04, border: 0.11, borderHi: 0.17 } as const;

/** `from` moved `fraction` of the way to `to`, channel by channel, each rounded to the nearest whole value. */
export function mix(from: string, to: string, fraction: number): string {
  const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16);
  return `#${[1, 3, 5]
    .map((at) => Math.round(channel(from, at) + (channel(to, at) - channel(from, at)) * fraction).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** The WCAG contrast of two #rrggbb colors, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5]
      .map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

/** The least contrast every text tone but muted keeps on the paper and on the selected line: WCAG's AA for small text. */
export const READABLE = 4.5;

/** The tones that must read on the paper and the selected line; muted, the faint ages, counts and keys, is faint on purpose. */
const READ_TONES = ['text', 'secondary', 'ok', 'warn', 'error', 'info'] as const;

/** Each text tone in `colors` that reads under `READABLE` on its paper or its selected line, said in words. */
export function unreadable(colors: Colors): string[] {
  const grounds = [['paper', colors.bg], ['highlight', colors.hover]] as const;
  return READ_TONES.flatMap((tone) =>
    grounds
      .map(([name, ground]) => ({ name, ground, ratio: contrast(colors[tone], ground) }))
      .filter(({ ratio }) => ratio < READABLE)
      .map(({ name, ground, ratio }) => `${tone} ${colors[tone]} reads ${ratio.toFixed(2)} to 1 on the ${name} ${ground}`),
  );
}

/**
 * The plain look's colors from an app's choices: the kit's text tones, its paper and highlight unless the app gives its
 * own, and the accent as info. Every tone but muted reads at least 4.5 to 1 on the kit's paper and highlight, in light and
 * in dark, for which ok and warn in light are a shade darker than the Studies page's #2e7d4f and #9a5b00; an app's own
 * accent or background that leaves a tone under it is refused with an error naming each one.
 */
export function plainColors({ accent = DEFAULT_ACCENT, background = DEFAULT_BACKGROUND }: PlainChoices = {}): { light: Colors; dark: Colors } {
  const scheme = (mode: 'light' | 'dark', tones: Pick<Colors, 'text' | 'secondary' | 'muted' | 'ok' | 'warn' | 'error'>): Colors => {
    const paper = background.paper[mode];
    return {
      ...tones,
      info: accent[mode],
      bg: paper,
      surface: paper,
      surfaceHi: mix(paper, tones.text, PLAIN_LINE_MIX.surfaceHi),
      border: mix(paper, tones.text, PLAIN_LINE_MIX.border),
      borderHi: mix(paper, tones.text, PLAIN_LINE_MIX.borderHi),
      hover: background.highlight[mode],
    };
  };
  const colors = {
    light: scheme('light', { text: '#2a2c30', secondary: '#5c5f65', muted: '#8e9197', ok: '#276d45', warn: '#8d5300', error: '#b3261e' }),
    dark: scheme('dark', { text: '#e6e4df', secondary: '#a3a6ab', muted: '#74777d', ok: '#7cc49a', warn: '#e0b46a', error: '#f2a39c' }),
  };
  const failing = [...unreadable(colors.light).map((line) => `light: ${line}`), ...unreadable(colors.dark).map((line) => `dark: ${line}`)];
  if (failing.length) throw new Error(`The plain look's colors must read at ${READABLE} to 1 or better: ${failing.join('; ')}`);
  return colors;
}

/** A look's colors, light and dark. */
export function colorsOf(look: Look): { light: Colors; dark: Colors } {
  return look.name === 'console' ? CONSOLE : plainColors(look);
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
  /** A section's label: in secondary in the menu bar theme's panel and windows, in muted on the web and in an extension. */
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
  /** A compact row in a menu bar panel: 30 high with no hairline, its selected fill 6 in from the panel's sides. */
  rowCompact: 30,
  fillInset: 6,
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

/** The console look's sizes: the menu bar panel's, and the console web apps' MUI body1 and body2. */
export const CONSOLE_SIZES = {
  body: 13,
  webBody: 14,
  webSmall: 13,
  small: 12,
  note: 11,
  row: 44,
  header: 40,
  footer: 36,
  side: 14,
  corner: 3,
} as const;
