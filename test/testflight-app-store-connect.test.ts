// The TestFlight part's pieces under the upload and the watcher: App Store Connect's token and calls against a
// stand-in that checks the token's signature, and the key read from 1Password. The runner they use is tested with the rest of command-line.
import { afterEach, expect, test } from 'bun:test';
import { AppStoreConnect, appStoreConnectToken, TOKEN_LIFE_SECONDS } from '../tauri/testflight/app-store-connect.ts';
import { keyFromItem, readKey } from '../tauri/testflight/key.ts';
import { appStoreConnect, exit, ITEM_JSON, KEY, ok, standInRunner, TOKEN, tokenProblem } from './testflight-stand-in.ts';

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

test('every build is read across pages with the day Apple expires it, and one build comes with its TestFlight state', async () => {
  const asc = await appStoreConnect({
    bundleId: 'app.pastthebreak',
    pageSize: 2,
    builds: ['98', '99', '100', '101', '7'].map((number) => ({ number, states: ['VALID'], ...(number === '101' ? { expires: '2026-12-01T10:00:00.000+0000' } : {}) })),
  });
  stops.push(asc.stop);
  const client = new AppStoreConnect(KEY, asc.options);
  expect(await client.appId('app.other')).toBeNull();
  const appId = await client.appId('app.pastthebreak');
  expect(appId).toBe('1000000001');
  const numbers = (await client.builds(appId!)).map((b) => b.number);
  expect(numbers.sort()).toEqual(['100', '101', '7', '98', '99']);
  // The stand-in answers only the fields asked for, as Apple does, so the expiry is there only because it was asked.
  const expiring = (await client.builds(appId!)).filter((b) => b.expires);
  expect(expiring).toEqual([{ number: '101', processingState: 'VALID', internalState: null, expires: '2026-12-01T10:00:00.000+0000' }]);
  expect(await client.build(appId!, '100')).toEqual({ number: '100', processingState: 'VALID', internalState: 'IN_BETA_TESTING', expires: null });
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
