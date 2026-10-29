/*
 * The MUI theme for each of the kit's looks, built from the tokens file (app-kit/look), so a web app picks its look as a
 * menu bar app does and keeps no copy of the colors. An app passes its look, in plain its accent, and any options of
 * its own; the kit builds the theme, since MUI computes the palette, the typography and the color schemes only from
 * createTheme's first argument and merges later ones raw, so a palette passed after would never get its light, dark
 * and contrast colors worked out.
 */
import { createTheme, type CssVarsTheme, type Theme, type ThemeOptions } from '@mui/material/styles';
import { CONSOLE, FONTS, PLAIN_SIZES, plainColors, type Accent, type Colors, type Look } from '../look';
import { rem } from './fields';

type Options = Record<string, unknown>;

/** `extra` merged into `base`, object into object; anything else in `extra` replaces what `base` has. */
function merge(base: Options, extra: Options): Options {
  const out: Options = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const under = out[key];
    out[key] = isPlainObject(under) && isPlainObject(value) ? merge(under, value) : value;
  }
  return out;
}

const isPlainObject = (value: unknown): value is Options =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;

/**
 * The look's MUI theme, with the app's own `options` merged into the kit's before MUI computes it, so an app's
 * components, breakpoints or a color of its own all take part. Pass it to ThemeProvider. Plain follows the system's
 * light or dark setting through CSS variables; console is dark only, as the console apps are. A text field's size on a
 * phone is still the app's to set: pass `{ components: fieldsNeverZoom }` as `options`.
 */
export function lookTheme(look?: Extract<Look, { name: 'plain' }>, options?: ThemeOptions): Theme & Pick<CssVarsTheme, 'colorSchemes'>;
export function lookTheme(look: Look, options?: ThemeOptions): Theme;
export function lookTheme(look: Look = { name: 'plain' }, options: ThemeOptions = {}): Theme {
  const kit = look.name === 'console' ? consoleOptions() : plainOptions(look.accent);
  return createTheme(merge(kit, options as Options) as ThemeOptions);
}

function palette(colors: Colors) {
  return {
    primary: { main: colors.info },
    secondary: { main: colors.secondary },
    success: { main: colors.ok },
    warning: { main: colors.warn },
    error: { main: colors.error },
    info: { main: colors.info },
    background: { default: colors.bg, paper: colors.surface },
    text: { primary: colors.text, secondary: colors.secondary, disabled: colors.muted },
    divider: colors.border,
    action: { hover: colors.hover },
  };
}

/** The plain look: the system typeface on the paper, no boxes or shadows, actions as words in the accent, and the kit's switch, menu and field. */
function plainOptions(accent?: Accent): Options {
  const { light, dark } = plainColors(accent);
  const size = PLAIN_SIZES;
  const line = `${size.line}px solid var(--mui-palette-divider)`;
  return {
    cssVariables: true,
    colorSchemes: { light: { palette: palette(light) }, dark: { palette: palette(dark) } },
    typography: {
      fontFamily: FONTS.plain,
      fontSize: size.body,
      body1: { fontSize: rem(size.body), lineHeight: size.lineHeight },
      body2: { fontSize: rem(size.small), lineHeight: size.lineHeight },
      h6: { fontSize: rem(size.titleWindow), fontWeight: size.strongWeight, lineHeight: 1.3 },
      subtitle1: { fontSize: rem(size.body), fontWeight: size.strongWeight, lineHeight: size.lineHeight },
      // A section's label.
      overline: {
        fontSize: rem(size.label),
        fontWeight: size.labelWeight,
        lineHeight: size.lineHeight,
        letterSpacing: 0,
        textTransform: 'none',
        color: 'var(--mui-palette-text-disabled)',
      },
      button: { fontSize: rem(size.body), fontWeight: size.strongWeight, textTransform: 'none', letterSpacing: 0 },
    },
    shape: { borderRadius: size.fieldCorner },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          // The paper reaches past the page's end, where a short page or an overscroll shows the root.
          html: { backgroundColor: 'var(--mui-palette-background-default)' },
          body: { scrollbarWidth: 'thin', scrollbarColor: 'var(--mui-palette-divider) transparent' },
        },
      },
      // No boxes or cards: a paper sits on the page's own paper.
      MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiCard: { styleOverrides: { root: { boxShadow: 'none', backgroundColor: 'transparent' } } },
      MuiAppBar: { defaultProps: { elevation: 0, color: 'inherit' }, styleOverrides: { root: { borderBottom: line } } },
      // An action is a word in the accent, a removal one in the error color, with nothing filled.
      MuiButton: {
        defaultProps: { variant: 'text', disableElevation: true, disableRipple: true },
        styleOverrides: {
          root: { minWidth: 0, padding: 0, flexShrink: 0, whiteSpace: 'nowrap', '&:hover': { backgroundColor: 'transparent', textDecoration: 'underline' } },
        },
      },
      MuiDivider: { styleOverrides: { root: { borderColor: 'var(--mui-palette-divider)' } } },
      // One row shape: at least a window's row height, a hairline below, no side padding of its own, and what goes on
      // the right (a status word, an action, a switch, a menu) as a child after the text, 12 from it, which a long
      // action needs: MUI's secondaryAction sits over the row and keeps only 48 pixels clear for it.
      MuiListItem: {
        styleOverrides: {
          root: {
            minHeight: size.rowWindow,
            gap: 12,
            paddingTop: size.rowPadding,
            paddingBottom: size.rowPadding,
            paddingLeft: 0,
            paddingRight: 0,
            borderBottom: line,
          },
        },
      },
      MuiListItemText: {
        styleOverrides: { root: { margin: 0 }, secondary: { fontSize: rem(size.small), marginTop: 2 } },
      },
      // The switch: 28 by 16, a muted outline and knob when off, the accent with a paper knob when on.
      MuiSwitch: {
        defaultProps: { disableRipple: true },
        styleOverrides: {
          root: { width: size.switchWidth, height: size.switchHeight, padding: 0, overflow: 'visible' },
          switchBase: {
            padding: (size.switchHeight - size.switchKnob) / 2,
            color: 'var(--mui-palette-text-disabled)',
            '&:hover': { backgroundColor: 'transparent' },
            '&.Mui-checked': {
              transform: `translateX(${size.switchWidth - size.switchHeight}px)`,
              color: 'var(--mui-palette-background-default)',
              '& + .MuiSwitch-track': { backgroundColor: 'var(--mui-palette-primary-main)', borderColor: 'var(--mui-palette-primary-main)', opacity: 1 },
            },
          },
          thumb: { width: size.switchKnob, height: size.switchKnob, boxShadow: 'none' },
          track: {
            boxSizing: 'border-box',
            borderRadius: size.switchHeight / 2,
            border: `${size.line}px solid var(--mui-palette-text-disabled)`,
            backgroundColor: 'transparent',
            opacity: 1,
          },
        },
      },
      // A text field in a hairline box, its corners 4.
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            fontSize: rem(size.small),
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--mui-palette-divider)' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--mui-palette-text-disabled)' },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--mui-palette-primary-main)', borderWidth: size.line },
          },
          input: { padding: `${size.fieldPaddingVertical}px ${size.fieldPaddingHorizontal}px` },
        },
      },
      // A menu that reads as text: <Select variant="standard">, its choice over a hairline.
      MuiInput: {
        styleOverrides: {
          underline: {
            '&::before': { borderBottom: line },
            '&:hover:not(.Mui-disabled, .Mui-error)::before': { borderBottom: `${size.line}px solid var(--mui-palette-text-disabled)` },
            '&::after': { borderBottomWidth: size.line },
          },
        },
      },
      MuiLink: { defaultProps: { underline: 'hover' } },
    },
  };
}

