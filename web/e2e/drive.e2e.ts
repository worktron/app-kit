// `app-kit web drive` run as a program against a small app this test serves itself: every step kind, the page's clock
// started at a past date and jumped forward, an outside request refused, the page's sound on the offline engine with no
// output device opened (recorded by audio-output.swift, as offline-audio.e2e.ts records it), the
// iPhone app's bridge at the App Store's sizes, each store size's exact pixels, a failing step, and a parent that ends
// taking the browser with it. Run with `bun test ./web/e2e/drive.e2e.ts`, which scripts/gates.sh does; Playwright's own
// run of web/e2e leaves it out.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withoutPage } from '../../test/dom.ts'

const COMMAND = join(import.meta.dir, '../../bin/app-kit.ts')
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'app-kit-drive-')))

const HOME = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
<h1>Shelf</h1>
<p id="clock"></p>
<p id="audio"></p>
<p id="bridge"></p>
<button id="load">Load the list</button>
<button id="outside">Ask another site</button>
<img alt="Poster" src="https://images.example.com/poster.png" width="40" height="60">
<ul id="list"></ul>
<script>
  const show = () => (document.getElementById('clock').textContent = 'Page time ' + new Date().toISOString().slice(0, 16));
  show();
  setInterval(show, 1000);
  document.getElementById('audio').textContent = 'Audio offline: ' + (new AudioContext() instanceof OfflineAudioContext);
  document.getElementById('bridge').textContent = 'In the iPhone app: ' + ('__TAURI_INTERNALS__' in window && /iPhone/.test(navigator.userAgent));
  document.getElementById('load').onclick = async () => {
    const loading = document.createElement('p');
    loading.textContent = 'Loading the list';
    document.body.append(loading);
    const items = await (await fetch('/api/list')).json();
    loading.remove();
    for (const item of items) {
      const li = document.createElement('li');
      li.textContent = item;
      document.getElementById('list').append(li);
    }
  };
  document.getElementById('outside').onclick = () => fetch('https://outside.example.com/track').catch(() => {});
</script></body></html>`

const SIGN_IN = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
<h1>Sign in</h1>
<form id="email"><label>Email <input name="email" aria-label="Email"></label></form>
<script>
  document.getElementById('email').onsubmit = (event) => {
    event.preventDefault();
    const address = event.target.email.value;
    document.body.innerHTML = '<form id="code"><label>Code <input name="code" aria-label="Code"></label></form>';
    document.getElementById('code').onsubmit = (next) => {
      next.preventDefault();
      document.body.innerHTML = next.target.code.value === '424242' ? '<h1>Signed in as ' + address + '</h1>' : '<h1>Wrong code</h1>';
    };
  };
</script></body></html>`

// Plays a tone and a loop of noise through a gain of zero until the audio clock has run a second and a half, then says
// so: a browser that opened the speakers would play silence into them, never sound.
const AUDIO = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
<button id="play">Play</button>
<p id="state">Not played</p>
<script>
  // Started by a tap, as a browser lets a page start sound.
  document.getElementById('play').onclick = () => {
    const context = new AudioContext();
    const silent = context.createGain();
    silent.gain.value = 0;
    silent.connect(context.destination);
    const tone = context.createOscillator();
    tone.connect(silent);
    tone.start();
    context.resume();
    const check = () => (context.currentTime < 1.5 ? setTimeout(check, 20) : (document.getElementById('state').textContent = 'Played'));
    check();
  };
</script></body></html>`

const WHO = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
<h1>Person: PERSON</h1><p id="zone"></p><p id="language"></p><p id="when"></p>
<script>
document.getElementById('zone').textContent = 'Zone: ' + Intl.DateTimeFormat().resolvedOptions().timeZone
document.getElementById('language').textContent = 'Language: ' + navigator.language
document.getElementById('when').textContent = 'When: ' + new Date().toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
</script></body></html>`

let server: ReturnType<typeof Bun.serve>
let address = ''
/** Each page asked for, so a test knows the browser is up. */
const served: string[] = []
let onServed = () => {}
let pageBack = () => {}
beforeAll(async () => {
  // The server answers with Bun's own Response, not the unit tests' simulated page's.
  pageBack = await withoutPage()
  server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const path = new URL(request.url).pathname
      served.push(path)
      onServed()
      if (path === '/api/list') {
        await Bun.sleep(150)
        return Response.json(['Rice', 'Oat milk'])
      }
      if (path === '/audio') return new Response(AUDIO, { headers: { 'content-type': 'text/html' } })
      if (path === '/who') {
        // The person comes from the cookie, as an app's seeded server picks its made-up person; the time from the page.
        const person = request.headers.get('cookie')?.match(/(?:^|; )person=([^;]*)/)?.[1] ?? 'none'
        return new Response(WHO.replace('PERSON', person), { headers: { 'content-type': 'text/html' } })
      }
      if (path === '/bare') return new Response('<!doctype html><h1>No viewport tag</h1>', { headers: { 'content-type': 'text/html' } })
      const html = path === '/sign-in' ? SIGN_IN : HOME
      return new Response(html, { headers: { 'content-type': 'text/html' } })
    },
  })
  address = `http://127.0.0.1:${server.port}`
})
afterAll(() => {
  server.stop(true)
  pageBack()
  rmSync(dir, { recursive: true, force: true })
})
let made = 0

