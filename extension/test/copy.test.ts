import { afterAll, expect, test } from 'bun:test'
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copiedFiles, copyWorker, unlistedImports, workerCopyDiffers, workerFiles } from '../copy.ts'
import { PLAIN_SIZES, plainColors } from '../../look/index.ts'
import { LOADED_FILES } from './fixture/worker.js'
import packageJson from '../../package.json'

const dir = mkdtempSync(join(tmpdir(), 'app-kit-extension-copy-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const cli = (...args: string[]) => Bun.spawnSync([process.execPath, join(import.meta.dir, '../../bin/app-kit.ts'), 'extension', ...args], { stdout: 'pipe', stderr: 'pipe' })

test('copy writes every worker file and the stylesheet, each naming the kit version it came from', () => {
  const folder = join(dir, 'kit')
  expect(copyWorker(folder)).toEqual([...workerFiles(), 'look.css'])
  expect(workerFiles()).toEqual(['account.js', 'alarms.js', 'build.js', 'errors.js', 'port.js', 'self-reload.js'])
  expect(readFileSync(join(folder, 'port.js'), 'utf8').split('\n')[0]).toBe(`// Copied from app-kit ${packageJson.version} by \`app-kit extension copy\`. Change it in the kit.`)
  expect(workerCopyDiffers(folder)).toEqual([])
})

test("the stylesheet's copy opens with a CSS comment and holds the tokens file's colors, light and dark, and sizes", () => {
  const folder = join(dir, 'look')
  copyWorker(folder)
  const css = readFileSync(join(folder, 'look.css'), 'utf8')
  // A `//` line would be read as part of the selector after it, and drop the :root rule.
  expect(css.split('\n')[0]).toBe(`/* Copied from app-kit ${packageJson.version} by \`app-kit extension copy\`. Change it in the kit. */`)
  const [lightBlock, darkBlock] = css.split('@media (prefers-color-scheme: dark)')
  const { light, dark } = plainColors()
  expect(lightBlock).toContain('color-scheme: light dark;')
  expect(lightBlock).toContain(`--text: ${light.text};`)
  expect(lightBlock).toContain(`--surface-hi: ${light.surfaceHi};`)
  expect(lightBlock).toContain(`--info: var(--accent-light, ${light.info});`)
  expect(lightBlock).toContain(`--side-popup: ${PLAIN_SIZES.sidePopup}px;`)
  expect(lightBlock).toContain(`--label-weight: ${PLAIN_SIZES.labelWeight};`)
  expect(darkBlock).toContain(`--text: ${dark.text};`)
  expect(darkBlock).toContain(`--info: var(--accent-dark, ${dark.info});`)
  // The kit's rules follow the variables.
  expect(css).toContain('.switch:checked {')
})

test('a stylesheet copy edited by hand, or missing, differs from the kit, and the check command names it', () => {
  const folder = join(dir, 'look-edited')
  copyWorker(folder)
  appendFileSync(join(folder, 'look.css'), '.mine { color: red; }\n')
  expect(workerCopyDiffers(folder)).toEqual(['look.css'])
  const edited = cli('check', folder)
  expect(edited.exitCode).toBe(3)
  expect(edited.stderr.toString()).toContain('look.css in')
  rmSync(join(folder, 'look.css'))
  expect(workerCopyDiffers(folder)).toEqual(['look.css'])
  expect(cli('check', folder).exitCode).toBe(3)
})

test("copy refuses to overwrite a look.css that is the extension's own, and writes nothing", () => {
  const folder = join(dir, 'own-look')
  mkdirSync(folder)
  writeFileSync(join(folder, 'look.css'), 'body { color: red; }\n')
  expect(() => copyWorker(folder)).toThrow('look.css in')
  expect(readdirSync(folder)).toEqual(['look.css'])
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

test('copy refuses an extension folder whose copies live in kit/, at the root or one folder up, and writes nothing', () => {
  // amazon-connector's layout: the manifest at the root, the worker in extension/, its copies in extension/kit/.
  const root = join(dir, 'amazon-layout')
  mkdirSync(join(root, 'extension'), { recursive: true })
  writeFileSync(join(root, 'manifest.json'), '{}')
  writeFileSync(join(root, 'extension', 'worker.js'), '')
  copyWorker(join(root, 'extension', 'kit'))
  const before = (folder: string) => readdirSync(folder).sort()
  const rootFiles = before(root)
  const extensionFiles = before(join(root, 'extension'))
  for (const folder of [join(root, 'extension'), root]) {
    const run = cli('copy', folder)
    expect(run.exitCode).toBe(1)
    expect(run.stderr.toString()).toContain(`but ${join(root, 'extension', 'kit')} holds copies of them`)
  }
  expect(before(root)).toEqual(rootFiles)
  expect(before(join(root, 'extension'))).toEqual(extensionFiles)
})

test("copy refuses to overwrite a file of the same name that is the extension's own", () => {
  const folder = join(dir, 'own-errors')
  mkdirSync(folder)
  writeFileSync(join(folder, 'errors.js'), 'export const mine = true\n')
  expect(() => copyWorker(folder)).toThrow("errors.js in")
  expect(readdirSync(folder)).toEqual(['errors.js'])
})

test('copy on a fresh folder, empty or not there yet, writes the files, and the usage says where they land', () => {
  const empty = join(dir, 'empty')
  mkdirSync(empty)
  expect(cli('copy', empty).exitCode).toBe(0)
  expect(readdirSync(empty).sort()).toEqual(copiedFiles().sort())
  expect(copyWorker(join(dir, 'not-there-yet', 'kit'))).toEqual(copiedFiles())
  expect(cli('copy').stderr.toString()).toContain("write the kit's worker files directly into <folder>, the\n                              folder the worker imports them from")
})

test('every file the fixture worker loads is in its list for self-reload, and one left out is named', () => {
  expect(unlistedImports(join(import.meta.dir, 'fixture'), LOADED_FILES)).toEqual([])
  const folder = join(dir, 'imports')
  mkdirSync(join(folder, 'lib'), { recursive: true })
  writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ background: { service_worker: 'worker.js', type: 'module' } }))
  writeFileSync(join(folder, 'worker.js'), 'import { a } from "./lib/a.js";\nimport {\n  b,\n} from "./lib/b.js";\n')
  writeFileSync(join(folder, 'lib', 'a.js'), 'export { c } from "../c.js";\nexport const a = 1;\n')
  writeFileSync(join(folder, 'lib', 'b.js'), 'import "./a.js";\nexport const b = 2;\n')
  writeFileSync(join(folder, 'c.js'), 'export const c = 3;\n')
  expect(unlistedImports(folder, ['worker.js', 'lib/a.js'])).toEqual(['c.js', 'lib/b.js'])
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

test('status with no host listening says why and exits 4', () => {
  const run = cli('status', join(dir, 'nowhere.sock'))
  expect(run.exitCode).toBe(4)
  expect(JSON.parse(run.stdout.toString())).toMatchObject({ connected: false })
})
