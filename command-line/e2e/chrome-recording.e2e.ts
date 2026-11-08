// Google Chrome recorded on the hidden display, for real, as a demo video records it: a fresh profile of the test's own
// (signed in to nothing), its one window made on the hidden display in the background, a page whose color changes
// recorded for three seconds, and the mp4 read back. Chrome shows its icon in the Dock while it runs; its window is on
// the hidden display, and one Chrome put anywhere else is closed at once and fails the test, as does a sighting of its window
// on any of the owner's displays, which a watcher of the screen's window list looks for every 20 milliseconds. The owner runs it in their
// own terminal, never an agent or the gates. Needs Screen Recording permission for the app it is started from, and ffmpeg.
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { watchWindows } from '../../swift/window-recording/e2e/watch.ts'
import { withoutPage } from '../../test/dom.ts'
import { drive } from '../signed-in-chrome.ts'
import { buildRecorder, frontmostPid, openHiddenDisplay } from '../window-recording.ts'

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'app-kit-chrome-recording-e2e-')))
// The tests' simulated page replaces fetch with one that refuses Chrome's DevTools answer as another origin's.
let putPageBack: () => void
beforeAll(async () => {
  putPageBack = await withoutPage()
})
afterAll(() => {
  putPageBack()
  rmSync(dir, { recursive: true, force: true })
})

const PAGE = `data:text/html,<title>app-kit Chrome recording test</title><style>body{margin:0;height:100vh;display:grid;place-items:center;font:48px system-ui;animation:c 1s infinite}@keyframes c{0%{background:%23d33}50%{background:%233d3}100%{background:%2333d}}</style><body>app-kit Chrome recording test`

test('a Chrome window on the hidden display is recorded with its address bar, never taking focus', async () => {
  const out = join(dir, 'chrome.mp4')
  const profile = join(dir, 'profile')
  mkdirSync(profile)
  const before = frontmostPid()
  const display = await openHiddenDisplay({ width: 1280, height: 800, out }, await buildRecorder())
  // Watched from before Chrome starts until after the display is gone, so a window of Chrome's on the owner's screens at
  // any moment, its first frame and its last included, fails the test.
  const watch = await watchWindows(dir, 'Google Chrome', display.left, display.top)
  const log: string[] = []
  try {
    const chrome = await drive(profile, (line) => log.push(line), { left: display.left, top: display.top, width: 1280, height: 800 })
    // A recording program that ends unasked took the display with it: Chrome goes at once, before anyone sees its window.
    void display.ended.then(() => chrome.close())
    try {
      await chrome.page!.goto(PAGE)
      await display.record(chrome.pid)
      await chrome.page!.waitForTimeout(3000)
      await display.stop()
    } finally {
      await chrome.close()
    }
  } finally {
    await display.close()
  }
  expect(await watch.stop()).toEqual([])
  expect(frontmostPid()).toBe(before)
  const probe = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', out], { encoding: 'utf8' }).stdout) as {
    streams: { width: number; height: number }[]
    format: { duration: string }
  }
  // The whole window, its toolbar and address bar included, at two pixels per point.
  expect(probe.streams[0]!.width).toBe(2560)
  expect(probe.streams[0]!.height).toBeGreaterThanOrEqual(1600)
  expect(Number(probe.format.duration)).toBeGreaterThan(2)
  const frame = (at: string) => spawnSync('ffmpeg', ['-v', 'error', '-ss', at, '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 26 }).stdout
  expect(Buffer.compare(frame('0.5'), frame('1.0'))).not.toBe(0)
  // The last frame, address bar included, kept where CHROME_RECORDING_FRAME names, for a look.
  const keep = process.env.CHROME_RECORDING_FRAME
  if (keep) spawnSync('ffmpeg', ['-v', 'error', '-y', '-sseof', '-0.5', '-i', out, '-frames:v', '1', keep])
}, 180_000)
