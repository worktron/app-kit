// The menu check a Mac release runs on a worker Mac: how the worker judges the app's lines, what it keeps from a real
// copy of the app, which leftover copies it ends, and what it prints of a stuck app's main thread. The lines are the
// shape the app's log printed on a worker Mac (2026-11-21), and the sample report's is `sample`'s on macOS 27.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appNumbers,
  appPid,
  CLAIM_MS,
  dataFolders,
  describeListed,
  ENDING_MS,
  itemName,
  judgeMenuCheck,
  kitLines,
  leftCopies,
  type Listed,
  otherCopies,
  otherCopiesOnceEnded,
  ownNoted,
  parseLine,
  recordFile,
  deleteOldSetAside,
  LATE_MS,
  recordFolders,
  SET_ASIDE_DAYS,
  setAsideFolder,
  setAsideRecorded,
  stuckFrames,
  unrecordedFolders,
} from '../tauri/mac-release/menu-check-entry.ts';
import { ENTRY } from '../tauri/mac-release/menu-check.ts';
import { scratch } from './testflight-stand-in.ts';

let place: ReturnType<typeof scratch>;
beforeEach(() => {
  place = scratch('mac-menu-check-');
});
afterEach(() => {
  place.done();
});

const KIT = 'tauri_plugin_app_kit_window';
const line = (message: string, target = KIT, level = 'INFO') => `[2026-11-21][12:16:08][${target}][${level}] ${message}`;

/** The lines of a check over `titles`, Quit last, each answering, with the kit's line after each of its own items. */
function run(titles: string[], change: (lines: string[]) => string[] = (lines) => lines): string[] {
  const total = titles.length;
  const lines = [line('menu check: starting'), line(`menu check: the menu holds ${JSON.stringify(titles)}`)];
  for (const [index, title] of titles.entries()) {
    const name = itemName(title, index + 1, total);
    lines.push(line(`menu check: choosing ${name}`));
    if (title.startsWith('Quit')) break;
    if (title === 'Settings…') lines.push(line('Settings opened', `${KIT}::settings`));
    if (title === 'Reload') lines.push(line('Reload chosen, reloading the page', `${KIT}::menu`));
    if (title.startsWith('Zoom ') || title === 'Actual Size') lines.push(line('zoomed to 1.15, saved for the next launch'));
    lines.push(line(`menu check: ${name} answered`));
  }
  return change(lines);
}

const ITEMS = ['About Example', 'Settings…', 'Close Window', 'Copy', 'Zoom In', 'Reload', 'Hearing Listener', 'Minimize', 'Quit Example'];

test('a check where every item answered, the kit acted on its own, and Quit ended the app passes', () => {
  expect(judgeMenuCheck(run(ITEMS), 'exited')).toEqual({ passed: true, why: 'every one of the 8 menu items answered, and Quit ended the app' });
});

test("the app stopping after Settings…, as v0.71.0's Settings window did, fails naming the item", () => {
  const lines = run(ITEMS, (all) => [...all.slice(0, all.indexOf(line('menu check: choosing Settings… (2 of 9)')) + 1), line('menu check: the app stopped answering after Settings… (2 of 9) was chosen', KIT, 'ERROR')]);
  expect(judgeMenuCheck(lines, 'stopped-answering')).toEqual({ passed: false, why: 'the app stopped answering after Settings… (2 of 9) was chosen' });
  // A log that stood still with no line from the app's own limit says the same of the last item chosen.
  const still = run(ITEMS, (all) => all.slice(0, all.indexOf(line('menu check: choosing Settings… (2 of 9)')) + 1));
  expect(judgeMenuCheck(still, 'still').why).toBe('the app stopped answering after Settings… (2 of 9) was chosen');
});

test('a kit item that answered but whose kit line never came fails, as a Settings… that opened no window would', () => {
  const lines = run(ITEMS, (all) => all.filter((each) => !each.endsWith('Settings opened')));
  expect(judgeMenuCheck(lines, 'exited')).toEqual({
    passed: false,
    why: 'Settings… (2 of 9) answered, but the kit never logged that it acted on it (one of: Settings opened; Settings chosen from the menu with the window open; chosen from the menu, bringing the window forward and handing it to the page)',
  });
  // The line must come after the item was chosen: the update check at launch does not answer Check for Updates….
  const updates = ['Check for Updates…', 'Quit Example'];
  const early = [line('no newer version is released', `${KIT}::updates`), ...run(updates)];
  expect(judgeMenuCheck(early, 'exited').passed).toBe(false);
  const late = run(updates, (all) => [...all.slice(0, -1), line('no newer version is released', `${KIT}::updates`), all.at(-1)!]);
  expect(judgeMenuCheck(late, 'exited').passed).toBe(true);
});

