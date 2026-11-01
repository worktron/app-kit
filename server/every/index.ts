/*
 * A job on a clock for a server (app-kit/server/every). setInterval starts a run while the last one goes on, so a job
 * slower than its interval sends alarms twice or changes the same mailbox twice; Bun.cron never stacks runs, but a
 * throw in it ends the process unless the app listens for unhandled rejections, its stop() does not wait for a run in
 * progress, and it keeps to the wall clock in whole minutes. No imports, so a worker with no web server takes it too.
 */

/** The longest delay a timer holds, a signed 32-bit number of milliseconds: about 24.8 days. */
export const LONGEST_DELAY_MS = 2_147_483_647;

export type EveryOptions = {
  /** Run once as soon as it is started, rather than first after one interval. */
  runAtStart?: boolean;
  /** Where a failed run is written, console.log unless given, as the server's other lines. */
  print?: (line: string) => void;
};

/**
 * Runs `job` every `intervalMs`, never two runs at once: the next run is set only once the last has settled, for one
 * interval after the last one started, or at once when the last took longer than that, so a due run is never skipped
 * and a slow one is never stacked. A run that throws is written with the job's name and the next run still happens.
 * Gives back stop(), which ends the clock and waits for a run in progress, for `listen`'s onStop.
 */
export function every(
  name: string,
  intervalMs: number,
  job: () => unknown,
  { runAtStart = false, print = console.log }: EveryOptions = {},
): () => Promise<void> {
  // An interval of 0, or none, would run the job back to back for as long as the server lives, and so would one past
  // the longest delay a timer holds (about 24.8 days), which Bun and Node cut to 1ms.
  if (!(intervalMs > 0 && intervalMs <= LONGEST_DELAY_MS)) {
    throw new RangeError(`${name}: the interval must be a number of milliseconds above 0 and at most ${LONGEST_DELAY_MS}, not ${intervalMs}`);
  }
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  const schedule = (at: number) => {
    timer = setTimeout(() => void (running = run()), Math.max(0, at - Date.now()));
  };
  const run = async () => {
    const started = Date.now();
    try {
      await job();
    } catch (error) {
      print(`${name} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    }
    running = undefined;
    if (!stopped) schedule(started + intervalMs);
  };
  schedule(Date.now() + (runAtStart ? 0 : intervalMs));
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await running;
  };
}
