/*
 * `app-kit icons render`: every icon an app ships, drawn from the drawings it commits in one folder:
 * - app-icon.svg, 1024 square, with its tile on Apple's macOS grid (an 824 rounded square at 100): the Mac icons as
 *   they are, and, cut to the tile with its corners filled in the tile's own colour and no alpha channel, the iPhone
 *   icons and the Apple touch icon. The favicon is the same cut keeping its rounded corners.
 * - mark.svg, square, the drawing with no tile: the extension's icons, 16 and 32 at full size (in one colour with
 *   --toolbar-color), 48 drawn at 40 and 128 at 96, the inset Chrome's icon guidelines ask for.
 * - glyph.svg: copied into the menu bar's template image set, which keeps it as a vector.
 * An Xcode icon set is filled from its own Contents.json, each entry from the drawing for its kind of device; a Tauri
 * app's icons are the files its tauri.conf.json lists.
 *
 * It draws with sharp, whose prebuilt binaries carry librsvg, the engine rsvg-convert draws with, so it needs neither
 * Homebrew nor a browser; sharp is an optional peer dependency, loaded only here. Each drawing is read from its file, so
 * a link to another drawing in its folder resolves; a link that does not resolve inside the folder would draw nothing,
 * so it is refused first. Every file is drawn before any is written, so a refusal or a failure while drawing leaves an
 * app's icons as they were, and each is written under another name and renamed into place, so none is ever cut short;
 * a disk that fills partway through the writing leaves the files before it new.
 * A file name read from a Contents.json or tauri.conf.json is refused when it leads out of its folder. The Mac .icns is
 * made by Apple's iconutil, through the kit's runner for outside programs.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { Sharp, SharpOptions } from 'sharp';
import { runCommand, type Run } from '../tauri/testflight/run.ts';

type SharpModule = (input?: string | Buffer, options?: SharpOptions) => Sharp;

export type IconsOptions = {
  /** The folder holding app-icon.svg, and mark.svg and glyph.svg when a target needs them. */
  drawings: string;
  /** Xcode icon sets (AppIcon.appiconset folders), each filled from its Contents.json. */
  iconSets?: string[];
  /** A Tauri app's src-tauri folder: the icons its tauri.conf.json lists. */
  tauri?: string;
  /** The menu bar's template image set (an .imageset folder): glyph.svg, kept as a vector. */
  menuBar?: string;
  /** The extension's icons folder: icon-16, icon-32, icon-48 and icon-128. */
  extension?: string;
  /** The one colour the extension's 16 and 32 draw every fill and stroke in, as #rgb or #rrggbb. */
  toolbarColor?: string;
  /** The folder a web app serves as its root: favicon.ico, apple-touch-icon.png, icon-192.png and icon-512.png. */
  web?: string;
  run?: Run;
  /** Loads sharp; replaced in tests. */
  load?: () => Promise<SharpModule>;
  print?: (line: string) => void;
};

/** The app icon's canvas, and the tile Apple's macOS grid puts on it. */
const CANVAS = 1024;
const TILE = 824;
const TILE_AT = 100;
/** The Mac icon set iconutil turns into an .icns: each size at 1x and 2x. */
const ICNS_SIZES = [16, 32, 128, 256, 512];

/** Loads sharp, or says how to install it. */
export const loadSharp = async (load: () => Promise<{ default: SharpModule }> = () => import('sharp')): Promise<SharpModule> => {
  try {
    return (await load()).default;
  } catch {
    throw new Error('app-kit icons render draws with sharp, which is not installed here: run bun add -d sharp');
  }
};

/** Every file a drawing links to, by its href, as written. */
const links = (svg: string) => [...svg.matchAll(/\bhref\s*=\s*["']([^"']*)["']/g)].map((match) => match[1]!);

