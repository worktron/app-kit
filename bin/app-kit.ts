#!/usr/bin/env bun
// app-kit <part> <command>: the kit's command line. The extension kit copies the
// kit's worker files and the plain look's stylesheet into an extension, checks the copy, prints an extension's
// ID, tells Chrome about a native host, and prints a native host's status, or
// why nothing is connected. The iPhone part builds a Tauri app and starts it on
// a Simulator or a paired iPhone. The iPhone simulator part sends a
// simulator's sound to BlackHole so it plays nowhere. The TestFlight part uploads
// an iPhone build, and watches apps' main to upload after each landing. The Mac
// part publishes a Mac app's release, which its installed copies update to, and
// makes the key that signs it. The icons part draws every icon an app ships from
// its drawings.

import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { answerHelpOrVersion, versionLine, wrongUsage } from '../command-line/index.ts'
import { copyWorker, workerCopyDiffers } from '../extension/copy.ts'
import { listingChecklist, privacyPolicyAnswers, privacyPolicyLink } from '../extension/listing.ts'
import { diagnoseHost, extensionId, hostStatus, installHost, NotConnected } from '../extension/host/index.ts'
import { isColor, renderIcons } from '../icons/render.ts'
import { makeKey } from '../tauri/mac-release/key.ts'
import { release } from '../tauri/mac-release/release.ts'
import packageJson from '../package.json'
import { runIphone } from '../tauri/iphone-run/index.ts'
import { quietSimulator } from '../tauri/iphone-simulator/index.ts'
import { clock, MINUTES, MOST_MINUTES, setTime, watchSimulator } from '../tauri/iphone-simulator/lifetime.ts'
import { stateFolder } from '../tauri/state.ts'
import { upload } from '../tauri/testflight/upload.ts'
import { drive, readSteps } from '../web/drive.ts'
import { watch } from '../tauri/testflight/watch.ts'

