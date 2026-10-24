/*
 * The repository is public, so nothing in it names a person's own email or home folder, or a real Google Cloud project: not a tracked file, not a
 * file as any commit had it, not a commit's author or committer, not a commit message. Test addresses are on example.com, and the kit's own on
 * worktron.com. Commits are by Worktron, and land by moving main forward, since GitHub's merge button commits as the
 * merging account; the commit trailers name Claude's address.
 */
import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { relative } from 'path';

/** An email address: a domain of letters ends it, so a package's name@1.2.3 is not one. */
const EMAIL = /[\w.+-]+@[a-z][\w-]*(?:\.[\w-]+)*\.[a-z]{2,}\b/gi;
const HOME_FOLDER = /\/(?:Users|home)\/[\w.-]+/g;
/** A real Google Cloud project, by number, or an OAuth client of one. A test's stand-in project is a short number. */
const GOOGLE_PROJECT = /\bprojects\/\d{6,}|\bproject_number:\d{6,}|\bproject \d{6,}|[\w-]+\.apps\.googleusercontent\.com/g;
const ALLOWED_EMAIL = /@(?:example\.com|worktron\.com)$/;
const ALLOWED_IN_HISTORY = new Set(['noreply@anthropic.com']);
const COMMIT_NAMES = new Set(['Worktron']);
/** Addresses that name no one, in commits from before example.com was the rule: GitHub's SSH user and two made up. */
const NAMES_NO_ONE = new Set(['git@github.com', 'a@b.co', 'x@y.co']);
const THIS_FILE = relative(process.cwd(), import.meta.path);

const git = (...args: string[]) => {
  const run = Bun.spawnSync(['git', ...args], { stdout: 'pipe', stderr: 'pipe' });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr.toString()}`);
  return run.stdout.toString();
};

/** The personal emails, home folders and Google Cloud projects in a text, each once. */
function personalFacts(text: string, allowed: (email: string) => boolean = (e) => ALLOWED_EMAIL.test(e)): string[] {
  const emails = [...text.matchAll(EMAIL)].map((m) => m[0]).filter((e) => !allowed(e));
  const homes = [...text.matchAll(HOME_FOLDER)].map((m) => m[0]);
  const projects = [...text.matchAll(GOOGLE_PROJECT)].map((m) => m[0]);
  return [...new Set([...emails, ...homes, ...projects])];
}

test('a personal email or a home folder is found, and test addresses are not', () => {
  expect(personalFacts('Signed in as someone@gmail.com from /Users/someone/Workspace')).toEqual(['someone@gmail.com', '/Users/someone']);
  expect(personalFacts('ana@example.com, kit@worktron.com, ./users/list')).toEqual([]);
});

test("a Google Cloud project's number or OAuth client is found, and a test's stand-in project is not", () => {
  expect(personalFacts("consumer 'projects/123456789012' for 123456789012-abc123.apps.googleusercontent.com")).toEqual([
    'projects/123456789012',
    '123456789012-abc123.apps.googleusercontent.com',
  ]);
  expect(personalFacts('Google Calendar API has not been used in project 123456789012 before')).toEqual(['project 123456789012']);
  expect(personalFacts("project 0, consumer 'projects/0' or 'project_number:1'")).toEqual([]);
});

test('no tracked file names a personal email or home folder', () => {
  const found: string[] = [];
  for (const path of git('ls-files', '-z').split('\0').filter((p) => p && p !== THIS_FILE && existsSync(p))) {
    for (const fact of personalFacts(readFileSync(path, 'utf8'))) found.push(`${path}: ${fact}`);
  }
  expect(found).toEqual([]);
});

test('no file in any commit ever named a personal email or home folder, though a later commit took it out', () => {
  // Every line each commit added, in every file but this one, whose patterns would match themselves.
  const added = git('log', '--all', '--format=%x01%H', '-p', '--no-color', '--', '.', `:!${THIS_FILE}`)
    .split('\x01')
    .flatMap((commit) => {
      const [sha, ...lines] = commit.split('\n');
      return lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).map((line) => [sha.slice(0, 7), line.slice(1)] as const);
    });
  expect(added.length).toBeGreaterThan(0);
  const allowed = (e: string) => ALLOWED_EMAIL.test(e) || NAMES_NO_ONE.has(e);
  const found = added.flatMap(([sha, line]) => personalFacts(line, allowed).map((fact) => `${sha}: ${fact}`));
  expect([...new Set(found)]).toEqual([]);
});

test('no commit names a person, or a personal email or home folder, as author, committer or in its message', () => {
  const allowed = (e: string) => ALLOWED_EMAIL.test(e) || ALLOWED_IN_HISTORY.has(e);
  const found: string[] = [];
  for (const commit of git('log', '--all', '--format=%H%x00%an%x00%cn%x00%ae %ce%n%B%x01').split('\x01')) {
    const [sha, author, committer, text] = commit.trim().split('\0');
    if (!sha) continue;
    for (const name of [author, committer]) if (!COMMIT_NAMES.has(name)) found.push(`${sha.slice(0, 7)}: ${name}`);
    for (const fact of personalFacts(text, allowed)) found.push(`${sha.slice(0, 7)}: ${fact}`);
  }
  expect(found).toEqual([]);
});
