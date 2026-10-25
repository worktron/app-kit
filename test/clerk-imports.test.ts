// Nothing the kit ships imports Clerk outside authentication/clerk/, so every other part works with any sign-in provider
// and an app that uses another never installs Clerk. What the gate needs from a provider goes through
// web/sign-in/provider.ts. The kit's own tests of the Clerk adapter, in test/, may import Clerk.
import { expect, test } from 'bun:test';
import { readFileSync } from 'fs';

const CLERK_IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|^\s*import\s+)['"]@clerk\//m;

test('no file outside authentication/clerk/ and test/ imports Clerk', () => {
  const tracked = Bun.spawnSync(['git', 'ls-files', '*.ts', '*.tsx', '*.js', '*.jsx'], { stdout: 'pipe' }).stdout.toString().trim().split('\n');
  const shipped = tracked.filter((path) => !path.startsWith('authentication/clerk/') && !path.startsWith('test/'));
  expect(shipped.length).toBeGreaterThan(50);
  expect(shipped.filter((path) => CLERK_IMPORT.test(readFileSync(path, 'utf8')))).toEqual([]);
});
