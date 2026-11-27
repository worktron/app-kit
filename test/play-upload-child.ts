// The upload as a process of its own, for the test that stops it mid-build as Ctrl-C or a supervisor would:
//   bun test/play-upload-child.ts <app checkout> <marker>
// Google answers that it does not know the app, so the upload builds build 1; the build writes where the key went to
// <marker>, sends the upload SIGTERM and never ends. It is never itself a test.
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KEYSTORE_PROPERTIES, playUpload } from '../tauri/play/upload.ts';

const [checkout, marker] = process.argv.slice(2);
if (!checkout || !marker) throw new Error('usage: <app checkout> <marker>');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const code = await playUpload({
  cwd: checkout,
  env: { ANDROID_HOME: '/sdk', NDK_HOME: '/sdk/ndk', JAVA_HOME: '/java', PATH: process.env.PATH },
  run: async () => {
    const properties = join(checkout, KEYSTORE_PROPERTIES);
    writeFileSync(marker, `${properties}\n${readFileSync(properties, 'utf8')}`);
    process.kill(process.pid, 'SIGTERM');
    return await new Promise(() => {});
  },
  serviceAccount: async () => ({ client_email: 'uploader@example.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), token_uri: 'http://play.example.com/token' }),
  uploadKey: async () => ({ keystore: Buffer.from('a keystore').toString('base64'), password: 'stand-in password', alias: 'upload' }),
  play: {
    playUrl: 'http://play.example.com',
    fetch: (async (url: string) =>
      String(url).endsWith('/token') ? json(200, { access_token: 'token' }) : json(404, { error: { code: 404, message: 'Package not found: com.example.fixture.', errors: [{ reason: 'applicationNotFound' }] } })) as unknown as typeof fetch,
  },
  stateEnv: { XDG_STATE_HOME: join(checkout, 'state') },
});
process.exit(code);
