/*
 * The one way the TestFlight part runs another program, so tests can stand in for every outside program it uses. Each
 * program starts in a process group of its own, so a step that runs past its time limit is stopped with everything it
 * started (Xcode's build starts many).
 */
import { spawn } from 'node:child_process';

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

/** How a program ended: its exit code (-1 when stopped), and the end of its output and errors together. */
export type RunResult = { code: number; out: string; timedOut: boolean };

export type Run = (command: string[], options?: RunOptions) => Promise<RunResult>;

/** The most of a program's output a result keeps: the end, which holds the error. */
const KEPT_OUTPUT = 1_000_000;
/** How long a stopped process group has between the polite signal and the forced one. */
const GRACE_MS = 5_000;

export const runCommand: Run = ([program, ...args], options = {}) =>
  new Promise((resolve) => {
    let out = '';
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(program, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: true,
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
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
      setTimeout(() => signal('SIGKILL'), GRACE_MS).unref();
    };
    const limit = (ms: number | undefined) => {
      if (timer) clearTimeout(timer);
      timer = ms === undefined ? undefined : setTimeout(stopGroup, ms);
    };
    limit(options.timeoutMs);
    const take = (data: Buffer) => {
      const chunk = data.toString();
      out = (out + chunk).slice(-KEPT_OUTPUT);
      const next = options.output?.(chunk);
      if (typeof next === 'number' && !timedOut) limit(next);
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    if (options.input !== undefined) child.stdin?.end(options.input);
    child.on('error', (error) => {
      limit(undefined);
      resolve({ code: 127, out: `${out}${error.message}`, timedOut });
    });
    // When the program ends, anything it left running in its group goes with it, so nothing outlives a step, and
    // nothing left holding its output keeps the step from ending.
    child.on('exit', () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // nothing left
      }
    });
    child.on('close', (code) => {
      limit(undefined);
      resolve({ code: timedOut ? -1 : (code ?? -1), out, timedOut });
    });
  });
