#!/usr/bin/env bun
// app-kit <part> <command>: the kit's command line. The extension kit copies the
// kit's worker files into an extension, checks the copy, prints an extension's
// ID, tells Chrome about a native host, and prints a native host's status, or
// why nothing is connected. The iPhone part builds a Tauri app and starts it on
// a Simulator or a paired iPhone. The iPhone simulator part sends a
// simulator's sound to BlackHole so it plays nowhere. The TestFlight part uploads
// an iPhone build, and watches apps' main to upload after each landing.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { copyWorker, workerCopyDiffers } from '../extension/copy.ts'
import { diagnoseHost, extensionId, hostStatus, installHost, NotConnected } from '../extension/host/index.ts'
import packageJson from '../package.json'
import { runIphone } from '../tauri/iphone-run/index.ts'
import { quietSimulator } from '../tauri/iphone-simulator/index.ts'
import { upload } from '../tauri/testflight/upload.ts'
import { watch } from '../tauri/testflight/watch.ts'

const USAGE = `app-kit <part> <command>

  extension copy <folder>     write the kit's worker files directly into <folder>, the
                              folder the worker imports them from, as extension/kit;
                              refuses a folder whose copies live in a folder below it
  extension check <folder>    exit 3 when <folder>'s worker files differ from this kit's
  extension id [<folder>]     the extension's ID, from the key in <folder>/manifest.json
  extension install-host <name> <host> [<folder>] --description <text> [--from-worktree]
                              tell Chrome about the native host <name>: a launcher that
                              runs <host> (a program, or a TypeScript or JavaScript file
                              run by this Bun) and the manifest Chrome reads, allowing
                              the extension whose manifest.json is in <folder>, . by
                              default; refuses a worktree unless --from-worktree
  extension status <socket> [<name> [<folder>]]
                              the status a native host serving <socket> gives, as JSON:
                              the extension's build, commit and kept errors; when no
                              host answers, why and the fix, checking how Chrome is
                              told of the host <name> and the extension in <folder>
  iphone run sim [<udid>]     from a Tauri app's checkout: build its iPhone app and start
                              it on this checkout's own Simulator (made once, an iPhone 17,
                              named after the app, and in a worktree after its folder too),
                              with no window and its sound sent to BlackHole; <udid> picks
                              another Simulator
  iphone run phone [<udid>]   build it signed for development and start it on the paired
                              iPhone, first adding the phone to the team's development
                              profile when none holds it; <udid> picks the phone
  iphone-simulator quiet <udid>
                              send the simulator <udid>'s sound to BlackHole: a booted
                              one restarts once when it plays elsewhere, a shut-down
                              one has the setting saved for its next boot; prints
                              one line, and exits 0 even when BlackHole is missing,
                              1 only when the simulator did not boot again
  testflight upload [--token-only]
                              from a Tauri app's checkout at a commit of origin/main:
                              build its iPhone app, check it, upload it to TestFlight
                              and wait until App Store Connect has processed it.
                              --token-only reads the key only through the keychain's
                              1Password token, never the signed-in op
  testflight watch <git url>...
                              one pass: for each app whose main moved and changed its
                              iPhone app, build main's commit in a clone of its own and
                              upload it; one line per decision in
                              ~/.local/state/app-kit/testflight/testflight.log;
                              exits 1 when a step failed for any app
  --version                   this kit's version and the commit it runs from

Exit codes: 0 done; 1 the command failed; 2 wrong usage; 3 check found worker
files that differ, or testflight upload's app did not compile; 4 status found no
host answering.`

/**
 * The commit this copy of the kit runs from: its own checkout's, or, installed from GitHub, the commit the app's
 * bun.lock pinned it to. git looks upward for a checkout, so an installed copy inside an app's checkout would find the
 * app's; only a checkout whose top is the kit's own folder counts.
 */
function commit(): string {
  const kit = realpathSync(join(import.meta.dir, '..'))
  const git = (...args: string[]) => spawnSync('git', ['-C', kit, ...args], { encoding: 'utf8' })
  const top = git('rev-parse', '--show-toplevel')
  if (top.status === 0 && realpathSync(top.stdout.trim()) === kit) return git('rev-parse', '--short', 'HEAD').stdout.trim()
  for (let folder = dirname(kit); folder !== dirname(folder); folder = dirname(folder)) {
    const lock = join(folder, 'bun.lock')
    if (!existsSync(lock)) continue
    const pinned = readFileSync(lock, 'utf8').match(/"app-kit@github:worktron\/app-kit#([0-9a-f]+)"/)
    if (pinned) return pinned[1]
  }
  return 'commit unknown: no checkout of its own and no bun.lock naming it'
}