test("a kit line counts for one item only, so a Zoom In that did nothing fails though Zoom Out's line follows", () => {
  const zooms = ['Zoom In', 'Zoom Out', 'Quit Example'];
  expect(judgeMenuCheck(run(zooms), 'exited').passed).toBe(true);
  const zoomInDidNothing = run(zooms, (all) => all.filter((each, at) => !(each.includes('zoomed to') && at < all.indexOf(line('menu check: choosing Zoom Out (2 of 3)')))));
  expect(judgeMenuCheck(zoomInDidNothing, 'exited').why).toBe("Zoom Out (2 of 3) answered, but the kit never logged that it acted on it (one of: zoomed to)");
});

test("a warning from the kit fails the check, and one from anything else does not", () => {
  const kitWarned = run(ITEMS, (all) => [...all, line('Settings chosen from the menu, but its window could not open: no page', `${KIT}::settings`, 'WARN')]);
  expect(judgeMenuCheck(kitWarned, 'exited')).toEqual({ passed: false, why: 'the kit logged a warn during the check: Settings chosen from the menu, but its window could not open: no page' });
  const appWarned = run(ITEMS, (all) => [...all, line('the helper could not start', 'example_app::hearing', 'WARN')]);
  expect(judgeMenuCheck(appWarned, 'exited').passed).toBe(true);
});

test('Quit that does not end the app, a check that never started, and an app that ended early each fail', () => {
  expect(judgeMenuCheck(run(ITEMS), 'still').why).toBe('Quit did not end the app within 10 s');
  expect(judgeMenuCheck(run(ITEMS), 'too-long').why).toBe('the check ran past 3 minutes');
  expect(judgeMenuCheck([line('updates are on', `${KIT}::updates`)], 'never-started').why).toStartWith('the app never logged that its menu check started');
  expect(judgeMenuCheck([line('menu check: starting')], 'exited').why).toBe('the app ended before the check listed the menu\'s items');
  const ended = run(ITEMS).slice(0, 7);
  expect(judgeMenuCheck(ended, 'exited').why).toBe('Close Window (3 of 9) was never chosen: the app ended first');
  expect(judgeMenuCheck(run(['About Example', 'Copy']), 'exited').why).toBe('the menu bar holds no Quit, which every Mac app has');
  // Every other item answered, then the app ended before Quit was chosen: that is not Quit ending it.
  const beforeQuit = run(ITEMS).filter((each) => !each.includes('choosing Quit Example'));
  expect(judgeMenuCheck(beforeQuit, 'exited').why).toBe('Quit Example (9 of 9) was never chosen: the app ended first');
});

test('two items with one title are told apart by their place', () => {
  const titles = ['Enter Full Screen', 'Enter Full Screen', 'Quit Example'];
  const lines = run(titles, (all) => all.filter((each) => !each.endsWith('Enter Full Screen (2 of 3) answered')));
  expect(judgeMenuCheck(lines, 'still').why).toBe('the app stopped answering after Enter Full Screen (2 of 3) was chosen');
});

test("the update item is the kit's under each of its titles", () => {
  expect(kitLines('Check for Updates…')).toContain('no newer version is released');
  expect(kitLines('Example 0.1.4 Is Up to Date')).toContain('no newer version is released');
  expect(kitLines('Could Not Check for Updates, Try Again')).toContain('could not ask the releases');
  expect(kitLines('Hearing Listener')).toBeNull();
  expect(parseLine('[2026-11-21][12:06:04][tauri_plugin_app_kit_window::updates][INFO] no newer version is released')).toEqual({
    target: 'tauri_plugin_app_kit_window::updates',
    level: 'INFO',
    message: 'no newer version is released',
  });
});

test("a real copy's data is never touched: only folders the check recorded are deleted", () => {
  const home = place.folder;
  const id = 'com.example.app';
  const [logs, webkit] = dataFolders(home, id) as [string, string];
  // Nothing there: nothing to keep.
  expect(unrecordedFolders(home, id)).toEqual([]);
  // A real copy's folder, with no record: the check refuses and leaves it.
  mkdirSync(webkit, { recursive: true });
  writeFileSync(join(webkit, 'cookies'), 'someone signed in');
  expect(unrecordedFolders(home, id)).toEqual([webkit]);
  expect(readFileSync(join(webkit, 'cookies'), 'utf8')).toBe('someone signed in');
  // A check that recorded its folders and was stopped before it cleared them: the next check sets them aside first.
  const other = 'com.example.other';
  recordFolders(home, other);
  const [otherLogs] = dataFolders(home, other) as [string];
  mkdirSync(otherLogs, { recursive: true });
  writeFileSync(join(otherLogs, 'Example.log'), 'the check');
  expect(unrecordedFolders(home, other)).toEqual([]);
  expect(existsSync(otherLogs)).toBe(false);
  expect(existsSync(recordFile(home, other))).toBe(false);
  // A record naming a folder that is not one of the app's own is never followed.
  writeFileSync(recordFile(home, 'com.example.third'), JSON.stringify({ folders: [webkit, logs], at: Date.now(), claimMs: 60_000 }));
  expect(setAsideRecorded(home, 'com.example.third')).toBeNull();
  expect(existsSync(webkit)).toBe(true);
});

