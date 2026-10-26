// What the TestFlight tests share: a team key, a stand-in for App Store Connect that refuses any request whose token
// does not verify with that key, git repositories made in a folder of their own and reached over file://, and a
// runner that passes some programs to the real one and answers for the rest.
import { generateKeyPairSync, verify } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TestFlightKey } from '../tauri/testflight/app-store-connect.ts';
import { runCommand, type Run, type RunOptions, type RunResult } from '../tauri/testflight/run.ts';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
export const KEY: TestFlightKey = {
  keyId: 'KEYID00001',
  issuerId: '00000000-0000-0000-0000-000000000001',
  privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim(),
};
/** 1Password's answer to `op item get "App Store Connect API" --vault TestFlight --format json`, cut to what is read. */
export const ITEM_JSON = JSON.stringify({
  title: 'App Store Connect API',
  vault: { name: 'TestFlight' },
  fields: [
    { label: 'key id', value: KEY.keyId },
    { label: 'issuer id', value: KEY.issuerId },
    { label: 'private key', value: KEY.privateKey },
  ],
});
export const TOKEN = 'ops_stand-in-token';

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString()) as Record<string, unknown>;

/** Why App Store Connect would refuse this authorization header, or null when it takes it. */
export function tokenProblem(authorization: string | null): string | null {
  const token = authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return 'no bearer token';
  const [header, claims, signature] = token.split('.');
  const signed = verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature ?? '', 'base64url'));
  if (!signed) return 'the signature does not verify';
  const h = decode(header);
  const c = decode(claims);
  if (h.alg !== 'ES256' || h.kid !== KEY.keyId || h.typ !== 'JWT') return `header ${JSON.stringify(h)}`;
  if (c.iss !== KEY.issuerId || c.aud !== 'appstoreconnect-v1') return `claims ${JSON.stringify(c)}`;
  const life = Number(c.exp) - Number(c.iat);
  if (!(life > 0 && life <= 20 * 60)) return `a token living ${life} seconds`;
  return null;
}

export type StandInBuild = {
  number: string;
  /** Each ask for this build by number takes the next state; the last one stays. */
  states: string[];
  internalState?: string;
  /** How many asks by number answer "not listed" before it is listed. */
  hiddenFor?: number;
};

/**
 * App Store Connect, for one app, whose builds list comes back in the order of their numbers read as text, as Apple's
 * need not be by number. A node:http server, since the unit tests' simulated page replaces the global Response; the
 * client is handed Bun's own fetch for the same reason (`options` below).
 */
