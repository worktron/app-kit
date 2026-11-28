// A real Google Chrome started headless by drive() quits when the program that called drive() is killed outright, both
// while Chrome is still starting and once drive() has returned. Each test runs a caller of its own on a fresh profile
// (signed in to nothing) and finds no process naming that profile within 10 seconds of killing it, Chrome's helpers
// included. It is a live test, run by hand (bun test ./command-line/e2e/signed-in-chrome-quits.e2e.ts) and never in the
// gates: while its Chrome runs, macOS sends AppleScript's messages to "Google Chrome" to it instead of the owner's own.
// Skipped on a Mac without Google Chrome.
import { afterAll, expect, test } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHROME } from '../signed-in-chrome.ts'

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'app-kit-chrome-quits-e2e-')))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// The caller: drive() on the profile its environment names, "up" once it returns, then nothing until it is killed, or
// until the test run has gone, so a run killed outright leaves no caller behind (and, with the guard, no Chrome).
const caller = join(dir, 'caller.ts')
writeFileSync(
  caller,
  `import { drive } from ${JSON.stringify(join(import.meta.dir, '..', 'signed-in-chrome.ts'))}
const chrome = await drive(process.env.CHROME_QUITS_PROFILE!, () => {})
console.log("up " + chrome.pid)
setInterval(() => {
  try {
    process.kill(Number(process.env.CHROME_QUITS_TEST_PID), 0)
  } catch {
    process.exit(0)
  }
}, 200)
`,
)

/** Every process whose command line names `profile`, by pid. */
function holding(profile: string): { pid: number; command: string }[] {
  const listed = spawnSync('ps', ['-ww', '-axo', 'pid=,command='], { encoding: 'utf8' }).stdout
  return listed
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null && match[2]!.includes(profile))
    .map((match) => ({ pid: Number(match[1]), command: match[2]! }))
}

async function until(check: () => boolean, limit: number): Promise<boolean> {
  const end = Date.now() + limit
  while (Date.now() < end) {
    if (check()) return true
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return check()
}

/**
 * Starts a caller on a fresh profile, waits for `ready`, kills it outright, and gives what still names the profile 10
 * seconds later (nothing, unless 10 seconds were not enough). Anything still left is killed by its number at the end.
 */
async function killedCaller(name: string, ready: (profile: string, said: () => string) => Promise<boolean>): Promise<string[]> {
  const profile = join(dir, name)
  mkdirSync(profile)
  const child = spawn(process.execPath, [caller], { cwd: dir, env: { ...process.env, CHROME_QUITS_PROFILE: profile, CHROME_QUITS_TEST_PID: String(process.pid) }, stdio: ['ignore', 'pipe', 'inherit'] })
  let out = ''
  child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
  try {
    expect(await ready(profile, () => out)).toBe(true)
    child.kill('SIGKILL')
    await until(() => holding(profile).length === 0, 10_000)
    return holding(profile).map((left) => `${left.pid} ${left.command.slice(0, 160)}`)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    for (const left of holding(profile)) {
      try {
        process.kill(left.pid, 'SIGKILL')
      } catch {
        // already gone
      }
    }
  }
}

const hasChrome = existsSync(CHROME)

test.skipIf(!hasChrome)('a caller killed while its Chrome is still starting leaves no Chrome', async () => {
  const left = await killedCaller('starting', async (profile, said) => {
    // Killed at the first sight of its Chrome, before DevTools has answered.
    const seen = await until(() => holding(profile).some((one) => one.command.startsWith(CHROME)), 30_000)
    return seen && !said().includes('up')
  })
  expect(left).toEqual([])
}, 60_000)

test.skipIf(!hasChrome)('a caller killed after drive() returned leaves no Chrome', async () => {
  const left = await killedCaller('up', async (_profile, said) => await until(() => said().includes('up'), 30_000))
  expect(left).toEqual([])
}, 60_000)
