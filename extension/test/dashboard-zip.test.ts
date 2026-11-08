import { afterAll, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareVersions, judgeZip, zipManifest } from '../dashboard/zip.ts'

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'app-kit-dashboard-zip-')))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test("a zip's manifest is read from its top", () => {
  const folder = join(dir, 'built')
  mkdirSync(folder)
  writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ name: 'Shelf', version: '1.0.3' }))
  execFileSync('zip', ['-q', join(dir, 'shelf.zip'), 'manifest.json'], { cwd: folder })
  expect(zipManifest(join(dir, 'shelf.zip'))).toEqual({ name: 'Shelf', version: '1.0.3' })
  writeFileSync(join(dir, 'not-a-zip.zip'), 'nothing')
  expect(() => zipManifest(join(dir, 'not-a-zip.zip'))).toThrow('holds no manifest.json at its top')
})

test('versions compare part by part as numbers', () => {
  expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0)
  expect(compareVersions('1.0', '1.0.0')).toBe(0)
  expect(compareVersions('0.9.216', '1.0.0')).toBeLessThan(0)
})

test("a zip uploads only when it is this extension's and newer than the dashboard's package", () => {
  expect(judgeZip({ name: 'Other', version: '2.0.0' }, 'Shelf', '1.0.0')).toEqual({ upload: false, ok: false, line: 'The zip\'s manifest names "Other", not this extension, "Shelf"' })
  expect(judgeZip({ name: 'Shelf', version: '0.9.0' }, 'Shelf', '1.0.0')).toEqual({ upload: false, ok: false, line: "The zip holds version 0.9.0, below the dashboard's 1.0.0" })
  expect(judgeZip({ name: 'Shelf', version: '1.0.0' }, 'Shelf', '1.0.0')).toEqual({ upload: false, ok: true, line: "The dashboard already has version 1.0.0, the zip's; nothing to upload" })
  expect(judgeZip({ name: 'Shelf', version: '1.0.1' }, 'Shelf', '1.0.0')).toEqual({ upload: true, ok: true, line: "The zip holds version 1.0.1, above the dashboard's 1.0.0" })
  expect(judgeZip({ name: 'Shelf', version: '1.0.1' }, 'Shelf', undefined).upload).toBe(true)
  expect(judgeZip({ name: 'Shelf' }, 'Shelf', '1.0.0').ok).toBe(false)
})
