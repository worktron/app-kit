// The release as a process of its own, for the test that stops it with a signal while it publishes:
//   bun test/mac-release-child.ts <app folder>
// It prints the folder its files go up from, then waits at gh's upload until it is stopped. It is never itself a test.
import { macRunner } from './mac-release-stand-in.ts';
import { release } from '../tauri/mac-release/release.ts';

const [app] = process.argv.slice(2);
if (!app) throw new Error('usage: <app folder>');
const stand = macRunner(app, {
  publish: (command) => {
    const asset = command[command.length - 1]!;
    console.log(asset.slice(0, asset.lastIndexOf('/')));
    return new Promise(() => {});
  },
});
const code = await release({ cwd: app, run: stand.run, env: { PATH: '/usr/bin:/bin' }, arch: 'arm64', print: () => {}, output: () => {} });
process.exit(code);