const USAGE = `app-kit <part> <command>

  extension copy <folder>     write the kit's worker files directly into <folder>, the
                              folder the worker imports them from, as extension/kit,
                              with look.css, the plain look's stylesheet for its pages;
                              refuses a folder whose copies live in a folder below it
  extension check <folder>    exit 3 when <folder>'s worker files or look.css differ from this kit's
  extension id [<folder>]     the extension's ID, from the key in <folder>/manifest.json
  extension listing [<folder>] [--json]
                              hold <folder>'s store-listing.md, the Chrome Web Store
                              listing, to its manifest.json, . by default: the summary,
                              each permission's reason, the remote-code answer, the 128
                              icon and the privacy link; prints passed, failed or yours
                              (the dashboard's steps) per line, or a JSON list with
                              --json, and exits 1 when any failed
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
  icons render [<drawings>] [--icon-set <set>]... [--tauri <src-tauri>] [--menu-bar <imageset>]
               [--extension <folder>] [--toolbar-color <#hex>] [--web <folder>]
                              draw every icon an app ships from the drawings in
                              <drawings> (design/icon by default): app-icon.svg, 1024
                              square with its tile on Apple's grid, mark.svg and
                              glyph.svg. --icon-set fills an Xcode AppIcon.appiconset
                              from its Contents.json, the Mac's from the app icon and the
                              iPhone's from its tile; --tauri the icons tauri.conf.json
                              lists; --menu-bar copies glyph.svg into a template image
                              set; --extension writes icon-16, -32, -48 and -128 from
                              the mark, the 16 and 32 in --toolbar-color when given;
                              --web writes favicon.ico, apple-touch-icon.png, icon-192.png
                              and icon-512.png. Needs sharp: bun add -d sharp
  iphone run sim [<udid>]     from a Tauri app's checkout: build its iPhone app and start
                              it on this checkout's own Simulator (made once, an iPhone 17,
                              named after the app, and in a worktree after its folder too),
                              with no window and its sound sent to BlackHole; <udid> picks
                              another Simulator. At most two run on the Mac at once, and one
                              this boots shuts down 10 minutes after the app starts, or when
                              the checkout is gone. How to tap and look at it: the README's
                              "Testing the iPhone app yourself"
  iphone run phone [<udid>]   build it signed for development and start it on the paired
                              iPhone, first adding the phone to the team's development
                              profile when none holds it; <udid> picks the phone
  iphone-simulator keep <udid> [<minutes>]
                              move the shut-down time of a Simulator iphone run sim booted
                              to <minutes> from now, 10 by default and 30 at most
  iphone-simulator quiet <udid>
                              send the simulator <udid>'s sound to BlackHole: a booted
                              one restarts once when it plays elsewhere, a shut-down
                              one has the setting saved for its next boot; prints
                              one line, and exits 0 even when BlackHole is missing,
                              1 only when the simulator did not boot again
  mac release                 from a Tauri app's folder, at landed code: build its Mac app
                              signed by the identity tauri.conf.json names, sign the update
                              with the key in 1Password (Touch ID), and publish it as the
                              next release in the public GitHub repository its updater
                              asks, which every installed copy then offers as an update
  mac key <owner>/<repository>
                              make the key that signs the app's updates, once, keep it in
                              1Password's Personal vault, and print the plugins.updater
                              block for tauri.conf.json, with <owner>/<repository> the
                              releases' public repository; refuses when the key exists
  testflight upload [--token-only]
                              from a Tauri app's checkout at a commit of origin/main:
                              build its iPhone app, check it, upload it to TestFlight
                              and wait until App Store Connect has processed it.
                              --token-only reads the key only through the keychain's
                              1Password token, never the signed-in op
  testflight watch <git url>[#<folder>]...
                              one pass: for each app whose main moved and changed its
                              iPhone app, or whose newest build expires within 15 days,
                              build main's commit in a clone of its own and upload it;
                              #<folder> names a Tauri project in a subfolder; one line
                              per decision in
                              ~/.local/state/app-kit/testflight/testflight.log;
                              exits 1 when a step failed for any app
  web drive <address> <steps.json> <out folder>
                              drive the app served at <address> in a fresh hidden
                              Chromium from a steps file, for a persona walk-through or a
                              store's screenshots: goto, click, fill, waitFor, signIn,
                              clockAt, advance, read (the accessibility tree printed and a
                              screenshot) and shot (an image at the steps file's size:
                              phone, desktop, chrome-store, iphone-6.3, iphone-6.9,
                              ipad-13); refuses every request not to <address>, and plays
                              no sound; the README's "Driving the app headless" has the
                              format; exits 1 when a step failed
  --version                   this kit's version and the commit it runs from

Exit codes: 0 done; 1 the command failed; 2 wrong usage; 3 check found worker
files that differ, or testflight upload's app did not compile; 4 status found no
host answering.`


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
  if (command === 'listing') {
    const json = args.includes('--json')
    const words = args.filter((word) => word !== '--json')
    if (words.length > 1 || words[0]?.startsWith('-')) return false
    const folder = words[0] ?? '.'
    const items = listingChecklist(folder)
    const link = privacyPolicyLink(folder)
    const firstYours = items.findIndex((item) => item.result === 'yours')
    if (link) items.splice(firstYours === -1 ? items.length : firstYours, 0, await privacyPolicyAnswers(link))
    if (json) console.log(JSON.stringify(items, null, 2))
    else {
      for (const item of items) console.log(`${item.result.padEnd(6)}  ${item.line}`)
      console.log('These checks compare the listing file with the manifest. Whether each sentence is true is yours to read.')
    }
    if (items.some((item) => item.result === 'failed')) process.exit(1)
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

/** icons render's arguments: the drawings folder at most, and its flags. Null for wrong usage. */
function iconsArguments(args: string[]) {
  const words: string[] = []
  const iconSets: string[] = []
  const flags: Record<string, string> = {}
  const single = ['--tauri', '--menu-bar', '--extension', '--toolbar-color', '--web']
  for (let at = 0; at < args.length; at++) {
    const flag = args[at]!
    const value = args[at + 1]
    if ((flag === '--icon-set' || single.includes(flag)) && value !== undefined && !value.startsWith('--')) {
      at++
      if (flag === '--icon-set') iconSets.push(value)
      else if (flag in flags) return null
      else flags[flag] = value
    } else if (flag.startsWith('-')) return null
    else words.push(flag)
  }
  const [drawings = 'design/icon', ...extra] = words
  const color = flags['--toolbar-color']
  if (extra.length || (color !== undefined && (!isColor(color) || !flags['--extension']))) return null
  const options = {
    drawings,
    iconSets,
    tauri: flags['--tauri'],
    menuBar: flags['--menu-bar'],
    extension: flags['--extension'],
    toolbarColor: color,
    web: flags['--web'],
  }
  if (!iconSets.length && !options.tauri && !options.menuBar && !options.extension && !options.web) return null
  return options
}

async function icons([command, ...args]: string[]): Promise<boolean> {
  const options = command === 'render' ? iconsArguments(args) : null
  if (!options) return false
  const written = await renderIcons(options)
  console.log(`Drew ${written.length} icon files from ${options.drawings}; commit them with the drawings.`)
  return true
}

async function mac([command, ...args]: string[]): Promise<boolean> {
  let code: number
  if (command === 'release' && args.length === 0) code = await release({ cwd: process.cwd() })
  else if (command === 'key' && args.length === 1 && !args[0]!.startsWith('-')) code = await makeKey({ cwd: process.cwd(), repository: args[0]! })
  else return false
  if (code !== 0) process.exit(code)
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

async function iphoneSimulator([command, udid, ...extra]: string[]): Promise<boolean> {
  if (!udid || udid.startsWith('-')) return false
  const folder = stateFolder('simulators')
  if (command === 'keep' && extra.length <= 1) {
    const minutes = extra.length ? Number(extra[0]) : MINUTES
    if (!Number.isInteger(minutes) || minutes < 1) return false
    const held = setTime({ folder }, udid, minutes)
    if (!held) {
      console.error(`[iphone-simulator] app-kit holds no shut-down time for ${udid}: app-kit iphone run sim did not boot it, or it has shut down already`)
      process.exit(1)
    }
    console.log(`[iphone-simulator] "${held.name}" (${udid}) shuts down at ${clock(held.until)}, in ${Math.min(minutes, MOST_MINUTES)} minutes`)
    return true
  }
  // The watcher `iphone run sim` starts for a Simulator it boots, in a session of its own; not a command for people.
  if (command === 'watch' && (extra.length === 0 || (extra.length === 2 && extra[0] === '--every' && Number(extra[1]) > 0))) {
    await watchSimulator({ folder, watchEveryMs: extra.length ? Number(extra[1]) : undefined }, udid)
    return true
  }
  if (command !== 'quiet' || extra.length) return false
  const { code, line } = quietSimulator(udid)
  if (code === 0) console.log(line)
  else {
    console.error(line)
    process.exit(code)
  }
  return true
}

async function web([command, ...args]: string[]): Promise<boolean> {
  if (command !== 'drive' || args.length !== 3 || args.some((arg) => arg.startsWith('-'))) return false
  const [address, stepsFile, out] = args as [string, string, string]
  if (!/^https?:\/\//.test(address)) return false
  mkdirSync(out, { recursive: true })
  const code = await drive({ address: address.replace(/\/$/, ''), steps: readSteps(readFileSync(stepsFile, 'utf8')), out })
  // Exits here whatever the outcome: with the parent watch on, its read of the pipe would keep a finished run waiting.
  process.exit(code)
}

async function main(args: string[]) {
  if (answerHelpOrVersion(args, { usage: USAGE, version: () => versionLine(packageJson, join(import.meta.dir, '..')) })) return
  const [part, ...rest] = args
  if (part === 'extension' && (await extension(rest))) return
  if (part === 'icons' && (await icons(rest))) return
  if (part === 'iphone' && (await iphone(rest))) return
  if (part === 'iphone-simulator' && (await iphoneSimulator(rest))) return
  if (part === 'mac' && (await mac(rest))) return
  if (part === 'testflight' && (await testflight(rest))) return
  if (part === 'web' && (await web(rest))) return
  wrongUsage(USAGE)
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
