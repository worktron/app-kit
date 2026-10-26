/*
 * The environment every build of a Tauri app's iPhone app runs in, the TestFlight upload's and `app-kit iphone run`'s
 * alike, and every Xcode call beside it.
 *
 * FORCE_COLOR is the one learned the hard way: the Xcode project's Rust build step passes ${FORCE_COLOR} to Tauri as a
 * flag, and regenerating the project bakes in whatever the shell holds, so a terminal's FORCE_COLOR=3 reached Tauri as
 * a chip architecture ("3 isn't a known arch"). The App Store Connect key goes too: with APPLE_API_* set, Tauri hands
 * that key to xcodebuild for signing, and an App Manager key fails it; signing goes through the Apple account Xcode is
 * signed in to.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export type Env = Record<string, string | undefined>;

/**
 * The environment the build runs in: Rust's own folder first, so a shell that never read rustup's profile finds cargo;
 * a UTF-8 locale, which CocoaPods and xcodebuild need; and none of what would change the build or reach it that should
 * not: FORCE_COLOR, APPLE_API_*, and the 1Password token.
 */
export function buildEnv(env: Env, home = homedir()): Env {
  const out: Env = {};
  for (const [name, value] of Object.entries(env)) {
    if (name === 'FORCE_COLOR' || name === 'OP_SERVICE_ACCOUNT_TOKEN' || name.startsWith('APPLE_API_')) continue;
    out[name] = value;
  }
  const cargo = join(env.CARGO_HOME || join(home, '.cargo'), 'bin');
  out.PATH = [cargo, ...(env.PATH ?? '').split(':').filter((dir) => dir && dir !== cargo)].join(':');
  out.LANG = 'en_US.UTF-8';
  return out;
}
