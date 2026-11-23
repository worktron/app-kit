/*
 * The menu check's half on the worker Mac, which fleet's worker door runs from the job the release sends
 * (menu-check.ts): it unpacks the update archive about to be published, starts the app with the check on, follows its
 * log, judges it, and puts the worker back as it was. Bun runs this file there from the job's own copy, beside
 * ../window/names.ts, the only file it imports, so it reaches nothing else of the kit.
 *
 * What it heads off:
 * - A real copy's data is never lost. The check clears only the app's folders under ~/Library that its own record
 *   (~/.local/state/app-kit/menu-check/<identifier>.json) says it made, and refuses (6) when the app is running on the
 *   worker or its folders are there without that record: the worker is someone's Mac, and the test copy shares a real
 *   copy's saved data, sign-in included, since Tauri builds the identifier into the app (a copy given another one in
 *   its Info.plist still wrote its log under the real one, on a worker Mac, 2026-11-21). A record counts only while
 *   nothing in its folders changed after its check could have written to them (`claimMs`): a later change is a real
 *   copy's, and the record is dropped. A copy of the app running when the check ends, opened during it, keeps them too,
 *   judged only once the check's own copy has left LaunchServices (ENDING_MS).
 *   What it clears it sets aside for SET_ASIDE_DAYS (~/.local/state/app-kit/menu-check/set-aside/), never deletes, so a
 *   misjudged real copy's data can be put back. After a run the record stays for LATE_MS, so what macOS writes for
 *   the app a moment after it ends is the check's to clear, not a real copy's that would refuse the next check.
 * - A copy an earlier check left running, stopped with the job (a lost connection, the release's own limit), is ended
 *   first, found by its program's path under this check's own temporary folders. macOS starts the app through
 *   LaunchServices (`open`), since a program started directly from the door's session cannot reach the desktop (a
 *   worker Mac, 2026-11-21), so it is not in the job's process group, and the door's stop never reaches it.
 * - A freeze is judged from the app's own lines, never from time alone: an item that does not answer within the app's
 *   own limit logs that it stopped answering, and a log that stops moving for STILL_MS, or a run past RUN_MS, is the
 *   same verdict. The stuck app is sampled first, and its main thread's frames from the app, Tauri and the kit printed,
 *   which named the Settings freeze at once.
 *
 * Exit codes: 0 passed; 5 the app failed the check; 6 refused, the worker holds a real copy of the app or the archive
 * holds no app; 1 anything else, the app's process never appearing included.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import {
  MENU_CHECK_ANSWERED,
  MENU_CHECK_CHOOSING,
  MENU_CHECK_HOLDS,
  MENU_CHECK_KIT_ITEMS,
  MENU_CHECK_KIT_TARGET,
  MENU_CHECK_LINE,
  MENU_CHECK_NEVER_ANSWERED,
  MENU_CHECK_STARTING,
  MENU_CHECK_STOPPED,
  MENU_CHECK_VARIABLE,
} from '../window/names.ts';

export const PASSED = 0;
export const FAILED = 5;
export const REFUSED = 6;

/** The start of the name of each check's temporary folder, under which the app it starts runs. */
export const CHECK_FOLDER = 'app-kit-menu-check-';
/** How long the app may take to log that its check started. */
export const START_MS = 30_000;
/** How long the log may stand still while the app runs before it counts as stuck: well past the app's own 20 s per item. */
export const STILL_MS = 30_000;
/** How long Quit may take to end the app. */
export const QUIT_MS = 10_000;
/** The longest a whole run may take. */
export const RUN_MS = 3 * 60_000;
/**
 * How long after its record a check's own app may still write to its folders: its start, its whole run, and a minute
 * for an app a lost connection left running, whose check still goes on to Quit by itself.
 */
export const CLAIM_MS = START_MS + RUN_MS + 60_000;
/** How long after a run ends macOS may still write the app's folders, its preferences flushed and WebKit closing. */
export const LATE_MS = 60_000;
/**
 * How long after the check ends its app macOS may still list it: the check waits this long for its own copy to leave
 * LaunchServices before it takes what is listed as another copy (a worker Mac, 2026-11-22, kept Matter's folders after
 * a failed check with no other copy started, by its own log).
 */
export const ENDING_MS = 5_000;
/** The start of a line the check prints that is not its verdict, so the release never takes one for it. */
export const NOTE = 'menu check note: ';
/** How long cleared folders are kept, set aside, before they are deleted. */
export const SET_ASIDE_DAYS = 7;

