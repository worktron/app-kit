// `iphone run sim` as a process of its own, for the tests that stop it as Ctrl-C does or kill it outright:
//   bun test/iphone-run-child.ts <app checkout> <marker> build|install
// The step named hangs, after printing a line with the marker: the build, before any Simulator is booted, or the
// install, after the boot, with the place taken and a real watcher started, looking every tenth of a second. The
// Simulator's tools are the test's stand-ins: here answered in the run, and on PATH for the signal handler's shut-down
// and the watcher. It is never itself a test.
import { runIphone } from '../tauri/iphone-run/index.ts';
import { runCommand, type RunResult } from '../command-line/run.ts';
import { startWatcher } from '../tauri/iphone-simulator/lifetime.ts';
import { stateFolder } from '../tauri/state.ts';

const [app, marker, hang] = process.argv.slice(2);
const UDID = 'SCRATCH-UDID';
const answered = (out = ''): Promise<RunResult> => Promise.resolve({ code: 0, out, stdout: out, stderr: '', timedOut: false });
const listing = JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [{ name: 'Sample App', udid: UDID, state: 'Shutdown' }] } });
// The state folder is the one the watcher reads from this process's environment, outside the checkout a test deletes.
const folder = stateFolder('simulators');

const code = await runIphone({
  target: 'sim',
  udid: UDID,
  cwd: app,
  env: { PATH: '/usr/bin:/bin', HOME: app },
  home: app,
  lifetime: { folder, startWatcher: startWatcher(folder, 100) },
  run: (command, options) => {
    if (command[0] === 'bunx' && hang === 'build') return runCommand(['bash', '-c', `echo "hanging ${marker}"; sleep 600; echo "${marker}"`], options);
    if (command.join(' ') === 'xcrun simctl list devices -j') return answered(listing);
    if (command.slice(0, 3).join(' ') === 'xcrun simctl install' && hang === 'install') {
      console.log(`hanging ${marker}`);
      // A timer keeps the process waiting, as a real install would.
      setInterval(() => {}, 60_000);
      return new Promise(() => {});
    }
    return answered();
  },
  quiet: () => ({ code: 0, line: '[iphone-simulator] quiet' }),
});
process.exit(code);
