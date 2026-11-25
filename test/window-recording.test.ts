import { afterAll, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openHiddenDisplay, RecordingFailed, watchResult, watchWindows } from '../command-line/window-recording.ts'
import type { Run } from '../command-line/run.ts'

// A stand-in for the Swift program, speaking its lines (swift/window-recording/Sources/window-recording/main.swift), so
// these tests make no display, record nothing and need no Screen Recording permission.
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'app-kit-window-recording-')))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function standIn(name: string, onRecord: string): string {
  const script = join(dir, `${name}.js`)
  writeFileSync(
    script,
    `console.log('display 9 2620 1500')
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  const lines = buffer.split('\\n')
  buffer = lines.pop()
  for (const line of lines) {
    if (line.startsWith('record ')) { console.log(${JSON.stringify(onRecord)}); if (${JSON.stringify(onRecord)}.startsWith('error')) process.exit(4) }
    if (line === 'stop') console.log('stopped')
  }
})
process.stdin.on('end', () => process.exit(0))
`,
  )
  const program = join(dir, name)
  writeFileSync(program, `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`)
  chmodSync(program, 0o755)
  return program
}

const recording = standIn('records', 'recording 1762600000123')
const refused = standIn('refused', 'error screen-recording: macOS has not allowed this program to record the screen')

test('the display says where the window goes, and a recording gives its first frame time and finishes', async () => {
  const display = await openHiddenDisplay({ width: 1280, height: 800, out: join(dir, 'take.mp4') }, recording, () => 1)
  expect([display.left, display.top]).toEqual([2620, 1500])
  expect(await display.record(4242)).toBe(1762600000123)
  await display.stop()
  await display.close()
})

test('a Mac that has not allowed screen recording stops the run, saying nothing was recorded', async () => {
  const display = await openHiddenDisplay({ width: 1280, height: 800, out: join(dir, 'take.mp4') }, refused, () => 1)
  const failure = await display.record(4242).catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(RecordingFailed)
  expect((failure as RecordingFailed).kind).toBe('screen-recording')
  expect((failure as RecordingFailed).message).toContain('Nothing was recorded')
  await display.close()
})

test('a recorded program that came to the front fails the recording', async () => {
  const display = await openHiddenDisplay({ width: 1280, height: 800, out: join(dir, 'take.mp4') }, recording, () => 4242)
  await display.record(4242)
  const failure = await display.stop().catch((error: unknown) => error)
  expect(String(failure)).toContain('came to the front')
  await display.close()
})

test('the window watch gives its sightings once it watched the whole run and saw the program\'s window', () => {
  expect(watchResult('Google Chrome', 'watching\ndone 0 40\n', 0, true)).toEqual([])
  expect(watchResult('Google Chrome', 'watching\noutside 5 10 20 1280 800\ndone 1 40\n', 0, true)).toEqual(['outside 5 10 20 1280 800'])
})

test('a window watch that saw no window of the program fails rather than passing having watched nothing', () => {
  expect(() => watchResult('Google Chrome', 'watching\ndone 0 0\n', 0, true)).toThrow('saw no window of Google Chrome anywhere')
})

test('a window watch that ended before it was asked, or never said it finished, fails', () => {
  expect(() => watchResult('Google Chrome', 'watching\ndone 0 40\n', 0, false)).toThrow('before it was asked to')
  expect(() => watchResult('Google Chrome', 'watching\n', null, true)).toThrow('did not watch the whole run')
  expect(() => watchResult('Google Chrome', 'watching\ndone 0 40\n', 1, true)).toThrow('did not watch the whole run')
})

test('the recording program runs in a process group of its own, so a Ctrl-C in the terminal never ends it before the recorded program', async () => {
  const groupFile = join(dir, 'group')
  const program = join(dir, 'tells-group')
  writeFileSync(program, `#!/bin/sh\nps -o pgid= -p $$ > '${groupFile}'\nexec '${recording}' "$@"\n`)
  chmodSync(program, 0o755)
  const display = await openHiddenDisplay({ width: 640, height: 400, out: join(dir, 'group.mp4') }, program)
  await display.close()
  const own = spawnSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).stdout.trim()
  expect(readFileSync(groupFile, 'utf8').trim()).not.toBe(own)
})

test('a watch stopped after its program said it finished gives what it saw, its finish line read once the program ended', async () => {
  // A stand-in for the window watch program, built by a stand-in swift build into the state folder: it prints its
  // finish line only as its standard input closes, as the real one does.
  const state = join(dir, 'watch-state')
  const program = join(state, 'app-kit', 'window-recording', 'build', 'release', 'window-watch')
  mkdirSync(join(program, '..'), { recursive: true })
  const script = join(dir, 'watch-stand-in.js')
  writeFileSync(script, `console.log('watching')
console.log('outside 7 10 20 1280 800')
process.stdin.resume()
process.stdin.on('end', () => { setTimeout(() => { console.log('done 1 12'); process.exit(0) }, 50) })
`)
  writeFileSync(program, `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`)
  chmodSync(program, 0o755)
  const built: string[][] = []
  const run: Run = async (command) => {
    built.push(command)
    return { code: 0, out: '', stdout: '', stderr: '', timedOut: false }
  }
  const watch = await watchWindows('Google Chrome', 2620, 1500, run, { XDG_STATE_HOME: state })
  expect(await watch.stop()).toEqual(['outside 7 10 20 1280 800'])
  expect(built[0]).toContain('window-watch')
})
