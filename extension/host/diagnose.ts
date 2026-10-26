// Why no host answers on the socket, and what fixes it: the checks Chrome
// makes before it starts a native host, and the ones it does not make but an
// owner on this Mac hits, such as a launcher left pointing into a worktree
// that is gone. Each check reads files only; nothing is changed.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { chromeHostsDir, extensionId, HOST_NAME, isExecutable, readHostLauncher, worktreeOf } from './install.ts'

/** Why nothing is connected, the fix, and the newest lines the host wrote to its error log, when it keeps one. */
export type Diagnosis = { reason: string; fix: string; hostErrors?: { at: string; lines: string[] } }

export type DiagnoseOptions = {
  /** The host's name, as the extension's connectNative names it; without it only the socket is known. */
  name?: string
  /** The folder with the extension's manifest.json, to check the ID the host's manifest allows. */
  extensionFolder?: string
  /** For tests: Bun reads HOME once, at start. */
  home?: string
}

const reinstall = (name: string, folder = '<extension folder>') =>
  `From the main checkout, run: bun run app-kit extension install-host ${name} <host script> ${folder} --description "<what the host does>"`

/** Why no host is listening, checked against what Chrome reads to start it. Call it once a caller has found nothing connected. */
export function diagnoseHost({ name, extensionFolder, home = homedir() }: DiagnoseOptions = {}): Diagnosis {
  const folder = extensionFolder === undefined ? undefined : resolve(extensionFolder)
  const loadUnpacked = folder ? ` If it is open, load the extension there from ${folder} (chrome://extensions, Developer mode, Load unpacked).` : ''
  if (name === undefined) {
    return {
      reason: 'No native host is listening on the socket: Chrome is not running the extension, or never started its host.',
      fix: `Open Chrome in the profile with the extension.${loadUnpacked} Give status the host's name and the extension's folder to check how Chrome is told of the host.`,
    }
  }
  const fix = reinstall(name, extensionFolder)
  if (!HOST_NAME.test(name)) return { reason: `Chrome refuses the host name ${name}: lowercase letters, digits and underscores, in parts joined by single dots.`, fix }

  const registration = join(chromeHostsDir(home), `${name}.json`)
  if (!existsSync(registration)) return { reason: `Chrome does not know the host ${name}: there is no ${registration}.`, fix }
  let manifest: { name?: unknown; path?: unknown; type?: unknown; allowed_origins?: unknown }
  try {
    manifest = JSON.parse(readFileSync(registration, 'utf8'))
  } catch {
    return { reason: `${registration} is not JSON, so Chrome cannot read it.`, fix }
  }
  if (manifest.name !== name) return { reason: `${registration} names the host ${String(manifest.name)}, not ${name}, so Chrome ignores it.`, fix }
  if (manifest.type !== 'stdio') return { reason: `${registration} has the type ${String(manifest.type)}; Chrome starts only stdio hosts.`, fix }
  if (typeof manifest.path !== 'string' || !isAbsolute(manifest.path)) return { reason: `${registration} gives the host's path as ${String(manifest.path)}; on a Mac Chrome needs an absolute path.`, fix }
  const program = manifest.path
  if (!existsSync(program)) return { reason: `The host ${registration} names, ${program}, does not exist.`, fix }
  if (!isExecutable(program)) return { reason: `The host ${registration} names, ${program}, is not executable.`, fix }

  const launcher = readHostLauncher(program)
  if (launcher) {
    const [runs, script] = launcher.command
    if (!runs || !isExecutable(runs)) return { reason: `The host's launcher, ${program}, runs ${String(runs)}, which is not an executable file.`, fix }
    if (script && isAbsolute(script) && !existsSync(script)) return { reason: `The host's launcher, ${program}, runs ${script}, which no longer exists.`, fix }
    const code = script && isAbsolute(script) ? script : runs
    const worktree = worktreeOf(join(code, '..'))
    if (worktree) {
      return {
        reason: `Chrome runs the host from the worktree ${worktree.worktree}, which goes away when its work lands.`,
        fix: `From the main checkout, ${worktree.main}, run: bun run app-kit extension install-host ${name} <host script> ${extensionFolder ?? '<extension folder>'} --description "<what the host does>"`,
      }
    }
  }

  if (folder) {
    const extensionManifest = join(folder, 'manifest.json')
    if (!existsSync(extensionManifest)) return { reason: `There is no manifest.json in ${folder}, so its extension's ID is unknown.`, fix: 'Give status the folder with the extension\'s manifest.json.' }
    let key: unknown
    try {
      key = JSON.parse(readFileSync(extensionManifest, 'utf8')).key
    } catch {
      return { reason: `${extensionManifest} is not JSON.`, fix: 'Give status the folder with the extension\'s manifest.json.' }
    }
    if (typeof key !== 'string' || !key) return { reason: `The manifest in ${folder} has no key, so its ID changes from profile to profile and no host can name it.`, fix: 'Add a key to the manifest, then install the host again.' }
    const id = extensionId(key)
    const origins = Array.isArray(manifest.allowed_origins) ? manifest.allowed_origins.map(String) : []
    if (!origins.includes(`chrome-extension://${id}/`)) {
      return { reason: `${registration} allows ${origins.join(', ') || 'no extension'}, but the extension in ${folder} has the ID ${id}.`, fix }
    }
  }

  const diagnosis: Diagnosis = {
    reason: `Chrome knows the host ${name} and can start it, but the extension is not running it.`,
    fix: `Open Chrome in the profile with the extension.${loadUnpacked}`,
  }
  const errors = launcher?.errorLog ? lastLines(launcher.errorLog, 20) : null
  if (errors) {
    diagnosis.hostErrors = errors
    diagnosis.fix += ` The host's error log was last written at ${errors.at}; when that is recent, the host stops as soon as Chrome starts it, and its newest lines below say why.`
  }
  return diagnosis
}

function lastLines(file: string, count: number): { at: string; lines: string[] } | null {
  try {
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n').filter(Boolean)
    if (!lines.length) return null
    return { at: statSync(file).mtime.toISOString(), lines: lines.slice(-count) }
  } catch {
    return null
  }
}
