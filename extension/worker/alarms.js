// Background work on a clock, on chrome.alarms, with a record of every run.
//
// Chrome stops an idle service worker after about thirty seconds, and its
// setInterval and setTimeout timers with it. An alarm survives: Chrome starts
// the worker again to deliver it. What the work needs across a restart belongs
// in chrome.storage, since the worker's variables do not survive either.
//
// every() owns a job's runs. Each run's start, end, outcome and error are kept
// in storage.local under `job:<name>`, where a status reader finds them with no
// worker running. One run at a time is held by a Web Lock named for the job,
// which Chrome frees if the worker stops, so two wakes at once make one run and
// a stopped worker leaves no lock behind. A run gets an AbortSignal that fires
// at its limit, and within() gives each request its own, shorter one. While a
// run is inside its limit the worker is kept alive with a Chrome call every 20
// seconds: Chrome counts a worker idle when no event arrives and no extension
// API is called, whatever the run is awaiting.
//
// At every worker start the job reads its record. A run with a start and no end
// was cut short by the worker stopping. A last run more than two periods ago is
// a quiet job, kept as an error, unless Chrome's own alarm shows it was not
// running the clock: the alarm arrives carrying a due time more than a period
// old (Chrome hands a missed alarm over with its original due time, and fires a
// missed one as soon as the Mac wakes or Chrome starts), which is what a Mac
// that slept or a Chrome that was closed leaves. An alarm that is on time, or
// none at all, keeps the error. A worker whose alarms reach
// nothing does not start until something else wakes it, so this check speaks
// only then; a reader outside the worker works out from the record whether a
// job is overdue at the moment it reads.

import { buildName, getRecordedBuild } from "./build.js";
import { recordWorkerError } from "./errors.js";

/** A run's limit unless the job sets one: under the five minutes Chrome lets one event or call run. */
export const RUN_LIMIT_MS = 4 * 60_000;
/** A request's limit unless the job sets one: under the thirty seconds after which Chrome stops a worker waiting on a fetch. */
export const REQUEST_LIMIT_MS = 25_000;
/** How long a quiet job waits for a late alarm before it is kept as an error. */
export const QUIET_WAIT_MS = 10_000;
/** How often a run inside its limit calls Chrome, under Chrome's thirty seconds idle. */
const KEEP_ALIVE_MS = 20_000;
/** How long after its limit a run that has not ended is over its limit. */
const OVER_LIMIT_MS = 1_000;
/** The longest error message a record keeps. */
const ERROR_LENGTH = 200;

/** @typedef {"running" | "ok" | "failed" | "aborted" | "over limit" | "cut short"} Outcome */
/**
 * @typedef {{ minutes: number, limitMs: number, started: string, ended: string | null, outcome: Outcome,
 *   error: string | null, lastOk: string | null }} JobRecord
 */
/** @typedef {{ ran: true, outcome: Outcome } | { ran: false, running: true, since: string | null }} RunAnswer */

/** The storage.local key a job's record is kept under. */
export function jobKey(/** @type {string} */ name) {
  return `job:${name}`;
}

/**
 * The job's record, or null before its first run.
 * @param {string} name
 * @returns {Promise<JobRecord | null>}
 */
export async function getJobRecord(name) {
  const key = jobKey(name);
  const { [key]: record } = /** @type {Record<string, JobRecord | undefined>} */ (await chrome.storage.local.get(key));
  return record ?? null;
}

// The job's decisions, each with its reason. These go to the console until the worker's log (extension-log) takes
// them; the record and the kept errors hold what a reader needs afterwards either way.
/**
 * @param {string} event
 * @param {Record<string, unknown>} fields
 */
function log(event, fields) {
  console.log(event, fields);
}

// Writes what the log holds so far. Nothing until the worker's log exists; once it does, its storage write is issued
// here, before the request starts.
function flush() {}

