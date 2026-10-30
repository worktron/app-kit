import { afterAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diagnoseHost } from '../host/diagnose.ts'
import { worktreeOf } from '../../command-line/index.ts'
import { chromeHostsDir, extensionId, installHost, readHostLauncher, writeHostLauncher, writeHostManifest } from '../host/install.ts'

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'app-kit-extension-install-')))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const FIXTURE = join(import.meta.dir, 'fixture')
const FIXTURE_ID = extensionId(JSON.parse(readFileSync(join(FIXTURE, 'manifest.json'), 'utf8')).key)
const NAME = 'com.example.tool'
let made = 0

/** A fresh folder of its own under the test's folder. */
function folder(label: string): string {
  const path = join(dir, `${label}-${++made}`)
  mkdirSync(path, { recursive: true })
  return path
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim()

/** A main checkout of an extension, with its manifest at the root and its host in src/, as amazon-connector keeps them. */
function checkout(): string {
  const root = folder('checkout')
  cpSync(join(FIXTURE, 'manifest.json'), join(root, 'manifest.json'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'host.ts'), 'console.log("host")\n')
  git(root, 'init', '--quiet', '--initial-branch=main')
  git(root, 'add', '-A')
  git(root, 'commit', '--quiet', '-m', 'first')
  return root
}

/** A worktree of `main`, on a branch of its own. */
function worktree(main: string): string {
  const path = join(dir, `worktree-${++made}`)
  git(main, 'worktree', 'add', '--quiet', '-b', `branch-${made}`, path)
  return path
}

const install = (root: string, home: string, overrides: Partial<Parameters<typeof installHost>[0]> = {}) =>
  installHost({ name: NAME, host: join(root, 'src', 'host.ts'), extensionFolder: root, description: 'Relays for the tool', home, ...overrides })

const cli = (args: string[], home: string) =>
  Bun.spawnSync([process.execPath, join(import.meta.dir, '../../bin/app-kit.ts'), 'extension', ...args], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, HOME: home } })

test('the extension ID is the one Chrome gives the manifest key', () => {
  // amazon-connector's key, and the ID Chrome showed for it on chrome://extensions.
  expect(extensionId('MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjhCgiHc5+4kh0/UYgWEKVV2p4Yaz1MWyGb8xGO03q0cBeNUvbo1TCSszsm5kiQPms7HG5dpcLUALy+EYQFEBd1dh4jM9H0/5lOxJU3/PFsJfr4pUQPLNhib/oN5FLxU8kozrmdQFx6KuWzBDGYjN0NZDlGrAXzdEHfHJrS3oHYkW+0GcEhh0Dg15NEQ5eOTiC1+RYVVDRaWxAyQR2bqRxqynxECtuA0qZUHnw2HqoyVOvkT43oR4KswrmvGcBM4jyh1WGEojXBVsRhqJ4qZcYW0HN3gZeJ3wvW3wKCTIzJdA78H/I3TSORFxQf6gRhrc4algt/noaUGNDWpMrngxRwIDAQAB')).toBe('anhanhbcgcbkmkplbafdhdhcllhecmfg')
})

test('the host manifest names the host, its executable and the one extension allowed to start it, and leaves no partial file', () => {
  const into = folder('manifest')
  const file = writeHostManifest(into, { name: NAME, description: 'Relays for the tool', path: '/opt/tool/host', extensionId: 'abcdefghijklmnopabcdefghijklmnop' })
  expect(file).toBe(join(into, 'com.example.tool.json'))
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
    name: NAME,
    description: 'Relays for the tool',
    path: '/opt/tool/host',
    type: 'stdio',
    allowed_origins: ['chrome-extension://abcdefghijklmnopabcdefghijklmnop/'],
  })
  expect(readdirSync(into)).toEqual(['com.example.tool.json'])
})

