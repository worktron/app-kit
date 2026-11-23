// The native upload as a process of its own, for the test that stops it as the watcher's time limit does:
//   bun test/testflight-native-child.ts <app checkout> <home> <marker>
// It hangs in the archive, printing a line with the marker, and is never itself a test.
import { tv } from './testflight-native-stand-in.ts';
import { appStoreConnect } from './testflight-stand-in.ts';
import { upload } from '../tauri/testflight/upload.ts';
import { TV_BUNDLE_ID } from './testflight-native-stand-in.ts';

const [app, home, marker] = process.argv.slice(2);
if (!app || !home || !marker) throw new Error('usage: <app> <home> <marker>');
// App Store Connect of its own: the stand-in key is made in each process, so the test's would refuse this one's tokens.
const asc = await appStoreConnect({ bundleId: TV_BUNDLE_ID });
const code = await upload({
  cwd: app,
  tokenOnly: false,
  run: tv(app, [], { hangArchive: marker }).run,
  env: { PATH: '/usr/bin:/bin', HOME: home },
  home,
  appStoreConnect: asc.options,
});
process.exit(code);
