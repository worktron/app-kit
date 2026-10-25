// The TestFlight part's pieces under the upload and the watcher: App Store Connect's token and calls against a
// stand-in that checks the token's signature, the key read from 1Password, and the runner's time limit.
import { afterEach, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppStoreConnect, appStoreConnectToken, TOKEN_LIFE_SECONDS } from '../tauri/testflight/app-store-connect.ts';
import { keyFromItem, readKey } from '../tauri/testflight/key.ts';
import { runCommand } from '../tauri/testflight/run.ts';
import { appStoreConnect, exit, ITEM_JSON, KEY, ok, scratch, standInRunner, TOKEN, tokenProblem } from './testflight-stand-in.ts';

const NOW = Date.UTC(2026, 9, 25, 12);
const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

test("App Store Connect's token names the key and issuer and its audience, lives under twenty minutes, and verifies with the key", () => {
  const token = appStoreConnectToken(KEY, NOW);
  expect(tokenProblem(`Bearer ${token}`)).toBeNull();
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  expect(claims).toEqual({ iss: KEY.issuerId, iat: NOW / 1000, exp: NOW / 1000 + TOKEN_LIFE_SECONDS, aud: 'appstoreconnect-v1' });
  expect(TOKEN_LIFE_SECONDS).toBeLessThan(20 * 60);
  expect(tokenProblem(`Bearer ${token.slice(0, -4)}AAAA`)).toBe('the signature does not verify');
});

test('every build is read across pages, and one build comes with its TestFlight state', async () => {
  const asc = await appStoreConnect({
    bundleId: 'app.pastthebreak',
    pageSize: 2,
    builds: ['98', '99', '100', '101', '7'].map((number) => ({ number, states: ['VALID'] })),
  });
  stops.push(asc.stop);
  const client = new AppStoreConnect(KEY, asc.options);
  expect(await client.appId('app.other')).toBeNull();
  const appId = await client.appId('app.pastthebreak');
  expect(appId).toBe('1000000001');
  const numbers = (await client.builds(appId!)).map((b) => b.number);
  expect(numbers.sort()).toEqual(['100', '101', '7', '98', '99']);
  expect(await client.build(appId!, '100')).toEqual({ number: '100', processingState: 'VALID', internalState: 'IN_BETA_TESTING' });
  expect(await client.build(appId!, '102')).toBeNull();
});

test("a refusal names App Store Connect's own reason", async () => {
  const asc = await appStoreConnect({ bundleId: 'app.pastthebreak' });
  stops.push(asc.stop);
  const client = new AppStoreConnect({ ...KEY, keyId: 'OTHERKEY01' }, asc.options);
  await expect(client.appId('app.pastthebreak')).rejects.toThrow(/App Store Connect answered 401 to \/v1\/apps: Authentication credentials are missing or invalid.: header/);
});

test("the key is read from 1Password's item by its fields' labels, and a missing field is named", () => {
  expect(keyFromItem(ITEM_JSON)).toEqual(KEY);
  const withoutIssuer = JSON.stringify({ fields: [{ label: 'key id', value: 'K' }, { label: 'private key', value: 'P' }] });
  expect(keyFromItem(withoutIssuer)).toBe('the 1Password item "App Store Connect API" in the vault "TestFlight" has no "issuer id"');
});

test("the token reaches only op's environment, and op's refusal is one line", async () => {
  const stand = standInRunner((command) => {
    if (command[0] === '/usr/bin/security') return ok(`${TOKEN}\n`);
    if (command[0] === 'op') return exit(1, '[ERROR] 2026/10/25 12:00:00 "TestFlight" isn\'t a vault in this account.\n');
    return undefined;
  });
  const result = await readKey(stand.run, { PATH: '/usr/bin' }, { tokenOnly: true });
  expect(result).toEqual({ error: `op could not read "App Store Connect API" in the vault "TestFlight": [ERROR] 2026/10/25 12:00:00 "TestFlight" isn't a vault in this account.` });
  expect(stand.calls[0].command).toEqual(['/usr/bin/security', 'find-generic-password', '-s', 'app-kit testflight', '-w']);
  expect(stand.calls[0].options.env).toBeUndefined();
  expect(stand.calls[1].options.env).toEqual({ PATH: '/usr/bin', OP_SERVICE_ACCOUNT_TOKEN: TOKEN });
});

test('a program past its time limit is stopped with everything it started, and one that ends takes its leftovers with it', async () => {
  const place = scratch('testflight-run-');
  try {
    const marker = join(place.folder, 'outlived');
    const stopped = await runCommand(['sh', '-c', `echo started; (sleep 2; touch ${marker}) & sleep 600`], { timeoutMs: 200 });
    expect(stopped).toEqual({ code: -1, out: 'started\n', timedOut: true });
    const ended = await runCommand(['sh', '-c', `(sleep 2; touch ${marker}) & echo done`]);
    expect(ended).toEqual({ code: 0, out: 'done\n', timedOut: false });
    // Neither group's sleeper is left to touch the marker.
    expect(Bun.spawnSync(['pgrep', '-f', `touch ${marker}`]).stdout.toString()).toBe('');
    expect(existsSync(marker)).toBe(false);
  } finally {
    place.done();
  }
});

test('a program in a stopped group that ignores the polite signal is forced to stop after the grace period', async () => {
  const marker = `ignores-term-${process.pid}-${Date.now()}`;
  // The first program ends on the polite signal; the one it started ignores it and holds the output open.
  const stopped = await runCommand(['sh', '-c', `(trap '' TERM; while :; do sleep 1; : ${marker}; done) & echo started; sleep 600`], {
    output: (chunk) => (chunk.includes('started') ? 0 : undefined),
  });
  expect(stopped).toMatchObject({ code: -1, timedOut: true });
  expect(Bun.spawnSync(['pgrep', '-f', marker]).stdout.toString()).toBe('');
}, 15_000);

test('a time limit can be replaced as the output comes', async () => {
  const result = await runCommand(['sh', '-c', 'echo building; sleep 0.5; echo uploading; sleep 600'], {
    timeoutMs: 600_000,
    output: (chunk) => (chunk.includes('uploading') ? 100 : undefined),
  });
  expect(result).toMatchObject({ code: -1, timedOut: true });
  expect(result.out).toBe('building\nuploading\n');
});
