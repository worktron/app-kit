// app-kit/server/process-usage with bun:ffi's dlopen replaced, in a process of its own so nothing else meets the stand-in.
// test/process-usage.test.ts names what macOS answers, and this prints what the reader did with it.
export {};

const [timebaseNumerator, timebaseDenominator, answer, platform] = process.argv.slice(2) as [string, string, string, string];

if (platform) Object.defineProperty(process, 'platform', { value: platform });

const opened: string[] = [];
const bufferSizes: number[] = [];
const flavors: number[] = [];
const pids: number[] = [];

const ffi = require('bun:ffi') as { dlopen: unknown };
ffi.dlopen = (library: string) => {
  opened.push(library);
  return {
    symbols: {
      mach_timebase_info: (fraction: Uint32Array) => {
        fraction[0] = Number(timebaseNumerator);
        fraction[1] = Number(timebaseDenominator);
        return 0;
      },
      proc_pid_rusage: (pid: number, flavor: number, buffer: Uint8Array) => {
        pids.push(pid);
        flavors.push(flavor);
        bufferSizes.push(buffer.length);
        const view = new DataView(buffer.buffer);
        const fields: [number, bigint][] = [
          [16, 24_000_000n], // user time
          [24, 12_000_000n], // system time
          [64, 1_000n], // resident size
          [72, 2_000n], // physical footprint
          [80, 2n ** 60n + 1n], // process start time, more than a number holds exactly
          [96, 48_000_000n], // child user time
          [104, 24_000_000n], // child system time
          [144, 3_000n], // disk bytes read
          [152, 4_000n], // disk bytes written
        ];
        for (const [offset, value] of fields) view.setBigUint64(offset, value, true);
        return Number(answer);
      },
    },
  };
};

const { readProcessUsage } = await import('../server/process-usage');
const openedByImport = [...opened];
const readings = [readProcessUsage(123), readProcessUsage(456), readProcessUsage(2 ** 32 + 7), readProcessUsage(-1), readProcessUsage(1.5)];

console.log(
  JSON.stringify(
    { openedByImport, opened, bufferSizes, flavors, pids, readings },
    (_, value) => (typeof value === 'bigint' ? value.toString() : value),
  ),
);