/** One line of the app's log, as the log plugin writes it: `[date][time][target][LEVEL] message`. */
export type LogLine = { target: string; level: string; message: string };

export function parseLine(line: string): LogLine | null {
  const match = /^\[[^\]]*\]\[[^\]]*\]\[([^\]]*)\]\[([A-Z]+)\] (.*)$/.exec(line);
  return match ? { target: match[1]!, level: match[2]!, message: match[3]! } : null;
}

/** An item as the check's lines name it: `<title> (<n> of <total>)`. */
export function itemName(title: string, place: number, total: number): string {
  return `${title} (${place} of ${total})`;
}

/** The kit's lines that say it acted on an item of this title, or null for an item that is not the kit's. */
export function kitLines(title: string): readonly string[] | null {
  const item = MENU_CHECK_KIT_ITEMS.find((kit) => (kit.end ? title.endsWith(kit.title) : title === kit.title));
  return item?.lines ?? null;
}

/** How the app's run ended, as the follower saw it. */
export type Ending = 'exited' | 'still' | 'never-started' | 'too-long' | 'stopped-answering';

export type Verdict = { passed: boolean; why: string };

/**
 * Judges a run from the app's lines and how it ended: the check listed its items, every item but Quit answered, each
 * kit item's own line came after it was chosen, the kit logged no warning or error, and Quit ended the app. Each kit
 * line counts for one item only, the first item before it still owed one, so a Zoom In that did nothing fails even when
 * Zoom Out's 'zoomed to' follows; a line may still come after later items were chosen, as the update item's answer does.
 */
export function judgeMenuCheck(lines: string[], ending: Ending): Verdict {
  const parsed = lines.map(parseLine).filter((line): line is LogLine => line !== null);
  const check = parsed.filter((line) => line.message.startsWith(MENU_CHECK_LINE)).map((line) => line.message.slice(MENU_CHECK_LINE.length));
  const stopped = check.find((message) => message.startsWith(MENU_CHECK_STOPPED));
  if (stopped) return { passed: false, why: stopped };
  if (check.includes(MENU_CHECK_NEVER_ANSWERED)) return { passed: false, why: MENU_CHECK_NEVER_ANSWERED };
  if (!check.includes(MENU_CHECK_STARTING)) {
    return { passed: false, why: `the app never logged that its menu check started, within ${START_MS / 1000} s: is it on app-kit's window plugin at a version with the check?` };
  }
  const holds = check.find((message) => message.startsWith(MENU_CHECK_HOLDS));
  let titles: string[] = [];
  try {
    titles = holds ? (JSON.parse(holds.slice(MENU_CHECK_HOLDS.length)) as string[]) : [];
  } catch {
    return { passed: false, why: `the check's list of items is not JSON: ${holds}` };
  }
  if (titles.length === 0) {
    const where = ending === 'exited' ? 'the app ended' : 'the app stopped logging';
    return { passed: false, why: holds ? 'the menu bar holds no item a person could choose' : `${where} before the check listed the menu's items` };
  }
  const total = titles.length;
  const last = titles[total - 1]!;
  const hasQuit = last === 'Quit' || last.startsWith('Quit ');
  const claimed = new Set<number>();
  for (const [index, title] of titles.entries()) {
    const name = itemName(title, index + 1, total);
    if (hasQuit && index === total - 1) break;
    const chosenAt = parsed.findIndex((line) => line.message === `${MENU_CHECK_LINE}${MENU_CHECK_CHOOSING}${name}`);
    if (chosenAt === -1) return { passed: false, why: `${name} was never chosen: ${ending === 'exited' ? 'the app ended' : 'the app stopped'} first` };
    if (!check.includes(`${name}${MENU_CHECK_ANSWERED}`)) return { passed: false, why: `the app stopped answering after ${name} was chosen` };
    const wanted = kitLines(title);
    if (!wanted) continue;
    const acted = parsed.findIndex(
      (line, at) => at > chosenAt && !claimed.has(at) && line.target.startsWith(MENU_CHECK_KIT_TARGET) && wanted.some((words) => line.message.includes(words)),
    );
    if (acted === -1) return { passed: false, why: `${name} answered, but the kit never logged that it acted on it (one of: ${wanted.join('; ')})` };
    claimed.add(acted);
  }
  const warned = parsed.find((line) => line.target.startsWith(MENU_CHECK_KIT_TARGET) && (line.level === 'WARN' || line.level === 'ERROR'));
  if (warned) return { passed: false, why: `the kit logged a ${warned.level.toLowerCase()} during the check: ${warned.message}` };
  if (!hasQuit) return { passed: false, why: 'the menu bar holds no Quit, which every Mac app has' };
  const quitName = itemName(last, total, total);
  if (!check.includes(`${MENU_CHECK_CHOOSING}${quitName}`)) {
    return { passed: false, why: `${quitName} was never chosen: ${ending === 'exited' ? 'the app ended' : 'the app stopped'} first` };
  }
  if (ending !== 'exited') {
    const why = { still: `Quit did not end the app within ${QUIT_MS / 1000} s`, 'too-long': `the check ran past ${RUN_MS / 60_000} minutes` }[ending as 'still' | 'too-long'];
    return { passed: false, why: why ?? `the app stopped answering after ${itemName(last, total, total)} was chosen` };
  }
  return { passed: true, why: `every one of the ${total - 1} menu items answered, and Quit ended the app` };
}

