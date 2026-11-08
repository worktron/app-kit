// The window recording for real: the program built as an app builds it, the hidden display made, a test window of
// its own shown there (no Dock icon, never active), three seconds recorded, and the mp4 read back with ffprobe and
// ffmpeg. Nothing shows on the owner's screens, though macOS moves their other displays aside for a moment as the
// display appears. Needs Screen Recording permission for the app the run is started from, and ffmpeg. scripts/gates.sh
// runs it when a branch changes the recording.
import { afterAll, expect, test } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildRecorder, frontmostPid, openHiddenDisplay } from '../../../command-line/window-recording.ts'

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'app-kit-window-recording-e2e-')))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('a window on the hidden display is recorded to an mp4 at twice its size, its frames changing', async () => {
  const testWindow = join(dir, 'test-window')
  const built = spawnSync('swiftc', ['-O', join(import.meta.dir, 'test-window.swift'), '-o', testWindow], { encoding: 'utf8' })
  expect(built.stderr).toBe('')
  const out = join(dir, 'take.mp4')
  const before = frontmostPid()
  const display = await openHiddenDisplay({ width: 640, height: 400, out }, await buildRecorder())
  const shown = spawn(testWindow, [String(display.left), String(display.top), '640', '400'], { stdio: ['pipe', 'pipe', 'inherit'] })
  try {
    const pid = await new Promise<number>((resolve) => shown.stdout.on('data', (chunk: Buffer) => resolve(Number(/shown (\d+)/.exec(String(chunk))?.[1]))))
    const startedAt = await display.record(pid)
    expect(Math.abs(Date.now() - startedAt)).toBeLessThan(10_000)
    await new Promise((resolve) => setTimeout(resolve, 3000))
    await display.stop()
  } finally {
    shown.stdin.end()
    await display.close()
  }
  expect(frontmostPid()).toBe(before)
  const probe = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name:format=duration', '-of', 'json', out], { encoding: 'utf8' }).stdout) as {
    streams: { width: number; height: number; codec_name: string }[]
    format: { duration: string }
  }
  expect(probe.streams[0]).toEqual({ width: 1280, height: 800, codec_name: 'h264' })
  expect(Number(probe.format.duration)).toBeGreaterThan(2)
  // Two frames a second apart differ, so the window kept drawing and the recording kept taking it.
  const frame = (at: string) => spawnSync('ffmpeg', ['-v', 'error', '-ss', at, '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 24 }).stdout
  expect(Buffer.compare(frame('0.5'), frame('1.5'))).not.toBe(0)
}, 120_000)