describe('the launcher', () => {
  test("reads back as the command it runs and its error log, whatever its paths hold, and runs that command with Chrome's arguments", () => {
    const into = folder("it's a folder")
    const script = join(into, 'echo.sh')
    writeFileSync(script, '#!/bin/sh\necho "$TOOL_ENV $1"\necho oops >&2\n', { mode: 0o755 })
    const errorLog = join(into, 'host-errors.log')
    const launcher = writeHostLauncher(join(into, 'host'), [script], { env: { TOOL_ENV: 'from env' }, errorLog })
    expect(statSync(launcher).mode & 0o777).toBe(0o755)
    expect(readHostLauncher(launcher)).toEqual({ command: [script], errorLog })
    expect(execFileSync(launcher, ['chrome-extension://abc/'], { encoding: 'utf8' })).toBe('from env chrome-extension://abc/\n')
    expect(readFileSync(errorLog, 'utf8')).toBe('oops\n')
  })

  test('a hand-written launcher in double quotes, as amazon-connector writes it, reads back too; anything else reads as unknown', () => {
    const into = folder('hand-written')
    const file = join(into, 'host')
    writeFileSync(file, '#!/bin/sh\nexec "/opt/bun/bin/bun" "/opt/My Tool/src/host.ts" "$@"\n')
    expect(readHostLauncher(file)).toEqual({ command: ['/opt/bun/bin/bun', '/opt/My Tool/src/host.ts'], errorLog: null })
    writeFileSync(file, '#!/bin/sh\nexec "$HOME/bin/host" "$@"\n')
    expect(readHostLauncher(file)).toBe(null)
    writeFileSync(file, '\x7fELF')
    expect(readHostLauncher(file)).toBe(null)
  })

  test('rewriting a launcher that lost its executable bit makes it executable again', () => {
    const into = folder('rewritten')
    const file = writeHostLauncher(join(into, 'host'), ['/bin/echo'])
    chmodSync(file, 0o644)
    writeHostLauncher(file, ['/bin/echo'])
    expect(statSync(file).mode & 0o777).toBe(0o755)
  })
})