/** Refuses a drawing that links to anything but an existing file inside its own folder, which librsvg would leave out. */
function checkLinks(file: string, folder: string): void {
  for (const link of links(readFileSync(file, 'utf8'))) {
    if (link.startsWith('#') || link.startsWith('data:')) continue;
    const target = resolve(dirname(file), decodeURI(link));
    const within = existsSync(target) ? relative(folder, realpathSync(target)) : '..';
    const inside = !/^[a-z][a-z0-9+.-]*:/i.test(link) && within !== '' && !within.startsWith('..') && !isAbsolute(within);
    if (!inside) throw new Error(`${file} links to ${link}, which is not a file in ${folder}; a drawing may link only to files beside it, or it draws nothing there`);
  }
}

/** One Contents.json entry, as Xcode writes it. */
type Entry = { size?: string; idiom?: string; filename?: string; scale?: string; platform?: string; appearances?: unknown[] };

const PHONE_IDIOMS = new Set(['iphone', 'ipad', 'ios-marketing']);

/** Builds every file into memory, then writes them all; returns the files written. */
export async function renderIcons(options: IconsOptions): Promise<string[]> {
  const print = options.print ?? ((line: string) => console.log(line));
  const run = options.run ?? runCommand;
  const sharp = await (options.load ?? (() => loadSharp()))();
  const folder = realpathSync(options.drawings);
  const drawing = (name: string, why: string) => {
    const file = join(folder, name);
    if (!existsSync(file)) throw new Error(`${why} is drawn from ${name}, and ${options.drawings} has none`);
    checkLinks(file, folder);
    return file;
  };
  const appIcon = drawing('app-icon.svg', 'Every icon');
  const appSize = await sharp(appIcon).metadata();
  if (appSize.width !== CANVAS || appSize.height !== CANVAS) {
    throw new Error(`${appIcon} is ${appSize.width} by ${appSize.height}; the app icon is drawn 1024 square, with its tile on Apple's grid (${TILE} square at ${TILE_AT})`);
  }

  const files = new Map<string, Buffer>();
  /** Keeps `bytes` to write as `name` in `into`, refusing a name, read from an app's own files, that leads out of it. */
  const add = (into: string, name: string, bytes: Buffer) => {
    const path = resolve(into, name);
    const within = relative(resolve(into), path);
    if (!within || within.startsWith('..') || isAbsolute(within)) throw new Error(`${name} leads out of ${into}, where its icon belongs`);
    files.set(path, bytes);
  };

  /** The app icon as it is, at `size`. */
  const mac = (size: number) => sharp(appIcon, { density: (72 * size) / CANVAS }).resize(size, size).png().toBuffer();
  /** The app icon's tile alone at `size`, drawn at that size rather than cut from a larger drawing and scaled. */
  const tile = (size: number) => {
    const canvas = Math.round((CANVAS * size) / TILE);
    const at = Math.round((TILE_AT * size) / TILE);
    return sharp(appIcon, { density: (72 * canvas) / CANVAS }).resize(canvas, canvas).extract({ left: at, top: at, width: size, height: size });
  };
  let ground: { r: number; g: number; b: number } | undefined;
  /** The tile's own colour, just inside the middle of its top edge, which fills its corners on the phone. */
  const tileGround = async () => {
    if (ground) return ground;
    const { data } = await tile(TILE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const at = (Math.round(TILE / 16) * TILE + TILE / 2) * 4;
    if (data[at + 3] !== 255) throw new Error(`${appIcon}'s tile is not opaque just inside its top edge, so its corners cannot be filled for the phone`);
    ground = { r: data[at]!, g: data[at + 1]!, b: data[at + 2]! };
    return ground;
  };
  /** The tile filling a square with no alpha channel, as iOS and the App Store take it. */
  const phone = async (size: number) => tile(size).flatten({ background: await tileGround() }).png().toBuffer();

  for (const set of options.iconSets ?? []) await iconSet(set, { mac, phone, add, print });

  if (options.tauri) {
    const config = join(options.tauri, 'tauri.conf.json');
    if (!existsSync(config)) throw new Error(`${options.tauri} has no tauri.conf.json`);
    const listed: unknown = (JSON.parse(readFileSync(config, 'utf8')) as { bundle?: { icon?: unknown } }).bundle?.icon;
    if (!Array.isArray(listed) || !listed.length) throw new Error(`${config} lists no icons under bundle.icon`);
    for (const name of listed as string[]) {
      const keep = (bytes: Buffer) => add(options.tauri!, name, bytes);
      const sized = /(?:^|\/)(\d+)x(\d+)(@2x)?\.png$/.exec(name);
      if (sized && sized[1] === sized[2]) keep(await mac(Number(sized[1]) * (sized[3] ? 2 : 1)));
      else if (basename(name) === 'icon.png') keep(await mac(512));
      else if (name.endsWith('.icns')) keep(await icns(mac, run));
      else if (/\.(ico|icon|car)$/.test(name)) print(`skipped ${name}: Windows and Liquid Glass icons are not drawn here`);
      else throw new Error(`${config} lists ${name}, which is not an icon this command draws (NxN.png, NxN@2x.png, icon.png, icon.icns)`);
    }
  }

  if (options.menuBar) {
    const glyph = drawing('glyph.svg', 'The menu bar icon');
    const contents = join(options.menuBar, 'Contents.json');
    let named = 'glyph.svg';
    if (existsSync(contents)) {
      const set = JSON.parse(readFileSync(contents, 'utf8')) as { images?: Entry[]; properties?: Record<string, unknown> };
      const file = set.images?.[0]?.filename;
      if (!file?.endsWith('.svg')) throw new Error(`${contents} names ${file ?? 'no file'} for its image; the menu bar icon is glyph.svg itself, so name an .svg there`);
      if (set.properties?.['template-rendering-intent'] !== 'template') print(`${contents} does not mark its image a template, so the menu bar draws it in its own colours`);
      named = file;
    } else add(options.menuBar, 'Contents.json', Buffer.from(TEMPLATE_CONTENTS));
    add(options.menuBar, named, readFileSync(glyph));
  }

  if (options.extension) {
    const mark = drawing('mark.svg', "The extension's icons");
    const { width, height } = await sharp(mark).metadata();
    if (!width || width !== height) throw new Error(`${mark} is ${width} by ${height}; the mark is drawn square`);
    // Drawn at least at the density of the drawing's own size, which sharp's smallest is, and then scaled to `size`.
    const draw = (size: number) => sharp(mark, { density: Math.max(1, (72 * size) / width) }).resize(size, size);
    const color = options.toolbarColor;
    for (const size of [16, 32]) {
      add(options.extension, `icon-${size}.png`, color ? await oneColour(sharp, draw(size), color) : await draw(size).png().toBuffer());
    }
    for (const [page, art] of [[48, 40], [128, 96]] as const) {
      const edge = (page - art) / 2;
      const inset = draw(art).extend({ top: edge, bottom: edge, left: edge, right: edge, background: { r: 0, g: 0, b: 0, alpha: 0 } });
      add(options.extension, `icon-${page}.png`, await inset.png().toBuffer());
    }
  }

  if (options.web) {
    add(options.web, 'favicon.ico', ico(await Promise.all([16, 32, 48].map((size) => tile(size).png().toBuffer()))));
    add(options.web, 'apple-touch-icon.png', await phone(180));
    for (const size of [192, 512]) add(options.web, `icon-${size}.png`, await mac(size));
  }

  for (const [path, bytes] of files) {
    mkdirSync(dirname(path), { recursive: true });
    // Made new, never through a file or link already there under that name.
    const fresh = `${path}.app-kit-icons`;
    rmSync(fresh, { force: true });
    writeFileSync(fresh, bytes, { flag: 'wx' });
    renameSync(fresh, path);
  }
  return [...files.keys()];
}

/** Fills one Xcode icon set from its Contents.json: every entry with a file, from the drawing for its device. */
async function iconSet(
  set: string,
  { mac, phone, add, print }: {
    mac: (size: number) => Promise<Buffer>;
    phone: (size: number) => Promise<Buffer>;
    add: (into: string, name: string, bytes: Buffer) => void;
    print: (line: string) => void;
  },
): Promise<void> {
  const contents = join(set, 'Contents.json');
  if (!existsSync(contents)) {
    throw new Error(`${set} has no Contents.json: make the icon set first (for a Tauri iPhone app, run bunx tauri ios init), then draw into it`);
  }
  const name = basename(set).replace(/\.appiconset$/, '');
  for (const glass of [join(dirname(set), `${name}.icon`), join(dirname(dirname(set)), `${name}.icon`)]) {
    if (existsSync(glass)) print(`${glass} is an Icon Composer icon, which macOS and iOS 26 and later show instead of ${set}; this set covers older systems only`);
  }
  const entries = (JSON.parse(readFileSync(contents, 'utf8')) as { images?: Entry[] }).images ?? [];
  for (const entry of entries) {
    const label = `${entry.idiom ?? 'no idiom'} ${entry.size ?? 'no size'}${entry.scale ? ` @${entry.scale}` : ''}`;
    if (entry.appearances?.length) {
      print(`skipped ${label} ${JSON.stringify(entry.appearances)} in ${set}: the system draws dark and tinted icons itself`);
      continue;
    }
    if (!entry.filename) throw new Error(`${contents}: the ${label} entry names no file; give it a filename, then draw again`);
    const side = /^(\d+(?:\.\d+)?)x\1$/.exec(entry.size ?? '')?.[1];
    const scale = Number((entry.scale ?? '1x').replace(/x$/, ''));
    const size = Number(side) * scale;
    if (!side || !Number.isInteger(size)) throw new Error(`${contents}: the ${label} entry is not a square of whole pixels`);
    const drawn = entry.idiom === 'mac' ? mac : PHONE_IDIOMS.has(entry.idiom ?? '') || (entry.idiom === 'universal' && entry.platform === 'ios') ? phone : undefined;
    if (!drawn) throw new Error(`${contents}: the ${label} entry is for a device this command does not draw for (Mac and iPhone only)`);
    add(set, entry.filename, await drawn(size));
  }
}

/**
 * The mark drawn in one colour, every pixel keeping its own transparency: the same as recolouring the drawing, however
 * its shapes are coloured (attributes, styles, classes or the default black).
 */
async function oneColour(sharp: SharpModule, image: Sharp, color: string): Promise<Buffer> {
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const hex = color.length === 4 ? color.replace(/[0-9a-f]/gi, (digit) => digit + digit) : color;
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  for (let at = 0; at < data.length; at += 4) {
    data[at] = r!;
    data[at + 1] = g!;
    data[at + 2] = b!;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

/** The Mac icon as an .icns, made by iconutil from the ten sizes of a Mac icon set. */
async function icns(mac: (size: number) => Promise<Buffer>, run: Run): Promise<Buffer> {
  const work = mkdtempSync(join(tmpdir(), 'app-kit-icns-'));
  try {
    const set = join(work, 'icon.iconset');
    mkdirSync(set);
    for (const size of ICNS_SIZES) {
      writeFileSync(join(set, `icon_${size}x${size}.png`), await mac(size));
      writeFileSync(join(set, `icon_${size}x${size}@2x.png`), await mac(size * 2));
    }
    const out = join(work, 'icon.icns');
    const { code, out: said } = await run(['iconutil', '-c', 'icns', set, '-o', out], { timeoutMs: 60_000 });
    if (code === 127) throw new Error(`iconutil, which makes the Mac .icns, was not found: it comes with macOS (${said.trim()})`);
    if (code !== 0) throw new Error(`iconutil could not make the .icns (exit ${code}): ${said.trim()}`);
    return readFileSync(out);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** A Windows icon file holding each PNG as it is, as browsers read favicon.ico. */
function ico(pngs: Buffer[]): Buffer {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach((png, at) => {
    const entry = 6 + 16 * at;
    const side = png.readUInt32BE(16);
    header.writeUInt8(side >= 256 ? 0 : side, entry);
    header.writeUInt8(side >= 256 ? 0 : side, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...pngs]);
}

/** The menu bar image set's Contents.json, written when the set has none: a vector template image, as Beeline's. */
const TEMPLATE_CONTENTS = `{
  "images" : [
    {
      "filename" : "glyph.svg",
      "idiom" : "universal"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  },
  "properties" : {
    "preserves-vector-representation" : true,
    "template-rendering-intent" : "template"
  }
}
`;

/** True for a colour --toolbar-color takes. */
export const isColor = (value: string) => /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
