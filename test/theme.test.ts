// The looks' MUI themes (web/theme.ts): built from the tokens file, with MUI's computed colors and typography taking
// the kit's values, which they would not were the palette passed after createTheme's first argument.
import { expect, test } from 'bun:test';
import { CONSOLE, DEFAULT_ACCENT, FONTS, plainColors } from '../look';
import { fieldsNeverZoom, FIELD_FONT_SIZE } from '../web/fields';
import { lookTheme } from '../web/theme';

test('the plain theme computes its palette from the tokens, light and dark, with the accent as primary', () => {
  const theme = lookTheme();
  const { light, dark } = plainColors();
  const lightPalette = theme.colorSchemes.light!.palette;
  const darkPalette = theme.colorSchemes.dark!.palette;
  expect(lightPalette.primary.main).toBe(DEFAULT_ACCENT.light);
  expect(lightPalette.background.default).toBe(light.bg);
  expect(lightPalette.text.primary).toBe(light.text);
  expect(lightPalette.divider).toBe(light.border);
  expect(darkPalette.primary.main).toBe(DEFAULT_ACCENT.dark);
  expect(darkPalette.background.default).toBe(dark.bg);
  expect(darkPalette.text.secondary).toBe(dark.secondary);
  expect(darkPalette.error.main).toBe(dark.error);
  // Worked out by MUI from the accent: white on the light blue, dark on the pale one.
  expect(lightPalette.primary.contrastText).toBe('#fff');
  expect(darkPalette.primary.contrastText).toBe('rgba(0, 0, 0, 0.87)');
  // Light and dark follow the system through CSS variables.
  expect(theme.vars?.palette.primary.main).toStartWith('var(--mui-palette-primary-main');
});

test("an app's accent is the plain theme's primary and info, light and dark", () => {
  const accent = { light: '#7a2fa7', dark: '#d29be6' };
  const theme = lookTheme({ name: 'plain', accent });
  expect(theme.colorSchemes.light!.palette.primary.main).toBe(accent.light);
  expect(theme.colorSchemes.light!.palette.info.main).toBe(accent.light);
  expect(theme.colorSchemes.dark!.palette.primary.main).toBe(accent.dark);
});

test('the plain theme draws in the system typeface at 13, and its section label is 12 at 600 without capitals', () => {
  const theme = lookTheme();
  expect(theme.typography.body1.fontFamily).toBe(FONTS.plain);
  expect(theme.typography.body1.fontSize).toBe('0.8125rem');
  expect(theme.typography.overline).toMatchObject({ fontSize: '0.75rem', fontWeight: 600, textTransform: 'none' });
  expect(theme.typography.h6).toMatchObject({ fontSize: '1.0625rem', fontWeight: 600 });
});

test("the app's own options merge into the kit's before MUI computes the theme", () => {
  const theme = lookTheme(
    { name: 'plain' },
    { components: { ...fieldsNeverZoom, MuiButton: { styleOverrides: { root: { letterSpacing: '0.01em' } } } }, spacing: 4 },
  );
  expect(theme.components?.MuiInputBase?.styleOverrides?.root).toEqual({ fontSize: FIELD_FONT_SIZE });
  // The app's button setting joins the kit's, rather than replacing it.
  expect(theme.components?.MuiButton?.styleOverrides?.root).toMatchObject({ letterSpacing: '0.01em', padding: 0 });
  expect(theme.components?.MuiButton?.defaultProps).toMatchObject({ variant: 'text', disableRipple: true });
  expect(theme.spacing(2)).toBe('calc(2 * var(--mui-spacing, 4px))');
  expect(theme.colorSchemes.light!.palette.primary.main).toBe(DEFAULT_ACCENT.light);
});

test("the console theme is the console apps' dark theme in JetBrains Mono", () => {
  const theme = lookTheme({ name: 'console' });
  expect(theme.palette.mode).toBe('dark');
  expect(theme.palette.background.default).toBe(CONSOLE.dark.bg);
  expect(theme.palette.background.paper).toBe(CONSOLE.dark.surface);
  expect(theme.palette.text.primary).toBe(CONSOLE.dark.text);
  expect(theme.palette.primary.main).toBe(CONSOLE.dark.info);
  expect(theme.palette.divider).toBe(CONSOLE.dark.border);
  expect(theme.typography.body1).toMatchObject({ fontFamily: FONTS.console, fontSize: '0.875rem' });
  expect(theme.shape.borderRadius).toBe(3);
});
