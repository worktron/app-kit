import { beforeEach, describe, expect, test } from 'bun:test'
import { reset, shim } from '../testing/chrome.ts'
import { checkForNewCheckout } from '../worker/self-reload.js'

const FIRST = '1111111111111111111111111111111111111111'
const SECOND = '2222222222222222222222222222222222222222'
const LOADED = ['worker.js', 'kit/self-reload.js']

// A checkout the way git leaves it after a commit, with the worker's files.
function checkoutAt(sha: string, packed = false) {
  const files: Record<string, string> = Object.fromEntries(LOADED.map((path) => [path, '// code']))
  files['.git/HEAD'] = 'ref: refs/heads/main\n'
  if (packed) files['.git/packed-refs'] = `# pack-refs with: peeled\n${sha} refs/heads/main\n`
  else files['.git/refs/heads/main'] = `${sha}\n`
  return files
}

// A built folder: no .git, and a manifest stamped with its build.
function builtAs(versionName: string) {
  return { 'worker.js': '// code', 'manifest.json': JSON.stringify({ version: '1.0.0', version_name: versionName }) }
}

describe('self reload from a repository root', () => {
  beforeEach(() => reset(checkoutAt(FIRST)))

  test('the first start records the commit it loaded from and does not reload', async () => {
    expect(await checkForNewCheckout(LOADED)).toEqual({ commit: FIRST, reloading: false })
    expect(shim.session.loadedCheckout).toBe(`git:${FIRST}`)
    expect(shim.reloads).toBe(0)
  })

  test('a landing on main reloads the worker once', async () => {
    await checkForNewCheckout(LOADED)
    shim.files = checkoutAt(SECOND)
    expect(await checkForNewCheckout(LOADED)).toEqual({ commit: FIRST, reloading: true })
    expect(shim.reloads).toBe(1)
    expect(shim.session.loadedCheckout).toBe(`git:${SECOND}`)
  })

  test('an unchanged checkout leaves the worker alone', async () => {
    await checkForNewCheckout(LOADED)
    await checkForNewCheckout(LOADED)
    expect(shim.reloads).toBe(0)
  })

  test('two checks at once share one run, so a move is answered with one reload', async () => {
    await checkForNewCheckout(LOADED)
    shim.files = checkoutAt(SECOND)
    await Promise.all([checkForNewCheckout(LOADED), checkForNewCheckout(LOADED)])
    expect(shim.reloads).toBe(1)
  })

  test('a packed ref is read too', async () => {
    reset(checkoutAt(FIRST, true))
    expect(await checkForNewCheckout(LOADED)).toEqual({ commit: FIRST, reloading: false })
  })

  test('a detached HEAD names the commit itself', async () => {
    reset({ ...Object.fromEntries(LOADED.map((p) => [p, ''])), '.git/HEAD': `${FIRST}\n` })
    expect(await checkForNewCheckout(LOADED)).toEqual({ commit: FIRST, reloading: false })
  })

  test('a file the worker loads that is gone reloads it', async () => {
    await checkForNewCheckout(LOADED)
    const { ['kit/self-reload.js']: _gone, ...rest } = checkoutAt(FIRST)
    shim.files = rest
    expect((await checkForNewCheckout(LOADED)).reloading).toBe(true)
    expect(shim.reloads).toBe(1)
  })

  test('a Web Store install never reloads itself', async () => {
    reset(checkoutAt(FIRST), { version: '0.1.0', update_url: 'https://clients2.google.com/service/update2/crx' })
    expect(await checkForNewCheckout(LOADED)).toEqual({ commit: null, reloading: false })
    shim.files = checkoutAt(SECOND)
    await checkForNewCheckout(LOADED)
    expect(shim.reloads).toBe(0)
  })
})

describe('self reload from a built folder', () => {
  test('the build Chrome loaded is left alone', async () => {
    reset(builtAs('1.0.0 (aaaaaaa)'), { version: '1.0.0', version_name: '1.0.0 (aaaaaaa)' })
    expect(await checkForNewCheckout()).toEqual({ commit: null, reloading: false })
    expect(shim.reloads).toBe(0)
  })

  test('a new build on disk reloads the worker', async () => {
    reset(builtAs('1.0.0 (bbbbbbb)'), { version: '1.0.0', version_name: '1.0.0 (aaaaaaa)' })
    expect(await checkForNewCheckout()).toEqual({ commit: null, reloading: true })
    expect(shim.reloads).toBe(1)
  })

  test('a manifest caught mid-write is read again next time, not taken as a new build', async () => {
    reset({ 'manifest.json': '{"version": "1.0' }, { version: '1.0.0', version_name: '1.0.0 (aaaaaaa)' })
    expect(await checkForNewCheckout()).toEqual({ commit: null, reloading: false })
  })

  test('a .git that appears under a built load is not a new build', async () => {
    reset(builtAs('1.0.0 (aaaaaaa)'), { version: '1.0.0', version_name: '1.0.0 (aaaaaaa)' })
    shim.session.loadedCheckout = 'version:1.0.0 (aaaaaaa)'
    shim.files = { ...shim.files, ...checkoutAt(FIRST) }
    expect(await checkForNewCheckout()).toEqual({ commit: null, reloading: false })
  })
})
