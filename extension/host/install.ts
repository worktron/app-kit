// Telling Chrome about a native host: the manifest Chrome reads to find it,
// which names the extension allowed to start it by its ID, and the launcher
// the manifest points at.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

/**
 * The extension's ID, from the `key` in its manifest: the first 32 hex digits
 * of the key's SHA-256, each written as a letter from a to p. A fixed key
 * gives the same ID in every profile and on every machine.
 */
export function extensionId(key: string): string {
  const hex = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)
  return [...hex].map((digit) => String.fromCharCode(97 + parseInt(digit, 16))).join('')
}

/** A folder of this Mac's Application Support, where a tool keeps its socket and log. `home` is for tests: Bun reads HOME once, at start. */
export function applicationSupport(name: string, home = homedir()): string {
  return join(home, 'Library', 'Application Support', name)
}

/** Where Chrome looks for native host manifests, for every profile of the signed-in user. */
export function chromeHostsDir(home = homedir()): string {
  return applicationSupport(join('Google', 'Chrome', 'NativeMessagingHosts'), home)
}

export type HostManifest = { name: string; description: string; path: string; type: 'stdio'; allowed_origins: string[] }

/** Chrome's rule for a host's name: lowercase letters, digits and underscores, in parts joined by single dots. */
export const HOST_NAME = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/

/** Writes `content` under another name beside `file` and renames it into place, so Chrome never reads half of it. */
function writeWhole(file: string, content: string, mode = 0o644) {
  mkdirSync(dirname(file), { recursive: true })
  const partial = join(dirname(file), `.${basename(file)}.${process.pid}`)
  writeFileSync(partial, content, { mode })
  renameSync(partial, file)
}

/**
 * Writes the manifest Chrome reads to start the host `name` (lowercase
 * letters, digits, dots and underscores) at `path`, an executable, for the
 * extension with `extensionId`. Returns the file written.
 */
export function writeHostManifest(folder: string, { name, description, path, extensionId }: { name: string; description: string; path: string; extensionId: string }): string {
  const manifest: HostManifest = { name, description, path, type: 'stdio', allowed_origins: [`chrome-extension://${extensionId}/`] }
  const file = join(folder, `${name}.json`)
  writeWhole(file, `${JSON.stringify(manifest, null, 2)}\n`)
  return file
}

const quote = (word: string) => `'${word.replaceAll("'", `'\\''`)}'`

/**
 * Writes a shell script at `file` that runs `command` with the arguments
 * Chrome passes, after exporting `env`, and appends what the host writes to
 * stderr to `errorLog`, since Chrome drops it. Chrome started from the Dock
 * has launchd's short PATH, so `command` names its programs by absolute path.
 */
export function writeHostLauncher(file: string, command: string[], { env = {}, errorLog }: { env?: Record<string, string>; errorLog?: string } = {}): string {
  const exports = Object.entries(env).map(([key, value]) => `export ${key}=${quote(value)}\n`).join('')
  const errors = errorLog ? ` 2>>${quote(errorLog)}` : ''
  writeWhole(file, `#!/bin/sh\n${exports}exec ${command.map(quote).join(' ')} "$@"${errors}\n`, 0o755)
  return file
}

/**
 * The command and error log of a launcher: one written by writeHostLauncher,
 * or a hand-written one whose `exec` line quotes each word in single or
 * double quotes. Null for anything else.
 */
export function readHostLauncher(file: string): { command: string[]; errorLog: string | null } | null {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  if (!text.startsWith('#!/bin/sh')) return null
  const line = text.split('\n').find((l) => l.startsWith('exec '))
  if (!line) return null
  const words = shellWords(line.slice(5))
  if (!words) return null
  const at = words.indexOf('$@')
  if (at < 1) return null
  const rest = words.slice(at + 1)
  const errorLog = rest[0] === '2>>' && rest[1] ? rest[1] : null
  return { command: words.slice(0, at), errorLog }
}

