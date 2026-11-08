import { afterAll, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openHiddenDisplay, RecordingFailed } from '../command-line/window-recording.ts'

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
