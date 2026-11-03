// The upload as a process of its own, for the test that stops it as the watcher's time limit does:
//   bun test/testflight-upload-child.ts <app checkout> <cargo folder> <build|altool> <marker>
// It hangs at the build or at altool, printing a line with the marker, and is never itself a test.
import { dirname } from 'node:path';
import { apple } from './testflight-apple-stand-in.ts';
import { appStoreConnect } from './testflight-stand-in.ts';
import { upload } from '../tauri/testflight/upload.ts';

const [app, cargoHome, at, marker] = process.argv.slice(2);
if (at !== 'build' && at !== 'altool') throw new Error(`usage: <app> <cargo folder> <build|altool> <marker>, not ${at}`);
// App Store Connect of its own: the stand-in key is made in each process, so the test's would refuse this one's tokens.
const asc = await appStoreConnect({ bundleId: 'app.pastthebreak' });
const code = await upload({
  cwd: app,
  tokenOnly: false,
  run: apple(app, [], { hang: { at, marker } }).run,
  // The keychains and profile folders go beside the checkout, as the tests' own runs put them.
  env: { PATH: '/usr/bin:/bin', HOME: dirname(cargoHome), CARGO_HOME: cargoHome },
  home: dirname(cargoHome),
  appStoreConnect: asc.options,
});
process.exit(code);
