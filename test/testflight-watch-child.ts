// The watcher as a process of its own, for the test that stops it as launchd does:
//   bun test/testflight-watch-child.ts <origin> <state folder> <marker>
// App Store Connect is a stand-in of its own, holding no build, so the app goes up; its upload hangs, printing a line
// with the marker, which also names the hanging process. Never itself a test.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand } from '../command-line/run.ts';
import { watch } from '../tauri/testflight/watch.ts';
import { appStoreConnect, ITEM_JSON, ok, standInRunner, TOKEN } from './testflight-stand-in.ts';

const [origin, state, marker] = process.argv.slice(2);
const asc = await appStoreConnect({ bundleId: 'app.pastthebreak' });
const stand = standInRunner((command, options) => {
  const line = command.join(' ');
  if (line === 'bun install --frozen-lockfile') {
    mkdirSync(join(options.cwd!, 'node_modules/app-kit/tauri/testflight'), { recursive: true });
    writeFileSync(join(options.cwd!, 'node_modules/app-kit/tauri/testflight/upload.ts'), '');
    return ok('installed\n');
  }
  if (command[0] === '/usr/bin/security') return ok(`${TOKEN}\n`);
  if (command[0] === 'op') return ok(ITEM_JSON);
  if (line.includes('testflight upload')) {
    return runCommand(['sh', '-c', `echo "[stand-in] hanging ${marker}"; while :; do sleep 1; done # ${marker}`], {
      ...options,
      output: (chunk) => {
        process.stdout.write(chunk);
        return options.output?.(chunk);
      },
    });
  }
  return undefined;
});
await watch({ urls: [`file://${origin}`], run: stand.run, env: { PATH: process.env.PATH, HOME: state, XDG_STATE_HOME: state }, appStoreConnect: asc.options });
