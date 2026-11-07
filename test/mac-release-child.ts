// The release as a process of its own, for the tests that stop it with a signal:
//   bun test/mac-release-child.ts <app folder>             prints the folder its files go up from, then waits at gh's upload
//   bun test/mac-release-child.ts <app folder> notarize    prints the folder of the App Store Connect key's file, then
//                                                          waits in Tauri's build, as it waits on Apple's notarizing
// and waits until it is stopped. It is never itself a test.
import { dirname } from 'node:path';
import { DEVELOPER_ID_IDENTITIES, macRunner } from './mac-release-stand-in.ts';
import { release } from '../tauri/mac-release/release.ts';

const [app, mode] = process.argv.slice(2);
if (!app) throw new Error('usage: <app folder> [notarize]');
const hold = () => new Promise<never>(() => {});
const stand = macRunner(
  app,
  mode === 'notarize'
    ? {
        identities: DEVELOPER_ID_IDENTITIES,
        build: (_command, options) => {
          console.log(dirname(options.env!.APPLE_API_KEY_PATH!));
          return hold();
        },
      }
    : {
        publish: (command) => {
          const asset = command[command.length - 1]!;
          console.log(asset.slice(0, asset.lastIndexOf('/')));
          return hold();
        },
      },
);
const code = await release({ cwd: app, run: stand.run, env: { PATH: '/usr/bin:/bin' }, arch: 'arm64', print: () => {}, output: () => {} });
process.exit(code);
