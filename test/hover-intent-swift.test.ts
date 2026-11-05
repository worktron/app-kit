/*
 * The menu bar theme's Swift package keeps its own copy of the hover intent's numbers (swift/menu-bar's
 * PointerIntent.swift), since Swift's package manager reaches no file outside the package. This reads them out of the
 * Swift source and holds them to web/hover-intent.ts, the one owner, so the pointer never answers a hand one way on
 * the web and another in a menu bar panel.
 */
import { expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { HOLD_PX, LIST_WAIT_MS, TRAVEL_PX } from '../web/hover-intent.ts';

const swift = readFileSync(join(import.meta.dir, '../swift/menu-bar/Sources/MenuBarTheme/PointerIntent.swift'), 'utf8');
const constant = (name: string) => {
  const found = swift.match(new RegExp(`static let ${name}: \\w+ = ([0-9.]+)`));
  expect(found, `PointerIntent.${name} in the Swift source`).not.toBeNull();
  return Number(found![1]);
};

test("the Swift pointer intent's travel, hold and wait are the web's", () => {
  expect(constant('travel')).toBe(TRAVEL_PX);
  expect(constant('hold')).toBe(HOLD_PX);
  expect(constant('wait') * 1000).toBe(LIST_WAIT_MS);
});
