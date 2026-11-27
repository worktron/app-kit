#!/usr/bin/env bun
/*
 * The Android app's round trip on a windowless emulator, the check for a change to the window plugin's Android code,
 * `app-kit android run` or the Android icons: test/fixtures/android-app, README.md's shell on the kit's window plugin,
 * built and started with `app-kit android run emulator` against the web fixture's Tauri page on a server here, which
 * the emulator reaches as its own localhost through `adb reverse`, with desktop sign-in's routes on the stand-in for
 * Clerk.
 *
 * Steps, each with a screenshot: the start page while the site does not answer, the site once it does, the site still
 * between the bars after Android recreated the activity for a font size change, a link to another site opening in Chrome, and Continue with Google through Chrome's stand-in page back into the app, while the
 * app runs and again after Android ended it behind Chrome (`am kill`). The app's log (logcat) is kept beside them.
 *
 * Usage: bun scripts/android-e2e.ts, leaving its evidence in test-results/android-e2e, a folder of its own that each run
 * empties first, so it takes no folder to empty. Needs the Android tools
 * (README.md's "Testing the Android app yourself"). The run ends its emulator; with ANDROID_E2E_KEEP=1 a failed run
 * keeps it and the site up until the run is stopped, for looking into the failure with adb.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runCommand } from '../command-line/run.ts';
import { standInTicket } from '../authentication/stand-in/index.tsx';
import { appServer, listen } from '../server/start/index.ts';
import { DESKTOP_SIGN_IN_ROUTES } from '../tauri/sign-in/names.ts';
import { desktopSignInRoutes } from '../tauri/sign-in/server.ts';
import { testsFolder, useOwnFolder } from '../testing/temporary-folder.ts';
import { serveBuiltPage } from '../web/server.ts';
import { tools } from '../tauri/android-run/index.ts';

const ROOT = resolve(import.meta.dir, '..');
const FIXTURE = join(ROOT, 'test/fixtures/android-app');
const EVIDENCE = join(ROOT, 'test-results/android-e2e');
const APP_ID = 'com.example.fixture';
/** Who the browser is signed in as: the stand-in's Google picks this account when none is named. */
const PERSON = 'chosen@example.com';
/** How long one step may take on the emulator before the run fails naming it. */
const STEP_MS = 90_000;
const SITE_WAIT_MS = 45_000;

useOwnFolder(testsFolder(ROOT));
rmSync(EVIDENCE, { recursive: true, force: true });
mkdirSync(EVIDENCE, { recursive: true });

const say = (line: string) => console.log(`[android-e2e] ${line}`);

async function must(command: string[], cwd = ROOT, env: Record<string, string | undefined> = process.env): Promise<string> {
  const result = await runCommand(command, { cwd, env, output: (chunk) => void process.stdout.write(chunk) });
  if (result.code !== 0) throw new Error(`${command.join(' ')} exited ${result.code}`);
  return result.stdout;
}

// The web fixture, built as scripts/e2e.sh builds it, served with desktop sign-in's routes. Its health check is held
// unanswered until the run says the site is up, so the app's start page shows first: the start page counts any answer,
// a 503 too, as the site being up, and only a request that gets none keeps it waiting.
await must(['bunx', 'vite', 'build', 'web/e2e/fixture', '--logLevel', 'warn']);
const page = serveBuiltPage(join(ROOT, 'web/e2e/fixture/dist'));
let siteIsUp = () => {};
const siteUp = new Promise<void>((resolve) => (siteIsUp = resolve));
const app = appServer({ service: 'android-fixture', print: (line) => say(`site: ${line}`) });
app.route(
  DESKTOP_SIGN_IN_ROUTES,
  desktopSignInRoutes({
    userId: (c) => (c.req.header('Authorization')?.startsWith('Bearer ') ? PERSON : null),
    makeTicket: async (email) => standInTicket(email),
  }),
);
// The fixture's Tauri page is the site's root, as an app's site is: the window loads a sign-in that comes back before
// the site has loaded at the root, so a cold start by the browser's link lands on the page that takes it.
app.get('/', (c) => page(new Request(new URL('/tauri.html', c.req.url), c.req.raw)));
app.get('*', (c) => page(c.req.raw));
// The kit's server answers its health route before any middleware added after it, so the hold sits in front of it.
const fetchHeld = async (request: Request, bun: Bun.Server<undefined>) => {
  if (new URL(request.url).pathname === '/api/health') await siteUp;
  return app.fetch(request, bun);
};
const server = listen({ fetch: fetchHeld }, { idleTimeout: 60, port: 0, hostname: 'localhost', print: (line) => say(`site: ${line}`) });
const address = `http://localhost:${server.port}/`;