/** Runs the command on a steps file, with no input attached, as an agent's shell runs it. */
async function run(steps: object, env: Record<string, string> = {}) {
  const folder = join(dir, `run-${++made}`)
  const file = `${folder}.json`
  writeFileSync(file, JSON.stringify(steps))
  const child = Bun.spawn([process.execPath, COMMAND, 'web', 'drive', address, file, folder], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...env } })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { stdout, stderr, code, folder }
}

/** A PNG's width, height and colour type, from its header. */
function png(file: string) {
  const bytes = readFileSync(file)
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] }
}

test('every step kind runs, with the page clock started at a past date and jumped an hour, and outside requests refused', async () => {
  const { stdout, code, folder } = await run({
    settledWhenGone: '^Loading ',
    steps: [
      { clockAt: '2026-11-02T09:00:00Z' },
      { goto: '/' },
      { read: 'start' },
      { click: { role: 'button', name: 'Load the list' } },
      { waitFor: { text: 'Oat milk' } },
      { click: { text: 'Ask another site' } },
      { advance: 3_600_000 },
      { read: 'later' },
      { goto: '/sign-in' },
      { fill: { role: 'textbox', name: 'Email' }, value: 'kept@example.com' },
      { signIn: { email: 'ana@example.com' } },
      { waitFor: { role: 'heading', name: 'Signed in as ana@example.com' } },
      { shot: 'signed-in' },
    ],
  })
  expect(code).toBe(0)
  expect(stdout).toContain('Page time 2026-11-02T09:00')
  expect(stdout).toContain('Page time 2026-11-02T10:00')
  expect(stdout).toContain('- listitem: Oat milk')
  expect(stdout).toContain('Audio offline: true')
  expect(stdout).toContain('In the iPhone app: false')
  expect(stdout).toContain('[refused an outside request: https://outside.example.com/track]')
  expect(stdout).not.toContain('images.example.com')
  expect(png(join(folder, 'start-phone.png')).width).toBe(390)
  expect(png(join(folder, 'signed-in.png'))).toEqual({ width: 390, height: 844, colorType: 2 })
}, 30_000)

test("the steps file's cookies reach the server, and its time zone and locale set how the page draws the time", async () => {
  const { stdout, code } = await run({
    cookies: [{ name: 'person', value: 'new-person' }],
    timeZone: 'Asia/Tokyo',
    locale: 'de-DE',
    steps: [{ clockAt: '2026-11-02T09:00:00Z' }, { goto: '/who' }, { read: 'who' }],
  })
  expect(code).toBe(0)
  expect(stdout).toContain('heading "Person: new-person"')
  expect(stdout).toContain('Zone: Asia/Tokyo')
  expect(stdout).toContain('Language: de-DE')
  // 09:00 in UTC is 18:00 in Tokyo, written the German way.
  expect(stdout).toContain('When: 02.11.26, 18:00')
  const plain = await run({ steps: [{ goto: '/who' }, { read: 'who' }] })
  expect(plain.stdout).toContain('heading "Person: none"')
}, 30_000)

test("each store size writes an image of that store's exact pixels, with no alpha channel, and the App Store's draw as the iPhone app", async () => {
  const expected = {
    'chrome-store': { width: 1280, height: 800, app: false },
    'iphone-6.3': { width: 1206, height: 2622, app: true },
    'iphone-6.9': { width: 1320, height: 2868, app: true },
    'ipad-13': { width: 2064, height: 2752, app: true },
  }
  const runs = await Promise.all(Object.keys(expected).map((size) => run({ size, steps: [{ goto: '/' }, { read: 'home' }, { shot: 'home' }] })))
  Object.entries(expected).forEach(([, want], at) => {
    const { code, stdout, folder } = runs[at]!
    expect(code).toBe(0)
    expect(png(join(folder, 'home.png'))).toEqual({ width: want.width, height: want.height, colorType: 2 })
    expect(stdout).toContain(`In the iPhone app: ${want.app}`)
  })
}, 60_000)

test('a step that fails exits 1 and prints the page as it was', async () => {
  const { code, stdout } = await run({ steps: [{ goto: '/' }, { fill: { role: 'button', name: 'Load the list' }, value: 'x' }] })
  expect(code).toBe(1)
  expect(stdout).toContain('[step failed:')
  expect(stdout).toContain('=== the page when it failed, at / ===')
  expect(stdout).toContain('heading "Shelf"')
}, 30_000)

