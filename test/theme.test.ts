// The looks' MUI themes (web/theme.ts): built from the tokens file, with MUI's computed colors and typography taking
// the kit's values, which they would not were the palette passed after createTheme's first argument.
import { expect, test } from 'bun:test';
import { colorsOf, CONSOLE, DEFAULT_ACCENT, FONTS, plainColors, type Role } from '../look';
import { fieldsNeverZoom, FIELD_FONT_SIZE } from '../web/fields';
import { colorVariables, lookTheme } from '../web/theme';

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

test("the console theme takes the console look's colors in light and in dark, in JetBrains Mono", () => {
  const theme = lookTheme({ name: 'console' });
  for (const scheme of ['light', 'dark'] as const) {
    const palette = theme.colorSchemes[scheme]!.palette;
    const colors = CONSOLE[scheme];
    expect(palette.mode).toBe(scheme);
    expect(palette.background.default).toBe(colors.bg);
    expect(palette.background.paper).toBe(colors.surface);
    expect(palette.text.primary).toBe(colors.text);
    expect(palette.primary.main).toBe(colors.info);
    expect(palette.divider).toBe(colors.border);
  }
  // Light and dark follow the system through CSS variables, as the plain theme does.
  expect(theme.vars?.palette.background.default).toStartWith('var(--mui-palette-background-default');
  expect(theme.typography.body1).toMatchObject({ fontFamily: FONTS.console, fontSize: '0.875rem' });
  expect(theme.shape.borderRadius).toBe(3);
});

test("the console theme's outlined button tints the accent at 31% and 8%, the hex 50 and 15 it had", () => {
  const outlined = lookTheme({ name: 'console' }).components?.MuiButton?.styleOverrides?.outlined as Record<string, unknown>;
  expect(outlined.borderColor).toBe('rgba(var(--mui-palette-primary-mainChannel) / 0.31)');
  expect(outlined['&:hover']).toMatchObject({ backgroundColor: 'rgba(var(--mui-palette-primary-mainChannel) / 0.08)' });
  expect(Math.round((0x50 / 255) * 100)).toBe(31);
  expect(Math.round((0x15 / 255) * 100)).toBe(8);
});

for (const look of [{ name: 'plain' }, { name: 'console' }] as const) {
  test(`every role variable is one the ${look.name} theme writes, with the look's value in light and in dark`, () => {
    const theme = lookTheme(look);
    const { light, dark } = colorsOf(look);
    // MUI writes each scheme's variables into a rule of their own, dark's inside its media query.
    type Rules = { [selector: string]: Rules | string };
    const rules = (block: Rules): Record<string, string>[] => {
      const nested = Object.values(block).filter((value): value is Rules => typeof value === 'object');
      return [block as Record<string, string>, ...nested.flatMap(rules)];
    };
    const declared = (theme.generateStyleSheets() as Rules[]).flatMap(rules);
    const lightVars = declared.find((vars) => vars['--mui-palette-background-default'] === light.bg)!;
    const darkVars = declared.find((vars) => vars['--mui-palette-background-default'] === dark.bg)!;
    expect(Object.keys(colorVariables).sort()).toEqual(Object.keys(light).sort());
    for (const [role, variable] of Object.entries(colorVariables) as [Role, string][]) {
      const name = variable.slice('var('.length, -1);
      expect([role, lightVars[name]]).toEqual([role, light[role]]);
      expect([role, darkVars[name]]).toEqual([role, dark[role]]);
    }
  });
}
