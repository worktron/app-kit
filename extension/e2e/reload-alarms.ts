// Do an extension's alarms still reach its worker after it reloads itself?
//
// A diagnostic run by hand, never by the gates: each reload waits for Chrome to
// stop the worker and then for the next alarm, about a minute, so 200 take
// about three and a half hours.
//
//   bun extension/e2e/reload-alarms.ts --browser chromium --reloads 200
//   bun extension/e2e/reload-alarms.ts --browser chrome-for-testing --reloads 200
//
// The suspected fault: Chrome delivers an alarm only to the event listeners it
// saved for the worker, an extension's reload clears them, and if the first
// worker after the reload is not seen to add its alarm listener again, every
// alarm goes nowhere until something else (a page's message) starts the
// worker. The kit's self-reload calls chrome.runtime.reload() on every landing,
// so every unpacked extension on the kit meets it.
//
// The kit's harness cannot see it: Playwright attaches DevTools to the worker,
// and Chrome never stops a worker DevTools is attached to. So this launches the
// browser itself, headless with a scratch profile, and watches only Chrome's
// list of running workers, attaching to nothing but an extension page it opens
// when it needs to read. The extension is the kit's real job and self-reload
// code under a worker of the script's own, with no native connection, which
// would keep the worker running: Getter's shape.
//
// Each cycle: the worker stops by itself after about 30 seconds idle; the
// script commits in the checkout; the next alarm starts the worker, whose job
// sees the commit and reloads it. A worker started with nothing open is an
// alarm delivered. No start within two periods is a stall: an extension page
// then reads what Chrome holds for the alarm, and wakes the worker with a
// message, as Getter's Settings page did, so the run goes on.
//
// `--browser chromium` is the build Playwright installs; `--browser
// chrome-for-testing` downloads Chrome for Testing at the version of the Google
// Chrome installed on this Mac, or at `--version`. Google Chrome itself has
// refused --load-extension since 137.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { extensionId } from '../host/install.ts'

const FIXTURE = join(import.meta.dir, '../test/fixture')
const PERIOD_MS = 60_000
// Chrome stops a worker after 30 seconds without an event or an API call.
const IDLE_STOP_MS = 90_000
const STALL_MS = 2 * PERIOD_MS + 15_000
const RELOAD_MS = 30_000

// The run's worker: the kit's job on a one-minute alarm, whose run looks for a
// new commit as every kit extension's does, and a listener a page's message
// wakes, which looks too. Those looks are made only after the note of what
// started them is written, so a reload never comes before the record of the
// run that caused it. The start-up look happens only when the worker has not
// yet recorded the commit it was loaded from, the first start after a load or
// a reload, when it records and never reloads. Each start, alarm and message
// is written under a key of its own, so two writes never race over one list.
const WORKER = `import { every } from "./kit/alarms.js";
import { checkForNewCheckout } from "./kit/self-reload.js";

const FILES = ["worker.js", "kit/alarms.js", "kit/self-reload.js"];

async function note(kind) {
  const at = Date.now();
  await chrome.storage.local.set({ [\`diagnostic:\${at}:\${kind}\`]: { kind, at, alarms: await chrome.alarms.getAll() } });
}

every("check", 1, async () => {
  await note("alarm");
  await checkForNewCheckout(FILES);
});

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message !== "wake") return;
  note("message").then(() => {
    respond("awake");
    checkForNewCheckout(FILES);
  });
  return true;
});

note("start").then(async () => {
  const { loadedCheckout } = await chrome.storage.session.get("loadedCheckout");
  if (!loadedCheckout) checkForNewCheckout(FILES);
});
`

type Options = { browser: 'chromium' | 'chrome-for-testing'; reloads: number; version?: string; out?: string; keep: boolean }