/** The folders under ~/Library where an app keeps its saved data and log, by its identifier. */
export function dataFolders(home: string, identifier: string): string[] {
  const library = join(home, 'Library');
  return [
    join(library, 'Logs', identifier),
    join(library, 'WebKit', identifier),
    join(library, 'Caches', identifier),
    join(library, 'Application Support', identifier),
    join(library, 'HTTPStorages', identifier),
    join(library, 'HTTPStorages', `${identifier}.binarycookies`),
    join(library, 'Saved Application State', `${identifier}.savedState`),
    join(library, 'Preferences', `${identifier}.plist`),
  ];
}

/** Where the check records the folders it is about to make, so only those are ever deleted. */
export function recordFile(home: string, identifier: string): string {
  return join(home, '.local/state/app-kit/menu-check', `${identifier}.json`);
}

/** The newest change to anything in these files and folders, in milliseconds, or 0 when none is there. */
export function newestChange(paths: string[]): number {
  let newest = 0;
  const look = (path: string) => {
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      return;
    }
    newest = Math.max(newest, stat.mtimeMs, stat.ctimeMs);
    if (stat.isDirectory()) for (const name of readdirSync(path)) look(join(path, name));
  };
  for (const path of paths) look(path);
  return newest;
}

/** The folders a check claims, from when, and for how long after it may write them. */
type CheckRecord = { folders: string[]; at: number; claimMs: number };

function readRecord(home: string, identifier: string): CheckRecord | null {
  try {
    const record = JSON.parse(readFileSync(recordFile(home, identifier), 'utf8')) as Partial<CheckRecord>;
    const { folders, at, claimMs } = record;
    return Array.isArray(folders) && typeof at === 'number' && typeof claimMs === 'number' ? { folders, at, claimMs } : null;
  } catch {
    return null;
  }
}

/**
 * Deletes what an earlier check recorded and did not get to remove, while nothing in it changed after that check could
 * have ended, then says which of the app's folders are there without a record: a real copy's, which the check never
 * touches. A record whose folders changed later, or that cannot be read, is dropped and its folders kept.
 */
export function unrecordedFolders(home: string, identifier: string, now = Date.now()): string[] {
  if (existsSync(recordFile(home, identifier))) {
    const record = readRecord(home, identifier);
    if (record && newestChange(dataFolders(home, identifier)) <= record.at + record.claimMs) setAsideRecorded(home, identifier, now);
    rmSync(recordFile(home, identifier), { force: true });
  }
  return dataFolders(home, identifier).filter((folder) => existsSync(folder));
}

/** Records the app's folders as the check's own from `now`, for `claimMs` after, before the app that makes them runs. */
export function recordFolders(home: string, identifier: string, now = Date.now(), claimMs = CLAIM_MS): void {
  mkdirSync(join(recordFile(home, identifier), '..'), { recursive: true });
  const record: CheckRecord = { folders: dataFolders(home, identifier), at: now, claimMs };
  writeFileSync(recordFile(home, identifier), JSON.stringify(record));
}

/** Where cleared folders are kept, one folder per clearing, named for the app and the time. */
export function setAsideFolder(home: string): string {
  return join(home, '.local/state/app-kit/menu-check/set-aside');
}

/**
 * Moves the folders the record names, only those that are the app's own, into a set-aside folder of their own, each
 * under its path in ~/Library, and returns it; the record itself is left to the caller.
 */
