// The types of forget-apps.js, which is plain JavaScript because Playwright's test runner loads nothing written in
// TypeScript from inside node_modules, where an app has the kit.

/** macOS's tool for its list of apps, which has no public call that forgets one. */
export const LSREGISTER: string;

/**
 * Every app bundle at or under `path`, nested ones included (a Chromium's helper apps), never following a link; `path`
 * itself when it names an app, even one already gone.
 */
export function appsIn(path: string): string[];

/**
 * Deletes each path, a folder or an app, then has macOS forget every app that was at or in it, so no copy a test
 * or a build made stays in macOS's list of apps once it is gone. Each path is taken as macOS registered it (`/tmp` is
 * `/private/tmp`). A forget that fails changes nothing and fails nothing; off macOS it only deletes. Returns the paths
 * that could not be deleted, with why, which are not forgotten either.
 * `run` runs a command, `[lsregister, '-u', path]`, and is a stand-in in tests.
 */
export function removeAppsNow(paths: string[], run?: (command: string[]) => unknown): { path: string; error: Error }[];
