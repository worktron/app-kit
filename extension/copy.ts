// The kit's worker files, copied into an extension.
//
// An unpacked extension loads from its checkout, which a landing updates with
// git and nothing else, so the files Chrome loads are committed in the
// extension rather than read from node_modules. Each copy starts with a line
// naming the kit version it came from, and workerCopyDiffers() lists the files
// whose code, below that line, differs from the installed kit, for a test in the
// extension to fail on. A release that changes no worker file, as most of
// app-kit's releases are of another part, leaves every copy current.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

/** Writes the worker files into `folder`, and returns their names. */
export function copyWorker(folder: string): string[] {
  mkdirSync(folder, { recursive: true })
  const names = workerFiles()
  for (const name of names) writeFileSync(join(folder, name), copied(name))
  return names
}

/** The worker files in `folder` that are missing or whose code differs from the installed kit's. */
export function workerCopyDiffers(folder: string): string[] {
  return workerFiles().filter((name) => {
    const path = join(folder, name)
    return !existsSync(path) || below(readFileSync(path, 'utf8')) !== below(copied(name))
  })
}
