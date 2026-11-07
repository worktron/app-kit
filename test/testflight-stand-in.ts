// What the TestFlight tests share: a team key, a stand-in for App Store Connect that refuses any request whose token
// does not verify with that key, git repositories made in a folder of their own and reached over file://, and a
// runner that passes some programs to the real one and answers for the rest.
import { generateKeyPairSync, verify } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TestFlightKey } from '../tauri/testflight/app-store-connect.ts';
import { runCommand, type Run, type RunOptions, type RunResult } from '../command-line/run.ts';

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
/** The distribution certificate's .p12 as 1Password holds it, in base64; the stand-in openssl reads SERIAL from it. */
export const CERTIFICATE = { p12: Buffer.from('a stand-in p12').toString('base64'), password: 'stand-in-password' };
/** Its serial as openssl prints it, with a leading zero Apple's record leaves out. */
export const SERIAL = '0ABC123';
/** 1Password's answer for the certificate item, cut to what is read. */
export const CERTIFICATE_JSON = JSON.stringify({
  title: 'TestFlight distribution certificate',
  vault: { name: 'TestFlight' },
  fields: [
    { label: 'certificate', value: CERTIFICATE.p12 },
    { label: 'password', value: CERTIFICATE.password },
  ],
});
/** The team's distribution certificate as Apple records it. */
export type StandInCertificate = { id: string; serialNumber: string; expirationDate: string };
export const CERTIFICATE_RECORD: StandInCertificate = { id: 'CERT000001', serialNumber: 'ABC123', expirationDate: '2099-01-01T00:00:00.000+00:00' };
/** An App Store profile Apple holds for the app. */
export type StandInProfile = { id: string; uuid: string; content: string; type: string; state: string; certificates: string[]; bundle?: string };
export const profileContent = (uuid: string) => Buffer.from(`a stand-in profile ${uuid}`).toString('base64');

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
  /** Its expirationDate, the day Apple expires it. */
  expires?: string;
};

/**
 * App Store Connect, for one app, whose builds list comes back in the order of their numbers read as text, as Apple's
 * need not be by number, and with only the attributes `fields[builds]` names, as Apple's sparse fieldsets do. A
 * node:http server, since the unit tests' simulated page replaces the global Response; the client is handed Bun's own
 * fetch for the same reason (`options` below).
 */
