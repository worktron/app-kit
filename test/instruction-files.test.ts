/*
 * The root AGENTS.md goes with every request a thread makes, so it holds only what a thread needs before it touches
 * anything. What each folder holds lives in that folder's own AGENTS.md, which Claude Code loads when a thread reads,
 * writes or edits a file there, through the one-line CLAUDE.md beside it, so Codex and Claude Code read the same text.
 */
import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = join(import.meta.dir, '..');
const tracked = Bun.spawnSync(['git', 'ls-files', '*AGENTS.md'], { cwd: root }).stdout.toString().trim().split('\n');

test('every AGENTS.md has a CLAUDE.md beside it that imports it first', () => {
  const unpaired = tracked.filter((file) => {
    const claude = join(root, dirname(file), 'CLAUDE.md');
    return !existsSync(claude) || readFileSync(claude, 'utf8').split('\n')[0] !== '@AGENTS.md';
  });
  expect(unpaired).toEqual([]);
});

test('every top folder an agent changes has its own AGENTS.md', () => {
  const folders = ['web', 'extension', 'tauri', 'swift', 'command-line', 'authentication', 'server', 'look', 'icons'];
  for (const folder of [...folders, 'testing', 'scripts', 'test']) expect(tracked).toContain(`${folder}/AGENTS.md`);
});

test("the root AGENTS.md holds no folder's inventory", () => {
  const lines = readFileSync(join(root, 'AGENTS.md'), 'utf8').split('\n');
  expect(lines).not.toContain('## Layout');
  expect(lines.filter((line) => /^[a-z-]+\/ {2,}\S/.test(line))).toEqual([]);
});