/**
 * A signal for one request in a run: it fires when the run's does or after `ms`, whichever is first. Pass it to every
 * fetch a job makes, so a request that hangs ends in an abort the record keeps rather than Chrome stopping the worker.
 * @param {AbortSignal} signal the run's signal
 * @param {number} [ms]
 */
export function within(signal, ms = REQUEST_LIMIT_MS) {
  flush();
  return AbortSignal.any([signal, AbortSignal.timeout(ms)]);
}

/**
 * How long, in plain units: "40 seconds", "3 minutes", "23 hours", "2 days", or under a second "20 milliseconds".
 * @param {number} ms
 */
export function howLong(ms) {
  if (ms < 1_000) return `${ms} milliseconds`;
  const units = /** @type {const} */ ([["day", 86_400_000], ["hour", 3_600_000], ["minute", 60_000], ["second", 1_000]]);
  for (const [unit, size] of units) {
    const count = Math.floor(ms / size);
    if (count >= 1 || unit === "second") return `${count} ${unit}${count === 1 ? "" : "s"}`;
  }
  return "";
}

/** @param {unknown} error */
function messageOf(error) {
  const message = error instanceof Error ? `${error.name === "Error" ? "" : `${error.name}: `}${error.message}` : String(error);
  return message.slice(0, ERROR_LENGTH);
}

/**
 * @param {unknown} error
 * @param {string} kind
 */
async function keepError(error, kind) {
  const build = (await getRecordedBuild().catch(() => null))?.versionName ?? buildName();
  await recordWorkerError(error, { kind, build });
}

/**
 * Runs `run` every `minutes` minutes, from now on, in every worker that starts, one run at a time, with a record of
 * each run. Call it at the top level of the worker, so the listener is in place when Chrome starts the worker to
 * deliver the alarm. The alarm is created only when missing, so a revival does not push the next run back.
 *
 * Gives back runNow(), which a page's or a host's message calls for a run outside the clock: it takes the same lock,
 * and answers whether it ran or another run was going, and since when.
 * @param {string} name
 * @param {number} minutes
 * @param {(signal: AbortSignal) => unknown} run gets a signal that fires at the run's limit; pass it to each request through within()
 * @param {{ limitMs?: number, quietWaitMs?: number }} [options] limitMs, a run's limit (four minutes unless set); quietWaitMs, how long a quiet job waits for a late alarm (ten seconds unless set)
 * @returns {() => Promise<RunAnswer>}
 */
