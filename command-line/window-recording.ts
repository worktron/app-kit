// Recording one window of a program, such as the signed-in Chrome of a demo video, on a display nobody sees. The Swift
// program in swift/window-recording makes the display and records the window with ScreenCaptureKit; this file builds
// it into app-kit's state folder from the kit bun installed and drives it over its standard input and output, whose
// lines the program's main.swift lists. While a recording runs it also watches which app is in front, since the owner's
// keyboard must never land in the recorded window.

import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { runCommand, type Run } from './run.ts'
import { stateFolder } from '../tauri/state.ts'

/** The Swift package, in the kit's own folder wherever bun installed it. */
export const RECORDER_PACKAGE = join(import.meta.dir, '..', 'swift', 'window-recording')

/**
 * Builds the recording program with Swift's package manager into app-kit's state folder, never into the installed kit,
 * and gives its path. An unchanged package builds in a second or two, so every run builds it.
 */
export async function buildRecorder(run: Run = runCommand, env: Record<string, string | undefined> = process.env): Promise<string> {
  const scratch = join(stateFolder('window-recording', env), 'build')
  const built = await run(['swift', 'build', '-c', 'release', '--package-path', RECORDER_PACKAGE, '--scratch-path', scratch, '--product', 'window-recording'], { timeoutMs: 600_000 })
  if (built.code !== 0) throw new Error(`The window recording program did not build (swift build exited ${built.code}):\n${built.out.slice(-2000)}`)
  return join(scratch, 'release', 'window-recording')
}

/** A hidden display, up, with its window place, and the recording of one window on it. */
export type HiddenDisplay = {
  /** Where a window's top left goes, in global points, to be on the hidden display. */
  left: number
  top: number
  /** Finds `pid`'s window on the display and starts recording it, giving the first frame's time in milliseconds since 1970. */
  record: (pid: number) => Promise<number>
  /** Finishes the file. Throws when the recorded program took focus at any time while it recorded. */
  stop: () => Promise<void>
  /**
   * Removes the display and ends the program. Close the recorded program first: macOS moves a window still on a display
   * that goes onto the owner's screen.
   */
  close: () => Promise<void>
  /**
   * Settles when the program ends, asked or not. A caller closes the recorded program the moment it settles, since a
   * program that crashed took its display with it and macOS moves the window onto the owner's screen.
   */
  ended: Promise<void>
}

/** What the recording program said went wrong, by its kind: usage, screen-recording, display or recording. */
export class RecordingFailed extends Error {
  constructor(
    readonly kind: string,
    message: string,
  ) {
    super(kind === 'screen-recording' ? `${message}. Nothing was recorded.` : message)
  }
}

/** Reads the program's lines as they come and gives the next one starting with a word, or its error. */
class Lines {
  private seen: string[] = []
  private waiting: (() => void)[] = []
  private ended = false
  /** The end of what the program wrote on standard error, for the message when it ends unasked. */
  private errors = ''

  constructor(child: ChildProcessWithoutNullStreams) {
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.errors = (this.errors + chunk).slice(-2000)
    })
    let partial = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      const lines = (partial + chunk).split('\n')
      partial = lines.pop() ?? ''
      this.seen.push(...lines.filter(Boolean))
      this.wake()
    })
    child.on('close', () => {
      this.ended = true
      this.wake()
    })
  }

  private wake(): void {
    for (const resolve of this.waiting.splice(0)) resolve()
  }

  /** The next line that starts with `word`, its words after it; throws on an error line or when the program ends first. */
  async next(word: string): Promise<string[]> {
    for (;;) {
      const at = this.seen.findIndex((line) => line.startsWith(`${word} `) || line === word || line.startsWith('error '))
      if (at >= 0) {
        const [line] = this.seen.splice(at, 1) as [string]
        const error = /^error ([a-z-]+): (.*)$/.exec(line)
        if (error) throw new RecordingFailed(error[1]!, error[2]!)
        return line.split(' ').slice(1)
      }
      if (this.ended) {
        const said = this.errors.trim() ? `: ${this.errors.trim().split('\n').slice(-5).join(' ')}` : ''
        throw new RecordingFailed('recording', `the window recording program ended before it said "${word}"${said}`)
      }
      await new Promise<void>((resolve) => this.waiting.push(resolve))
    }
  }
}

/** The pid of the app in front, from LaunchServices, or undefined when it does not say. */
export function frontmostPid(): number | undefined {
  const front = spawnSync('lsappinfo', ['front'], { encoding: 'utf8' }).stdout.trim()
  if (!front) return undefined
  const info = spawnSync('lsappinfo', ['info', '-only', 'pid', front], { encoding: 'utf8' }).stdout
  const pid = /pid = (\d+)/.exec(info)?.[1]
  return pid ? Number(pid) : undefined
}

/**
 * Starts the recording program, which makes the hidden display for a `width` by `height` point window and records it
 * to `out` at `scale` pixels per point. `program` is the built program (`buildRecorder`); `front` gives the app in
 * front, checked every half second while a recording runs.
 */
export async function openHiddenDisplay(
  options: { width: number; height: number; out: string; scale?: 1 | 2 },
  program: string,
  front: () => number | undefined = frontmostPid,
): Promise<HiddenDisplay> {
  const child = spawn(program, ['--width', String(options.width), '--height', String(options.height), '--out', options.out, '--scale', String(options.scale ?? 2)], { stdio: ['pipe', 'pipe', 'pipe'] })
  // A write after the program ended fails with EPIPE; the line reader already says it ended, which is the error the
  // caller gets.
  child.stdin.on('error', () => {})
  const lines = new Lines(child)
  // 'close', not 'exit': the program's last lines, such as its error, are read by then.
  const ended = new Promise<void>((resolve) => child.on('close', () => resolve()))
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.stdin.end()
      await ended
    }
  }
  let words: string[]
  try {
    words = await lines.next('display')
  } catch (error) {
    await close()
    throw error
  }
  let watch: ReturnType<typeof setInterval> | undefined
  let recorded: number | undefined
  let tookFocus = false
  const check = () => {
    if (recorded !== undefined && front() === recorded) tookFocus = true
  }
  return {
    left: Number(words[1]),
    top: Number(words[2]),
    record: async (pid) => {
      child.stdin.write(`record ${pid}\n`)
      const [at] = await lines.next('recording')
      recorded = pid
      check()
      watch = setInterval(check, 500)
      return Number(at)
    },
    stop: async () => {
      clearInterval(watch)
      check()
      child.stdin.write('stop\n')
      await lines.next('stopped')
      if (tookFocus) throw new RecordingFailed('recording', 'the recorded program came to the front while it recorded, so the owner\'s keys could have reached it')
    },
    close,
    ended,
  }
}
