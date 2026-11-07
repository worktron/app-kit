// A job on a clock (extension/worker/alarms.js) against the Chrome stand-in: the record of each run, one run at a
// time, the run's and each request's limits, the keep-alive, and the check every worker start makes of the record.
import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from 'bun:test'
import { answerNetwork, deliverAlarm, reset, shim } from '../testing/chrome.ts'
import { every, getJobRecord, howLong, jobKey, within } from '../worker/alarms.js'
import { getWorkerErrors } from '../worker/errors.js'

const HOUR = 3_600_000
let lines: [string, Record<string, unknown>][] = []

beforeEach(() => {
  reset()
  lines = []
  spyOn(console, 'log').mockImplementation((event: string, fields: Record<string, unknown>) => void lines.push([event, fields]))
})

afterEach(() => {
  jest.useRealTimers()
  ;(console.log as unknown as { mockRestore(): void }).mockRestore()
})

/** Resolves once `done` holds; a test that never sees it fails on bun's own timeout. */
async function until(done: () => boolean | Promise<boolean>) {
  while (!(await done())) await Bun.sleep(1)
}

/** Lets every promise already on its way settle, for a test on the fake clock, where a sleep would never end. */
async function settle() {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

/** The job's alarm, delivered on time as Chrome would, whether or not the worker has made it yet. */
const fireAlarm = (name: string) => deliverAlarm({ name, periodInMinutes: 1, scheduledTime: Date.now() })

const logged = (event: string) => lines.filter(([line]) => line === event).map(([, fields]) => fields)

/** A run the test lets end: `release()` ends it. */
function heldRun() {
  const held = { runs: 0, release: () => {} }
  const run = () => {
    held.runs++
    return new Promise<void>((resolve) => (held.release = resolve))
  }
  return { held, run }
}

function seed(name: string, record: Record<string, unknown>) {
  shim.local[jobKey(name)] = { minutes: 1, limitMs: 240_000, ended: null, error: null, lastOk: null, ...record }
}

describe('the run record', () => {
  test('a run that ends well records its start, end and outcome, and when the job last succeeded', async () => {
    every('read', 1, () => {})
    await fireAlarm('read')
    const record = (await getJobRecord('read'))!
    expect(record).toMatchObject({ minutes: 1, limitMs: 240_000, outcome: 'ok', error: null, lastOk: record.started })
    expect(Date.parse(record.ended!)).toBeGreaterThanOrEqual(Date.parse(record.started))
    expect(logged('job started')).toEqual([{ job: 'read', from: 'alarm' }])
    expect(logged('job ended')).toEqual([{ job: 'read', outcome: 'ok' }])
  })

  test('a run that throws is recorded as failed and kept as an error once while it fails the same way', async () => {
    let failure = 'the server said 500'
    every('read', 1, () => {
      throw new Error(failure)
    })
    await fireAlarm('read')
    expect(await getJobRecord('read')).toMatchObject({ outcome: 'failed', error: 'the server said 500', lastOk: null })
    await fireAlarm('read')
    expect(await getWorkerErrors()).toMatchObject([{ kind: 'job', message: 'read failed: the server said 500', build: '0.1.0-src' }])
    failure = 'the server said 401'
    await fireAlarm('read')
    expect((await getWorkerErrors()).map((error) => error.message)).toEqual(['read failed: the server said 500', 'read failed: the server said 401'])
  })

  test('a job that fails again after a good run is kept again', async () => {
    let fail = true
    every('read', 1, () => {
      if (fail) throw new Error('offline')
    })
    await fireAlarm('read')
    fail = false
    await fireAlarm('read')
    fail = true
    await fireAlarm('read')
    expect((await getWorkerErrors()).map((error) => error.message)).toEqual(['read failed: offline', 'read failed: offline'])
  })
})

describe('one run at a time', () => {
  test('two wakes at once make one run, and the second is logged as skipped', async () => {
    const { held, run } = heldRun()
    every('read', 1, run)
    const first = fireAlarm('read')
    await fireAlarm('read')
    expect(held.runs).toBe(1)
    expect(logged('job skipped')).toMatchObject([{ job: 'read', from: 'alarm', reason: 'another run holds it' }])
    held.release()
    await first
    expect((await getJobRecord('read'))?.outcome).toBe('ok')
  })

  test("a run asked for while the alarm's is going is told so and since when, and one asked for after it runs", async () => {
    const { held, run } = heldRun()
    const runNow = every('read', 1, run)
    const alarm = fireAlarm('read')
    await until(() => held.runs === 1)
    const started = (await getJobRecord('read'))!.started
    expect(await runNow()).toEqual({ ran: false, running: true, since: started })
    held.release()
    await alarm
    const again = runNow()
    await until(() => held.runs === 2)
    held.release()
    expect(await again).toEqual({ ran: true, outcome: 'ok' })
    expect(logged('job started').map((fields) => fields.from)).toEqual(['alarm', 'asked'])
  })
})

describe('limits', () => {
  test("the run's signal fires at its limit, and a request given within() ends with it", async () => {
    answerNetwork(() => new Promise<Response>(() => {}))
    every('read', 1, async (signal) => void (await fetch('https://api.example.com/unread', { signal: within(signal, 10_000) })), { limitMs: 20 })
    await fireAlarm('read')
    expect(await getJobRecord('read')).toMatchObject({ outcome: 'aborted', error: 'TimeoutError: read reached its 20 milliseconds limit' })
  })

  test("a request that never answers ends at within()'s own limit, and the stand-in saw its signal", async () => {
    answerNetwork(() => new Promise<Response>(() => {}))
    every('read', 1, async (signal) => void (await fetch('https://api.example.com/unread', { signal: within(signal, 20) })))
    await fireAlarm('read')
    expect(await getJobRecord('read')).toMatchObject({ outcome: 'failed', error: expect.stringContaining('TimeoutError') })
    expect(shim.networkRequests).toEqual([{ url: 'https://api.example.com/unread', method: 'GET', signal: true }])
  })

  test('a run that ignores its signal keeps the lock, and is logged and kept as over its limit', async () => {
    const { held, run } = heldRun()
    const runNow = every('read', 1, run, { limitMs: 20 })
    const alarm = fireAlarm('read')
    await until(async () => (await getWorkerErrors()).length > 0)
    expect(await getWorkerErrors()).toMatchObject([{ kind: 'job over its limit', message: 'read is still running past its 20 milliseconds limit' }])
    expect(logged('job over its limit')).toHaveLength(1)
    expect(await runNow()).toMatchObject({ ran: false, running: true })
    held.release()
    await alarm
    expect((await getJobRecord('read'))?.outcome).toBe('over limit')
  })

  test('a run inside its limit calls Chrome every 20 seconds, and stops at the limit', async () => {
    jest.useFakeTimers()
    const { held, run } = heldRun()
    every('read', 1, run, { limitMs: 60_000 })
    const alarm = fireAlarm('read')
    await settle()
    expect(held.runs).toBe(1)
    jest.advanceTimersByTime(20_000)
    expect(shim.platformInfoCalls).toBe(1)
    jest.advanceTimersByTime(40_000)
    const atLimit = shim.platformInfoCalls
    expect(atLimit).toBeLessThanOrEqual(3)
    jest.advanceTimersByTime(60_000)
    expect(shim.platformInfoCalls).toBe(atLimit)
    held.release()
    await alarm
  })
})

describe('at every worker start', () => {
  test('makes the alarm when Chrome no longer holds it, and says so', async () => {
    seed('read', { started: new Date(Date.now() - 30_000).toISOString(), outcome: 'ok' })
    every('read', 1, () => {})
    await until(() => logged('job alarm made again').length > 0)
    expect(shim.alarms.get('read')).toMatchObject({ periodInMinutes: 1 })
    expect(logged('job alarm made again')).toEqual([{ job: 'read', reason: 'Chrome no longer held it' }])
  })

  test("listens for the browser's start, so Chrome starts the worker then even with the alarm gone", () => {
    every('read', 1, () => {})
    expect(chrome.runtime.onStartup.hasListeners()).toBe(true)
  })

  test('a run with a start and no end is marked cut short, and a run the same wake starts is not overwritten', async () => {
    const before = new Date(Date.now() - 30_000).toISOString()
    seed('read', { started: before, outcome: 'running' })
    every('read', 1, () => {})
    // The alarm that started the worker, delivered before the record has been read.
    await fireAlarm('read')
    expect(logged('job cut short')).toEqual([{ job: 'read', started: before }])
    const record = (await getJobRecord('read'))!
    expect(record.outcome).toBe('ok')
    expect(Date.parse(record.started)).toBeGreaterThan(Date.parse(before))
  })

  test('a job that last ran on time says so and keeps no error', async () => {
    seed('read', { started: new Date(Date.now() - 90_000).toISOString(), outcome: 'ok' })
    every('read', 1, () => {}, { quietWaitMs: 0 })
    await until(() => logged('job on time').length > 0)
    expect(await getWorkerErrors()).toEqual([])
  })

  test('a job that last ran three hours ago is kept as quiet when no alarm comes', async () => {
    seed('read', { started: new Date(Date.now() - 3 * HOUR).toISOString(), outcome: 'ok' })
    every('read', 1, () => {}, { quietWaitMs: 5 })
    await until(async () => (await getWorkerErrors()).length > 0)
    expect(await getWorkerErrors()).toMatchObject([{ kind: 'quiet job', message: 'read last ran 3 hours ago, every 1 minute expected' }])
    expect(logged('job quiet')).toMatchObject([{ job: 'read', gap: '3 hours' }])
  })

  test('an alarm that arrives on time does not clear a quiet job', async () => {
    seed('read', { started: new Date(Date.now() - 3 * HOUR).toISOString(), outcome: 'ok' })
    shim.alarms.set('read', { name: 'read', periodInMinutes: 1, scheduledTime: Date.now() + 60_000 })
    every('read', 1, () => {}, { quietWaitMs: 50 })
    await deliverAlarm({ name: 'read', periodInMinutes: 1, scheduledTime: Date.now() })
    await until(async () => (await getWorkerErrors()).length > 0)
    expect((await getWorkerErrors())[0]?.kind).toBe('quiet job')
  })

  test('an alarm that arrives late, as after the Mac slept, is a gap and no error, even before the record is read', async () => {
    seed('read', { started: new Date(Date.now() - 8 * HOUR).toISOString(), outcome: 'ok' })
    // Chrome has already moved the alarm on, and hands over the missed one with its original due time.
    shim.alarms.set('read', { name: 'read', periodInMinutes: 1, scheduledTime: Date.now() + 60_000 })
    every('read', 1, () => {}, { quietWaitMs: 60_000 })
    const delivered = deliverAlarm({ name: 'read', periodInMinutes: 1, scheduledTime: Date.now() - 8 * HOUR })
    await until(() => logged('job resumed after a gap').length > 0)
    await delivered
    expect(logged('job resumed after a gap')).toMatchObject([{ job: 'read', gap: '8 hours', reason: 'its alarm came late, so Chrome was not running' }])
    expect(await getWorkerErrors()).toEqual([])
  })

  test('an alarm Chrome holds past due, then delivers late, is a gap and no error', async () => {
    seed('read', { started: new Date(Date.now() - 8 * HOUR).toISOString(), outcome: 'ok' })
    const due = Date.now() - 8 * HOUR + 60_000
    shim.alarms.set('read', { name: 'read', periodInMinutes: 1, scheduledTime: due })
    every('read', 1, () => {}, { quietWaitMs: 60_000 })
    // Chrome fires it once it has read its alarms, after the worker has asked about it.
    await chrome.alarms.get('read')
    await deliverAlarm({ name: 'read', periodInMinutes: 1, scheduledTime: due })
    await until(() => logged('job resumed after a gap').length > 0)
    expect(await getWorkerErrors()).toEqual([])
  })

  test('an alarm Chrome holds past due that never arrives keeps the quiet error', async () => {
    seed('read', { started: new Date(Date.now() - 8 * HOUR).toISOString(), outcome: 'ok' })
    shim.alarms.set('read', { name: 'read', periodInMinutes: 1, scheduledTime: Date.now() - 8 * HOUR + 60_000 })
    every('read', 1, () => {}, { quietWaitMs: 5 })
    await until(async () => (await getWorkerErrors()).length > 0)
    expect((await getWorkerErrors())[0]?.kind).toBe('quiet job')
  })

  test('a job with no record is a first run and says nothing of a gap', async () => {
    every('read', 1, () => {}, { quietWaitMs: 0 })
    await until(() => shim.alarms.has('read'))
    await fireAlarm('read')
    expect(await getWorkerErrors()).toEqual([])
    expect(logged('job alarm made again')).toEqual([])
  })
})

test('how long, in plain units', () => {
  expect([20, 40_000, 60_000, 3 * 60_000, 3 * HOUR, 49 * HOUR].map(howLong)).toEqual(['20 milliseconds', '40 seconds', '1 minute', '3 minutes', '3 hours', '2 days'])
})
