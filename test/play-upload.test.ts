// `app-kit play upload` against a stand-in for Google's token service and Play Developer API, which checks each
// request's signed token with the service account's public key and keeps the calls in order; the Android build is a
// stand-in that writes the bundle where Tauri's does, and records the build number and the signing file it saw.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { generateKeyPairSync, verify } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runCommand, type Run } from '../command-line/run.ts';
import { BUNDLE, firstUploadSteps, KEYSTORE_PROPERTIES, playUpload } from '../tauri/play/upload.ts';
import { serviceAccountFromItem, uploadKeyFromItem, uploadKeyTemplate } from '../tauri/play/key.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ACCOUNT = { client_email: 'uploader@example.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
const KEY = { keystore: Buffer.from('a keystore').toString('base64'), password: 'stand-in password', alias: 'upload' };
const PACKAGE = 'com.example.fixture';

/** What the stand-in Google holds and answers, set by each test. */
type Google = { known: boolean; draft: boolean; bundles: number[]; apks: number[]; takenOnce: number | null; calls: string[]; tracks: unknown[] };
let google: Google;
let server: Server;
let origin = '';

type Answer = { status: number; body: unknown };
const answer = (status: number, body: unknown): Answer => ({ status, body });
const refusal = (status: number, message: string, reason = '') => answer(status, { error: { code: status, message, errors: [{ reason }] } });

