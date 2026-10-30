// `iphone run sim` as a process of its own, for the test that stops it as Ctrl-C does:
//   bun test/iphone-run-child.ts <app checkout> <marker>
// Its build hangs, printing a line with the marker, and it is never itself a test.
import { runIphone } from '../tauri/iphone-run/index.ts';
import { runCommand } from '../command-line/run.ts';

const [app, marker] = process.argv.slice(2);
const code = await runIphone({
  target: 'sim',
  udid: 'SCRATCH-UDID',
  cwd: app,
  env: { PATH: '/usr/bin:/bin', HOME: app },
  home: app,
  run: (command, options) =>
    command[0] === 'bunx'
      ? runCommand(['bash', '-c', `echo "hanging ${marker}"; sleep 600; echo "${marker}"`], options)
      : Promise.resolve({ code: 0, out: '', timedOut: false }),
  quiet: () => ({ code: 0, line: '[iphone-simulator] quiet' }),
});
process.exit(code);
