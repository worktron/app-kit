/*
 * The repository is public, so nothing in it names a person's own email or home folder, or a real Google Cloud project: not a tracked file, not a
 * file as any commit had it, not a commit's author or committer, not a commit message. Test addresses are on example.com, and the kit's own on
 * worktron.com. Commits are by Worktron, and land by moving main forward, since GitHub's merge button commits as the
 * merging account; the commit trailers name Claude's address.
 */
import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';

/**
 * An email address: a domain of letters ends it, so a package's name@1.2.3 is not one. Its name before the @ is at most
 * the 64 characters an address may have, which keeps a long run of letters from being tried from every start to its end.
 */
const EMAIL = /[\w.+-]{1,64}@[a-z][\w-]*(?:\.[\w-]+)*\.[a-z]{2,}\b/gi;
/** A home folder, as a path or as JSON writes one, with each slash escaped ("\/Users\/someone"). */
const HOME_FOLDER = /\\?\/(?:Users|home)\\?\/[\w.-]+/g;
/**
 * A real Google Cloud project, by number, or an OAuth client of one. A test's stand-in project is a short number. A
 * client's name is one part of a host name, at most 63 characters, for the same reason as an email's.
 */
const GOOGLE_PROJECT = /\bprojects\/\d{6,}|\bproject_number:\d{6,}|\bproject \d{6,}|[\w-]{1,63}\.apps\.googleusercontent\.com/g;
/**
 * Test addresses, the project's own, the Co-Authored-By trailer's, which names no one and a plan may quote, and
 * GitHub's SSH user, which every SSH address of a GitHub repository holds (`git@github.com:<owner>/<app>.git`).
 */
const ALLOWED_EMAIL = /@(?:example\.com|worktron\.com)$|^noreply@anthropic\.com$|^git@github\.com$/;
const COMMIT_NAMES = new Set(['Worktron']);
/** Addresses that name no one, in commits from before example.com was the rule: two made up. */
const NAMES_NO_ONE = new Set(['a@b.co', 'x@y.co']);
const THIS_FILE = relative(process.cwd(), import.meta.path);

