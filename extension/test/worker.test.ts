import { beforeEach, describe, expect, test } from 'bun:test'
import { fireAlarm, reset, shim } from '../testing/chrome.ts'
import { account, askForEmail, hasEmailPermission } from '../worker/account.js'
import { every } from '../worker/alarms.js'
import { buildName, getRecordedBuild, recordBuild } from '../worker/build.js'
import { getWorkerErrors, MAX_ERRORS, recordWorkerError, watchWorkerErrors } from '../worker/errors.js'
import { nativePort } from '../worker/port.js'

beforeEach(() => reset())

describe('build', () => {
  test('names the stamped version, with the commit a repository root load came from', () => {
    expect(buildName()).toBe('0.1.0-src')
    expect(buildName('abcdef1234567890abcdef1234567890abcdef12')).toBe('0.1.0-src (abcdef1)')
  })

  test('a build that skipped the stamp is named by its version', () => {
    reset({}, { version: '2.0.0' })
    expect(buildName()).toBe('2.0.0')
  })

  test('records when this profile first ran a build, and keeps that time while it runs', async () => {
    const first = await recordBuild('a'.repeat(40))
    expect(first).toMatchObject({ version: '0.1.0', versionName: '0.1.0-src (aaaaaaa)', commit: 'a'.repeat(40) })
    await Bun.sleep(5)
    expect((await recordBuild('a'.repeat(40))).firstSeenAt).toBe(first.firstSeenAt)
    const next = await recordBuild('b'.repeat(40))
    expect(next.firstSeenAt).toBeGreaterThan(first.firstSeenAt)
    expect(await getRecordedBuild()).toEqual(next)
  })
})

describe('recorded errors', () => {
  test('each error keeps its time, kind, message, the top of its stack and its build', async () => {
    await recordWorkerError(new Error('the port broke'), { build: '0.1.0-src', now: Date.UTC(2026, 9, 22) })
    expect(await getWorkerErrors()).toEqual([
      { at: '2026-10-22T00:00:00.000Z', kind: 'error', message: 'the port broke', stack: expect.any(String), build: '0.1.0-src' },
    ])
  })

  test('only the newest are kept', async () => {
    for (let n = 0; n < MAX_ERRORS + 5; n++) await recordWorkerError(new Error(`error ${n}`))
    const errors = await getWorkerErrors()
    expect(errors).toHaveLength(MAX_ERRORS)
    expect(errors[0]!.message).toBe('error 5')
  })

  test('a burst of errors loses none of them', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, n) => recordWorkerError(`burst ${n}`)))
    expect(await getWorkerErrors()).toHaveLength(10)
  })

  test('uncaught errors and unhandled rejections on the scope are recorded with the build', async () => {
    const scope = new EventTarget()
    watchWorkerErrors(scope, () => '0.1.0-src (abc1234)')
    const rejection = Object.assign(new Event('unhandledrejection'), { reason: new Error('nobody caught this') })
    scope.dispatchEvent(rejection)
    scope.dispatchEvent(Object.assign(new Event('error'), { error: new Error('thrown at the top'), message: 'thrown at the top' }))
    await Bun.sleep(10)
    expect(await getWorkerErrors()).toMatchObject([
      { kind: 'unhandled rejection', message: 'nobody caught this', build: '0.1.0-src (abc1234)' },
      { kind: 'error', message: 'thrown at the top', build: '0.1.0-src (abc1234)' },
    ])
  })
})

describe('account', () => {
  test('the account id comes without the email permission, and the email once it is granted', async () => {
    shim.account = { id: '1234', email: 'someone@example.com' }
    expect(await account()).toEqual({ accountId: '1234', email: '' })
    expect(await hasEmailPermission()).toBe(false)
    await askForEmail()
    expect(await account()).toEqual({ accountId: '1234', email: 'someone@example.com' })
  })

  test('a profile signed out of the browser has an empty account', async () => {
    expect(await account()).toEqual({ accountId: '', email: '' })
  })
})

describe('alarms', () => {
  test('creates the alarm once, and runs the work each time it comes due', async () => {
    let runs = 0
    every('check', 1, () => runs++)
    await Bun.sleep(0)
    const created = shim.alarms.get('check')
    expect(created).toMatchObject({ name: 'check', periodInMinutes: 1 })
    fireAlarm('check')
    fireAlarm('check')
    expect(runs).toBe(2)
  })

  test('a worker that starts again keeps the alarm it found, so the next run is not pushed back', async () => {
    every('check', 1, () => {})
    await Bun.sleep(0)
    const scheduled = shim.alarms.get('check')!.scheduledTime
    await Bun.sleep(5)
    every('check', 1, () => {})
    await Bun.sleep(0)
    expect(shim.alarms.get('check')!.scheduledTime).toBe(scheduled)
  })
})

/** A stand-in for the port Chrome opens to a native host. */
function fakePort() {
  const onMessage: ((message: unknown) => void)[] = []
  const onDisconnect: (() => void)[] = []
  const posted: any[] = []
  return {
    posted,
    port: {
      postMessage: (message: unknown) => posted.push(message),
      onMessage: { addListener: (listener: (message: unknown) => void) => onMessage.push(listener) },
      onDisconnect: { addListener: (listener: () => void) => onDisconnect.push(listener) },
    },
    send: (message: unknown) => onMessage.forEach((listener) => listener(message)),
    disconnect: () => onDisconnect.forEach((listener) => listener()),
  }
}

describe('native port', () => {
  test('says hello with its build, answers state with its kept errors, and passes the rest to the extension', async () => {
    const fake = fakePort()
    const { connect } = nativePort({
      host: 'com.example.test',
      describe: () => ({ version: '0.1.0-src (abc1234)', commit: 'abc1234' }),
      answer: (message: any) => (message.type === 'echo' ? { type: 'answer', id: message.id, echoed: message.text } : null),
      open: () => fake.port as never,
    })
    await recordWorkerError(new Error('kept'), { now: 0 })
    connect()
    fake.send({ type: 'state', id: 'r1' })
    fake.send({ type: 'echo', id: 'r2', text: 'hi' })
    fake.send({ type: 'unknown', id: 'r3' })
    await Bun.sleep(10)
    // Each reply is posted when it is ready, so they come in any order.
    expect(fake.posted).toHaveLength(3)
    expect(fake.posted).toContainEqual({ type: 'hello', version: '0.1.0-src (abc1234)', commit: 'abc1234' })
    expect(fake.posted).toContainEqual({ type: 'state', id: 'r1', version: '0.1.0-src (abc1234)', commit: 'abc1234', errors: [expect.objectContaining({ message: 'kept' })] })
    expect(fake.posted).toContainEqual({ type: 'answer', id: 'r2', echoed: 'hi' })
  })

  test('connects again after the port closes', async () => {
    let opens = 0
    const fake = fakePort()
    const { connect, port } = nativePort({
      host: 'com.example.test',
      describe: () => ({ version: '1', commit: null }),
      answer: () => null,
      reconnectMs: 5,
      open: () => {
        opens++
        return fake.port as never
      },
    })
    connect()
    expect(connect()).toBe(port())
    expect(opens).toBe(1)
    fake.disconnect()
    expect(port()).toBe(null)
    await Bun.sleep(20)
    expect(opens).toBe(2)
  })
})