describe('install-host', () => {
  test('writes the launcher and the manifest Chrome reads into the home it runs with, and prints them and the folder to load', () => {
    const root = checkout()
    const home = folder('home')
    const absolute = cli(['install-host', NAME, join(root, 'src', 'host.ts'), root, '--description', 'Relays for the tool'], home)
    expect(absolute.stderr.toString()).toBe('')
    expect(absolute.exitCode).toBe(0)
    const manifest = join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.example.tool.json')
    const launcher = join(home, 'Library/Application Support/com.example.tool/host')
    expect(JSON.parse(readFileSync(manifest, 'utf8'))).toEqual({
      name: NAME,
      description: 'Relays for the tool',
      path: launcher,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${FIXTURE_ID}/`],
    })
    expect(readHostLauncher(launcher)).toEqual({ command: [process.execPath, join(root, 'src', 'host.ts')], errorLog: join(home, 'Library/Application Support/com.example.tool/host-errors.log') })
    expect(statSync(launcher).mode & 0o777).toBe(0o755)
    const out = absolute.stdout.toString()
    expect(out).toContain(manifest)
    expect(out).toContain(launcher)
    expect(out).toContain(`Load the extension in Chrome from: ${root}`)
  })

  test('a relative host and folder are made whole, from the folder it runs in', () => {
    const root = checkout()
    const home = folder('home')
    const run = Bun.spawnSync([process.execPath, join(import.meta.dir, '../../bin/app-kit.ts'), 'extension', 'install-host', NAME, 'src/host.ts', '--description', 'x'], {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, HOME: home },
    })
    expect(run.exitCode).toBe(0)
    expect(readHostLauncher(join(home, 'Library/Application Support/com.example.tool/host'))?.command).toEqual([process.execPath, join(root, 'src', 'host.ts')])
  })

  test('refuses a worktree, naming the main checkout, unless told it is meant, and writes nothing', () => {
    const main = checkout()
    const branch = worktree(main)
    const home = folder('home')
    expect(() => install(branch, home)).toThrow(`Install from the main checkout, ${main}, or pass --from-worktree`)
    expect(existsSync(join(home, 'Library'))).toBe(false)
    expect(install(branch, home, { fromWorktree: true }).launcher).toBe(join(home, 'Library/Application Support/com.example.tool/host'))
  })

  test('a host in a subfolder of a main checkout is not taken for a worktree', () => {
    const main = checkout()
    expect(worktreeOf(join(main, 'src'))).toBe(null)
    expect(worktreeOf(join(worktree(main), 'src'))).toEqual({ worktree: expect.stringContaining('worktree-'), main })
  })

  test('refuses what Chrome would refuse, or could not start, before it writes anything', () => {
    const root = checkout()
    const home = folder('home')
    expect(() => install(root, home, { name: 'amazon-connector' })).toThrow('Chrome refuses the host name amazon-connector')
    expect(() => install(root, home, { name: 'com..tool' })).toThrow('Chrome refuses the host name')
    expect(() => install(root, home, { description: ' ' })).toThrow('may not be empty')
    expect(() => install(root, home, { host: join(root, 'src', 'gone.ts') })).toThrow('There is no host at')
    expect(() => install(root, home, { host: join(root, 'manifest.json') })).toThrow('is not executable')
    const keyless = folder('keyless')
    writeFileSync(join(keyless, 'manifest.json'), '{}')
    expect(() => install(root, home, { extensionFolder: keyless })).toThrow('has no key')
    expect(existsSync(join(home, 'Library'))).toBe(false)
  })
})

describe('why nothing is connected', () => {
  test('with only the socket, it says no host listens and asks for the name', () => {
    expect(diagnoseHost({ home: folder('home') }).reason).toContain('No native host is listening')
  })

  test('a host Chrome was never told of', () => {
    const { reason, fix } = diagnoseHost({ name: NAME, home: folder('home') })
    expect(reason).toBe(`Chrome does not know the host ${NAME}: there is no ${join(chromeHostsDir(join(dir, `home-${made}`)), 'com.example.tool.json')}.`)
    expect(fix).toContain(`install-host ${NAME}`)
  })

  test('a name Chrome refuses', () => {
    expect(diagnoseHost({ name: 'amazon-connector', home: folder('home') }).reason).toContain('Chrome refuses the host name amazon-connector')
  })

  test('a registration Chrome cannot read or would ignore', () => {
    const home = folder('home')
    const registration = join(chromeHostsDir(home), 'com.example.tool.json')
    mkdirSync(chromeHostsDir(home), { recursive: true })
    writeFileSync(registration, '{ not json')
    expect(diagnoseHost({ name: NAME, home }).reason).toContain('is not JSON')
    writeFileSync(registration, JSON.stringify({ name: 'com.example.other', path: '/bin/echo', type: 'stdio' }))
    expect(diagnoseHost({ name: NAME, home }).reason).toContain('names the host com.example.other')
    writeFileSync(registration, JSON.stringify({ name: NAME, path: 'host', type: 'stdio' }))
    expect(diagnoseHost({ name: NAME, home }).reason).toContain('needs an absolute path')
  })

  test('a launcher that is gone or not executable', () => {
    const root = checkout()
    const home = folder('home')
    const { launcher } = install(root, home)
    chmodSync(launcher, 0o644)
    expect(diagnoseHost({ name: NAME, home }).reason).toContain('is not executable')
    rmSync(launcher)
    expect(diagnoseHost({ name: NAME, home }).reason).toBe(`The host ${join(chromeHostsDir(home), 'com.example.tool.json')} names, ${launcher}, does not exist.`)
  })

  test('a launcher whose Bun is gone', () => {
    const root = checkout()
    const home = folder('home')
    install(root, home, { bun: join(dir, 'no-bun') })
    expect(diagnoseHost({ name: NAME, home }).reason).toContain(`runs ${join(dir, 'no-bun')}, which is not an executable file`)
  })

  test('a launcher left pointing into a worktree that is gone, and one into a worktree still there', () => {
    const main = checkout()
    const branch = worktree(main)
    const home = folder('home')
    install(branch, home, { fromWorktree: true })
    const there = diagnoseHost({ name: NAME, home })
    expect(there.reason).toBe(`Chrome runs the host from the worktree ${branch}, which goes away when its work lands.`)
    expect(there.fix).toContain(`From the main checkout, ${main}`)
    git(main, 'worktree', 'remove', '--force', branch)
    expect(diagnoseHost({ name: NAME, home }).reason).toContain(`runs ${join(branch, 'src', 'host.ts')}, which no longer exists`)
  })

  test("a registration that allows another extension than the folder's", () => {
    const root = checkout()
    const home = folder('home')
    install(root, home)
    const other = folder('other-extension')
    writeFileSync(join(other, 'manifest.json'), JSON.stringify({ key: 'AAAA' }))
    expect(diagnoseHost({ name: NAME, extensionFolder: other, home }).reason).toBe(
      `${join(chromeHostsDir(home), 'com.example.tool.json')} allows chrome-extension://${FIXTURE_ID}/, but the extension in ${other} has the ID ${extensionId('AAAA')}.`,
    )
    expect(diagnoseHost({ name: NAME, extensionFolder: folder('empty'), home }).reason).toContain('There is no manifest.json in')
  })

  test('all well from the main checkout: Chrome can start the host, so the extension is not running, with the host\'s newest errors', () => {
    const root = checkout()
    const home = folder('home')
    const { errorLog } = install(root, home)
    const well = diagnoseHost({ name: NAME, extensionFolder: root, home })
    expect(well.reason).toBe(`Chrome knows the host ${NAME} and can start it, but the extension is not running it.`)
    expect(well.fix).toContain(`load the extension there from ${root}`)
    expect(well.hostErrors).toBeUndefined()
    writeFileSync(errorLog, 'error: Cannot find module "./gone.ts"\n')
    expect(diagnoseHost({ name: NAME, extensionFolder: root, home }).hostErrors).toEqual({ at: expect.any(String), lines: ['error: Cannot find module "./gone.ts"'] })
  })

  test('status with nothing listening prints the reason and the fix, and exits 4', () => {
    const home = folder('home')
    const run = cli(['status', join(dir, 'nowhere.sock'), NAME, FIXTURE], home)
    expect(run.exitCode).toBe(4)
    expect(JSON.parse(run.stdout.toString())).toEqual({ connected: false, reason: expect.stringContaining(`Chrome does not know the host ${NAME}`), fix: expect.stringContaining('install-host') })
  })
})