export function setAsideRecorded(home: string, identifier: string, now = Date.now()): string | null {
  const folders = readRecord(home, identifier)?.folders ?? [];
  const allowed = new Set(dataFolders(home, identifier));
  const there = folders.filter((folder) => allowed.has(folder) && existsSync(folder));
  if (there.length === 0) return null;
  const kept = join(setAsideFolder(home), `${identifier}-${new Date(now).toISOString().replaceAll(':', '-')}`);
  for (const folder of there) {
    const to = join(kept, relative(join(home, 'Library'), folder));
    mkdirSync(dirname(to), { recursive: true });
    renameSync(folder, to);
  }
  return kept;
}

/** Deletes what was set aside more than SET_ASIDE_DAYS ago. */
export function deleteOldSetAside(home: string, now = Date.now()): void {
  const folder = setAsideFolder(home);
  if (!existsSync(folder)) return;
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (now - lstatSync(path).mtimeMs > SET_ASIDE_DAYS * 24 * 60 * 60_000) rmSync(path, { recursive: true, force: true });
  }
}

/** The pids of programs running from under a check's temporary folder, by `ps -axo pid=,command=`'s listing. */
export function leftCopies(listing: string, folders: string[]): number[] {
  const pids: number[] = [];
  for (const line of listing.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (match && folders.some((folder) => match[2]!.startsWith(folder))) pids.push(Number(match[1]));
  }
  return pids;
}

/** The main thread's frames from the app, Tauri and the kit, from `sample`'s report: what the app was stuck in. */
export function stuckFrames(report: string): string[] {
  const lines = report.split('\n');
  const start = lines.findIndex((line) => line.includes('com.apple.main-thread'));
  if (start === -1) return [];
  const frames: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\d+ Thread_/.test(line)) break;
    const frame = /\d+\s+(\S.*?)\s+\(in ([^)]+)\)/.exec(line);
    if (frame && /tauri|app_kit|plugin|Mutex|mutex|lock/i.test(frame[1]!)) frames.push(frame[1]!.replace(/::h[0-9a-f]{16}$/, ''));
  }
  return frames.slice(-12);
}

function command(program: string, args: string[]): { code: number; out: string } {
  const done = spawnSync(program, args, { encoding: 'utf8' });
  return { code: done.status ?? -1, out: `${done.stdout ?? ''}${done.stderr ?? ''}` };
}

const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

/** The check folders this user's temporary folder may be written as: the path given, and with symbolic links resolved. */
function checkFolderStarts(): string[] {
  const base = tmpdir();
  const real = realpathSync(base);
  return [...new Set([join(base, CHECK_FOLDER), join(real, CHECK_FOLDER)])];
}