test('what the check clears is set aside, under its path in Library, and deleted only after its days are up', () => {
  const home = place.folder;
  const id = 'com.example.app';
  const [logs, webkit] = dataFolders(home, id) as [string, string];
  mkdirSync(join(webkit, 'WebsiteData'), { recursive: true });
  writeFileSync(join(webkit, 'WebsiteData', 'cookies'), 'signed in');
  mkdirSync(logs, { recursive: true });
  recordFolders(home, id);
  const when = Date.parse('2026-11-21T14:30:00Z');
  const kept = setAsideRecorded(home, id, when)!;
  expect(kept).toBe(join(setAsideFolder(home), 'com.example.app-2026-11-21T14-30-00.000Z'));
  expect(readFileSync(join(kept, 'WebKit', id, 'WebsiteData', 'cookies'), 'utf8')).toBe('signed in');
  expect(existsSync(join(kept, 'Logs', id))).toBe(true);
  expect(existsSync(webkit)).toBe(false);
  deleteOldSetAside(home, Date.now() + (SET_ASIDE_DAYS - 1) * 24 * 60 * 60_000);
  expect(existsSync(kept)).toBe(true);
  deleteOldSetAside(home, Date.now() + (SET_ASIDE_DAYS + 1) * 24 * 60 * 60_000);
  expect(existsSync(kept)).toBe(false);
});

test("what macOS writes for the app a moment after a run is the check's to clear, not a real copy's", () => {
  const home = place.folder;
  const id = 'com.example.app';
  const preferences = dataFolders(home, id).at(-1)!;
  // The run ended and cleared its folders; the record stays for LATE_MS, and macOS then flushes the preferences.
  recordFolders(home, id, Date.now() - 5_000, LATE_MS);
  mkdirSync(join(preferences, '..'), { recursive: true });
  writeFileSync(preferences, 'flushed late');
  expect(unrecordedFolders(home, id)).toEqual([]);
  expect(existsSync(preferences)).toBe(false);
});

test("a record an interrupted check left is dropped, its folders kept, once a real copy changed them after it", () => {
  const home = place.folder;
  const id = 'com.example.app';
  const [, webkit] = dataFolders(home, id) as [string, string];
  // The check recorded its folders an hour ago and was cut off; since then someone installed the app and signed in.
  const hourAgo = Date.now() - 60 * 60_000;
  recordFolders(home, id, hourAgo);
  mkdirSync(join(webkit, 'WebsiteData'), { recursive: true });
  writeFileSync(join(webkit, 'WebsiteData', 'cookies'), 'someone signed in');
  expect(unrecordedFolders(home, id)).toEqual([webkit]);
  expect(readFileSync(join(webkit, 'WebsiteData', 'cookies'), 'utf8')).toBe('someone signed in');
  expect(existsSync(recordFile(home, id))).toBe(false);
  // A check cut off a moment ago: its own app's writes came after its record, within CLAIM_MS, so they are cleared.
  const other = 'com.example.other';
  const [, otherWebkit] = dataFolders(home, other) as [string, string];
  recordFolders(home, other, Date.now() - CLAIM_MS / 2);
  mkdirSync(join(otherWebkit, 'WebsiteData'), { recursive: true });
  writeFileSync(join(otherWebkit, 'WebsiteData', 'cache'), 'the check');
  expect(unrecordedFolders(home, other)).toEqual([]);
  expect(existsSync(otherWebkit)).toBe(false);
});

test("the check's own app is told from another copy by the process id macOS lists for each", () => {
  // lsappinfo's answers on macOS 27 (2026-11-21), for Finder.
  expect(appNumbers('ASN:0x0-0x26026-"Finder":\n')).toEqual(['ASN:0x0-0x26026-"Finder":']);
  expect(appNumbers('')).toEqual([]);
  expect(appPid('[ NULL ]  [ NULL ]  \n    bundleID=[ NULL ] \n    pid = 761 !cgsConnection !signalled type=[ NULL ]')).toBe(761);
  expect(appPid('"pid"=761')).toBe(761);
  expect(appPid('')).toBe(0);
});

