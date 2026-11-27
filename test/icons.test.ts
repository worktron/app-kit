// `app-kit icons render`: every icon an app ships, drawn from the fixture drawings into the folders an app keeps them in,
// with the real sharp and iconutil, and checked by their pixels; the refusals, which write nothing; and the icon sets
// compiled by Xcode's asset compiler, as an app's build compiles them.
import { describe, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import { loadSharp, renderIcons } from '../icons/render.ts';
import { runCommand } from '../command-line/run.ts';

const FIXTURES = join(import.meta.dir, 'fixtures/icons');
/** The tile's colour in the fixture's app-icon.svg. */
const GROUND = [0xf6, 0xf5, 0xf2];
const TOOLBAR = '#1f1f1f';

/** A fresh app checkout: the drawings, and the folders an app keeps its icons in, with the icon sets' Contents.json. */
function app() {
  const root = mkdtempSync(join(tmpdir(), 'icons-'));
  cpSync(join(FIXTURES, 'drawings'), join(root, 'design/icon'), { recursive: true });
  const catalog = join(root, 'Assets.xcassets');
  const sets = { mac: join(catalog, 'AppIcon.appiconset'), iphone: join(root, 'phone/Assets.xcassets/AppIcon.appiconset'), xcode: join(root, 'xcode/Assets.xcassets/AppIcon.appiconset') };
  for (const [name, set] of Object.entries(sets)) {
    mkdirSync(set, { recursive: true });
    cpSync(join(FIXTURES, `sets/${name}.json`), join(set, 'Contents.json'));
    writeFileSync(join(set, '../Contents.json'), '{ "info" : { "author" : "xcode", "version" : 1 } }\n');
  }
  mkdirSync(join(root, 'src-tauri'));
  cpSync(join(FIXTURES, 'tauri.conf.json'), join(root, 'src-tauri/tauri.conf.json'));
  const printed: string[] = [];
  const options = {
    drawings: join(root, 'design/icon'),
    iconSets: Object.values(sets),
    tauri: join(root, 'src-tauri'),
    menuBar: join(catalog, 'MenuBarIcon.imageset'),
    extension: join(root, 'extension/icons'),
    toolbarColor: TOOLBAR,
    web: join(root, 'public'),
    print: (line: string) => printed.push(line),
  };
  return { root, sets, options, printed };
}

const pixels = async (file: string) => {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x + 1) * info.channels)];
  return { width: info.width, height: info.height, channels: info.channels, at, data };
};

/** Every file below `folder`, with its bytes. */
const snapshot = (folder: string): Record<string, string> =>
  Object.fromEntries(
    (readdirSync(folder, { recursive: true }) as string[])
      .filter((name) => statSync(join(folder, name)).isFile())
      .map((name) => [name, readFileSync(join(folder, name)).toString('base64')]),
  );

