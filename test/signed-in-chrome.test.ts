import { afterAll, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { driveArguments, lastUsedProfile, ordinaryUserAgent, signIn, windowWhereAsked, withProfile } from '../command-line/signed-in-chrome.ts'

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'app-kit-signed-in-chrome-')))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('a run opens the profile Chrome last used, and the first one when Chrome has not said', () => {
  const folder = join(dir, 'profile')
  mkdirSync(folder)
  expect(lastUsedProfile(folder)).toBe('Default')
  writeFileSync(join(folder, 'Local State'), JSON.stringify({ profile: { last_used: 'Profile 1' } }))
  expect(lastUsedProfile(folder)).toBe('Profile 1')
})

test('the user agent names Chrome by its first version number, as an ordinary Chrome does', () => {
  expect(ordinaryUserAgent('Google Chrome 156.0.8078.80 \n')).toContain('Chrome/156.0.0.0 Safari')
  expect(ordinaryUserAgent('Google Chrome 156.0.8078.80')).not.toContain('Headless')
})

const options = { profile: '/profiles/demo', inside: 'Default', port: 9444, userAgent: 'agent' }

test('a headless run opens no window and keeps the debugging port on this Mac', () => {
  const args = driveArguments(options)
  expect(args).toContain('--headless=new')
  expect(args).toContain('--remote-debugging-address=127.0.0.1')
  expect(args).not.toContain('--no-startup-window')
})

test('a run with a window opens none of its own, keeps drawing when covered, and has no automation switch', () => {
  const args = driveArguments({ ...options, window: { left: 2560, top: 1490, width: 1280, height: 800 } })
  expect(args).not.toContain('--headless=new')
  expect(args).toContain('--no-startup-window')
  expect(args).toContain('--disable-backgrounding-occluded-windows')
  expect(args).toContain('--disable-renderer-backgrounding')
  expect(args.some((arg) => arg.startsWith('--enable-automation') || arg === '--remote-debugging-pipe')).toBe(false)
})

test('a second run of the same profile is refused while the first holds it, naming whose profile it is', async () => {
  const folder = join(dir, 'locked')
  let second: unknown
  await withProfile(folder, 'demo videos', async () => {
    // A lock file naming a live process other than this one, as a second run would find the first's.
    writeFileSync(join(folder, 'profile.lock'), String(process.ppid))
    second = await withProfile(folder, 'demo videos', async () => 'ran').catch((error: Error) => error.message)
    writeFileSync(join(folder, 'profile.lock'), String(process.pid))
  })
  expect(String(second)).toContain('Another run holds the demo videos profile')
})

test('a window Chrome moved elsewhere, as macOS moves one it judges off every screen, is caught', () => {
  const asked = { left: 2620, top: 1500, width: 1280, height: 800 }
  expect(windowWhereAsked({ left: 2620, top: 1470 }, asked)).toBe(true)
  expect(windowWhereAsked({ left: 380, top: 636 }, asked)).toBe(false)
  expect(windowWhereAsked({}, asked)).toBe(false)
})

test('sign-in waits for Chrome without stopping the caller, so a redirect server answers while Chrome is open', async () => {
  // A stand-in open(1) that waits until the caller has run, as Chrome stays open until the owner allows the consent.
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const ran = join(dir, 'caller-ran')
  writeFileSync(join(bin, 'open'), `#!/bin/sh\nwhile [ ! -e '${ran}' ]; do sleep 0.05; done\n`)
  chmodSync(join(bin, 'open'), 0o755)
  const path = process.env.PATH
  process.env.PATH = `${bin}:${path}`
  try {
    const signedIn = signIn(join(dir, 'profile'), 'https://accounts.example.com/', () => {})
    await new Promise((resolve) => setTimeout(resolve, 0))
    writeFileSync(ran, 'yes')
    await signedIn
  } finally {
    process.env.PATH = path
  }
})
