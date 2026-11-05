/*
 * The names the page shares with the window's Rust (plugin/src/mac.rs, menu.rs and updates.rs), which cannot import them.
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

/**
 * The flag the Mac window sets, and the window event it dispatches, when an update from the app's releases is found,
 * installing or failed (plugin/src/updates.rs), with the flag's value one of `UPDATE_STATES`.
 */
export const UPDATE_FLAG = '__APP_KIT_UPDATE__';
export const UPDATE_EVENT = 'app-kit-update';
export const UPDATE_STATES = ['available', 'installing', 'failed'] as const;

/** The host of the app's own link that installs the update found: `<scheme>://update`. */
export const UPDATE_HOST = 'update';

/** The window event the Mac window dispatches when a menu item the page carries out is chosen, its detail the item. */
export const MENU_EVENT = 'app-kit-menu';
/** The items the page carries out: Settings… and Sign Out (plugin/src/menu.rs). */
export const MENU_SETTINGS = 'settings';
export const MENU_SIGN_OUT = 'sign-out';