// Each cycle waits for an alarm to start the stopped worker, so cycle n tries
// the alarm after reload n - 1: the first tries the first load, and one more
// cycle than there are reloads, with no commit, tries the alarm after the last.
type Cycle = {
  cycle: number
  /** Whether a self-reload came before this cycle's alarm: every cycle but the first. */
  afterReload: boolean
  stoppedAt: string
  /** When the wait for the alarm began: the commit, or on the last cycle, which commits nothing, the stop. */
  waitFrom: string
  outcome: 'delivered' | 'stalled'
  /** Milliseconds from the start of the wait to the worker's start. */
  startedAfterMs?: number
  /** For a stall: what Chrome held for the alarm, read from an extension page. */
  alarm?: 'missing' | { scheduledTime: string; periodInMinutes?: number }
  /** For a stall: whether the page's message started the worker. */
  messageWoke?: boolean
  /** Whether a second worker, the one after the reload, followed; the last cycle makes no reload. */
  reloaded: boolean
  /** Milliseconds from the start of the wait to that second worker's start, or to the end of the run on the last cycle: the job's run, if it ran, falls before it. */
  windowMs?: number
}

// Each run keeps a file of its own in the temporary folder naming its browser
// and its scratch folder, so the next run stops and removes what a run killed
// outright left behind. One file per run: runs side by side never write the
// same file.
const RUN_FILE = 'app-kit-reload-alarms-run-'

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Stops a browser's process group, waiting until none of it runs; false when some of it would not stop. */
function stopBrowser(pid: number): boolean {
  for (const [signal, waitMs] of [['SIGTERM', 10_000], ['SIGKILL', 5_000]] as const) {
    try {
      process.kill(-pid, signal)
    } catch {
      return true
    }
    const deadline = Date.now() + waitMs
    while (alive(-pid) && Date.now() < deadline) Bun.sleepSync(100)
    if (!alive(-pid)) return true
  }
  return false
}

/** Stops the browser and removes the scratch folder of each earlier run whose script is gone. */
function stopLeftBrowsers() {
  for (const name of readdirSync(tmpdir()).filter((file) => file.startsWith(RUN_FILE))) {
    if (alive(Number(name.slice(RUN_FILE.length)))) continue
    const [browser, scratch] = readFileSync(join(tmpdir(), name), 'utf8').trim().split(' ')
    if (!browser || !scratch?.includes('app-kit-reload-alarms-')) continue
    // Only while something in that process group is still the run's, the browser or a helper it started, each of
    // which names the run's scratch profile, never another program's that has taken the number since.
    const group = execFileSync('ps', ['-A', '-o', 'pgid=,command='], { encoding: 'utf8' })
      .split('\n')
      .filter((line) => line.trim().split(' ')[0] === browser)
    if (group.some((line) => line.includes(`--user-data-dir=${scratch}`)) && !stopBrowser(Number(browser))) throw new Error(`A browser an earlier run left, process group ${browser}, would not stop`)
    rmSync(scratch, { recursive: true, force: true })
    rmSync(join(tmpdir(), name), { force: true })
  }
}

function parseOptions(argv: string[]): Options {
  const value = (name: string) => {
    const at = argv.indexOf(name)
    return at >= 0 ? argv[at + 1] : undefined
  }
  const browser = value('--browser') ?? 'chromium'
  if (browser !== 'chromium' && browser !== 'chrome-for-testing') throw new Error(`--browser is chromium or chrome-for-testing, not ${browser}`)
  const reloads = Number(value('--reloads') ?? 200)
  if (!Number.isInteger(reloads) || reloads < 1) throw new Error('--reloads takes a whole number above 0')
  return { browser, reloads, version: value('--version'), out: value('--out'), keep: argv.includes('--keep') }
}

/** The Google Chrome installed on this Mac, whose version the Chrome for Testing run matches. */
function installedChromeVersion(): string {
  const plist = '/Applications/Google Chrome.app/Contents/Info.plist'
  if (process.platform !== 'darwin' || !existsSync(plist)) throw new Error('No Google Chrome in /Applications to match; pass --version')
  return execFileSync('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', plist], { encoding: 'utf8' }).trim()
}

