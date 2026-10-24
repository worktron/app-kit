import { afterAll, expect, test } from 'bun:test'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyWorker, workerCopyDiffers, workerFiles } from '../copy.ts'
import packageJson from '../../package.json'

const dir = mkdtempSync(join(tmpdir(), 'app-kit-extension-copy-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const cli = (...args: string[]) => Bun.spawnSync(['bun', join(import.meta.dir, '../../bin/app-kit.ts'), 'extension', ...args], { stdout: 'pipe', stderr: 'pipe' })

test('copy writes every worker file, each naming the kit version it came from', () => {
  const folder = join(dir, 'kit')
  expect(copyWorker(folder)).toEqual(workerFiles())
  expect(workerFiles()).toEqual(['account.js', 'alarms.js', 'build.js', 'errors.js', 'port.js', 'self-reload.js'])
  expect(readFileSync(join(folder, 'port.js'), 'utf8').split('\n')[0]).toBe(`// Copied from app-kit ${packageJson.version} by \`app-kit extension copy\`. Change it in the kit.`)
  expect(workerCopyDiffers(folder)).toEqual([])
})

test('a copy edited by hand, or missing a file, differs from the kit, and the check command exits 3', () => {
  const folder = join(dir, 'edited')
  copyWorker(folder)
  appendFileSync(join(folder, 'build.js'), '// a local change\n')
  rmSync(join(folder, 'alarms.js'))
  expect(workerCopyDiffers(folder)).toEqual(['alarms.js', 'build.js'])
  const run = cli('check', folder)
  expect(run.exitCode).toBe(3)
  expect(run.stderr.toString()).toContain('alarms.js, build.js')
})

test('a copy made by another release of the kit, with the same code, does not differ', () => {
  const folder = join(dir, 'older')
  copyWorker(folder)
  const path = join(folder, 'port.js')
  writeFileSync(path, readFileSync(path, 'utf8').replace(`app-kit ${packageJson.version}`, 'app-kit 0.0.1'))
  expect(workerCopyDiffers(folder)).toEqual([])
})

test("the kit's own fixture extension carries the current copy", () => {
  expect(workerCopyDiffers(join(import.meta.dir, 'fixture/kit'))).toEqual([])
  expect(cli('check', join(import.meta.dir, 'fixture/kit')).exitCode).toBe(0)
})

test('id prints the extension ID from the manifest key', () => {
  const run = cli('id', join(import.meta.dir, 'fixture'))
  expect(run.exitCode).toBe(0)
  expect(run.stdout.toString().trim()).toMatch(/^[a-p]{32}$/)
})

test('status with no host listening says so and exits 4', () => {
  const run = cli('status', join(dir, 'nowhere.sock'))
  expect(run.exitCode).toBe(4)
  expect(JSON.parse(run.stdout.toString())).toMatchObject({ connected: false })
})