/** Runs the check on this worker, from the job's folder holding the archive, and returns its exit code. */
export async function main(jobFolder: string, print: (line: string) => void): Promise<number> {
  const home = process.env.HOME || homedir();
  const worker = process.env.FLEET_WORKER_NAME || 'this worker';
  const archive = readdirSync(jobFolder).find((name) => name.endsWith('.app.tar.gz'));
  if (!archive) {
    print('menu check: refused: the job holds no update archive');
    return REFUSED;
  }
  deleteOldSetAside(home);
  for (const pid of leftCopies(command('/bin/ps', ['-axo', 'pid=,command=']).out, checkFolderStarts())) {
    print(`${NOTE}ending process ${pid}, a copy an earlier check left running`);
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  const folder = mkdtempSync(join(tmpdir(), CHECK_FOLDER));
  const out = join(folder, 'output.log');
  let identifier = '';
  let app = '';
  let pid = 0;
  // The numbers LaunchServices lists the check's own copy under, read while it runs, since one that quit is gone.
  const numbers = new Set<string>();
  const noteOwn = (): boolean => {
    if (pid && identifier) for (const copy of listed(identifier)) if (copy.pid === pid) numbers.add(copy.number);
    return numbers.size > 0;
  };
  // The verdict is printed last, after every line the cleanup prints, since the release takes the last line as it.
  let verdict = '';
  const say = (line: string) => void (verdict = line);
  try {
    const unpacked = command('/usr/bin/tar', ['-xzf', join(jobFolder, archive), '-C', folder]);
    const bundle = readdirSync(folder).find((name) => name.endsWith('.app'));
    if (unpacked.code !== 0 || !bundle) {
      say(`menu check: refused: the update archive holds no app: ${unpacked.out.trim()}`);
      return REFUSED;
    }
    app = join(folder, bundle);
    const plist = join(app, 'Contents/Info.plist');
    const read = (key: string) => command('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist]).out.trim();
    identifier = read('CFBundleIdentifier');
    const program = join(app, 'Contents/MacOS', read('CFBundleExecutable'));
    if (!/^[A-Za-z0-9.-]+$/.test(identifier) || !existsSync(program)) {
      say(`menu check: refused: ${bundle} names no identifier or program in its Info.plist`);
      identifier = '';
      return REFUSED;
    }
    if (listed(identifier).length > 0) {
      say(`menu check: refused: ${identifier} is running on ${worker}; the check never runs beside a real copy`);
      identifier = '';
      return REFUSED;
    }
    const real = unrecordedFolders(home, identifier);
    if (real.length > 0) {
      say(`menu check: refused: ${worker} holds ${identifier}'s own data (${real.join(', ')}); the check never touches a real copy's`);
      identifier = '';
      return REFUSED;
    }
    recordFolders(home, identifier);
    print(`menu check: starting ${bundle} on ${worker}`);
    const opened = command('/usr/bin/open', ['-n', '--stdout', out, '--stderr', out, '--env', `${MENU_CHECK_VARIABLE}=1`, app]);
    if (opened.code !== 0) {
      say(`menu check: macOS could not start ${bundle}: ${opened.out.trim()}`);
      return 1;
    }
    const started = Date.now();
    while (!pid && Date.now() - started < START_MS) {
      pid = leftCopies(command('/bin/ps', ['-axo', 'pid=,command=']).out, [program, realpathSync(program)])[0] ?? 0;
      if (!pid) await Bun.sleep(250);
    }
    if (!pid) {
      // No process is a fact about the worker as much as the build (LaunchServices slow, a desktop that starts
      // nothing), so it is tried again, not held: an app that dies at launch fails each hourly try and says so.
      say(`menu check: ${bundle} did not start within ${START_MS / 1000} s on ${worker}`);
      return 1;
    }
    const ending = await follow(out, pid, noteOwn);
    const lines = existsSync(out) ? readFileSync(out, 'utf8').split('\n') : [];
    // The check's lines and the kit's own, which say what each item did; the app's own lines stay on the worker.
    for (const line of lines) if (parseLine(line)?.target.startsWith(MENU_CHECK_KIT_TARGET)) print(line);
    if (ending !== 'exited') {
      const sample = join(folder, 'sample.txt');
      command('/usr/bin/sample', [String(pid), '2', '-file', sample]);
      if (existsSync(sample)) {
        const frames = stuckFrames(readFileSync(sample, 'utf8'));
        if (frames.length > 0) print(`menu check: the main thread, innermost last:\n  ${frames.join('\n  ')}`);
      }
    }
    const judged = judgeMenuCheck(lines, ending);
    say(judged.passed ? `menu check: passed on ${worker}: ${judged.why}` : `menu check: failed on ${worker}: ${judged.why}`);
    return judged.passed ? PASSED : FAILED;
  } finally {
    // The check's own copy as macOS lists it, read once more while it may still run, so the cleanup tells it from any other.
    noteOwn();
    const own: Own = { pid, numbers: [...numbers] };
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // it ended
      }
    }
    if (app) command(LSREGISTER, ['-u', app]);
    rmSync(folder, { recursive: true, force: true });
    try {
      const others = identifier ? await otherCopiesOnceEnded(() => listed(identifier), own) : [];
      if (others.length > 0) {
        // A copy opened during the run shares the folders, so they are its now: the record goes, and they stay.
        rmSync(recordFile(home, identifier), { force: true });
        print(`${NOTE}${identifier} was opened on ${worker} during the check, so its folders are left as they are (macOS lists ${describeListed(others)})`);
      } else if (identifier) {
        setAsideRecorded(home, identifier);
        // The record stays a minute more, for what macOS writes for the app as it ends; the next check clears that.
        recordFolders(home, identifier, Date.now(), LATE_MS);
      }
    } finally {
      if (verdict) print(verdict);
    }
  }
}