/** Downloads Chrome for Testing at `version` into the system temp folder, once, and returns its binary. */
async function chromeForTesting(version: string): Promise<string> {
  const platform = process.platform === 'darwin' ? (process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64') : 'linux64'
  const folder = join(tmpdir(), 'app-kit-chrome-for-testing', version)
  const binary =
    platform === 'linux64'
      ? join(folder, 'chrome-linux64', 'chrome')
      : join(folder, `chrome-${platform}`, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
  if (existsSync(binary)) return binary

  const listing = await fetch(`https://googlechromelabs.github.io/chrome-for-testing/${version}.json`)
  if (!listing.ok) throw new Error(`Chrome for Testing has no ${version} (${listing.status})`)
  const downloads = ((await listing.json()) as { downloads?: { chrome?: { platform: string; url: string }[] } }).downloads?.chrome ?? []
  const url = downloads.find((download) => download.platform === platform)?.url
  if (!url) throw new Error(`Chrome for Testing ${version} has no ${platform} build`)
  console.log(`Downloading Chrome for Testing ${version} for ${platform}`)
  const zip = await fetch(url)
  if (!zip.ok) throw new Error(`Downloading ${url} answered ${zip.status}`)
  mkdirSync(folder, { recursive: true })
  const zipPath = join(folder, 'chrome.zip')
  writeFileSync(zipPath, new Uint8Array(await zip.arrayBuffer()))
  execFileSync('unzip', ['-q', '-o', zipPath, '-d', folder])
  rmSync(zipPath)
  if (!existsSync(binary)) throw new Error(`The download held no ${binary}`)
  return binary
}

/** One DevTools connection to the browser, never attached to the worker. */
class DevTools {
  private next = 1
  private waiting = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  private listeners: ((method: string, params: any) => void)[] = []

  private constructor(private socket: WebSocket) {
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id) {
        const call = this.waiting.get(message.id)
        this.waiting.delete(message.id)
        if (message.error) call?.reject(new Error(`${message.error.message} (${message.error.code})`))
        else call?.resolve(message.result)
      } else if (message.method) {
        for (const listener of this.listeners) listener(message.method, message.params)
      }
    }
  }

  static async connect(profile: string, deadlineMs = 30_000): Promise<DevTools> {
    const portFile = join(profile, 'DevToolsActivePort')
    const deadline = Date.now() + deadlineMs
    while (!existsSync(portFile)) {
      if (Date.now() > deadline) throw new Error('The browser never opened its DevTools port')
      await Bun.sleep(100)
    }
    const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n')
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`)
    await new Promise((resolve, reject) => {
      socket.onopen = resolve
      socket.onerror = () => reject(new Error('The DevTools connection failed'))
    })
    return new DevTools(socket)
  }

  /** A call the browser has not answered in 30 seconds fails, naming it, so the run never hangs without a word. */
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    const id = this.next++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        reject(new Error(`The browser did not answer ${method} ${JSON.stringify(params).slice(0, 120)} within 30 seconds`))
      }, 30_000)
      this.waiting.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.socket.send(JSON.stringify({ id, method, params, sessionId }))
    })
  }

  on(listener: (method: string, params: any) => void) {
    this.listeners.push(listener)
  }

  /** Opens `url` as a page, runs `expression` in it, closes it, and returns the value. */
  async inPage(url: string, expression: string): Promise<any> {
    const { targetId } = await this.send('Target.createTarget', { url })
    try {
      const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true })
      for (let tries = 0; ; tries++) {
        const ready = await this.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, sessionId)
        if (ready.result?.value === 'complete') break
        if (tries > 100) throw new Error(`${url} never finished loading`)
        await Bun.sleep(100)
      }
      const answer = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
      if (answer.exceptionDetails) throw new Error(`${url}: ${answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text}`)
      return answer.result?.value
    } finally {
      await this.send('Target.closeTarget', { targetId })
    }
  }

  close() {
    this.socket.close()
  }
}

/** The extension's workers as Chrome lists them: each start and stop, by target. */
class Workers {
  private live = new Set<string>()
  private started: { id: string; at: number }[] = []
  private changed: (() => void)[] = []

  constructor(devTools: DevTools, url: string) {
    devTools.on((method, params) => {
      if (method === 'Target.targetCreated' && params.targetInfo.type === 'service_worker' && params.targetInfo.url === url) {
        this.live.add(params.targetInfo.targetId)
        this.started.push({ id: params.targetInfo.targetId, at: Date.now() })
      } else if (method === 'Target.targetDestroyed' && this.live.has(params.targetId)) {
        this.live.delete(params.targetId)
      } else {
        return
      }
      for (const wake of this.changed.splice(0)) wake()
    })
  }

  get running() {
    return this.live.size > 0
  }

  /** How many workers have started so far. */
  get starts() {
    return this.started.length
  }

  startedAt(index: number) {
    return this.started[index]?.at
  }

  /** Resolves true once `done` holds, or false after `ms`. */
  async until(done: () => boolean, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms
    while (!done()) {
      const left = deadline - Date.now()
      if (left <= 0) return false
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left)
        this.changed.push(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    return true
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  const version = options.browser === 'chrome-for-testing' ? (options.version ?? installedChromeVersion()) : undefined
  const binary = version ? await chromeForTesting(version) : chromium.executablePath()

  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'app-kit-reload-alarms-')))
  const checkout = join(scratch, 'checkout')
  const profile = join(scratch, 'profile')
  // Outside the scratch folder, which goes at the end.
  const out = options.out ?? join(tmpdir(), `app-kit-reload-alarms-${options.browser}-${Date.now()}.jsonl`)
  cpSync(FIXTURE, checkout, { recursive: true })
  writeFileSync(join(checkout, 'worker.js'), WORKER)
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=diagnostic', '-c', 'user.email=diagnostic@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: checkout, encoding: 'utf8' }).trim()
  git('init', '--quiet', '--initial-branch=main')
  git('add', '-A')
  git('commit', '--quiet', '-m', 'first')

  const id = extensionId(JSON.parse(readFileSync(join(checkout, 'manifest.json'), 'utf8')).key)
  const origin = `chrome-extension://${id}`

  stopLeftBrowsers()
  const runFile = join(tmpdir(), `${RUN_FILE}${process.pid}`)
  let browser: ChildProcess | null = spawn(
    binary,
    ['--headless=new', `--user-data-dir=${profile}`, `--disable-extensions-except=${checkout}`, `--load-extension=${checkout}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', 'about:blank'],
    // In a process group of its own, so stopping the group stops every helper Chrome started.
    { stdio: 'ignore', detached: true },
  )
  const browserPid = browser.pid ?? 0
  writeFileSync(runFile, `${browserPid} ${scratch}\n`)
  // Stops the browser and every helper it started, and checks none of them still runs.
  const stop = () => {
    if (!browser) return
    browser = null
    const stopped = browserPid === 0 || stopBrowser(browserPid)
    if (!options.keep) rmSync(scratch, { recursive: true, force: true })
    if (stopped) rmSync(runFile, { force: true })
    if (!stopped) {
      console.error(`The browser's process group ${browserPid} would not stop`)
      process.exitCode = 1
    }
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      stop()
      process.exit(signal === 'SIGINT' ? 130 : 143)
    })
  }

  try {
    if (browserPid === 0) throw new Error(`The browser did not start: ${binary}`)
    const devTools = await DevTools.connect(profile)
    const workers = new Workers(devTools, `${origin}/worker.js`)
    await devTools.send('Target.setDiscoverTargets', { discover: true })
    const { product } = await devTools.send('Browser.getVersion')
    console.log(`${product}, ${options.reloads} reloads, each cycle a line in ${out}`)

    // Chrome brings an unpacked install back from a reload only in Developer
    // mode. A Preferences file written before launch does not turn it on.
    await devTools.inPage('chrome://extensions', 'chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }).then(() => true)')
    if (!(await workers.until(() => workers.starts > 0, 30_000))) throw new Error('The extension never started a worker')

    const cycles: Cycle[] = []
    for (let cycle = 1; cycle <= options.reloads + 1; cycle++) {
      const last = cycle === options.reloads + 1
      if (!(await workers.until(() => !workers.running, IDLE_STOP_MS))) throw new Error(`Cycle ${cycle}: the worker did not stop by itself within ${IDLE_STOP_MS / 1000} seconds`)
      const stoppedAt = new Date()
      if (!last) {
        writeFileSync(join(checkout, 'cycle.txt'), `${cycle}\n`)
        git('add', '-A')
        git('commit', '--quiet', '-m', `cycle ${cycle}`)
      }
      const waitFrom = Date.now()
      const startsBefore = workers.starts

      const delivered = await workers.until(() => workers.starts > startsBefore, STALL_MS)
      const record: Cycle = { cycle, afterReload: cycle > 1, stoppedAt: stoppedAt.toISOString(), waitFrom: new Date(waitFrom).toISOString(), outcome: delivered ? 'delivered' : 'stalled', reloaded: false }
      if (delivered) {
        record.startedAfterMs = workers.startedAt(startsBefore)! - waitFrom
      } else {
        // Read what Chrome holds, then wake the worker the way Getter's page did.
        const alarms = (await devTools.inPage(`${origin}/look.html`, 'chrome.alarms.getAll()')) as chrome.alarms.Alarm[]
        const check = alarms.find((alarm) => alarm.name === 'check')
        record.alarm = check ? { scheduledTime: new Date(check.scheduledTime).toISOString(), periodInMinutes: check.periodInMinutes } : 'missing'
        if (workers.starts > startsBefore) throw new Error(`Cycle ${cycle}: opening the extension's page started the worker, so the read is not clean`)
        await devTools.inPage(`${origin}/look.html`, 'chrome.runtime.sendMessage("wake")')
        record.messageWoke = await workers.until(() => workers.starts > startsBefore, 10_000)
        if (!record.messageWoke) throw new Error(`Cycle ${cycle}: the alarm stalled and a message did not start the worker either`)
      }
      // The started worker sees the commit and reloads, which starts the next one.
      if (!last) {
        record.reloaded = await workers.until(() => workers.starts > startsBefore + 1, RELOAD_MS)
        if (!record.reloaded) throw new Error(`Cycle ${cycle}: the extension did not come back after its reload, so the run stops rather than count it`)
        record.windowMs = workers.startedAt(startsBefore + 1)! - waitFrom
      } else {
        // Its job's run, if it ran, is written within the run's own limit of the worker's start.
        await workers.until(() => !workers.running, IDLE_STOP_MS)
        record.windowMs = Date.now() - waitFrom
      }
      cycles.push(record)
      appendFileSync(out, `${JSON.stringify(record)}\n`)
      const note = record.outcome === 'delivered' ? `delivered ${Math.round(record.startedAfterMs! / 1000)}s after the ${last ? 'stop' : 'commit'}` : `stalled, alarm ${typeof record.alarm === 'string' ? record.alarm : `held for ${record.alarm?.scheduledTime}`}, message woke it`
      console.log(`${stoppedAt.toISOString()} cycle ${cycle}: ${note}`)
    }

    // What each start of the worker found, and the job's record, as the worker kept them.
    const kept = (await devTools.inPage(`${origin}/look.html`, 'chrome.storage.local.get(null)')) as Record<string, any>
    const starts = Object.entries(kept).filter(([key]) => key.startsWith('diagnostic:') && key.endsWith(':start'))
    const startsWithoutAlarm = starts.filter(([, value]) => !value.alarms.some((alarm: chrome.alarms.Alarm) => alarm.name === 'check')).length
    const alarmTimes = Object.values(kept)
      .filter((value) => value?.kind === 'alarm')
      .map((value) => value.at as number)
    // The counts are of the cycles after a reload; the first cycle tried the first load.
    const afterReloads = cycles.filter((cycle) => cycle.afterReload)
    const stalls = afterReloads.filter((cycle) => cycle.outcome === 'stalled')
    const summary = {
      browser: product,
      reloads: afterReloads.length,
      delivered: afterReloads.length - stalls.length,
      firstLoad: cycles[0]?.outcome ?? null,
      stalledAlarmMissing: stalls.filter((cycle) => cycle.alarm === 'missing').length,
      stalledAlarmPresent: stalls.filter((cycle) => cycle.alarm !== 'missing').length,
      messageWoke: stalls.filter((cycle) => cycle.messageWoke).length,
      workerStarts: starts.length,
      startsThatFoundNoAlarmYet: startsWithoutAlarm,
      alarmRuns: alarmTimes.length,
      // A worker the alarm started whose job never ran between the commit and the reload: started for a saved
      // listener its code did not add again.
      deliveredWithoutRun: afterReloads.filter((cycle) => {
        if (cycle.outcome !== 'delivered') return false
        const from = Date.parse(cycle.waitFrom)
        return !alarmTimes.some((at) => at >= from && at <= from + cycle.windowMs!)
      }).length,
      job: kept['job:check'] ?? null,
    }
    appendFileSync(out, `${JSON.stringify({ summary })}\n`)
    console.log(JSON.stringify(summary, null, 2))
    devTools.close()
  } finally {
    stop()
  }
}

await main()
