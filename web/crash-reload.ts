import { isNewBuild, runningEntry, servedEntry, unsavedInput } from './new-build';
import { RELOAD_GUARD_MS } from './preload';
import { read, session, write, type KeyValueStore } from './storage';

const KEY = 'app-kit.crashReload';

/** How long a crashed page waits to hear which build the server serves before it shows the crash. */
export const CRASH_CHECK_MS = 3_000;

/** Whether a crash reloads the page, and why, for the log. */
export type CrashDecision = { reload: boolean; reason: string };

/**
 * Whether a page that crashed reloads onto the build the server serves now. A page left open across a deploy, or a
 * rollback, crashes on data in a shape its build does not know, and a reload onto the served build mends it. It never
 * reloads toward the build it last reloaded toward in this tab, nor within RELOAD_GUARD_MS of its last reload, so a
 * crash the served build has too, a reload that a cache answers with the old page, or two builds answering in turn
 * ends on the crash screen rather than in a loop. A reload it cannot remember, with storage blocked, is not made. When
 * it reloads, it remembers.
 */
export function crashReload({
  running,
  served,
  typed,
  store = session,
  now = Date.now(),
}: {
  running: string | null;
  served: string | null;
  /** Whether the page holds text a reload would lose, outside the part that crashed. */
  typed: boolean;
  store?: () => KeyValueStore;
  now?: number;
}): CrashDecision {
  if (served === null) return { reload: false, reason: 'the index page the server sent names no built entry' };
  if (!isNewBuild(running, served)) return { reload: false, reason: `the server serves this build, ${String(running)}` };
  if (typed) return { reload: false, reason: 'the page holds typed text a reload would lose' };
  const last = lastReload(store);
  if (last?.to === served) return { reload: false, reason: `the page already reloaded once toward ${served}` };
  if (last && now - last.at < RELOAD_GUARD_MS) return { reload: false, reason: 'the page reloaded after a crash moments ago' };
  const memory = JSON.stringify({ to: served, at: now });
  write(store, KEY, memory);
  if (read(store, KEY) !== memory) return { reload: false, reason: 'storage is blocked, so a reload could not be remembered' };
  return { reload: true, reason: `the server serves a newer build, ${String(served)}` };
}

function lastReload(store: () => KeyValueStore): { to: string; at: number } | null {
  try {
    const last: unknown = JSON.parse(read(store, KEY) ?? 'null');
    if (typeof last === 'object' && last !== null && 'to' in last && 'at' in last && typeof last.to === 'string' && typeof last.at === 'number')
      return { to: last.to, at: last.at };
  } catch {
    // Not what was written: as good as none.
  }
  return null;
}

/**
 * After a crash on a built page, asks which build the server serves, waiting at most `waitMs`, and reloads onto it
 * when crashReload says to. Resolves true when the page is reloading, false when the crash is to be shown. Every
 * decision is logged with its reason. A page that asks before it unloads, and is told to stay, keeps what it drew
 * while asking: no app on the kit asks.
 */
export async function afterCrash({
  look = servedEntry,
  reload = () => window.location.reload(),
  waitMs = CRASH_CHECK_MS,
  store = session,
}: {
  look?: (signal: AbortSignal) => Promise<string | null>;
  reload?: () => void;
  waitMs?: number;
  store?: () => KeyValueStore;
} = {}): Promise<boolean> {
  const running = runningEntry();
  if (!running) return false;
  const stop = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const noAnswer = new Promise<'no answer'>((resolve) => {
    timer = setTimeout(() => resolve('no answer'), waitMs);
  });
  // Offline, or the server mid-deploy, is no answer too.
  const served = await Promise.race([look(stop.signal).catch(() => 'no answer' as const), noAnswer]);
  clearTimeout(timer);
  stop.abort();
  if (served === 'no answer') {
    console.info('[app-kit] crash, not reloading: the server did not say which build it serves');
    return false;
  }
  const decision = crashReload({ running, served, typed: unsavedInput(), store });
  if (!decision.reload) {
    console.info(`[app-kit] crash, not reloading: ${decision.reason}`);
    return false;
  }
  console.info(`[app-kit] crash on an older build, reloading: ${decision.reason}`);
  reload();
  return true;
}