/** install-host's arguments: three words at most, and its two flags. Null for wrong usage. */
function installHostArguments(args: string[]) {
  const words: string[] = []
  let description: string | undefined
  let fromWorktree = false
  for (let at = 0; at < args.length; at++) {
    if (args[at] === '--description' && at + 1 < args.length) description = args[++at]
    else if (args[at] === '--from-worktree') fromWorktree = true
    else if (args[at]!.startsWith('-')) return null
    else words.push(args[at]!)
  }
  const [name, host, folder = '.', ...extra] = words
  if (!name || !host || extra.length || description === undefined) return null
  return { name, host, extensionFolder: folder, description, fromWorktree }
}

async function extension([command, ...args]: string[]): Promise<boolean> {
  if (command === 'install-host') {
    const options = installHostArguments(args)
    if (!options) return false
    const installed = installHost(options)
    console.log(`Wrote ${installed.manifest}, which tells Chrome to start ${installed.launcher} for the extension ${installed.extensionId}.`)
    console.log(`The host's errors go to ${installed.errorLog}.`)
    console.log(`Load the extension in Chrome from: ${installed.extensionFolder}`)
    return true
  }
  if (command === 'status' && args.length >= 1 && args.length <= 3) {
    const [socket, name, folder] = args as [string, string?, string?]
    try {
      console.log(JSON.stringify(await hostStatus(socket), null, 2))
    } catch (error) {
      if (!(error instanceof NotConnected)) throw error
      console.log(JSON.stringify({ connected: false, ...diagnoseHost({ name, extensionFolder: folder }) }, null, 2))
      process.exit(4)
    }
    return true
  }
  const [argument, ...extra] = args
  if (extra.length) return false
  if (command === 'copy' && argument) {
    console.log(`Copied ${copyWorker(argument).join(', ')} into ${argument}`)
  } else if (command === 'check' && argument) {
    const differs = workerCopyDiffers(argument)
    if (differs.length) {
      console.error(`${differs.join(', ')} in ${argument} differ from app-kit ${packageJson.version}; run: bun run app-kit extension copy ${argument}`)
      process.exit(3)
    }
  } else if (command === 'id') {
    const manifest = JSON.parse(readFileSync(join(argument ?? '.', 'manifest.json'), 'utf8'))
    if (!manifest.key) throw new Error('The manifest has no key, so its ID changes from profile to profile')
    console.log(extensionId(manifest.key))
  } else {
    return false
  }
  return true
}

async function testflight([command, ...args]: string[]): Promise<boolean> {
  if (command === 'upload' && (args.length === 0 || (args.length === 1 && args[0] === '--token-only'))) {
    const code = await upload({ cwd: process.cwd(), tokenOnly: args[0] === '--token-only' })
    if (code !== 0) process.exit(code)
  } else if (command === 'watch' && args.length > 0 && !args.some((url) => url.startsWith('-'))) {
    // Each failure is a line in the watcher's log; the exit code says a pass had one.
    if ((await watch({ urls: args })) > 0) process.exit(1)
  } else {
    return false
  }
  return true
}

async function iphone([command, target, udid, ...extra]: string[]): Promise<boolean> {
  if (command !== 'run' || (target !== 'sim' && target !== 'phone') || udid?.startsWith('-') || extra.length) return false
  const code = await runIphone({ target, udid, cwd: process.cwd() })
  if (code !== 0) process.exit(code)
  return true
}

function iphoneSimulator([command, udid, ...extra]: string[]): boolean {
  if (command !== 'quiet' || !udid || extra.length) return false
  const { code, line } = quietSimulator(udid)
  if (code === 0) console.log(line)
  else {
    console.error(line)
    process.exit(code)
  }
  return true
}

async function main([part, ...rest]: string[]) {
  if (part === 'extension' && (await extension(rest))) return
  if (part === 'iphone' && (await iphone(rest))) return
  if (part === 'iphone-simulator' && iphoneSimulator(rest)) return
  if (part === 'testflight' && (await testflight(rest))) return
  if (part === '--version' && rest.length === 0) {
    console.log(`app-kit ${packageJson.version} (${commit()})`)
  } else if ((part === undefined || part === '--help' || part === '-h' || part === 'help') && rest.length === 0) {
    console.log(USAGE)
  } else {
    console.error(USAGE)
    process.exit(2)
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
