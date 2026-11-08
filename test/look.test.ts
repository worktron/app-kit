// The plain look's colors from an app's choices (look/index.ts): the lines worked out from the paper, and colors whose
// text would read poorly refused, in the words the Swift copy uses too (swift/menu-bar's LookTests holds the same values).
import { expect, test } from 'bun:test';
import { contrast, DEFAULT_ACCENT, DEFAULT_BACKGROUND, mix, PLAIN_LINE_MIX, plainColors, READABLE, unreadable } from '../look';

/** The Plain Panel Studies page's Slate: a cool grey paper and highlight, light and dark. */
const slate = { paper: { light: '#f7f8fa', dark: '#1b1d21' }, highlight: { light: '#e1e5ec', dark: '#2f3540' } };

test("the kit's own colors read at 4.5 to 1 or better, and its lines are its paper moved toward its text", () => {
  const { light, dark } = plainColors();
  expect(unreadable(light)).toEqual([]);
  expect(unreadable(dark)).toEqual([]);
  expect(light.bg).toBe(DEFAULT_BACKGROUND.paper.light);
  expect(dark.hover).toBe(DEFAULT_BACKGROUND.highlight.dark);
  expect(light.info).toBe(DEFAULT_ACCENT.light);
  expect(light.border).toBe(mix(light.bg, light.text, PLAIN_LINE_MIX.border));
  // A few steps from the hand-picked values they replace (#e2e0da, #323438).
  expect([light.border, dark.border]).toEqual(['#e0dfdd', '#333435']);
});

test("an app's paper and highlight are its panel's, and its lines follow its paper", () => {
  const { light, dark } = plainColors({ background: slate });
  expect([light.bg, light.surface, light.hover]).toEqual(['#f7f8fa', '#f7f8fa', '#e1e5ec']);
  expect([dark.bg, dark.hover]).toEqual(['#1b1d21', '#2f3540']);
  // The same values the Swift copy works out (LookTests, aPaperGivesItsLinesByTheTokensFilesRule).
  expect([light.border, dark.border, light.surfaceHi, dark.borderHi]).toEqual(['#e0e2e4', '#313336', '#eff0f2', '#3e3f41']);
});

test('colors whose text reads under 4.5 to 1 on the paper or the highlight are refused, naming each', () => {
  const dim = { paper: slate.paper, highlight: { light: '#9a9a9a', dark: '#2f3540' } };
  expect(() => plainColors({ background: dim })).toThrow('light: secondary #5c5f65 reads 2.28 to 1 on the highlight #9a9a9a');
  expect(() => plainColors({ accent: { light: '#c0187a', dark: '#f08ac8' } })).toThrow(
    "The plain look's colors must read at 4.5 to 1 or better: light: info #c0187a reads 4.23 to 1 on the highlight #dfddd6",
  );
  // Muted, the faint ages, counts and keys, is faint on purpose and never held to it.
  expect(contrast(plainColors().light.muted, DEFAULT_BACKGROUND.paper.light)).toBeLessThan(READABLE);
});

test("mix moves each channel the fraction of the way and rounds it; contrast is WCAG's", () => {
  expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  expect(mix('#f6f5f2', '#2a2c30', 0)).toBe('#f6f5f2');
  expect(contrast('#000000', '#ffffff')).toBe(21);
  expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
});