describe('icons render', () => {
  test('draws every icon an app ships from its drawings, and the same bytes again on a second run', async () => {
    const { root, sets, options, printed } = app();
    expect((await renderIcons(options)).length).toBe(10 + 18 + 3 + 6 + 2 + 6 + 4);

    // The Mac's: the app icon as drawn, its margins see-through and its tile solid.
    const mac = JSON.parse(readFileSync(join(sets.mac, 'Contents.json'), 'utf8')).images as { filename: string; size: string; scale: string }[];
    for (const entry of mac) {
      const icon = await pixels(join(sets.mac, entry.filename));
      const side = Number(entry.size.split('x')[0]) * Number(entry.scale[0]);
      expect([entry.filename, icon.width, icon.height]).toEqual([entry.filename, side, side]);
      expect(icon.at(0, 0)[3]).toBe(0);
      // Between the tile's edge (100 of 1024) and the mark (187): a whole pixel there from 64 up.
      if (side >= 64) expect(icon.at(Math.floor(side * 0.14), Math.floor(side / 2))).toEqual([...GROUND, 255]);
    }

    // The iPhone's: Tauri's eighteen, each the tile filling the square with no alpha channel, as the App Store takes it.
    const iphone = JSON.parse(readFileSync(join(sets.iphone, 'Contents.json'), 'utf8')).images as { filename: string; size: string; scale: string }[];
    expect(iphone).toHaveLength(18);
    for (const entry of iphone) {
      const icon = await pixels(join(sets.iphone, entry.filename));
      const side = Number(entry.size.split('x')[0]) * Number(entry.scale[0]);
      expect([entry.filename, icon.width, icon.channels]).toEqual([entry.filename, side, 3]);
      expect(icon.at(0, 0)).toEqual(GROUND);
    }

    // A set from Xcode's template: the iPhone's one size and the Mac's, each from its own drawing; dark and tinted left to the system.
    expect((await pixels(join(sets.xcode, 'AppIcon-iOS.png'))).channels).toBe(3);
    expect((await pixels(join(sets.xcode, 'AppIcon-iOS.png'))).width).toBe(1024);
    expect((await pixels(join(sets.xcode, 'AppIcon-mac-32@2x.png'))).at(0, 0)[3]).toBe(0);
    expect(printed.filter((line) => line.startsWith('skipped universal 1024x1024'))).toHaveLength(2);

    // Tauri's: the files its config lists, the .icns holding the Mac sizes and the .ico Windows'; Liquid Glass icons skipped.
    for (const [name, side] of [['32x32.png', 32], ['128x128.png', 128], ['128x128@2x.png', 256], ['icon.png', 512]] as const) {
      expect((await pixels(join(root, 'src-tauri/icons', name))).width).toBe(side);
    }
    const icns = readFileSync(join(root, 'src-tauri/icons/icon.icns'));
    expect(icns.subarray(0, 4).toString()).toBe('icns');
    for (const type of ['ic07', 'ic08', 'ic09', 'ic10']) expect(icns.includes(type)).toBe(true);
    // Windows': icon.ico with four sizes of the tile, drawn to the square's edges as the favicon is, its corners rounded.
    const windows = readFileSync(join(root, 'src-tauri/icons/icon.ico'));
    expect([windows.readUInt16LE(2), windows.readUInt16LE(4)]).toEqual([1, 4]);
    // An entry's width byte is 0 for 256, as the format writes it.
    expect([0, 1, 2, 3].map((at) => windows.readUInt8(6 + 16 * at))).toEqual([16, 32, 48, 0]);
    const big = await sharp(windows.subarray(windows.readUInt32LE(6 + 48 + 12))).raw().toBuffer({ resolveWithObject: true });
    expect([big.info.width, big.info.height, big.data[3]]).toEqual([256, 256, 0]);
    expect([...big.data.subarray((10 * 256 + 128) * 4, (10 * 256 + 128) * 4 + 4)]).toEqual([...GROUND, 255]);
    expect(printed).toContain('skipped icons/AppIcon.icon: Liquid Glass icons are not drawn here');

    // The menu bar's: the glyph itself, kept a vector template image.
    expect(readFileSync(join(options.menuBar, 'glyph.svg'), 'utf8')).toBe(readFileSync(join(FIXTURES, 'drawings/glyph.svg'), 'utf8'));
    expect(JSON.parse(readFileSync(join(options.menuBar, 'Contents.json'), 'utf8')).properties).toEqual({
      'preserves-vector-representation': true,
      'template-rendering-intent': 'template',
    });

    // The extension's: 16 and 32 in the one toolbar colour, 48 drawn at 40 and 128 at 96 with see-through edges.
    for (const side of [16, 32]) {
      const icon = await pixels(join(options.extension, `icon-${side}.png`));
      expect(icon.width).toBe(side);
      // Where two shades meet, their soft edges leave a pixel partly see-through; its colour is still the one.
      for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) for (const channel of icon.at(x, y).slice(0, 3)) expect(Math.abs(channel - 0x1f)).toBeLessThanOrEqual(1);
      }
      // The same shape for Chrome's dark mode in its light grey: every pixel's transparency the same as the light mode's.
      const dark = await pixels(join(options.extension, `icon-${side}-dark-mode.png`));
      expect(dark.width).toBe(side);
      for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
          const [r, g, b, alpha] = dark.at(x, y);
          for (const channel of [r!, g!, b!]) expect(Math.abs(channel - 0xe3)).toBeLessThanOrEqual(1);
          expect(alpha).toBe(icon.at(x, y)[3]!);
        }
      }
    }
    for (const [side, edge] of [[48, 4], [128, 16]] as const) {
      const icon = await pixels(join(options.extension, `icon-${side}.png`));
      expect(icon.width).toBe(side);
      expect(icon.at(edge - 1, side / 2)[3]).toBe(0);
      expect(icon.at(side - edge, side / 2)[3]).toBe(0);
      expect(icon.at(edge, edge)).toEqual([0x2a, 0x2c, 0x30, 255]);
      expect(icon.at(side - edge - 1, side - edge - 1)).toEqual([0x8e, 0x91, 0x97, 255]);
    }

    // The web's: favicon.ico with three sizes of the tile, its corners rounded; the Apple touch icon filling its square
    // with no alpha channel; the manifest's two as the Mac icon.
    const ico = readFileSync(join(options.web, 'favicon.ico'));
    expect([ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([1, 3]);
    expect([0, 1, 2].map((at) => ico.readUInt8(6 + 16 * at))).toEqual([16, 32, 48]);
    const largest = ico.subarray(ico.readUInt32LE(6 + 32 + 12));
    const favicon = await sharp(largest).raw().toBuffer({ resolveWithObject: true });
    expect([favicon.info.width, favicon.data[3]]).toEqual([48, 0]);
    expect([...favicon.data.subarray((2 * 48 + 24) * 4, (2 * 48 + 24) * 4 + 4)]).toEqual([...GROUND, 255]);
    const touch = await pixels(join(options.web, 'apple-touch-icon.png'));
    expect([touch.width, touch.channels, ...touch.at(0, 0)]).toEqual([180, 3, ...GROUND]);
    for (const side of [192, 512]) {
      const icon = await pixels(join(options.web, `icon-${side}.png`));
      expect([icon.width, icon.at(0, 0)[3]]).toEqual([side, 0]);
    }

    // Drawn again from the same drawings, every file is the same bytes, so a rerun changes nothing in git.
    const first = snapshot(root);
    await renderIcons({ ...options, print: () => {} });
    expect(snapshot(root)).toEqual(first);
  }, 60_000);

  test('the icon sets it fills compile in Xcode for the Mac and the iPhone', async () => {
    const { root, sets, options } = app();
    await renderIcons({ ...options, iconSets: [sets.mac, sets.iphone] });
    for (const [catalog, platform, extra] of [
      [join(root, 'Assets.xcassets'), 'macosx', ['--minimum-deployment-target', '13.0']],
      [join(root, 'phone/Assets.xcassets'), 'iphoneos', ['--minimum-deployment-target', '17.0', '--target-device', 'iphone']],
    ] as const) {
      const out = mkdtempSync(join(tmpdir(), 'actool-'));
      const compiled = await runCommand(
        ['xcrun', 'actool', '--compile', out, '--platform', platform, ...extra, '--app-icon', 'AppIcon', '--output-partial-info-plist', join(out, 'partial.plist'), '--errors', '--warnings', '--notices', '--output-format', 'human-readable-text', catalog],
        { timeoutMs: 120_000 },
      );
      expect({ platform, code: compiled.code, said: compiled.out.split('\n').filter((line) => /error|warning/i.test(line)) }).toEqual({ platform, code: 0, said: [] });
      expect(existsSync(join(out, 'Assets.car'))).toBe(true);
    }
  }, 240_000);

  test('refuses an app icon that is not 1024 square, and writes nothing', async () => {
    const { root, options } = app();
    writeFileSync(join(options.drawings, 'app-icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"/>');
    const before = snapshot(root);
    await expect(renderIcons(options)).rejects.toThrow('app-icon.svg is 1000 by 1000; the app icon is drawn 1024 square');
    expect(snapshot(root)).toEqual(before);
  });

  test('refuses a drawing that links outside its folder, which would draw nothing there', async () => {
    const { options } = app();
    const icon = join(options.drawings, 'app-icon.svg');
    writeFileSync(icon, readFileSync(icon, 'utf8').replace('href="mark.svg"', 'href="../shared/mark.svg"'));
    await expect(renderIcons(options)).rejects.toThrow('links to ../shared/mark.svg, which is not a file in');
  });

  test('refuses an icon set with no Contents.json, and one whose entry names no file', async () => {
    const { root, options } = app();
    await expect(renderIcons({ ...options, iconSets: [join(root, 'empty.appiconset')] })).rejects.toThrow('has no Contents.json: make the icon set first (for a Tauri iPhone app, run bunx tauri ios init)');
    const unnamed = join(root, 'unnamed.appiconset');
    mkdirSync(unnamed);
    writeFileSync(join(unnamed, 'Contents.json'), JSON.stringify({ images: [{ idiom: 'mac', scale: '1x', size: '16x16' }] }));
    await expect(renderIcons({ ...options, iconSets: [unnamed] })).rejects.toThrow('the mac 16x16 @1x entry names no file');
  });

  test('refuses a file name that leads out of its folder, and an existing menu bar set that names no .svg', async () => {
    const { root, sets, options } = app();
    const before = snapshot(root);
    writeFileSync(join(sets.mac, 'Contents.json'), JSON.stringify({ images: [{ idiom: 'mac', scale: '1x', size: '16x16', filename: '../../README.md' }] }));
    await expect(renderIcons({ ...options, iconSets: [sets.mac] })).rejects.toThrow('../../README.md leads out of');
    mkdirSync(options.menuBar, { recursive: true });
    writeFileSync(join(options.menuBar, 'Contents.json'), JSON.stringify({ images: [{ idiom: 'universal', filename: 'menu.png' }] }));
    await expect(renderIcons({ ...options, iconSets: [] })).rejects.toThrow('names menu.png for its image; the menu bar icon is glyph.svg itself');
    expect(existsSync(join(root, 'README.md'))).toBe(false);
    expect(Object.keys(snapshot(root)).filter((name) => !(name in before))).toEqual(['Assets.xcassets/MenuBarIcon.imageset/Contents.json']);
  });

  test('a mark drawn large, and coloured by styles, classes and the default black, still draws in the one toolbar colour', async () => {
    const { options } = app();
    writeFileSync(
      join(options.drawings, 'mark.svg'),
      `<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048" viewBox="0 0 2048 2048">
        <style>.lane{fill:#5c5f65}</style>
        <rect width="2048" height="700" style="fill:#2a2c30"/><rect y="700" width="2048" height="700" class="lane"/><rect y="1400" width="2048" height="648"/>
      </svg>`,
    );
    await renderIcons({ ...options, iconSets: [], tauri: undefined, menuBar: undefined, web: undefined });
    for (const side of [16, 32]) {
      const icon = await pixels(join(options.extension, `icon-${side}.png`));
      expect(icon.width).toBe(side);
      // Each pixel in the one colour, a band's soft edge keeping only its own transparency.
      for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) expect(icon.at(x, y).slice(0, 3)).toEqual([0x1f, 0x1f, 0x1f]);
      const dark = await pixels(join(options.extension, `icon-${side}-dark-mode.png`));
      for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) expect(dark.at(x, y).slice(0, 3)).toEqual([0xe3, 0xe3, 0xe3]);
    }
    expect((await pixels(join(options.extension, 'icon-128.png'))).at(64, 20)).toEqual([0x2a, 0x2c, 0x30, 255]);
  });

  test('with no toolbar colour, the mark keeps its own colours and no dark-mode icons are drawn', async () => {
    const { options } = app();
    await renderIcons({ ...options, iconSets: [], tauri: undefined, menuBar: undefined, web: undefined, toolbarColor: undefined });
    expect(readdirSync(options.extension).sort()).toEqual(['icon-128.png', 'icon-16.png', 'icon-32.png', 'icon-48.png']);
  });

  test('writes each icon under a name of its own, never through a link left where that name goes', async () => {
    const { root, options } = app();
    const kept = join(root, 'kept.txt');
    writeFileSync(kept, 'not an icon');
    mkdirSync(options.web, { recursive: true });
    symlinkSync(kept, join(options.web, 'favicon.ico.app-kit-icons'));
    await renderIcons({ ...options, iconSets: [], tauri: undefined, menuBar: undefined, extension: undefined });
    expect(readFileSync(kept, 'utf8')).toBe('not an icon');
    expect(readFileSync(join(options.web, 'favicon.ico')).readUInt16LE(4)).toBe(3);
    expect(readdirSync(options.web).sort()).toEqual(['apple-touch-icon.png', 'favicon.ico', 'icon-192.png', 'icon-512.png']);
  });

  test('a failure after drawing began writes nothing, so an app is never left with half its icons new', async () => {
    const { root, options } = app();
    const before = snapshot(root);
    const failing = renderIcons({ ...options, run: async () => ({ code: 1, out: 'iconutil: Invalid Iconset.', stdout: '', stderr: 'iconutil: Invalid Iconset.', timedOut: false }) });
    await expect(failing).rejects.toThrow('iconutil could not make the .icns (exit 1): iconutil: Invalid Iconset.');
    expect(snapshot(root)).toEqual(before);
  });

  test("draws an Android app's launcher icons: the adaptive icon's layers, the older square and round ones, and the Play Store icon", async () => {
    const { root, options } = app();
    const res = join(root, 'src-tauri/gen/android/app/src/main/res');
    mkdirSync(res, { recursive: true });
    const written = await renderIcons({ ...options, iconSets: [], menuBar: undefined, extension: undefined, web: undefined, androidBackground: '#1d6b4f' });
    expect(written.filter((file) => file.includes('/gen/android/')).length).toBe(5 * 4 + 3 + 1);
    for (const [density, scale] of [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]] as const) {
      // The older square icon is the tile filling it, as the iPhone's; the round one the same in a circle.
      const square = await pixels(join(res, `mipmap-${density}/ic_launcher.png`));
      expect([square.width, square.channels, ...square.at(0, 0)]).toEqual([48 * scale, 3, ...GROUND]);
      const round = await pixels(join(res, `mipmap-${density}/ic_launcher_round.png`));
      expect([round.width, round.at(0, 0)[3], ...round.at(24 * scale, 2 * scale)]).toEqual([48 * scale, 0, ...GROUND, 255]);
      // The layers are 108 dp, the mark on its 48 dp keyline in the middle, the rest see-through.
      const side = 108 * scale;
      const foreground = await pixels(join(res, `mipmap-${density}/ic_launcher_foreground.png`));
      expect(foreground.width).toBe(side);
      expect(foreground.at(Math.floor(29 * scale) - 1, side / 2)[3]).toBe(0);
      expect(foreground.at(Math.ceil(31 * scale), Math.ceil(31 * scale))).toEqual([0x2a, 0x2c, 0x30, 255]);
      // The themed icon's layer: the same shape, in one colour Android tints.
      const monochrome = await pixels(join(res, `mipmap-${density}/ic_launcher_monochrome.png`));
      expect(monochrome.at(Math.ceil(31 * scale), Math.ceil(31 * scale))).toEqual([255, 255, 255, 255]);
      expect(monochrome.at(Math.floor(29 * scale) - 1, side / 2)[3]).toBe(0);
    }
    const adaptive = readFileSync(join(res, 'mipmap-anydpi-v26/ic_launcher.xml'), 'utf8');
    for (const layer of ['@color/ic_launcher_background', '@mipmap/ic_launcher_foreground', '@mipmap/ic_launcher_monochrome']) expect(adaptive).toContain(layer);
    expect(readFileSync(join(res, 'mipmap-anydpi-v26/ic_launcher_round.xml'), 'utf8')).toBe(adaptive);
    expect(readFileSync(join(res, 'values/ic_launcher_background.xml'), 'utf8')).toContain('<color name="ic_launcher_background">#1d6b4f</color>');
    const play = await pixels(join(res, '../ic_launcher-playstore.png'));
    expect([play.width, play.channels, ...play.at(0, 0)]).toEqual([512, 3, ...GROUND]);
  });

  test('a Tauri app with an Android project and no background colour is refused, and writes nothing', async () => {
    const { root, options } = app();
    const res = join(root, 'src-tauri/gen/android/app/src/main/res');
    mkdirSync(res, { recursive: true });
    const before = snapshot(root);
    await expect(renderIcons({ ...options, run: undefined })).rejects.toThrow("has an Android project, whose icon draws the mark on the app's own background colour");
    expect(snapshot(root)).toEqual(before);
    // With no Android project, no colour is asked for, and the command refuses a colour with no --tauri app to use it.
    const done = Bun.spawnSync(['bun', join(import.meta.dir, '../bin/app-kit.ts'), 'icons', 'render', '--web', 'public', '--android-background', '#123456'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
    expect(done.exitCode).not.toBe(0);
    expect(existsSync(join(root, 'public'))).toBe(false);
  });

  test('names sharp with its install line when it is not installed', async () => {
    await expect(loadSharp(() => Promise.reject(new Error("Cannot find package 'sharp'")))).rejects.toThrow(
      'app-kit icons render draws with sharp, which is not installed here: run bun add -d sharp',
    );
  });

  test('the command draws from design/icon by default and says what it drew', () => {
    const { root } = app();
    const done = Bun.spawnSync(['bun', join(import.meta.dir, '../bin/app-kit.ts'), 'icons', 'render', '--web', 'public'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
    expect({ code: done.exitCode, out: done.stdout.toString(), err: done.stderr.toString() }).toEqual({
      code: 0,
      out: 'Drew 4 icon files from design/icon; commit them with the drawings.\n',
      err: '',
    });
    expect(readdirSync(join(root, 'public')).sort()).toEqual(['apple-touch-icon.png', 'favicon.ico', 'icon-192.png', 'icon-512.png']);
  });
});
