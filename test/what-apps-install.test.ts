/*
 * An app installs the kit from GitHub's archive of a tag, the whole repository but what `.gitattributes` marks
 * export-ignore. Claude Code loads a CLAUDE.md or AGENTS.md when it reads a file in that folder, node_modules
 * included, so the kit's rules for changing the kit would reach the agent of every app that reads its README.
 * `git archive` applies the same marks GitHub's archive does.
 */
import { expect, test } from 'bun:test';

const run = (command: string[]) => {
  const result = Bun.spawnSync(command, { stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(`${command.join(' ')}: ${result.stderr.toString()}`);
  return result.stdout.toString();
};

const archived = run(['sh', '-c', 'git archive --format=tar HEAD | tar -t']).split('\n');

test("the archive an app installs holds none of the kit's own instructions", () => {
  const instructions = archived.filter((path) => /(^|\/)(AGENTS\.md|CLAUDE\.md|\.claude(\/|$))/.test(path));
  expect(instructions).toEqual([]);
});

test('the archive an app installs still holds what apps use', () => {
  for (const path of ['README.md', 'package.json', 'bin/', 'tauri/', 'web/']) expect(archived).toContain(path);
});

test('an instruction file added in a folder later is left out too', () => {
  for (const path of ['tauri/CLAUDE.md', 'tauri/AGENTS.md', 'tauri/.claude']) {
    expect(run(['git', 'check-attr', 'export-ignore', '--', path]).trim()).toEndWith('export-ignore: set');
  }
});
