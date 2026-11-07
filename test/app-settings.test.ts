// The kit ships TypeScript sources that each app compiles under its own settings, so every file the exports point at
// must compile under the settings apps use that the kit's own tsconfig does not: without allowImportingTsExtensions,
// and with noUncheckedIndexedAccess. An upgrade thread in an app on both found the command-line part failing its
// typecheck (2026-11-06). The compile runs the kit's own tsc over the exports, with the kit's options and those two
// changed, from a tsconfig in this test's own temporary folder.
import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import packageJson from '../package.json';
import tsconfig from '../tsconfig.json';

const kit = resolve(import.meta.dir, '..');

/** The TypeScript files the package's exports point at, the ones an app's compile starts from. */
function exportedSources(): string[] {
  const targets = Object.values(packageJson.exports as Record<string, string | Record<string, string>>).flatMap((value) => (typeof value === 'string' ? [value] : Object.values(value)));
  return [...new Set(targets.filter((target) => /\.tsx?$/.test(target) && !target.endsWith('.d.ts')))].map((target) => join(kit, target));
}

test("every exported file compiles under an app's stricter settings: no .ts endings in imports, and checked index access", async () => {
  const files = exportedSources();
  expect(files.length).toBeGreaterThan(20);
  const folder = mkdtempSync(join(tmpdir(), 'app-kit-app-settings-'));
  const config = join(folder, 'tsconfig.json');
  const compilerOptions = { ...tsconfig.compilerOptions, allowImportingTsExtensions: false, noUncheckedIndexedAccess: true, typeRoots: [join(kit, 'node_modules/@types')] };
  writeFileSync(config, JSON.stringify({ compilerOptions, files }));
  try {
    const child = Bun.spawn([join(kit, 'node_modules/.bin/tsc'), '--noEmit', '--pretty', 'false', '-p', config], { cwd: kit, stdout: 'pipe', stderr: 'pipe' });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(`${out}${err}`.trim()).toBe('');
    expect(code).toBe(0);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  // One tsc over every export and the React, MUI and Clerk types they reach: about a second alone, longer on a busy machine.
}, 15_000);