export async function appStoreConnect(config: { bundleId: string; appId?: string; builds?: StandInBuild[]; pageSize?: number }) {
  const appId = config.appId ?? '1000000001';
  const builds: StandInBuild[] = config.builds ?? [];
  const requests: string[] = [];
  const answer = (url: URL, authorization: string | null): [number, unknown] => {
    requests.push(`${url.pathname}${url.search}`);
    const problem = tokenProblem(authorization);
    if (problem) return [401, { errors: [{ status: '401', title: 'Authentication credentials are missing or invalid.', detail: problem }] }];
    const q = (name: string) => url.searchParams.get(name);
    if (url.pathname === '/v1/apps') {
      return [200, { data: q('filter[bundleId]') === config.bundleId ? [{ type: 'apps', id: appId, attributes: { bundleId: config.bundleId } }] : [] }];
    }
    if (url.pathname === '/v1/builds' && q('filter[app]') === appId) {
      const resource = (b: StandInBuild, state: string) => ({
        type: 'builds',
        id: `build-${b.number}`,
        attributes: { version: b.number, processingState: state },
        relationships: { buildBetaDetail: { data: { type: 'buildBetaDetails', id: `detail-${b.number}` } } },
      });
      const version = q('filter[version]');
      if (version) {
        const build = builds.find((b) => b.number === version);
        if (!build || (build.hiddenFor ?? 0) > 0) {
          if (build) build.hiddenFor = (build.hiddenFor ?? 0) - 1;
          return [200, { data: [] }];
        }
        const state = build.states.length > 1 ? build.states.shift()! : build.states[0];
        return [
          200,
          {
            data: [resource(build, state)],
            included: [{ type: 'buildBetaDetails', id: `detail-${build.number}`, attributes: { internalBuildState: build.internalState ?? 'IN_BETA_TESTING' } }],
          },
        ];
      }
      const sorted = [...builds].sort((a, b) => b.number.localeCompare(a.number));
      const size = config.pageSize ?? Number(q('limit') ?? 50);
      const from = Number(q('cursor') ?? 0);
      const next = from + size < sorted.length ? new URL(`/v1/builds?filter[app]=${appId}&limit=${size}&cursor=${from + size}`, url).href : undefined;
      return [200, { data: sorted.slice(from, from + size).map((b) => resource(b, b.states[b.states.length - 1])), links: { next } }];
    }
    return [404, { errors: [{ status: '404', title: 'Not found' }] }];
  };
  const server = createServer((request, response) => {
    const [status, body] = answer(new URL(request.url ?? '/', baseUrl), request.headers.authorization ?? null);
    response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    baseUrl,
    builds,
    requests,
    options: { baseUrl, fetch: Bun.fetch as typeof fetch },
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * A folder for one test's repositories and state, under node_modules/.cache rather than the system temp folder: Bun
 * looks in every folder above a script it runs, and a temp folder holding many entries made that look take minutes.
 */
export function scratch(prefix: string) {
  const cache = join(import.meta.dir, '../node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const folder = mkdtempSync(join(cache, prefix));
  return { folder, done: () => rmSync(folder, { recursive: true, force: true }) };
}

const GIT_IDENTITY = ['-c', 'user.name=app', '-c', 'user.email=app@example.com', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main'];

/** Runs git in `cwd` and gives its output, throwing on failure. */
export function git(cwd: string, ...args: string[]): string {
  const done = Bun.spawnSync(['git', ...GIT_IDENTITY, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (done.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${done.stderr.toString()}`);
  return done.stdout.toString().trim();
}

/** A repository whose main starts with `files`. */
export function repository(folder: string, files: Record<string, string>): string {
  mkdirSync(folder, { recursive: true });
  git(folder, 'init', '-q');
  commit(folder, files, 'the app');
  return folder;
}

/** Writes `files` and commits them on the branch checked out; gives the commit. */
export function commit(folder: string, files: Record<string, string>, message = 'a change'): string {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
  git(folder, 'add', '-A');
  git(folder, 'commit', '-q', '--allow-empty', '-m', message);
  return git(folder, 'rev-parse', 'HEAD');
}

/** Adds `count` empty commits on top of the branch checked out, in one git process. */
export function emptyCommits(folder: string, count: number) {
  const head = git(folder, 'rev-parse', 'HEAD');
  const branch = git(folder, 'symbolic-ref', 'HEAD');
  let stream = '';
  for (let i = 0; i < count; i++) {
    const message = `empty ${i}`;
    stream += `commit ${branch}\ncommitter app <app@example.com> ${1_800_000_000 + i} +0000\ndata ${message.length}\n${message}\n${i === 0 ? `from ${head}\n` : ''}\n`;
  }
  const done = Bun.spawnSync(['git', 'fast-import', '--quiet'], { cwd: folder, stdin: Buffer.from(stream), stdout: 'pipe', stderr: 'pipe' });
  if (done.exitCode !== 0) throw new Error(`git fast-import: ${done.stderr.toString()}`);
  git(folder, 'reset', '-q', '--hard', branch);
}

export type Call = { command: string[]; options: RunOptions };
export type Answer = (command: string[], options: RunOptions) => RunResult | undefined | Promise<RunResult | undefined>;

/**
 * A runner that records every call, answers through `answer`, and passes to the real runner whatever `answer` leaves
 * (it returns undefined) and is named in `real`.
 */
export function standInRunner(answer: Answer, real: string[] = ['git', 'plutil', 'unzip', 'zip']) {
  const calls: Call[] = [];
  const run: Run = async (command, options = {}) => {
    calls.push({ command, options });
    const answered = await answer(command, options);
    if (answered) {
      if (answered.out) options.output?.(answered.out);
      return answered;
    }
    if (real.includes(command[0])) return runCommand(command, options);
    return { code: 127, out: `no stand-in for ${command.join(' ')}`, timedOut: false };
  };
  return { run, calls, named: (program: string) => calls.filter((c) => runs(c.command, program)) };
}

/**
 * Whether a command holds `program`'s words as whole arguments in a row, such as `op item get` or `testflight upload`.
 * Matching on the joined text took any path with the letters in it for the program: a checkout under `saved-copies`
 * read as a call to `op`.
 */
function runs(command: string[], program: string): boolean {
  const words = program.split(' ');
  return command.some((_, start) => words.every((word, i) => command[start + i] === word));
}

export const ok = (out = ''): RunResult => ({ code: 0, out, timedOut: false });
export const exit = (code: number, out: string): RunResult => ({ code, out, timedOut: false });