export function every(name, minutes, run, { limitMs = RUN_LIMIT_MS, quietWaitMs = QUIET_WAIT_MS } = {}) {
  const key = jobKey(name);
  const periodMs = minutes * 60_000;
  let lateAlarm = false;
  let onLateAlarm = () => {};

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== name) return;
    // Noted before anything is awaited: the alarm that started the worker arrives before the record has been read.
    if (Date.now() - alarm.scheduledTime > periodMs) {
      lateAlarm = true;
      onLateAlarm();
    }
    return runOnce("alarm");
  });
  // Chrome starts the worker at the profile's start only for a listener, so the check below runs then even when the
  // alarm is gone.
  chrome.runtime.onStartup.addListener(() => {});

  /** @param {JobRecord} record */
  const write = (record) => chrome.storage.local.set({ [key]: record });

  // The record as this worker found it, with a run cut short marked so; every run waits for it, so the check and the
  // first run never both write the record.
  const checked = getJobRecord(name)
    .then(async (record) => {
      if (record?.outcome !== "running") return record;
      log("job cut short", { job: name, started: record.started });
      await write({ ...record, outcome: "cut short" });
      return record;
    })
    .catch(() => null);

  const alarm = chrome.alarms.get(name).then(async (existing) => {
    if (!existing || existing.periodInMinutes !== minutes) {
      await chrome.alarms.create(name, { periodInMinutes: minutes });
      if (existing) log("job alarm made again", { job: name, reason: `its period was ${existing.periodInMinutes} minutes` });
      else if (await checked) log("job alarm made again", { job: name, reason: "Chrome no longer held it" });
    }
    return existing;
  });

  // The wait counts from Chrome's answer about the alarm, which comes only once Chrome has read its alarms from disk.
  Promise.all([checked, alarm])
    .then(async ([record, existing]) => {
      if (!record) return;
      const since = Date.now() - Date.parse(record.started);
      if (!(since > 2 * periodMs)) {
        log("job on time", { job: name, started: record.started });
        return;
      }
      const fields = { job: name, started: record.started, gap: howLong(since), alarm: existing ? new Date(existing.scheduledTime).toISOString() : null };
      if (!lateAlarm) {
        await new Promise((resolve) => {
          onLateAlarm = () => resolve(undefined);
          setTimeout(resolve, quietWaitMs);
        });
      }
      if (lateAlarm) {
        log("job resumed after a gap", { ...fields, reason: "its alarm came late, so Chrome was not running" });
        return;
      }
      const expected = minutes === 1 ? "every 1 minute" : `every ${minutes} minutes`;
      log("job quiet", fields);
      await keepError(new Error(`${name} last ran ${howLong(since)} ago, ${expected} expected`), "quiet job");
    })
    .catch(() => {});

  /**
   * @param {"alarm" | "asked"} from
   * @returns {Promise<RunAnswer>}
   */
  async function runOnce(from) {
    const previous = await checked;
    /** @type {RunAnswer | null} */
    let answer = null;
    await navigator.locks.request(key, { ifAvailable: true }, async (lock) => {
      if (!lock) return;
      answer = await held(from, previous);
    });
    if (answer) return answer;
    const since = (await getJobRecord(name).catch(() => null))?.started ?? null;
    log("job skipped", { job: name, from, reason: "another run holds it", since });
    return { ran: false, running: true, since };
  }

  /**
   * One run, inside the job's lock.
   * @param {"alarm" | "asked"} from
   * @param {JobRecord | null} found the record this worker started with
   * @returns {Promise<RunAnswer>}
   */
  async function held(from, found) {
    const before = (await getJobRecord(name).catch(() => null)) ?? found;
    const started = new Date().toISOString();
    /** @type {JobRecord} */
    const record = { minutes, limitMs, started, ended: null, outcome: "running", error: null, lastOk: before?.lastOk ?? null };
    await write(record).catch(() => {});
    log("job started", { job: name, from });

    const controller = new AbortController();
    let settled = false;
    let over = false;
    const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), KEEP_ALIVE_MS);
    const limit = setTimeout(() => {
      clearInterval(keepAlive);
      controller.abort(new DOMException(`${name} reached its ${howLong(limitMs)} limit`, "TimeoutError"));
      setTimeout(() => {
        if (settled) return;
        over = true;
        log("job over its limit", { job: name, started, limit: howLong(limitMs) });
        keepError(new Error(`${name} is still running past its ${howLong(limitMs)} limit`), "job over its limit").catch(() => {});
      }, OVER_LIMIT_MS);
    }, limitMs);

    /** @type {Outcome} */
    let outcome = "ok";
    /** @type {string | null} */
    let error = null;
    try {
      await run(controller.signal);
    } catch (thrown) {
      error = messageOf(thrown);
      outcome = controller.signal.aborted ? "aborted" : "failed";
    } finally {
      settled = true;
      clearInterval(keepAlive);
      clearTimeout(limit);
    }
    const ended = new Date();
    if (over) outcome = "over limit";
    await write({ ...record, ended: ended.toISOString(), outcome, error, lastOk: outcome === "ok" ? started : record.lastOk }).catch(() => {});
    log("job ended", { job: name, outcome, ...(error ? { error } : {}) });
    // A job that keeps failing for the same reason is kept once, so it never pushes every other error out.
    if (error && before?.error !== error) await keepError(new Error(`${name} failed: ${error}`), "job");
    return { ran: true, outcome };
  }

  return () => runOnce("asked");
}