test('a store image from a page with no viewport tag, which a phone scales, fails its step rather than writing the wrong size', async () => {
  const { code, stdout } = await run({ size: 'iphone-6.3', steps: [{ goto: '/bare' }, { shot: 'bare' }] })
  expect(code).toBe(1)
  expect(stdout).toContain('not the 1206 by 2622 iphone-6.3 asks for')
}, 30_000)

test('a steps file that is wrong is refused before any browser starts', async () => {
  const { code, stderr } = await run({ steps: [{ goto: '/' }, { advance: 1000 }] })
  expect(code).toBe(1)
  expect(stderr).toContain('Step 2: advance needs a clockAt step before it')
})

/** Every process below `pid`, found by their parents. */
function descendants(pid: number): number[] {
  const children = Bun.spawnSync(['pgrep', '-P', String(pid)]).stdout.toString().split('\n').filter(Boolean).map(Number)
  return children.flatMap((child) => [child, ...descendants(child)])
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('with the watch asked for, the browser closes when the parent that started the run ends', async () => {
  const folder = join(dir, 'watched')
  const file = `${folder}.json`
  writeFileSync(file, JSON.stringify({ steps: [{ goto: '/' }, { waitFor: { text: 'Never shown' } }] }))
  const child = Bun.spawn([process.execPath, COMMAND, 'web', 'drive', address, file, folder], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, APP_KIT_DRIVE_STOP_WHEN_PARENT_ENDS: 'on' },
  })
  // The browser is up once it has asked for the page.
  const before = served.length
  await new Promise<void>((resolve) => {
    onServed = () => served.length > before && resolve()
  })
  const browser = descendants(child.pid)
  try {
    expect(browser.length).toBeGreaterThan(0)
  } finally {
    // The parent's end, as the pipe it holds closes: the run closes its browser before it exits.
    child.stdin.end()
  }
  expect(await child.exited).toBe(1)
  // Playwright's close returns when the browser's main process ends; its helpers end a moment after it. Each is waited
  // for until it is gone, and a helper that never goes fails the test at its time limit.
  while (browser.some(alive)) await Bun.sleep(20)
  expect(browser.filter(alive)).toEqual([])
}, 30_000)

test('with the watch asked for, a run whose steps all pass exits 0 while its parent still holds the pipe', async () => {
  const folder = join(dir, 'watched-done')
  const file = `${folder}.json`
  writeFileSync(file, JSON.stringify({ steps: [{ goto: '/' }, { read: 'home' }] }))
  const child = Bun.spawn([process.execPath, COMMAND, 'web', 'drive', address, file, folder], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, APP_KIT_DRIVE_STOP_WHEN_PARENT_ENDS: 'on' },
  })
  try {
    expect(await child.exited).toBe(0)
  } finally {
    child.stdin.end()
  }
}, 30_000)

/** A process macOS's audio service saw with an output device open, as audio-output.swift reports it. */
type Output = { pid: number; executable: string; parents: number[] }

test("a page's sound opens no output device on the Mac", async () => {
  if (process.platform !== 'darwin') return
  const recorderProgram = join(dir, 'audio-output')
  execFileSync('swiftc', [join(import.meta.dir, 'audio-output.swift'), '-o', recorderProgram], { stdio: ['ignore', 'ignore', 'pipe'] })
  const recorder = spawn(recorderProgram, [], { stdio: ['pipe', 'pipe', 'inherit'] })
  const outputs: Output[] = []
  let answered = () => {}
  let rest = ''
  const ready = new Promise<void>((resolve, reject) => {
    recorder.on('exit', (code, signal) => reject(new Error(`audio-output ended (${code ?? signal}) before it was ready`)))
    recorder.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      const lines = (rest + chunk).split('\n')
      rest = lines.pop()!
      for (const line of lines) {
        if (line === 'ready') resolve()
        else if (line === 'mark') answered()
        else if (line) outputs.push(JSON.parse(line) as Output)
      }
    })
  })
  try {
    await ready
    const { code, stdout } = await run({ steps: [{ goto: '/audio' }, { click: { role: 'button', name: 'Play' } }, { waitFor: { text: 'Played' } }, { read: 'played' }] })
    expect(code).toBe(0)
    expect(stdout).toContain('Played')
    // Every process that ran output while the page played is reported before the recorder answers a mark sent now.
    await new Promise<void>((resolve) => {
      answered = resolve
      recorder.stdin.write('mark\n')
    })
    expect(outputs.filter((output) => output.parents.includes(process.pid))).toEqual([])
  } finally {
    recorder.stdin.end()
    recorder.kill()
  }
}, 60_000)
