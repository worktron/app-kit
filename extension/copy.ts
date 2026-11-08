// The kit's worker files, and the plain look's stylesheet for the extension's pages, copied into an extension.
//
// An unpacked extension loads from its checkout, which a landing updates with
// git and nothing else, so the files Chrome loads are committed in the
// extension rather than read from node_modules. Each copy starts with a line
// naming the kit version it came from, and workerCopyDiffers() lists the files
// whose code, below that line, differs from the installed kit, for a test in the
// extension to fail on, and unlistedImports() the files the worker loads that
// its list for self-reload leaves out. A release that changes no worker file, as most of
// app-kit's releases are of another part, leaves every copy current. The stylesheet's copy, look.css, opens with a
// CSS comment rather than a `//` line, which CSS would read as part of the rule after it, and holds the look's
// variables, written from the tokens file as it is copied, above the kit's rules (extension/look.css), so the kit
// keeps no generated file and no copy of the values. An extension that sets its own accent, or its paper with its
// highlight, says so in look.json beside its manifest, which the copy reads, checks and writes into the variables.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve } from 'node:path'
import packageJson from '../package.json'
import { FONTS, PLAIN_SIZES, plainColors, type Colors, type LightDark, type PlainChoices } from '../look/index'

/** The kit's worker files, as shipped. */
export const WORKER_DIR = join(import.meta.dir, 'worker')

/** The worker files' names. */
export function workerFiles(): string[] {
  return readdirSync(WORKER_DIR).filter((name) => name.endsWith('.js')).sort()
}

/** The plain look's stylesheet, as copied into an extension beside the worker files. */
export const STYLESHEET = 'look.css'

/** Every file `copyWorker` writes: the worker files, then the stylesheet. */
export function copiedFiles(): string[] {
  return [...workerFiles(), STYLESHEET]
}

const header = `Copied from app-kit ${packageJson.version} by \`app-kit extension copy\`. Change it in the kit.`

function copied(name: string, folder: string): string {
  if (name === STYLESHEET) return `/* ${header} */\n${lookVariables(lookChoices(folder))}\n${readFileSync(join(import.meta.dir, STYLESHEET), 'utf8')}`
  return `// ${header}\n${readFileSync(join(WORKER_DIR, name), 'utf8')}`
}

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

/** The file beside an extension's manifest that holds the plain look's choices it makes: its accent, its paper and highlight. */
export const LOOK_CHOICES = 'look.json'

/**
 * The plain look's choices for the extension whose copies are in `folder`: look.json in the nearest folder at or above
 * it that holds a manifest.json, `{ "accent": { "light", "dark" }, "background": { "paper": {…}, "highlight": {…} } }`,
 * each color #rrggbb; none when there is no such file. A file in another shape is refused, naming what is wrong.
 */
export function lookChoices(folder: string): PlainChoices {
  let at = resolve(folder)
  while (!existsSync(join(at, 'manifest.json'))) {
    if (dirname(at) === at) return {}
    at = dirname(at)
  }
  const path = join(at, LOOK_CHOICES)
  if (!existsSync(path)) return {}
  /** `value` as an object holding no keys but `keys`, or a refusal saying what `name` needs. */
  const object = (value: unknown, name: string, keys: string[], needs: string): Record<string, unknown> => {
    const fits = typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key))
    if (!fits) throw new Error(`${path}: ${name} ${needs}`)
    return value as Record<string, unknown>
  }
  const pair = (value: unknown, name: string): LightDark => {
    const needs = 'needs a light and a dark color, each #rrggbb'
    const { light, dark } = object(value, name, ['light', 'dark'], needs)
    const hex = (color: unknown) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)
    if (!hex(light) || !hex(dark)) throw new Error(`${path}: ${name} ${needs}`)
    return { light: (light as string).toLowerCase(), dark: (dark as string).toLowerCase() }
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(`${path}: the file must be an object whose keys are accent and background`)
  const unknown = Object.keys(parsed).filter((key) => key !== 'accent' && key !== 'background')
  if (unknown.length) throw new Error(`${path}: ${unknown.join(', ')} is not a choice the plain look takes; it takes accent and background`)
  const read = parsed as Record<string, unknown>
  const choices: PlainChoices = {}
  if (read.accent !== undefined) choices.accent = pair(read.accent, 'accent')
  if (read.background !== undefined) {
    const { paper, highlight } = object(read.background, 'background', ['paper', 'highlight'], 'needs a paper and a highlight, each a light and a dark color')
    choices.background = { paper: pair(paper, 'background.paper'), highlight: pair(highlight, 'background.highlight') }
  }
  return choices
}

/**
 * The look's CSS variables from the tokens file and the extension's choices: each color role, light, and dark under
 * prefers-color-scheme; the typefaces; and every size, in pixels but for the weights and the line height. Colors whose
 * text would read under 4.5 to 1 are refused, as `plainColors` refuses them.
 */
