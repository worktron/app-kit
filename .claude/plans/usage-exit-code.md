# The usage test's child that ends with no exit code

Open until its cause is found and fixed, with a test that fails on the old code.

## What was seen

Once, in a full `bun test` run (1,579 tests, Bun 1.4.4 on macOS, the machine at a load of about 15), test/command.test.ts's wrong-usage test failed with `"code": null` for one of its six-word `icons render` lists, 792 ms in. `Bun.spawnSync(...).exitCode` is null when the child had no exit code. The file alone passed, and so did the landing's run of the same code. The command rejects those arguments before it loads any part and exits 2 in about 11 ms, so a slow exit is not it.

## What the hunt ruled out

- Fifteen more full runs with a preload that logged every `Bun.spawnSync` in any test that came back with no exit code or with a signal: 1,593 pass each, none logged.
- 1,800 wrong-usage runs from a scratch kit, in six copies at once beside a full run, and 9,000 short children (a shell and a Bun script, output piped) inside six `bun test` runs at once: every one kept its exit code.
- bun:test's own time limit, which kills a `spawnSync` child when the test runs out of time: it prints "killed N dangling process" and a time-out, and the red had neither.
- The fonts test that ran just before it, which switches fake timers on and off: thirty runs of the two files together passed.
- Anything in app-kit signalling its own process group (nothing does), the dev supervisor (it stops only orphans), and Bun's binary changing under the run (it had not changed in a month).

## The likeliest cause, unproven

Bun 1.4.4's `on_wait_pid` (src/spawn/process.rs) has a macOS branch for a child that has started to exit but is not yet a zombie: the exit watch fails with ESRCH, and `reap_on_thread` collects it on a thread. If collecting it fails there, the status is `Status::Err`, which `has_exited` counts as exited, and `spawnSync` then reads both its exit code and its signal from that status: both empty. A red with no exit code and no signal fits this; one with a signal would point outside Bun. No report of it was found in Bun's issues.

## What to do with the next red

The test now says the arguments, the exit code or its absence, the signal or its absence, and the stderr. Keep the run's log and bring that line to this note's thread (usage-exit-code). No exit code and no signal: reproduce it against Bun and report it there, with the log. A signal: find what sent it.
