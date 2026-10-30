/*
 * The one way a command runs another program, so tests can stand in for every outside program it uses: the kit's own
 * (the TestFlight part, `iphone run`, `icons render`) and an app's. Each program starts in a process group of its own,
 * so a step that runs past its time limit is stopped with everything it started (Xcode's build starts many), which
 * Bun.spawn's own timeout does not do: it signals the program alone. A group of its own is out of reach of a signal to its parent's group, so a
 * program that is stopped itself stops the groups it started (`stopRunning`), as the upload does when the watcher's
 * time limit stops it.
 */
import { type ChildProcess, spawn } from 'node:child_process';

export type RunOptions = {
  cwd?: string;
  /** The program's whole environment; the caller's own when left out. */
  env?: Record<string, string | undefined>;
  /** Text written to its standard input. */
  input?: string;
  /** How long it may run before its process group is stopped, in milliseconds; no limit when left out. */
  timeoutMs?: number;
  /**
   * Each piece of its output and errors as it comes. Return a new time limit, in milliseconds from now, to replace
   * the one running: the upload says when its build is done, and the upload's own limit starts then.
   */
  output?: (chunk: string) => number | void;
};

/**
 * How a program ended: its exit code (-1 when stopped), the end of its output and errors together as they came (`out`),
 * and the end of each apart, for a caller that parses the output and must not read a warning as part of it.
 */
export type RunResult = { code: number; out: string; stdout: string; stderr: string; timedOut: boolean };

export type Run = (command: string[], options?: RunOptions) => Promise<RunResult>;

/** The most of a program's output a result keeps, in each of its three texts: the end, which holds the error. */
const KEPT_OUTPUT = 1_000_000;
/** How long a stopped process group has between the polite signal and the forced one. */
const GRACE_MS = 5_000;
/** The signals that stop a command that runs programs here (the upload, the watcher, `iphone run`), as launchd and a terminal send them. */
export const STOP_SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];
/** Every program this process started through `runCommand` that has not ended. */
const running = new Set<ChildProcess>();

/** Sends `signal` to the process group of every program this process started and that is still running. */
export function stopRunning(signal: NodeJS.Signals): void {
  for (const child of running) {
    try {
      if (child.pid) process.kill(-child.pid, signal);
    } catch {
      // the group has already exited
    }
  }
}

export const runCommand: Run = ([program, ...args], options = {}) =>
  new Promise((resolve) => {
    const kept = { out: '', stdout: '', stderr: '' };
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(program, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: true,
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    running.add(child);
    const stopGroup = () => {
      timedOut = true;
      const signal = (name: NodeJS.Signals) => {
        try {
          if (child.pid) process.kill(-child.pid, name);
        } catch {
          // the group has already exited
        }
      };
      signal('SIGTERM');
      grace = setTimeout(() => signal('SIGKILL'), GRACE_MS);
    };
    const limit = (ms: number | undefined) => {
      if (timer) clearTimeout(timer);
      timer = ms === undefined ? undefined : setTimeout(stopGroup, ms);
    };
    limit(options.timeoutMs);
    const take = (stream: 'stdout' | 'stderr') => (data: Buffer) => {
      const chunk = data.toString();
      kept.out = (kept.out + chunk).slice(-KEPT_OUTPUT);
      kept[stream] = (kept[stream] + chunk).slice(-KEPT_OUTPUT);
      const next = options.output?.(chunk);
      if (typeof next === 'number' && !timedOut) limit(next);
    };
    child.stdout?.on('data', take('stdout'));
    child.stderr?.on('data', take('stderr'));
    if (options.input !== undefined) child.stdin?.end(options.input);
    child.on('error', (error) => {
      running.delete(child);
      limit(undefined);
      resolve({ code: 127, out: `${kept.out}${error.message}`, stdout: kept.stdout, stderr: `${kept.stderr}${error.message}`, timedOut });
    });
    // When the program ends, anything it left running in its group goes with it, so nothing outlives a step, and
    // nothing left holding its output keeps the step from ending. A group stopped at its time limit keeps its grace
    // period instead: the first program in it can end on the polite signal at once (caffeinate does), while another,
    // the upload, is still putting things back.
    child.on('exit', () => {
      running.delete(child);
      if (timedOut) return;
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // nothing left
      }
    });
    child.on('close', (code) => {
      limit(undefined);
      // The forced signal stays due while anything in the stopped group is left, so a program that ignores the polite
      // one does not outlive the step; with the group gone, nothing waits for it.
      let left = false;
      try {
        if (child.pid) left = process.kill(-child.pid, 0);
      } catch {
        // the group is gone
      }
      if (grace && !left) clearTimeout(grace);
      resolve({ code: timedOut ? -1 : (code ?? -1), ...kept, timedOut });
    });
  });
