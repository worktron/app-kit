// Every import name the package exports points at a file that exists, so a moved or renamed file fails here rather than
// in an app on its next upgrade. The kit's own tests import by relative path, which would never notice.
import { expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import packageJson from '../package.json';

const root = join(import.meta.dir, '..');

test('every export target exists, and a folder export holds the files it offers', () => {
  const missing = Object.entries(packageJson.exports as Record<string, string>).filter(([, target]) => {
    if (!target.includes('*')) return !existsSync(join(root, target));
    const folder = join(root, dirname(target));
    return !existsSync(folder) || readdirSync(folder).length === 0;
  });
  expect(missing).toEqual([]);
});

test('the command the package declares exists', () => {
  expect(Object.values(packageJson.bin).filter((path) => !existsSync(join(root, path)))).toEqual([]);
});
