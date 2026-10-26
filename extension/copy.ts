// The kit's worker files, copied into an extension.
//
// An unpacked extension loads from its checkout, which a landing updates with
// git and nothing else, so the files Chrome loads are committed in the
// extension rather than read from node_modules. Each copy starts with a line
// naming the kit version it came from, and workerCopyDiffers() lists the files
// whose code, below that line, differs from the installed kit, for a test in the
// extension to fail on, and unlistedImports() the files the worker loads that
// its list for self-reload leaves out. A release that changes no worker file, as most of
// app-kit's releases are of another part, leaves every copy current.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'
import packageJson from '../package.json'

/** The kit's worker files, as shipped. */
export const WORKER_DIR = join(import.meta.dir, 'worker')

/** The worker files' names. */
export function workerFiles(): string[] {
  return readdirSync(WORKER_DIR).filter((name) => name.endsWith('.js')).sort()
}

function copied(name: string): string {
  return `// Copied from app-kit ${packageJson.version} by \`app-kit extension copy\`. Change it in the kit.\n${readFileSync(join(WORKER_DIR, name), 'utf8')}`
}

/** A copy's code, without the header line naming the version it came from. */
const below = (copy: string) => copy.slice(copy.indexOf('\n') + 1)

/** Whether a file is a copy: its first line names where it was copied from, as this kit's and the extension kit's before it did. */
const isCopy = (path: string) => readFileSync(path, 'utf8').startsWith('// Copied from ')

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
 * Writes the worker files directly into `folder`, the folder the worker
 * imports them from, and returns their names. Refuses, writing nothing, a
 * folder that holds none of them while a folder below it holds copies, the
 * way `copy extension` once wrote strays beside a worker whose copies were in
 * extension/kit; and a file of the same name that is not a copy, which is the
 * extension's own.
 */
export function copyWorker(folder: string): string[] {
  const names = workerFiles()
  if (existsSync(folder)) {
    const present = names.filter((name) => existsSync(join(folder, name)))
    const below = present.length ? null : copiesBelow(folder, names)
    if (below) throw new Error(`${folder} holds none of the worker files, but ${below} holds copies of them. Copy into the folder the worker imports them from: app-kit extension copy ${below}`)
    const own = present.filter((name) => !isCopy(join(folder, name)))
    if (own.length) throw new Error(`${own.join(', ')} in ${folder} ${own.length === 1 ? 'is' : 'are'} not a copy of the kit's, so copying would overwrite the extension's own code`)
  }
  mkdirSync(folder, { recursive: true })
  for (const name of names) writeFileSync(join(folder, name), copied(name))
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

/** The worker files in `folder` that are missing or whose code differs from the installed kit's. */
export function workerCopyDiffers(folder: string): string[] {
  return workerFiles().filter((name) => {
    const path = join(folder, name)
    return !existsSync(path) || below(readFileSync(path, 'utf8')) !== below(copied(name))
  })
}
