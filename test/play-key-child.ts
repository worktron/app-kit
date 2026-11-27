// The key maker as a process of its own, for the test that stops it mid-keytool as Ctrl-C or a supervisor would:
//   bun test/play-key-child.ts <app checkout> <marker>
// 1Password holds no key yet, so the maker runs keytool, which writes where the keystore went to <marker>, sends the
// maker SIGTERM and never ends. It is never itself a test.
import { writeFileSync } from 'node:fs';
import { makeUploadKey } from '../tauri/play/key.ts';

const [checkout, marker] = process.argv.slice(2);
if (!checkout || !marker) throw new Error('usage: <app checkout> <marker>');
const code = await makeUploadKey({
  cwd: checkout,
  env: { PATH: process.env.PATH },
  run: async (command) => {
    if (command[0] === 'op') return { code: 1, out: '[ERROR] "Fixture Play upload key" isn\'t an item in the "Agents" vault', stdout: '', stderr: '', timedOut: false };
    const keystore = command[command.indexOf('-keystore') + 1]!;
    writeFileSync(keystore, 'a keystore');
    writeFileSync(marker, keystore);
    process.kill(process.pid, 'SIGTERM');
    return await new Promise(() => {});
  },
});
process.exit(code);