/** The console look: the four console apps' dark theme, JetBrains Mono at 13 on near-black. */
function consoleOptions(): Options {
  const colors = CONSOLE.dark;
  const mono = FONTS.console;
  return {
    palette: {
      mode: 'dark',
      primary: { main: colors.info },
      secondary: { main: colors.secondary },
      success: { main: colors.ok },
      warning: { main: colors.warn },
      error: { main: colors.error },
      background: { default: colors.bg, paper: colors.surface },
      text: { primary: colors.text, secondary: colors.secondary },
      divider: colors.border,
    },
    typography: {
      fontFamily: mono,
      fontSize: 13,
      body1: { fontSize: '0.875rem', lineHeight: 1.55 },
      body2: { fontSize: '0.8125rem', lineHeight: 1.5 },
      h3: { fontWeight: 700 },
      h4: { fontWeight: 600 },
      h5: { fontWeight: 600 },
      h6: { fontWeight: 600 },
      button: { textTransform: 'none' },
    },
    shape: { borderRadius: 3 },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { scrollbarWidth: 'thin', scrollbarColor: `${colors.border} ${colors.bg}` },
          a: { textDecoration: 'none' },
        },
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiAppBar: { styleOverrides: { root: { backgroundColor: colors.surface, borderBottom: `1px solid ${colors.border}` } } },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            backgroundColor: colors.surface,
            boxShadow: 'none',
            border: `1px solid ${colors.border}`,
            transition: 'border-color 0.15s ease',
            '&:hover': { borderColor: colors.borderHi },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { textTransform: 'none', fontWeight: 500, fontFamily: mono, fontSize: '0.8125rem' },
          contained: { boxShadow: 'none', '&:hover': { boxShadow: 'none' } },
          outlined: { borderColor: `${colors.info}50`, '&:hover': { borderColor: colors.info, backgroundColor: `${colors.info}15` } },
        },
      },
      MuiChip: { styleOverrides: { root: { fontWeight: 500, fontFamily: mono } } },
      MuiDialog: { styleOverrides: { paper: { backgroundColor: colors.surface, backgroundImage: 'none', border: `1px solid ${colors.border}` } } },
      MuiDivider: { styleOverrides: { root: { borderColor: colors.border } } },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            fontFamily: mono,
            fontSize: '0.75rem',
            borderRadius: 3,
            backgroundColor: colors.surfaceHi,
            border: `1px solid ${colors.border}`,
            color: colors.text,
          },
        },
      },
      MuiLinearProgress: { styleOverrides: { root: { backgroundColor: colors.border, borderRadius: 2 } } },
    },
  };
}
