// The wallpaper and widget services a shut-down iPhone Simulator boots without: the file its launch manager reads,
// merged with what iOS wrote there, and the read-back of what a booted one holds off, against a stand-in for plutil.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { Run } from '../tauri/iphone-simulator/index.ts';
import { NEVER_SWITCHED_OFF, SWITCHED_OFF, servicesFile, servicesOff, switchOff, switchOffServices } from '../tauri/iphone-simulator/services.ts';

const UDID = '00000000-0000-0000-0000-000000000002';
let root: string;
let commands: string[];

/** plutil over the test's own folder: the file is kept as JSON, which the conversion to XML leaves as it is. */
const plutil: Run = (command) => {
  commands.push(command.join(' '));
  const [, a, b] = command;
  const file = command.at(-1)!;
  if (a === '-convert' && b === 'json') {
    try {
      JSON.parse(readFileSync(file, 'utf8'));
      return { ok: true, out: readFileSync(file, 'utf8') };
    } catch {
      return { ok: false, out: `${file}: Property List error: Unexpected character` };
    }
  }
  if (a === '-convert' && b === 'xml1') return { ok: true, out: '' };
  return { ok: false, out: `unexpected: ${command.join(' ')}` };
};

const read = () => JSON.parse(readFileSync(servicesFile(UDID, root), 'utf8')) as Record<string, boolean>;

beforeEach(() => {
  const cache = join(import.meta.dir, '../node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  root = mkdtempSync(join(cache, 'iphone-simulator-services-'));
  commands = [];
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('the list', () => {
  test('holds no service simslim found wedges a Simulator or that a check needs', () => {
    expect(SWITCHED_OFF.filter((label) => NEVER_SWITCHED_OFF.includes(label))).toEqual([]);
  });

  test("keeps iOS's own entries and switches the kit's off, even one iOS had on", () => {
    expect(switchOff({ 'com.apple.pairedsyncd': false, 'com.apple.chronod': false })).toEqual({
      'com.apple.pairedsyncd': false,
      'com.apple.chronod': true,
      'com.apple.PosterBoard': true,
      'com.apple.liveactivitiesd': true,
      'com.apple.navd': true,
    });
  });
});

describe('switchOffServices', () => {
  test('a Simulator never booted gets the folder and the file, written whole', () => {
    expect(switchOffServices(UDID, plutil, root)).toBe('wallpaper and widgets switched off for its boot');
    expect(read()).toEqual(Object.fromEntries(SWITCHED_OFF.map((label) => [label, true])));
    expect(existsSync(`${servicesFile(UDID, root)}.app-kit`)).toBe(false);
  });

  test("an erased one keeps the entries iOS wrote", () => {
    mkdirSync(dirname(servicesFile(UDID, root)), { recursive: true });
    writeFileSync(servicesFile(UDID, root), JSON.stringify({ 'com.apple.pairedsyncd': false, 'com.apple.nanonewscd': false }));
    switchOffServices(UDID, plutil, root);
    expect(read()).toMatchObject({ 'com.apple.pairedsyncd': false, 'com.apple.nanonewscd': false, 'com.apple.PosterBoard': true });
  });

  test('one already switched off is not written again', () => {
    switchOffServices(UDID, plutil, root);
    commands = [];
    expect(switchOffServices(UDID, plutil, root)).toBe('wallpaper and widgets stay switched off for its boot');
    expect(commands.filter((c) => c.includes('xml1'))).toEqual([]);
  });

  test('a file plutil cannot read is left as it was, and the boot goes ahead with them on', () => {
    mkdirSync(dirname(servicesFile(UDID, root)), { recursive: true });
    writeFileSync(servicesFile(UDID, root), 'not a plist');
    expect(switchOffServices(UDID, plutil, root)).toBe(`could not read ${servicesFile(UDID, root)}, so wallpaper and widgets run at its boot as usual`);
    expect(readFileSync(servicesFile(UDID, root), 'utf8')).toBe('not a plist');
  });

  test('a failed conversion leaves no half-written file behind', () => {
    const refuse: Run = (command) => (command.includes('xml1') ? { ok: false, out: 'Permission denied' } : plutil(command));
    expect(switchOffServices(UDID, refuse, root)).toBe(`could not write ${servicesFile(UDID, root)}, so wallpaper and widgets run at its boot as usual`);
    expect(existsSync(servicesFile(UDID, root))).toBe(false);
    expect(existsSync(`${servicesFile(UDID, root)}.app-kit`)).toBe(false);
  });
});

describe('servicesOff', () => {
  test("reads the kit's services out of a booted Simulator's listing", () => {
    const listing = readFileSync(join(import.meta.dir, 'fixtures/iphone-simulator/print-disabled.txt'), 'utf8');
    expect(servicesOff(listing)).toEqual(SWITCHED_OFF);
    expect(servicesOff('disabled services = {\n}\n')).toEqual([]);
  });
});