test('only copies running from a check folder count as left by an earlier check', () => {
  const listing = [
    '  101 /private/var/folders/x/T/app-kit-menu-check-abc/Example App.app/Contents/MacOS/example',
    '  102 /Applications/Example App.app/Contents/MacOS/example',
    '  103 /usr/bin/ssh-agent -l',
  ].join('\n');
  expect(leftCopies(listing, ['/var/folders/x/T/app-kit-menu-check-', '/private/var/folders/x/T/app-kit-menu-check-'])).toEqual([101]);
});

test("a stuck app's main thread is printed from the app, Tauri and the kit, innermost last", () => {
  const report = readFileSync(join(import.meta.dir, 'fixtures/mac-release/sample-settings-freeze.txt'), 'utf8');
  // The real report of v0.71.0's Settings freeze on a worker Mac (2026-11-21), its first two threads.
  expect(stuckFrames(report)).toEqual([
    'tauri_runtime_wry::handle_event_loop',
    'tauri::app::App$LT$R$GT$::make_run_event_loop_callback::_$u7b$$u7b$closure$u7d$$u7d$',
    'tauri::app::on_event_loop_event',
    'tauri_plugin_app_kit_window::run_event',
    'tauri_plugin_app_kit_window::menu::menu_event',
    'tauri_plugin_app_kit_window::settings::open',
    'tauri::window::WindowBuilder$LT$R$C$M$GT$::with_webview',
    'tauri::manager::webview::WebviewManager$LT$R$GT$::prepare_webview',
    '_RNvMNtNtNtNtNtCsg55jX0GwzBC_3std3sys3pal4unix4sync5mutexNtB2_5Mutex4lock',
    '_pthread_mutex_firstfit_lock_slow',
    '_pthread_mutex_firstfit_lock_wait',
    '__psynch_mutexwait',
  ]);
});

test("the job's entry runs the kit's judge with bun from the job's own folder", () => {
  expect(ENTRY).toContain('cd "$(dirname "$0")/.." && exec bun tauri/mac-release/menu-check-entry.ts');
});

// The moments after the kill are made up: on the workers macOS stopped listing a killed app at the first look in 31
// tries (2026-11-22), yet one check took its own ending copy for another; what macOS listed then is unknown.
const OWN_NUMBER = 'ASN:0x0-0x1-"Example":';
const own = { pid: 501, numbers: [OWN_NUMBER] };

test("the check's own copy, still listed a moment after its kill by its number or its id, with or without an id, is waited out and is no other copy", async () => {
  const answers: Listed[][] = [[{ number: OWN_NUMBER, pid: 501 }], [{ number: OWN_NUMBER, pid: 0 }], [{ number: 'ASN:0x0-0x9-"Example":', pid: 501 }], []];
  let slept = 0;
  expect(await otherCopiesOnceEnded(() => answers.shift() ?? [], own, async () => void slept++)).toEqual([]);
  expect(slept).toBe(3);
});

test("a copy opened during the check is another copy, even once its process has ended, and so is one macOS still gives no id for after the wait", async () => {
  // A real copy opened and quit during the check: listed under its own number with its ended process's id.
  const openedAndQuit = { number: 'ASN:0x0-0x2-"Example":', pid: 777 };
  let slept = 0;
  expect(await otherCopiesOnceEnded(() => [openedAndQuit], own, async () => void slept++)).toEqual([openedAndQuit]);
  expect(slept).toBe(0);

  const unknown = { number: 'ASN:0x0-0x3-"Example":', pid: 0 };
  expect(await otherCopiesOnceEnded(() => [unknown], own, async () => void slept++)).toEqual([unknown]);
  expect(slept).toBe(ENDING_MS / 100);
  expect(describeListed([openedAndQuit, unknown])).toBe('ASN:0x0-0x2-"Example": with process 777, ASN:0x0-0x3-"Example": with no process id');
});

test("a check whose app ended before its number was read still tells its own copy by its process id, and nothing else", () => {
  const ended = { pid: 501, numbers: [] };
  expect(otherCopies([{ number: 'a', pid: 501 }], ended)).toEqual([]);
  expect(otherCopies([{ number: 'b', pid: 0 }, { number: 'c', pid: 640 }], ended)).toHaveLength(2);
});

test("the check asks for its own copy's number once its check has started, and again each time round until macOS lists it", () => {
  const answers = [false, false, true];
  let asked = 0;
  const noteOwn = () => (asked++, answers.shift() ?? true);
  const before = line("menu check: the menu holds []");
  let noted = ownNoted(false, before, noteOwn);
  expect([noted, asked]).toEqual([false, 0]);
  const started = `${line("menu check: starting")}\n`;
  for (let round = 0; round < 4; round++) noted = ownNoted(noted, started, noteOwn);
  expect([noted, asked]).toEqual([true, 3]);
});
