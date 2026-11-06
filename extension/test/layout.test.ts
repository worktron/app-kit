import { afterAll, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { layoutProblems } from '../layout.ts'

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'app-kit-extension-layout-')))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
let made = 0

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim()

/** A git checkout with a manifest at `at` below its root ('' for the root itself) and the worker in extension/. */
function checkout(at: string): string {
  const root = join(dir, `checkout-${++made}`)
  mkdirSync(join(root, at, 'extension'), { recursive: true })
  writeFileSync(join(root, at, 'manifest.json'), JSON.stringify({ manifest_version: 3, background: { service_worker: 'extension/worker.js' } }))
  writeFileSync(join(root, at, 'extension', 'worker.js'), '')
  git(root, 'init', '--quiet', '--initial-branch=main')
  git(root, 'add', '-A')
  git(root, 'commit', '--quiet', '-m', 'first')
  return root
}

test('a manifest at the root of its checkout has no problems', () => {
  expect(layoutProblems(checkout(''))).toEqual([])
})

test('the folder defaults to the one it runs in', () => {
  const root = checkout('')
  const was = process.cwd()
  process.chdir(join(root, 'extension'))
  try {
    expect(layoutProblems()).toEqual([expect.stringContaining('There is no manifest.json in')])
    process.chdir(root)
    expect(layoutProblems()).toEqual([])
  } finally {
    process.chdir(was)
  }
})

test('a manifest in a subfolder names the subfolder and the root, and says to move it', () => {
  const root = checkout('extension')
  expect(layoutProblems(join(root, 'extension'))).toEqual([
    `manifest.json is in extension/ of the checkout ${root}. Move it to the checkout's root and point its paths (background.service_worker, pages, icons) into extension/, so Load unpacked takes the checkout itself and self-reload reads its .git`,
  ])
})

test('a folder in no git checkout', () => {
  const loose = join(dir, `loose-${++made}`)
  mkdirSync(loose)
  writeFileSync(join(loose, 'manifest.json'), '{}')
  expect(layoutProblems(loose)).toEqual([`${loose} is in no git checkout, so the extension's self-reload sees no commit; load the extension from the checkout it is committed in`])
})

test('a worktree is a checkout of its own, so its root passes', () => {
  const main = checkout('')
  const branch = join(dir, `worktree-${++made}`)
  git(main, 'worktree', 'add', '--quiet', '-b', 'side', branch)
  expect(layoutProblems(branch)).toEqual([])
})

test("the README's extension section opens with the layout, before the install lines, and shows the test that holds it", () => {
  const readme = readFileSync(join(import.meta.dir, '../../README.md'), 'utf8')
  const section = readme.slice(readme.indexOf('## extension/: the extension kit'), readme.indexOf('## tauri/'))
  const layout = section.indexOf("An extension's `manifest.json` sits at the root of its repository, and its paths point into a folder for the code, so Chrome's Load unpacked takes the checkout itself")
  expect(layout).toBeGreaterThan(0)
  expect(layout).toBeLessThan(section.indexOf('An extension installs app-kit the same way an app does'))
  expect(section).toContain("test('the manifest is at the root of the checkout', () => expect(layoutProblems('.')).toEqual([]))")
})
