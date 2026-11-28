// The guard drive() starts beside every Chrome, held against a stand-in program instead of a real Google Chrome: while a
// real one runs, macOS sends AppleScript's messages to "Google Chrome" to it instead of the owner's own, and many
// threads run these tests on one Mac. The stand-in is /bin/sleep whose command line carries a made-up
// --user-data-dir, as Chrome's does. Each caller is a program of its own, so it can be killed the ways a real one dies.
// command-line/e2e/signed-in-chrome-quits.e2e.ts holds the same with a real Chrome, run by hand.
import { afterAll, expect, test } from 'bun:test'
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { alive } from '../tauri/state.ts'

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'app-kit-chrome-guard-')))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// The caller: starts a guard over the program its environment names and says the guard's pid. Then it waits to be
// killed ("wait"), or stops the guard as drive() does once Chrome has closed and returns ("stop"), or returns at once
// ("return"), with nothing else keeping it running.
const caller = join(dir, 'caller.ts')
writeFileSync(
  caller,
  `import { quitWithCaller } from ${JSON.stringify(join(import.meta.dir, '..', 'command-line', 'signed-in-chrome.ts'))}
const guard = quitWithCaller(Number(process.env.GUARD_PID), process.env.GUARD_PROFILE!)
console.log("guard " + guard.pid)
if (process.env.GUARD_MODE === 'stop') await guard.stop()
else if (process.env.GUARD_MODE === 'wait') setInterval(() => {}, 60_000)
`,
)

type Started = { child: ChildProcess; exited: Promise<void> }

function started(child: ChildProcess): Started {
  return { child, exited: new Promise((resolve) => child.on('exit', () => resolve())) }
}

/** A program whose command line holds `--user-data-dir=<profile>` as Chrome's does, or no profile when `profile` is undefined. */
function standIn(profile: string | undefined): Started {
  const name = profile ? `stand-in --user-data-dir=${profile}` : 'stand-in'
  return started(spawn('/bin/sh', ['-c', 'exec -a "$0" /bin/sleep 600', name], { stdio: 'ignore' }))
}

/** A caller guarding `pid`; `guard` gives its guard's pid once it has said it. */
function guarding(pid: number, profile: string, mode: 'wait' | 'stop' | 'return'): Started & { guard: Promise<number> } {
  const one = started(spawn(process.execPath, [caller], { cwd: dir, env: { ...process.env, GUARD_PID: String(pid), GUARD_PROFILE: profile, GUARD_MODE: mode }, stdio: ['ignore', 'pipe', 'inherit'] }))
  const guard = new Promise<number>((resolve, reject) => {
    let out = ''
    one.child.stdout!.on('data', (chunk: Buffer) => {
      out += chunk.toString()
      const said = /guard (\d+)/.exec(out)
      if (said) resolve(Number(said[1]))
    })
    void one.exited.then(() => reject(new Error(`the caller ended before it said its guard: ${out}`)))
  })
  return { ...one, guard }
}

/** Whether `fact` came within `limit` milliseconds, the bound on a failing case. */
async function within(fact: Promise<void>, limit: number): Promise<boolean> {
  return await Promise.race([fact.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), limit))])
}

async function untilGone(pid: number, limit: number): Promise<boolean> {
  const end = Date.now() + limit
  while (alive(pid) && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 20))
  return !alive(pid)
}

/** Kills by number whatever a test started that is still running. */
function end(...pids: (number | undefined)[]): void {
  for (const pid of pids) {
    if (!pid) continue
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
}

test.concurrent('a caller killed outright takes its Chrome with it', async () => {
  const profile = join(dir, 'killed')
  const chrome = standIn(profile)
  const one = guarding(chrome.child.pid!, profile, 'wait')
  let guard: number | undefined
  try {
    guard = await one.guard
    one.child.kill('SIGKILL')
    expect(await within(chrome.exited, 10_000)).toBe(true)
    expect(await untilGone(guard, 10_000)).toBe(true)
  } finally {
    end(chrome.child.pid, one.child.pid, guard)
  }
}, 15_000)

test.concurrent('a caller stopped by a signal it has no handler for takes its Chrome with it', async () => {
  const profile = join(dir, 'terminated')
  const chrome = standIn(profile)
  const one = guarding(chrome.child.pid!, profile, 'wait')
  let guard: number | undefined
  try {
    guard = await one.guard
    one.child.kill('SIGTERM')
    expect(await within(chrome.exited, 10_000)).toBe(true)
    expect(await untilGone(guard, 10_000)).toBe(true)
  } finally {
    end(chrome.child.pid, one.child.pid, guard)
  }
}, 15_000)

test.concurrent('a caller that stops its guard and returns exits on its own, leaving no guard and its program untouched', async () => {
  const profile = join(dir, 'returns')
  const chrome = standIn(profile)
  const one = guarding(chrome.child.pid!, profile, 'stop')
  let guard: number | undefined
  try {
    guard = await one.guard
    expect(await within(one.exited, 5000)).toBe(true)
    expect(one.child.exitCode).toBe(0)
    expect(alive(guard)).toBe(false)
    expect(chrome.child.exitCode).toBeNull()
    expect(chrome.child.signalCode).toBeNull()
  } finally {
    end(chrome.child.pid, one.child.pid, guard)
  }
}, 15_000)

test.concurrent('a caller that returns without stopping its guard still exits, and its program goes with it', async () => {
  const profile = join(dir, 'forgot')
  const chrome = standIn(profile)
  const one = guarding(chrome.child.pid!, profile, 'return')
  let guard: number | undefined
  try {
    guard = await one.guard
    // The guard holds nothing on the caller's event loop, so the caller ends, and its end closes the guard's pipe.
    expect(await within(one.exited, 5000)).toBe(true)
    expect(await within(chrome.exited, 10_000)).toBe(true)
    expect(await untilGone(guard, 10_000)).toBe(true)
  } finally {
    end(chrome.child.pid, one.child.pid, guard)
  }
}, 20_000)

test.concurrent('a number that no longer holds the profile is never signaled', async () => {
  const profile = join(dir, 'reused')
  // The number now belongs to a program started without the profile, as when macOS has given Chrome's to another.
  const other = standIn(undefined)
  const one = guarding(other.child.pid!, profile, 'wait')
  let guard: number | undefined
  try {
    guard = await one.guard
    one.child.kill('SIGKILL')
    // The guard has made its decision once it has gone; the program is still running then.
    expect(await untilGone(guard, 10_000)).toBe(true)
    expect(other.child.exitCode).toBeNull()
    expect(other.child.signalCode).toBeNull()
  } finally {
    end(other.child.pid, one.child.pid, guard)
  }
}, 15_000)

test.concurrent('a profile whose name only starts with the guarded one is not taken for it', async () => {
  const profile = join(dir, 'prefix')
  const other = standIn(`${profile}-other`)
  const one = guarding(other.child.pid!, profile, 'wait')
  let guard: number | undefined
  try {
    guard = await one.guard
    one.child.kill('SIGKILL')
    expect(await untilGone(guard, 10_000)).toBe(true)
    expect(other.child.exitCode).toBeNull()
    expect(other.child.signalCode).toBeNull()
  } finally {
    end(other.child.pid, one.child.pid, guard)
  }
}, 15_000)