/** Google's answer to one request; a node:http server, since the unit tests' simulated page replaces the global Response. */
function respond(method: string, url: URL, authorization: string, text: string): Answer {
  if (url.pathname === '/token') {
    const assertion = new URLSearchParams(text).get('assertion') ?? '';
    const [head, body, signature] = assertion.split('.');
    const good = verify('sha256', Buffer.from(`${head}.${body}`), publicKey, Buffer.from(signature ?? '', 'base64url'));
    const claims = JSON.parse(Buffer.from(body ?? '', 'base64url').toString() || '{}') as { iss?: string; scope?: string };
    if (!good || claims.iss !== ACCOUNT.client_email || claims.scope !== 'https://www.googleapis.com/auth/androidpublisher') return answer(400, { error: 'invalid_grant' });
    return answer(200, { access_token: 'stand-in-access', expires_in: 3600 });
  }
  if (authorization !== 'Bearer stand-in-access') return refusal(401, 'no token');
  const path = url.pathname.replace(/^\/(upload\/)?androidpublisher\/v3\/applications\/[^/]+/, '');
  google.calls.push(`${method} ${path}`);
  if (!google.known) return refusal(404, 'Package not found: com.example.fixture.');
  if (method === 'POST' && path === '/edits') return answer(200, { id: `edit-${google.calls.length}` });
  if (method === 'DELETE') return answer(204, null);
  if (path.endsWith('/bundles') && method === 'GET') return answer(200, { bundles: google.bundles.map((versionCode) => ({ versionCode })) });
  if (path.endsWith('/apks')) return answer(200, { apks: google.apks.map((versionCode) => ({ versionCode })) });
  if (path.endsWith('/bundles') && method === 'POST') {
    const number = Number(text);
    google.bundles.push(number);
    if (google.takenOnce === number) {
      google.takenOnce = null;
      return refusal(403, 'APK specifies a version code that has already been used.', 'apkUpgradeVersionConflict');
    }
    return answer(200, { versionCode: number });
  }
  if (path.includes('/tracks/')) {
    const body = JSON.parse(text) as { releases: { status: string }[] };
    if (google.draft && body.releases[0]?.status !== 'draft') return refusal(400, 'Only releases with status draft may be created on draft app.');
    google.tracks.push(body);
    return answer(200, body);
  }
  if (path.endsWith(':commit')) return answer(200, {});
  return refusal(404, `no ${method} ${path}`);
}

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const { status, body } = respond(request.method ?? 'GET', new URL(request.url ?? '/', origin), request.headers.authorization ?? '', Buffer.concat(chunks).toString());
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(body === null ? '' : JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

let checkout = '';
/** A Tauri app's checkout with an Android project whose release build signs from keystore.properties. */
function app() {
  checkout = mkdtempSync(join(tmpdir(), 'play-'));
  mkdirSync(join(checkout, 'src-tauri/gen/android/app'), { recursive: true });
  writeFileSync(join(checkout, 'src-tauri/tauri.conf.json'), JSON.stringify({ productName: 'Fixture', identifier: PACKAGE }));
  writeFileSync(
    join(checkout, 'src-tauri/gen/android/app/build.gradle.kts'),
    'val keystorePropertiesFile = rootProject.file("keystore.properties")\nandroid { buildTypes { getByName("release") { signingConfig = signingConfigs.getByName("release") } } }\n',
  );
  const built: { versionCode: number; signedWith: string }[] = [];
  const run: Run = async (command, options) => {
    const config = JSON.parse(command[command.indexOf('--config') + 1] ?? '{}') as { bundle: { android: { versionCode: number } } };
    const versionCode = config.bundle.android.versionCode;
    const properties = readFileSync(join(checkout, KEYSTORE_PROPERTIES), 'utf8');
    const store = /storeFile=(.*)/.exec(properties)![1]!;
    built.push({ versionCode, signedWith: `${properties.includes(`password=${KEY.password}`)} ${readFileSync(store, 'utf8')}` });
    expect(options?.env?.OP_SERVICE_ACCOUNT_TOKEN).toBeUndefined();
    mkdirSync(dirname(join(checkout, BUNDLE)), { recursive: true });
    writeFileSync(join(checkout, BUNDLE), String(versionCode));
    return { code: 0, out: '', stdout: '', stderr: '', timedOut: false };
  };
  const printed: string[] = [];
  const upload = () =>
    playUpload({
      cwd: checkout,
      env: { ANDROID_HOME: '/sdk', NDK_HOME: '/sdk/ndk', JAVA_HOME: '/java', PATH: process.env.PATH, OP_SERVICE_ACCOUNT_TOKEN: 'kept from the build' },
      run,
      print: (line) => printed.push(line),
      serviceAccount: async () => ({ ...ACCOUNT, token_uri: `${origin}/token` }),
      uploadKey: async () => KEY,
      play: { playUrl: origin, fetch: Bun.fetch as typeof fetch },
      stateEnv: { XDG_STATE_HOME: join(checkout, 'state') },
    });
  return { built, printed, upload };
}

test('builds one past every build Google holds, bundles and APKs alike, uploads it, releases it to internal testing and commits', async () => {
  google = { known: true, draft: false, bundles: [3, 9], apks: [12], takenOnce: null, calls: [], tracks: [] };
  const { built, printed, upload } = app();
  expect(await upload()).toBe(0);
  expect(built).toEqual([{ versionCode: 13, signedWith: 'true a keystore' }]);
  expect(google.calls).toEqual(['POST /edits', 'GET /edits/edit-1/bundles', 'GET /edits/edit-1/apks', 'DELETE /edits/edit-1', 'POST /edits', 'POST /edits/edit-5/bundles', 'PUT /edits/edit-5/tracks/internal', 'POST /edits/edit-5:commit']);
  expect(google.tracks).toEqual([{ track: 'internal', releases: [{ versionCodes: ['13'], status: 'completed' }] }]);
  expect(printed.at(-1)).toBe('[play] build 13 of Fixture is on internal testing');
  // The signing file and the keystore are gone once the build is done.
  expect(existsSync(join(checkout, KEYSTORE_PROPERTIES))).toBe(false);
});

test('a build number another upload took meanwhile is read again and the app built once more', async () => {
  google = { known: true, draft: false, bundles: [4], apks: [], takenOnce: 5, calls: [], tracks: [] };
  const { built, printed, upload } = app();
  expect(await upload()).toBe(0);
  expect(built.map((build) => build.versionCode)).toEqual([5, 6]);
  expect(printed).toContain('[play] Google already holds build 5, which another upload took meanwhile; building 6 instead');
  expect(google.tracks).toEqual([{ track: 'internal', releases: [{ versionCodes: ['6'], status: 'completed' }] }]);
});

test('an app still a draft in Play Console gets its build as a draft release, and is told it is not with testers yet', async () => {
  google = { known: true, draft: true, bundles: [1], apks: [], takenOnce: null, calls: [], tracks: [] };
  const { printed, upload } = app();
  expect(await upload()).toBe(0);
  expect(google.tracks).toEqual([{ track: 'internal', releases: [{ versionCodes: ['2'], status: 'draft' }] }]);
  expect(printed.some((line) => line.includes('is still a draft in Play Console'))).toBe(true);
  expect(printed.at(-1)).toBe('[play] build 2 of Fixture is a draft release on internal testing, which testers get once it is rolled out in Play Console');
});

test("an app Google does not know yet is built and signed as build 1 and its first upload's steps printed, with nothing sent", async () => {
  google = { known: false, draft: false, bundles: [], apks: [], takenOnce: null, calls: [], tracks: [] };
  const { built, printed, upload } = app();
  expect(await upload()).toBe(0);
  expect(built.map((build) => build.versionCode)).toEqual([1]);
  expect(google.calls).toEqual(['POST /edits']);
  expect(printed.at(-1)).toBe(firstUploadSteps('Fixture', PACKAGE, join(checkout, BUNDLE)));
  expect(readFileSync(join(checkout, BUNDLE), 'utf8')).toBe('1');
});

test('stops before building when the Android tools, the signing block or 1Password are not there', async () => {
  google = { known: true, draft: false, bundles: [], apks: [], takenOnce: null, calls: [], tracks: [] };
  const { built, printed } = app();
  const base = { cwd: checkout, print: (line: string) => printed.push(line), run: async () => ({ code: 1, out: '', stdout: '', stderr: '', timedOut: false }) };
  expect(await playUpload({ ...base, env: {} })).toBe(3);
  expect(printed.at(-1)).toContain('this shell has no ANDROID_HOME, NDK_HOME, JAVA_HOME');
  writeFileSync(join(checkout, 'src-tauri/gen/android/app/build.gradle.kts'), 'android {}\n');
  expect(await playUpload({ ...base, env: { ANDROID_HOME: 'a', NDK_HOME: 'b', JAVA_HOME: 'c' } })).toBe(3);
  expect(printed.at(-1)).toContain('does not sign its release build from keystore.properties');
  expect(built).toEqual([]);
  expect(google.calls).toEqual([]);
});

test("reads the service account's JSON key and the upload key from their 1Password items, and writes the upload key's", () => {
  const item = (fields: Record<string, string>) => JSON.stringify({ fields: Object.entries(fields).map(([label, value]) => ({ label, value })) });
  expect(serviceAccountFromItem(item({ 'json key': JSON.stringify({ ...ACCOUNT, type: 'service_account' }) }))).toEqual({ ...ACCOUNT, token_uri: undefined });
  expect(serviceAccountFromItem(item({ 'json key': 'not json' }))).toContain('has no "json key" holding');
  const template = JSON.parse(uploadKeyTemplate('Fixture Google Play upload key', KEY)) as { fields: { label: string; value: string }[] };
  expect(uploadKeyFromItem(JSON.stringify(template), 'Fixture Google Play upload key')).toEqual(KEY);
  expect(uploadKeyFromItem(item({ keystore: 'x' }), 'k')).toBe('the 1Password item "k" in the vault "TestFlight" has no "password", "alias"');
});

test('an upload stopped by a signal mid-build stops and removes the upload key and its password before exiting', async () => {
  app();
  const marker = join(checkout, 'marker');
  const stopped = await runCommand(['bun', join(import.meta.dir, 'play-upload-child.ts'), checkout, marker]);
  expect(stopped.code).toBe(1);
  expect(stopped.out).toContain('[play] stopped by SIGTERM; stopping the build and removing the upload key');
  const [properties, ...written] = readFileSync(marker, 'utf8').split('\n');
  const store = /storeFile=(.*)/.exec(written.join('\n'))![1]!;
  expect(properties).toBe(join(checkout, KEYSTORE_PROPERTIES));
  expect(existsSync(properties!)).toBe(false);
  expect(existsSync(dirname(store))).toBe(false);
});
