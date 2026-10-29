/*
 * The menu bar theme's Swift package keeps its own copy of the looks' values (swift/menu-bar's Tokens.swift and
 * Look.swift), since Swift's package manager reaches no file outside the package. This reads the copies out of the Swift
 * sources and holds each to the tokens file (look/index.ts), the one owner, so a color or size changed on one side only
 * fails here rather than drawing two looks.
 */
import { expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CONSOLE, CONSOLE_SIZES, DEFAULT_ACCENT, PLAIN_SIZES, plainColors, type Colors, type Role } from '../look';

const theme = join(import.meta.dir, '../swift/menu-bar/Sources/MenuBarTheme');
const tokens = readFileSync(join(theme, 'Tokens.swift'), 'utf8');
const look = readFileSync(join(theme, 'Look.swift'), 'utf8');

const hex = (swift: string) => `#${swift.replace(/^0x/, '').padStart(6, '0')}`;
/** The text between `start` and the next line that closes a block at `indent`. */
function block(source: string, start: string, indent = '    '): string {
  const at = source.indexOf(start);
  expect(at, `${start} in the Swift source`).toBeGreaterThan(-1);
  const end = source.indexOf(`\n${indent}}`, at);
  return source.slice(at, end);
}

test("the console look's colors in Swift are the tokens file's, dark and light", () => {
  const palette = block(tokens, 'public enum Palette', '');
  const dark = Object.fromEntries([...palette.matchAll(/^ {4}case (\w+) = (0x[0-9a-f]+)$/gm)].map((m) => [m[1], hex(m[2]!)]));
  expect(dark).toEqual(CONSOLE.dark);
  const lightBlock = block(tokens, 'public var light: UInt32 {');
  const light = Object.fromEntries([...lightBlock.matchAll(/case \.(\w+): (0x[0-9a-f]+)/g)].map((m) => [m[1], hex(m[2]!)]));
  expect(light).toEqual(CONSOLE.light);
});

test("the plain look's colors in Swift are the tokens file's, with the accent as info", () => {
  const plain = block(tokens, 'public func plain(accent: Accent)');
  const light: Partial<Colors> = {};
  const dark: Partial<Colors> = {};
  for (const [, cases, pair] of plain.matchAll(/case ([.\w, ]+): \(([^)]*)\)/g)) {
    const [l, d] = pair!.split(',').map((value) => value.trim());
    for (const role of cases!.split(',').map((name) => name.trim().replace(/^\./, '')) as Role[]) {
      light[role] = l === 'accent.light' ? 'accent' : hex(l!);
      dark[role] = d === 'accent.dark' ? 'accent' : hex(d!);
    }
  }
  const expected = plainColors({ light: 'accent', dark: 'accent' });
  expect(light).toEqual(expected.light);
  expect(dark).toEqual(expected.dark);
});

test("the default accent in Swift is the tokens file's", () => {
  const [, l, d] = look.match(/static let `default` = Accent\(light: (0x[0-9a-f]+), dark: (0x[0-9a-f]+)\)/) ?? [];
  expect({ light: hex(l ?? ''), dark: hex(d ?? '') }).toEqual(DEFAULT_ACCENT);
});

test("the plain look's sizes in Swift are the tokens file's, name for name", () => {
  const metrics = block(tokens, 'public enum PlainMetrics', '');
  const weights: Record<string, number> = { regular: 400, medium: 500, semibold: 600, bold: 700 };
  const swift = Object.fromEntries(
    [...metrics.matchAll(/static let (\w+): (?:CGFloat = ([\d.]+)|NSFont\.Weight = \.(\w+))/g)].map((m) => [m[1], m[2] ? Number(m[2]) : weights[m[3]!]]),
  );
  expect(swift).toEqual({ ...PLAIN_SIZES });
  // The panel's side padding in the plain look is a popup's.
  expect(look).toMatch(new RegExp(`case \\.plain: ${PLAIN_SIZES.sidePopup}\\b`));
});

test("the console look's panel sizes in Swift are the tokens file's", () => {
  // The web apps' body1 and body2 sizes have no Swift copy.
  const { webBody, webSmall, ...panel } = CONSOLE_SIZES;
  expect([webBody, webSmall]).toEqual([14, 13]);
  const metrics = block(tokens, 'public enum Metrics', '');
  const value = (name: string) => Number(metrics.match(new RegExp(`static let ${name}: CGFloat = ([\\d.]+)`))?.[1]);
  expect({
    body: value('body'),
    small: value('small'),
    note: value('note'),
    row: value('row'),
    header: value('header'),
    footer: value('footer'),
    side: Number(look.match(/case \.console: (\d+)/)?.[1]),
    corner: value('cornerInside'),
  }).toEqual(panel);
});