export function lookVariables(choices: PlainChoices = {}): string {
  const { light, dark } = plainColors(choices)
  const colors = (scheme: Colors) => Object.entries(scheme).map(([role, value]) => `  --${kebab(role)}: ${value};`)
  const sizes = Object.entries(PLAIN_SIZES).map(([name, value]) => `  --${kebab(name)}: ${/Weight|lineHeight/.test(name) ? value : `${value}px`};`)
  return [
    ':root {',
    '  color-scheme: light dark;',
    ...colors(light),
    `  --font: ${FONTS.plain};`,
    `  --font-code: ${FONTS.code};`,
    ...sizes,
    '}',
    '@media (prefers-color-scheme: dark) {',
    '  :root {',
    ...colors(dark).map((line) => `  ${line}`),
    '  }',
    '}',
    '',
  ].join('\n')
}

/** A copy's code, without the header line naming the version it came from. */
const below = (copy: string) => copy.slice(copy.indexOf('\n') + 1)

/** Whether a file is a copy: its first line names where it was copied from, as this kit's and the extension kit's before it did. */
const isCopy = (path: string) => /^(\/\/|\/\*) Copied from /.test(readFileSync(path, 'utf8'))

/** The first folder below `folder`, three deep at most, that holds a copy of a worker file; not node_modules or a dot folder. */
function copiesBelow(folder: string, names: string[]): string | null {
  let level = [folder]
  for (let depth = 0; depth < 3 && level.length; depth++) {
    const next: string[] = []
    for (const parent of level) {
      for (const entry of readdirSync(parent, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue
        const child = join(parent, entry.name)
        if (names.some((name) => existsSync(join(child, name)) && isCopy(join(child, name)))) return child
        next.push(child)
      }
    }
    level = next
  }
  return null
}

/**
 * Writes the worker files and the stylesheet directly into `folder`, the
 * folder the worker imports them from, and returns their names. Refuses, writing nothing, a
 * folder that holds none of them while a folder below it holds copies, the
 * way `copy extension` once wrote strays beside a worker whose copies were in
 * extension/kit; and a file of the same name that is not a copy, which is the
 * extension's own.
 */
export function copyWorker(folder: string): string[] {
  const names = copiedFiles()
  if (existsSync(folder)) {
    const present = names.filter((name) => existsSync(join(folder, name)))
    const below = present.length ? null : copiesBelow(folder, workerFiles())
    if (below) throw new Error(`${folder} holds none of the worker files, but ${below} holds copies of them. Copy into the folder the worker imports them from: app-kit extension copy ${below}`)
    const own = present.filter((name) => !isCopy(join(folder, name)))
    if (own.length) throw new Error(`${own.join(', ')} in ${folder} ${own.length === 1 ? 'is' : 'are'} not a copy of the kit's, so copying would overwrite the extension's own code`)
  }
  // Read before anything is written, so a refused look.json leaves the copies as they were.
  const contents = names.map((name) => copied(name, folder))
  mkdirSync(folder, { recursive: true })
  names.forEach((name, at) => writeFileSync(join(folder, name), contents[at]!))
  return names
}

/**
 * The files the extension's worker loads, from the manifest's
 * background.service_worker through every static relative import, that
 * `loadedFiles` leaves out, as paths from `extensionFolder`. Self-reload
 * checks only the files it is given (worker/self-reload.js), so one left out
 * can be deleted under a running worker unnoticed. For a test in the extension.
 */
export function unlistedImports(extensionFolder: string, loadedFiles: string[]): string[] {
  const manifest = JSON.parse(readFileSync(join(extensionFolder, 'manifest.json'), 'utf8')) as { background?: { service_worker?: string } }
  const entry = manifest.background?.service_worker
  if (!entry) throw new Error(`The manifest in ${extensionFolder} names no background.service_worker`)
  const seen = new Set<string>()
  const queue = [normalize(entry)]
  while (queue.length) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)
    const source = readFileSync(join(extensionFolder, file), 'utf8')
    for (const [, from, bare] of source.matchAll(/(?:import|export)\s[^'"]*?from\s*["'](\.{1,2}\/[^"']+)["']|import\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const target = relative(extensionFolder, join(extensionFolder, dirname(file), (from ?? bare)!))
      queue.push(target)
    }
  }
  const listed = new Set(loadedFiles.map((path) => normalize(path)))
  return [...seen].filter((file) => !listed.has(file)).sort()
}

/** The worker files and the stylesheet in `folder` that are missing or whose code differs from the installed kit's. */
export function workerCopyDiffers(folder: string): string[] {
  return copiedFiles().filter((name) => {
    const path = join(folder, name)
    return !existsSync(path) || below(readFileSync(path, 'utf8')) !== below(copied(name, folder))
  })
}
