// The upload as a process of its own, for the test that stops it as the watcher's time limit does:
//   bun test/testflight-upload-child.ts <app checkout> <cargo folder> <build|altool> <marker>
// It hangs at the build or at altool, printing a line with the marker, and is never itself a test.
import { apple } from './testflight-apple-stand-in.ts';
import { upload } from '../tauri/testflight/upload.ts';

const [app, cargoHome, at, marker] = process.argv.slice(2);
if (at !== 'build' && at !== 'altool') throw new Error(`usage: <app> <cargo folder> <build|altool> <marker>, not ${at}`);
const code = await upload({
  cwd: app,
  tokenOnly: false,
  run: apple(app, [], { hang: { at, marker } }).run,
  env: { PATH: '/usr/bin:/bin', HOME: app, CARGO_HOME: cargoHome },
});
process.exit(code);
