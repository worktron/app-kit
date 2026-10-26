/*
 * The names the page shares with the window's Rust (plugin/src/mac.rs), which cannot import them.
 * test/tauri-window.test.ts reads the Rust and holds each to these. The page comes from the app's server and the shell
 * from the installed build, so a rename would leave every build installed before it out of step: these stay as they are.
 */

/** The flag the Mac window sets, and the window event it dispatches, when the window goes into or out of full screen. */
export const FULL_SCREEN_FLAG = '__APP_KIT_FULL_SCREEN__';
export const FULL_SCREEN_EVENT = 'app-kit-full-screen';

/** The flag the Mac window sets, and the window event it dispatches, once a newer build of the app is installed. */
export const NEWER_BUILD_FLAG = '__APP_KIT_NEWER_BUILD__';
export const NEWER_BUILD_EVENT = 'app-kit-newer-build';

/** The host of the app's own link that restarts it into the newer build: `<scheme>://restart`. */
export const RESTART_HOST = 'restart';