/** A git command's exit code and output, for the calls where a failing exit is an answer. */
const gitRun = (cwd: string, args: string[], env?: Record<string, string>, input?: string) => {
  const run = Bun.spawnSync(['git', ...args], {
    cwd,
    env: env && { ...process.env, ...env },
    stdin: input === undefined ? 'ignore' : new TextEncoder().encode(input),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { exitCode: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
};
const gitIn = (cwd: string, ...args: string[]) => {
  const run = gitRun(cwd, args);
  if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${run.err}`);
  return run.out;
};
const git = (...args: string[]) => gitIn(process.cwd(), ...args);

/** What the history checks read: the commits named by revs, and with paths, only those that change them. */
type HistoryPart = { revs: string[]; paths?: string[] };
/** Plan files land on main with no gates run (scripts/land.ts skips them for a plans-only landing), so no landing has checked them. */
const UNGATED = '.claude/plans';
/** The patterns that find a personal fact, as written: a base whose copy lacks one found less than they find now. */
const PATTERNS = [EMAIL, HOME_FOLDER, GOOGLE_PROJECT, ALLOWED_EMAIL].map(String);

/**
 * The history a landing adds, so another thread's unlanded branch is never read: the commits from where HEAD meets main
 * (the commit a landing pins and rebases onto), and every commit to the plan files, which no gate checked. All of HEAD's
 * history when there is no main to meet, or when main's copy of the patterns lacks one of today's, so a widened pattern
 * is tried against everything already published.
 */
function historyToRead(cwd: string, patternsFile: string): HistoryPart[] {
  const everything = [{ revs: ['HEAD'] }];
  const base = gitRun(cwd, ['merge-base', 'HEAD', 'refs/remotes/origin/main']);
  if (base.exitCode !== 0) return everything;
  const sha = base.out.trim();
  const patternsThen = gitRun(cwd, ['show', `${sha}:${patternsFile}`]);
  if (patternsThen.exitCode !== 0 || PATTERNS.some((pattern) => !patternsThen.out.includes(pattern))) return everything;
  return [{ revs: [`${sha}..HEAD`] }, { revs: ['HEAD'], paths: [UNGATED] }];
}

/** Every line the commits read added, in every file but the patterns file, whose patterns would match themselves. */
function addedFacts(cwd: string, parts: HistoryPart[], patternsFile: string) {
  const read = new Set<string>();
  const found = new Set<string>();
  const allowed = (e: string) => ALLOWED_EMAIL.test(e) || NAMES_NO_ONE.has(e);
  for (const { revs, paths = ['.'] } of parts) {
    for (const commit of gitIn(cwd, 'log', ...revs, '--format=%x01%H', '-p', '--no-color', '--', ...paths, `:!${patternsFile}`).split('\x01')) {
      const [sha, ...lines] = commit.split('\n');
      if (!sha) continue;
      read.add(sha);
      for (const line of lines) {
        if (!line.startsWith('+') || line.startsWith('+++')) continue;
        for (const fact of personalFacts(line.slice(1), allowed)) found.add(`${sha.slice(0, 7)}: ${fact}`);
      }
    }
  }
  return { read, found: [...found] };
}

/** Each commit read whose author or committer is not Worktron, or whose message names a personal fact. */
function commitFacts(cwd: string, parts: HistoryPart[]) {
  const read = new Set<string>();
  const found = new Set<string>();
  const allowed = (e: string) => ALLOWED_EMAIL.test(e);
  for (const { revs, paths = [] } of parts) {
    for (const commit of gitIn(cwd, 'log', ...revs, '--format=%H%x00%an%x00%cn%x00%ae %ce%n%B%x01', '--', ...paths).split('\x01')) {
      const [sha, author, committer, text] = commit.trim().split('\0');
      if (!sha) continue;
      read.add(sha);
      for (const name of [author, committer]) if (!COMMIT_NAMES.has(name)) found.add(`${sha.slice(0, 7)}: ${name}`);
      for (const fact of personalFacts(text, allowed)) found.add(`${sha.slice(0, 7)}: ${fact}`);
    }
  }
  return { read, found: [...found] };
}

/** The personal emails, home folders and Google Cloud projects in a text, each once. */
function personalFacts(text: string, allowed: (email: string) => boolean = (e) => ALLOWED_EMAIL.test(e)): string[] {
  const emails = [...text.matchAll(EMAIL)].map((m) => m[0]).filter((e) => !allowed(e));
  const homes = [...text.matchAll(HOME_FOLDER)].map((m) => m[0]);
  const projects = [...text.matchAll(GOOGLE_PROJECT)].map((m) => m[0]);
  return [...new Set([...emails, ...homes, ...projects])];
}

test('a personal email or a home folder is found, and test addresses are not', () => {
  expect(personalFacts('Signed in as someone@gmail.com from /Users/someone/Workspace')).toEqual(['someone@gmail.com', '/Users/someone']);
  expect(personalFacts('ana@example.com, kit@worktron.com, ./users/list, git@github.com:example/app.git')).toEqual([]);
  // The trailer's address names no one; anyone else's at the same company is a person's.
  expect(personalFacts('Co-Authored-By: Claude <noreply@anthropic.com>, from someone@anthropic.com')).toEqual(['someone@anthropic.com']);
  expect(personalFacts('"dataPath" : "\\/Users\\/someone\\/Library"')).toEqual(['\\/Users\\/someone']);
});

// A run of letters as long as a test file's (the Apple Messages reader's has one of 70,000) took the email and Google
// client patterns seconds, since each tried every start in the run to its end, and a busy machine stretched that past
// the five seconds a test may take.
test('a run of 200,000 letters is scanned at once, and what follows it is still found', () => {
  const run = 'a'.repeat(200_000);
  expect(personalFacts(`${run} someone@gmail.com ${run} 123-abc.apps.googleusercontent.com ${run}`)).toEqual([
    'someone@gmail.com',
    '123-abc.apps.googleusercontent.com',
  ]);
  // An address longer than any address may be is still found, from its last 64 characters.
  expect(personalFacts(`${'x'.repeat(100)}@gmail.com`)).toEqual([`${'x'.repeat(64)}@gmail.com`]);
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
  // The plan files' history is always read, so a read that found no commit read nothing it should have.
  const { read, found } = addedFacts(process.cwd(), historyToRead(process.cwd(), THIS_FILE), THIS_FILE);
  expect(read.size).toBeGreaterThan(0);
  expect(found).toEqual([]);
});

test('no commit names a person, or a personal email or home folder, as author, committer or in its message', () => {
  const { read, found } = commitFacts(process.cwd(), historyToRead(process.cwd(), THIS_FILE));
  expect(read.size).toBeGreaterThan(0);
  expect(found).toEqual([]);
});

// Another thread's branch in the same repository, unlanded, once stopped a landing that had nothing to do with it, and
// reading every thread's branches made the check slower with each one.
test('a commit on another local branch is neither read nor reported by the history checks', () => {
  const repo = mkdtempSync(join(tmpdir(), 'public-history-'));
  try {
    // The machine's own git settings (a default branch, hooks, signing) stay out of the scratch repository.
    const env = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    const run = (args: string[], input?: string) => {
      const done = gitRun(repo, args, env, input);
      if (done.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${done.err}`);
    };
    // The whole history in one git process, since process starts are what a busy machine slows most.
    const data = (text: string) => `data ${Buffer.byteLength(text)}\n${text}\n`;
    const commit = (ref: string, mark: number, from: number | null, files: Record<string, string>, message: string, author = 'Worktron') =>
      `commit ${ref}\nmark :${mark}\nauthor ${author} <kit@worktron.com> 1700000000 +0000\ncommitter Worktron <kit@worktron.com> 1700000000 +0000\n` +
      `${data(message)}${from ? `from :${from}\n` : ''}${Object.entries(files).map(([path, text]) => `M 100644 inline ${path}\n${data(text)}`).join('')}`;
    const patterns = 'patterns.ts';
    run(['init', '-q', '-b', 'work']);
    run(['fast-import', '--quiet', `--export-marks=${join(repo, 'marks')}`], [
      // Main as it was before a pattern was added, then as it is, with a fact in a plan file no gate checked.
      commit('refs/heads/main', 1, null, { [patterns]: PATTERNS.slice(1).join('\n'), 'README.md': 'kit@worktron.com\n' }, 'The kit'),
      commit('refs/heads/main', 2, 1, { [patterns]: PATTERNS.join('\n'), [`${UNGATED}/backlog.md`]: 'from /Users/someone\n' }, 'A ticket'),
      commit('refs/heads/other', 3, 2, { 'notes.md': 'someone@gmail.com\n' }, 'Notes from /Users/other', 'Someone'),
      commit('refs/heads/work', 4, 2, { 'work.md': 'ana@example.com\n' }, 'The work'),
      'reset refs/remotes/origin/main\nfrom :2\n',
    ].join(''));
    const [older, landed, other, work] = readFileSync(join(repo, 'marks'), 'utf8').trim().split('\n').map((line) => line.split(' ')[1]);

    const parts = historyToRead(repo, patterns);
    expect(parts).toEqual([{ revs: [`${landed}..HEAD`] }, { revs: ['HEAD'], paths: [UNGATED] }]);
    const added = addedFacts(repo, parts, patterns);
    expect([...added.read].sort()).toEqual([landed, work].sort());
    expect(added.found).toEqual([`${landed.slice(0, 7)}: /Users/someone`]);
    const commits = commitFacts(repo, parts);
    expect([...commits.read].sort()).toEqual([landed, work].sort());
    expect(commits.found).toEqual([]);

    // Main's copy lacks today's email pattern, so all of HEAD's history is read, and still not the other branch.
    run(['update-ref', 'refs/remotes/origin/main', older]);
    expect(historyToRead(repo, patterns)).toEqual([{ revs: ['HEAD'] }]);
    expect([...addedFacts(repo, [{ revs: ['HEAD'] }], patterns).read].sort()).toEqual([older, landed, work].sort());

    // With no main to meet, all of HEAD's history.
    run(['update-ref', '-d', 'refs/remotes/origin/main']);
    expect(historyToRead(repo, patterns)).toEqual([{ revs: ['HEAD'] }]);

    // Landing the other branch, its facts are found.
    run(['update-ref', 'refs/remotes/origin/main', landed]);
    run(['symbolic-ref', 'HEAD', 'refs/heads/other']);
    const theirs = historyToRead(repo, patterns);
    expect(addedFacts(repo, theirs, patterns).found.sort()).toEqual([`${landed.slice(0, 7)}: /Users/someone`, `${other.slice(0, 7)}: someone@gmail.com`].sort());
    expect(commitFacts(repo, theirs).found.sort()).toEqual([`${other.slice(0, 7)}: Someone`, `${other.slice(0, 7)}: /Users/other`].sort());
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