/** The apps `lsappinfo find` names, as `ASN:0x0-0x26026-"Finder":`, one per running copy. */
export function appNumbers(found: string): string[] {
  return found.match(/ASN:0x[0-9a-f]+-0x[0-9a-f]+(?:-"[^"]*")?:/g) ?? [];
}

/** The process id in `lsappinfo info -only pid`'s answer, which macOS 27 writes as `pid = 761`, older ones `"pid"=761`. */
export function appPid(info: string): number {
  const match = /"?pid"?\s*=\s*(\d+)/.exec(info);
  return match ? Number(match[1]) : 0;
}

/** A copy of an app LaunchServices lists: its number there, and the process id it gives for it, 0 when it gives none. */
export interface Listed {
  number: string;
  pid: number;
}

/** The copies of the app of this identifier that macOS lists. */
function listed(identifier: string): Listed[] {
  return appNumbers(command('/usr/bin/lsappinfo', ['find', `bundleid=${identifier}`]).out).map((number) => ({
    number,
    pid: appPid(command('/usr/bin/lsappinfo', ['info', '-only', 'pid', number]).out),
  }));
}

/** The check's own copy: its process id, and the numbers LaunchServices listed it under while it ran. */
export interface Own {
  pid: number;
  numbers: string[];
}

function isOwn(copy: Listed, own: Own): boolean {
  return own.numbers.includes(copy.number) || (own.pid !== 0 && copy.pid === own.pid);
}

/**
 * The listed copies that are not the check's own, by its number in LaunchServices or its process id. Any other counts,
 * one macOS gives no id for and one whose process has ended included: a real copy that ran during the check shared its
 * folders, and the check never deletes on a guess.
 */
export function otherCopies(copies: Listed[], own: Own): Listed[] {
  return copies.filter((copy) => !isOwn(copy, own));
}

/**
 * The other copies listed once the check's own has left LaunchServices: asked again while its own copy, or one with no
 * id that could be it, is still listed, for up to ENDING_MS, and then judged as it stands.
 */
export async function otherCopiesOnceEnded(list: () => Listed[], own: Own, sleep: (ms: number) => Promise<void> = Bun.sleep, waitMs = ENDING_MS): Promise<Listed[]> {
  let copies = list();
  for (let waited = 0; waited < waitMs && copies.some((copy) => copy.pid === 0 || isOwn(copy, own)); waited += 100) {
    await sleep(100);
    copies = list();
  }
  return otherCopies(copies, own);
}

/** What macOS listed, as the check's note says it. */
export function describeListed(copies: Listed[]): string {
  return copies.map((copy) => `${copy.number} ${copy.pid ? `with process ${copy.pid}` : 'with no process id'}`).join(', ');
}

/**
 * Whether the check has its own copy's number from LaunchServices: once the app's output says its check started, macOS
 * lists it, so it is asked then, before Quit can end it, and asked again each time round until macOS has listed it.
 */
export function ownNoted(noted: boolean, text: string, noteOwn: () => boolean): boolean {
  return noted || (text.includes(`${MENU_CHECK_LINE}${MENU_CHECK_STARTING}`) && noteOwn());
}

/** Follows the app's output until it ends, is stuck, or runs too long, and says which. */
async function follow(out: string, pid: number, noteOwn: () => boolean): Promise<Ending> {
  const started = Date.now();
  let noted = false;
  let size = -1;
  let movedAt = Date.now();
  let quitAt = 0;
  for (;;) {
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    if (!alive) return 'exited';
    const text = existsSync(out) ? readFileSync(out, 'utf8') : '';
    if (text.length !== size) {
      size = text.length;
      movedAt = Date.now();
    }
    noted = ownNoted(noted, text, noteOwn);
    if (text.includes(`${MENU_CHECK_LINE}${MENU_CHECK_STOPPED}`)) return 'stopped-answering';
    if (text.includes(`${MENU_CHECK_LINE}${MENU_CHECK_NEVER_ANSWERED}`)) return 'stopped-answering';
    if (!text.includes(`${MENU_CHECK_LINE}${MENU_CHECK_STARTING}`) && Date.now() - started > START_MS) return 'never-started';
    if (!quitAt && /menu check: choosing Quit( [^\n]*)? \(\d+ of \d+\)\n/.test(text)) quitAt = Date.now();
    if (quitAt && Date.now() - quitAt > QUIT_MS) return 'still';
    if (Date.now() - movedAt > STILL_MS) return 'still';
    if (Date.now() - started > RUN_MS) return 'too-long';
    await Bun.sleep(500);
  }
}

if (import.meta.main) {
  process.exit(await main(process.cwd(), (line) => console.log(line)));
}