const env = { ...process.env, TAURI_PAGE_ADDRESS: address };
const adbPath = tools(env).adb;
let serial = '';
let logcat: Bun.Subprocess | undefined;

async function adb(...args: string[]): Promise<string> {
  const result = await runCommand([adbPath, '-s', serial, ...args], { env });
  if (result.code !== 0) throw new Error(`adb ${args.join(' ')} exited ${result.code}: ${result.stderr.trim()}`);
  return result.stdout;
}

async function screenshot(name: string): Promise<void> {
  // Bun's own spawn, since the PNG is bytes and the kit's run keeps text.
  const shot = Bun.spawn([adbPath, '-s', serial, 'exec-out', 'screencap', '-p'], { env, stdout: 'pipe', stderr: 'ignore' });
  const bytes = new Uint8Array(await new Response(shot.stdout).arrayBuffer());
  if ((await shot.exited) !== 0 || bytes.length === 0) throw new Error(`no screenshot for ${name}`);
  const file = join(EVIDENCE, `${name}.png`);
  writeFileSync(file, bytes);
  say(`screenshot ${file}`);
}

type Node = { text: string; x: number; y: number };

/** What the screen shows, as Android's accessibility tree has it: every node with text or a description, and its centre. */
async function screen(): Promise<Node[]> {
  await adb('shell', 'uiautomator', 'dump', '/sdcard/window.xml');
  const xml = await adb('exec-out', 'cat', '/sdcard/window.xml');
  const nodes: Node[] = [];
  for (const match of xml.matchAll(/<node [^>]*?text="([^"]*)"[^>]*?content-desc="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)) {
    const [, text = '', description = '', x1, y1, x2, y2] = match;
    const words = (text || description).replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
    if (words) nodes.push({ text: words, x: (Number(x1) + Number(x2)) >> 1, y: (Number(y1) + Number(y2)) >> 1 });
  }
  return nodes;
}

/**
 * Throws unless the page sits between Android's status bar and its navigation bar: the web view's top below the
 * screen's top edge, where the status bar is, and its bottom above the screen's bottom edge, where the navigation bar is.
 */
async function pageInsideBars(): Promise<void> {
  await adb('shell', 'uiautomator', 'dump', '/sdcard/window.xml');
  const xml = await adb('exec-out', 'cat', '/sdcard/window.xml');
  const page = /<node [^>]*?class="android\.webkit\.WebView"[^>]*?bounds="\[\d+,(\d+)\]\[\d+,(\d+)\]"/.exec(xml);
  const size = /(\d+)x(\d+)\s*$/.exec((await adb('shell', 'wm', 'size')).trim());
  if (!page || !size) throw new Error('page inside the bars: no web view or no screen size to measure');
  const [top, bottom, height] = [Number(page[1]), Number(page[2]), Number(size[2])];
  if (top <= 0 || bottom >= height) throw new Error(`page inside the bars: the page runs from ${top} to ${bottom} on a screen ${height} high, under the bars`);
  say(`the page runs from ${top} to ${bottom} on a screen ${height} high, between the bars`);
}

/**
 * Waits for the screen to show `wanted`, tapping through any of `passing` (Chrome's first-run screens) on the way.
 * Fails naming the step and what the screen showed instead.
 */
async function waitFor(step: string, wanted: RegExp, passing: RegExp[] = []): Promise<Node> {
  const deadline = Date.now() + STEP_MS;
  let seen: Node[] = [];
  while (Date.now() < deadline) {
    seen = await screen().catch(() => []);
    const found = seen.find((node) => wanted.test(node.text));
    if (found) return found;
    const pass = seen.find((node) => passing.some((words) => words.test(node.text)));
    if (pass) {
      say(`${step}: tapping "${pass.text}"`);
      await adb('shell', 'input', 'tap', String(pass.x), String(pass.y));
    }
    await Bun.sleep(1000);
  }
  await screenshot(`failed-${step.replaceAll(' ', '-')}`);
  throw new Error(`${step}: the screen never showed ${wanted}; it showed ${JSON.stringify(seen.map((node) => node.text).slice(0, 30))}`);
}