export async function appStoreConnect(config: {
  bundleId: string;
  appId?: string;
  builds?: StandInBuild[];
  pageSize?: number;
  certificates?: StandInCertificate[];
  profiles?: StandInProfile[];
  /** Whether Apple refuses the key making a profile, as it refuses a role that may not. */
  refuseProfiles?: boolean;
}) {
  const appId = config.appId ?? '1000000001';
  const bundleResource = 'BUNDLE0001';
  const builds: StandInBuild[] = config.builds ?? [];
  const certificates = config.certificates ?? [CERTIFICATE_RECORD];
  const profiles: StandInProfile[] = config.profiles ?? [{ id: 'PROFILE001', uuid: 'uuid-0001', content: profileContent('uuid-0001'), type: 'IOS_APP_STORE', state: 'ACTIVE', certificates: [CERTIFICATE_RECORD.id] }];
  const requests: string[] = [];
  const profileResource = (p: StandInProfile) => ({
    type: 'profiles',
    id: p.id,
    attributes: { profileType: p.type, profileState: p.state, uuid: p.uuid, profileContent: p.content },
    relationships: { bundleId: { data: { type: 'bundleIds', id: p.bundle ?? bundleResource } }, certificates: { data: p.certificates.map((id) => ({ type: 'certificates', id })) } },
  });
  const answer = (method: string, url: URL, authorization: string | null, body: string): [number, unknown] => {
    requests.push(`${method === 'GET' ? '' : `${method} `}${url.pathname}${url.search}`);
    const problem = tokenProblem(authorization);
    if (problem) return [401, { errors: [{ status: '401', title: 'Authentication credentials are missing or invalid.', detail: problem }] }];
    const q = (name: string) => url.searchParams.get(name);
    if (url.pathname === '/v1/certificates' && q('filter[certificateType]') === 'DISTRIBUTION') {
      return [200, { data: certificates.map((c) => ({ type: 'certificates', id: c.id, attributes: { serialNumber: c.serialNumber, expirationDate: c.expirationDate } })) }];
    }
    if (url.pathname === '/v1/bundleIds') {
      const identifier = q('filter[identifier]');
      // Apple's filter matches part of an identifier, so an app's id with a suffix comes back too.
      const all = [config.bundleId, `${config.bundleId}.widget`].map((id, at) => ({ type: 'bundleIds', id: at ? 'BUNDLE0002' : bundleResource, attributes: { identifier: id } }));
      return [200, { data: all.filter((b) => identifier && b.attributes.identifier.includes(identifier)) }];
    }
    if (url.pathname === '/v1/profiles' && method === 'GET') {
      // Apple's filters, and the links the upload matches on; Apple refuses `include` on a bundle id's own list.
      const listed = profiles.filter((p) => (!q('filter[profileType]') || p.type === q('filter[profileType]')) && (!q('filter[profileState]') || p.state === q('filter[profileState]')));
      if (q('include') !== 'bundleId,certificates') return [400, { errors: [{ status: '400', title: 'include must name bundleId and certificates' }] }];
      // One profile a page when the test asks, so a match on a later page is reached through links.next.
      const size = config.pageSize ?? listed.length;
      const from = Number(q('cursor') ?? 0);
      const next = from + size < listed.length ? new URL(`${url.pathname}${url.search.replace(/&cursor=\d+/, '')}&cursor=${from + size}`, url).href : undefined;
      return [200, { data: listed.slice(from, from + size).map(profileResource), links: { next } }];
    }
    if (method === 'POST' && url.pathname === '/v1/profiles') {
      if (config.refuseProfiles) return [403, { errors: [{ status: '403', title: 'The API key in use does not allow this request', detail: 'FORBIDDEN_ERROR' }] }];
      const made = JSON.parse(body) as { data: { relationships: { bundleId: { data: { id: string } }; certificates: { data: { id: string }[] } } } };
      if (made.data.relationships.bundleId.data.id !== bundleResource) return [409, { errors: [{ status: '409', title: 'wrong bundle id' }] }];
      const uuid = `uuid-${String(profiles.length + 1).padStart(4, '0')}`;
      const profile = { id: `PROFILE${profiles.length + 1}`, uuid, content: profileContent(uuid), type: 'IOS_APP_STORE', state: 'ACTIVE', certificates: made.data.relationships.certificates.data.map((c) => c.id) };
      profiles.push(profile);
      return [201, { data: profileResource(profile) }];
    }
    if (url.pathname === '/v1/apps') {
      return [200, { data: q('filter[bundleId]') === config.bundleId ? [{ type: 'apps', id: appId, attributes: { bundleId: config.bundleId } }] : [] }];
    }
    if (url.pathname === '/v1/builds' && q('filter[app]') === appId) {
      const fields = q('fields[builds]')?.split(',');
      const resource = (b: StandInBuild, state: string) => {
        const all: Record<string, unknown> = { version: b.number, processingState: state, ...(b.expires ? { expirationDate: b.expires } : {}) };
        return {
          type: 'builds',
          id: `build-${b.number}`,
          attributes: fields ? Object.fromEntries(Object.entries(all).filter(([name]) => fields.includes(name))) : all,
          relationships: { buildBetaDetail: { data: { type: 'buildBetaDetails', id: `detail-${b.number}` } } },
        };
      };
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
    let received = '';
    request.on('data', (chunk: Buffer) => (received += chunk.toString()));
    request.on('end', () => {
      const [status, body] = answer(request.method ?? 'GET', new URL(request.url ?? '/', baseUrl), request.headers.authorization ?? null, received);
      response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    baseUrl,
    builds,
    profiles,
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

/**
 * The identity a program under test commits and writes refs as. Given an empty home folder with none, git makes one up
 * from the machine's network name, and that lookup through mDNS waited out 5 seconds on a busy Mac on every clone,
 * checkout and fetch (a stack sample of each sat in getaddrinfo below files_log_ref_write).
 */
export const GIT_IDENTITY_ENV = { GIT_AUTHOR_NAME: 'app', GIT_AUTHOR_EMAIL: 'app@example.com', GIT_COMMITTER_NAME: 'app', GIT_COMMITTER_EMAIL: 'app@example.com' };

/**
 * `path` with git itself first, found as Homebrew finds it (Xcode's developer folder, then its usr/bin/git), so a
 * program under test never runs Xcode's /usr/bin/git. That shim writes an entry in Xcode's cache for each new home
 * folder, after its license check, and concurrent calls overwrite each other's entries, so a test with a home folder of
 * its own started xcodebuild. Off macOS, or with no developer folder, `path` as it is.
 */
export function pathWithGitItself(path = process.env.PATH ?? ''): string {
  return gitItselfFolder() ? `${gitItselfFolder()}:${path}` : path;
}

let gitItself: string | null | undefined;
function gitItselfFolder(): string | null {
  if (gitItself !== undefined) return gitItself;
  gitItself = null;
  if (process.platform !== 'darwin') return gitItself;
  const found = Bun.spawnSync(['xcode-select', '-p'], { stdout: 'pipe', stderr: 'ignore' });
  const folder = join(found.stdout.toString().trim(), 'usr/bin');
  if (found.exitCode === 0 && existsSync(join(folder, 'git'))) gitItself = folder;
  return gitItself;
}

/** Runs git in `cwd` and gives its output, throwing on failure. */
export function git(cwd: string, ...args: string[]): string {
  const done = Bun.spawnSync(['git', ...GIT_IDENTITY, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (done.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${done.stderr.toString()}`);
  return done.stdout.toString().trim();
}

/** A repository whose main starts with `files`. */
export function repository(folder: string, files: Record<string, string | Uint8Array>): string {
  mkdirSync(folder, { recursive: true });
  git(folder, 'init', '-q');
  commit(folder, files, 'the app');
  return folder;
}

/** Writes `files` and commits them on the branch checked out; gives the commit. */
export function commit(folder: string, files: Record<string, string | Uint8Array>, message = 'a change'): string {
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
      if (answered.stdout) options.output?.(answered.stdout, 'stdout');
      if (answered.stderr) options.output?.(answered.stderr, 'stderr');
      return answered;
    }
    if (real.includes(command[0])) return runCommand(command, options);
    const said = `no stand-in for ${command.join(' ')}`;
    return { code: 127, out: said, stdout: '', stderr: said, timedOut: false };
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

export const ok = (out = ''): RunResult => ({ code: 0, out, stdout: out, stderr: '', timedOut: false });
export const exit = (code: number, out: string): RunResult => ({ code, out, stdout: '', stderr: out, timedOut: false });