/** Splits quoted shell words, with `2>>` as a word of its own; null for anything it does not follow, such as a variable outside `"$@"`. */
function shellWords(line: string): string[] | null {
  const words: string[] = []
  let at = 0
  while (at < line.length) {
    if (line[at] === ' ') {
      at++
      continue
    }
    if (line.startsWith('2>>', at)) {
      words.push('2>>')
      at += 3
      continue
    }
    let word = ''
    while (at < line.length && line[at] !== ' ') {
      const c = line[at]
      if (c === "'") {
        const end = line.indexOf("'", at + 1)
        if (end < 0) return null
        word += line.slice(at + 1, end)
        at = end + 1
      } else if (c === '"') {
        const end = line.indexOf('"', at + 1)
        if (end < 0) return null
        const inner = line.slice(at + 1, end)
        if (inner.includes('$') && inner !== '$@') return null
        word += inner
        at = end + 1
      } else if (c === '\\' && at + 1 < line.length) {
        word += line[at + 1]
        at += 2
      } else if (/[\w./@:+,=-]/.test(c)) {
        word += c
        at++
      } else {
        return null
      }
    }
    words.push(word)
  }
  return words
}

/**
 * The worktree `folder` sits in, and the main checkout it belongs to; null
 * when it is in a main checkout or in no checkout at all. Asks git for both
 * folders as absolute paths, since in a subfolder git writes one of them
 * relative.
 */
export function worktreeOf(folder: string): { worktree: string; main: string } | null {
  const run = spawnSync('git', ['-C', folder, 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-toplevel'], { encoding: 'utf8' })
  if (run.status !== 0) return null
  const [gitDir, commonDir, top] = run.stdout.trim().split('\n')
  if (!gitDir || !commonDir || !top || gitDir === commonDir) return null
  return { worktree: top, main: basename(commonDir) === '.git' ? dirname(commonDir) : commonDir }
}

const SCRIPT = /\.(ts|tsx|js|mjs|cjs)$/

export type InstallHostOptions = {
  /** The host's name, as the extension's connectNative names it. */
  name: string
  /** The host: a program, or a TypeScript or JavaScript file Bun runs. */
  host: string
  /** The folder with the extension's manifest.json, whose key gives the ID allowed to start the host. */
  extensionFolder: string
  /** What Chrome says the host is. */
  description: string
  /** Install even from a worktree, which goes away when its work lands. */
  fromWorktree?: boolean
  /** For tests: Bun reads HOME once, at start. */
  home?: string
  /** The Bun that runs a script; the one running this, by default. */
  bun?: string
}

export type InstalledHost = { manifest: string; launcher: string; errorLog: string; extensionFolder: string; extensionId: string }

/**
 * Tells Chrome about a native host: writes a launcher for it in the host's
 * own Application Support folder and the manifest naming that launcher and
 * the extension allowed to start it. Checks everything before it writes
 * anything, so a refusal leaves no file behind.
 */
export function installHost({ name, host, extensionFolder, description, fromWorktree = false, home = homedir(), bun = process.execPath }: InstallHostOptions): InstalledHost {
  if (!HOST_NAME.test(name)) throw new Error(`Chrome refuses the host name ${name}: lowercase letters, digits and underscores, in parts joined by single dots, as com.example.tool`)
  if (!description.trim()) throw new Error('The description is what Chrome says the host is, and it may not be empty')
  const program = resolve(host)
  if (!existsSync(program)) throw new Error(`There is no host at ${program}`)
  const script = SCRIPT.test(program)
  if (!script && !isExecutable(program)) throw new Error(`${program} is not executable, and is not a TypeScript or JavaScript file for Bun to run`)
  const folder = resolve(extensionFolder)
  const manifestPath = join(folder, 'manifest.json')
  if (!existsSync(manifestPath)) throw new Error(`There is no manifest.json in ${folder}`)
  const { key } = JSON.parse(readFileSync(manifestPath, 'utf8')) as { key?: string }
  if (!key) throw new Error(`The manifest in ${folder} has no key, so its ID changes from profile to profile`)
  const worktree = worktreeOf(dirname(program))
  if (worktree && !fromWorktree) {
    throw new Error(`${worktree.worktree} is a worktree, which goes away when its work lands, and Chrome would run its code until then. Install from the main checkout, ${worktree.main}, or pass --from-worktree to mean it.`)
  }

  const id = extensionId(key)
  const support = applicationSupport(name, home)
  const errorLog = join(support, 'host-errors.log')
  const launcher = writeHostLauncher(join(support, 'host'), script ? [bun, program] : [program], { errorLog })
  const manifest = writeHostManifest(chromeHostsDir(home), { name, description, path: launcher, extensionId: id })
  return { manifest, launcher, errorLog, extensionFolder: folder, extensionId: id }
}

/** Whether `path` is a file this user may run. */
export function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}