async function tap(step: string, words: RegExp, passing: RegExp[] = []): Promise<void> {
  const node = await waitFor(step, words, passing);
  await adb('shell', 'input', 'tap', String(node.x), String(node.y));
}

/** The package of the activity in front. */
async function inFront(): Promise<string> {
  const activities = await adb('shell', 'dumpsys', 'activity', 'activities');
  return /mResumedActivity: ActivityRecord\{\S+ \S+ ([\w.]+)\//.exec(activities)?.[1] ?? /topResumedActivity=ActivityRecord\{\S+ \S+ ([\w.]+)\//.exec(activities)?.[1] ?? '';
}

async function waitInFront(step: string, wanted: string): Promise<void> {
  const deadline = Date.now() + STEP_MS;
  let front = '';
  while (Date.now() < deadline) {
    front = await inFront();
    if (front === wanted) return;
    await Bun.sleep(500);
  }
  await screenshot(`failed-${step.replaceAll(' ', '-')}`);
  const seen = await screen().catch(() => []);
  throw new Error(`${step}: ${wanted} never came to the front; ${front || 'nothing'} is there, showing ${JSON.stringify(seen.map((node) => node.text).slice(0, 30))}`);
}

/** Waits for the app's log (logcat, as the run keeps it) to have a line matching `wanted`, failing as `step`. */
async function waitForLog(step: string, wanted: RegExp): Promise<void> {
  const deadline = Date.now() + STEP_MS;
  while (Date.now() < deadline) {
    if (wanted.test(readFileSync(join(EVIDENCE, 'logcat.txt'), 'utf8'))) return;
    await Bun.sleep(500);
  }
  await screenshot(`failed-${step.replaceAll(' ', '-')}`);
  throw new Error(`${step}: the app's log never had ${wanted}`);
}

/** Chrome's first-run screens and its prompt to open the app, which a fresh emulator shows once. */
const CHROME_PASSING = [/^Accept & continue$/i, /^Use without an account$/i, /^No thanks$/i, /^Continue$/i, /^Got it$/i, /^Open$/i, /^Android Fixture$/];

/** Signs the app in through Chrome, from the app's button to the app saying who is signed in. `kill` ends the app first. */
async function signIn(name: string, kill: boolean): Promise<void> {
  await tap(`${name} app signed out`, /^Continue with Google in the Mac app$/);
  await waitInFront(`${name} Chrome opens`, 'com.android.chrome');
  if (kill) {
    // am kill ends only an app Android counts as in the background, which the app becomes a moment after Chrome
    // comes in front, so it is asked again until the app is gone.
    let left = '';
    for (const end = Date.now() + 15_000; Date.now() < end; await Bun.sleep(500)) {
      await adb('shell', 'am', 'kill', APP_ID);
      left = (await runCommand([adbPath, '-s', serial, 'shell', 'pidof', APP_ID], { env })).stdout.trim();
      if (!left) break;
    }
    if (left) throw new Error(`${name}: the app still runs as ${left} 15 seconds into am kill`);
    say(`${name}: Android ended the app behind Chrome`);
  }
  // The stand-in's sign-in page signs Chrome in by itself, or shows Continue with Google first.
  await waitFor(`${name} Chrome hand-over page`, /^Sign the app in as /, [...CHROME_PASSING, /^Continue with Google$/]);
  await screenshot(`${name}-chrome-hand-over`);
  await tap(`${name} Chrome hand-over button`, /^Sign in to the app$/);
  await waitFor(`${name} the app signed in`, new RegExp(`^Signed in as ${PERSON.replaceAll('.', '\\.')}$`), CHROME_PASSING);
  await screenshot(`${name}-app-signed-in`);
  if ((await inFront()) !== APP_ID) throw new Error(`${name}: the app is signed in but ${await inFront()} is in front`);
}

let failed: unknown = null;
try {
  // Android's project and icons, as an app makes them once.
  rmSync(join(FIXTURE, 'src-tauri/gen'), { recursive: true, force: true });
  await must(['bunx', 'tauri', 'android', 'init', '--ci', '--skip-targets-install'], FIXTURE, env);
  await must(['bun', join(ROOT, 'bin/app-kit.ts'), 'icons', 'render', join(ROOT, 'test/fixtures/icons/drawings'), '--tauri', join(FIXTURE, 'src-tauri'), '--android-background', '#050505']);

  const output = await must(['bun', join(ROOT, 'bin/app-kit.ts'), 'android', 'run', 'emulator'], FIXTURE, env);
  serial = /-s (emulator-\d+) /.exec(output)?.[1] ?? '';
  if (!serial) throw new Error('app-kit android run printed no emulator');
  say(`the app runs on ${serial}`);
  // Android's log is a ring of a few megabytes that its own services fill within a minute, so it is streamed to the
  // file from here (from the start of what the ring still holds, the app's start-up included) rather than read at the end.
  logcat = Bun.spawn([adbPath, '-s', serial, 'logcat'], { env, stdout: Bun.file(join(EVIDENCE, 'logcat.txt')), stderr: 'ignore' });

  await waitFor('start page', /reach/i);
  await screenshot('1-start-page');
  siteIsUp();
  // The start page tries again every 30 seconds by itself.
  const deadline = Date.now() + SITE_WAIT_MS;
  // A slow emulator can let the start page give up on its first try before the screenshot, and its next try comes
  // only after half a minute, so the run presses its Try again, as a person would.
  await waitFor('site', /^Signed in as nobody$/, [/^Try again$/]);
  if (Date.now() > deadline) throw new Error('the start page took more than 45 seconds to go on to the site');
  await screenshot('2-site');
  await pageInsideBars();

  // A font size change, which the app does not take itself, makes Android recreate the activity, and wry moves the
  // same web view into the new window without telling plugins: the page must stay between the bars there too.
  await adb('shell', 'settings', 'put', 'system', 'font_scale', '1.15');
  await waitForLog('recreated window', /the recreated window keeps the strips behind Android's bars/);
  await waitFor('site after the recreate', /^Signed in as nobody$/);
  await screenshot('2b-site-recreated');
  await pageInsideBars();
  await adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0');
  await waitFor('site at the usual font size', /^Signed in as nobody$/);

  await tap('outside link', /^An outside site$/);
  await waitInFront('outside link opens Chrome', 'com.android.chrome');
  await waitFor('Chrome shows example.com', /Example Domain/, CHROME_PASSING);
  await screenshot('3-outside-site-in-chrome');
  await adb('shell', 'am', 'start', '-W', '-n', `${APP_ID}/.MainActivity`);
  await waitInFront('back to the app', APP_ID);

  await signIn('4-running', false);

  // A fresh, signed-out app, ended by Android while Chrome signs in.
  await adb('shell', 'am', 'force-stop', APP_ID);
  await adb('shell', 'am', 'start', '-W', '-n', `${APP_ID}/.MainActivity`);
  await waitFor('fresh app', /^Signed in as nobody$/);
  await signIn('5-ended-behind-chrome', true);
  say('passed');
} catch (e) {
  failed = e;
} finally {
  if (serial) {
    logcat?.kill();
    await logcat?.exited;
    const log = readFileSync(join(EVIDENCE, 'logcat.txt'), 'utf8');
    for (const line of log.split('\n').filter((line) => /app_kit_window|android_fixture|desktop sign-in|sign-in link|out of the window/i.test(line))) say(`log: ${line}`);
    say(`the app's log ${join(EVIDENCE, 'logcat.txt')}`);
    if (failed && process.env.ANDROID_E2E_KEEP) {
      // For looking into a failure by hand: the emulator and the site stay until this run is stopped.
      say(`failed: ${failed instanceof Error ? failed.message : String(failed)}`);
      say(`kept: ${serial} and the site stay up until this run is stopped (ANDROID_E2E_KEEP)`);
      await new Promise(() => {});
    }
    // The run's own emulator ends with it, however the run went; its watcher would end it only at its time.
    await runCommand([adbPath, '-s', serial, 'emu', 'kill'], { env });
  }
  server.stop(true);
}
if (failed) {
  console.error(`[android-e2e] failed: ${failed instanceof Error ? failed.message : String(failed)}`);
  process.exit(1);
}
