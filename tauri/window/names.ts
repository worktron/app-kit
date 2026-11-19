/*
 * The names the page shares with the window's Rust (plugin/src/mac.rs, menu.rs, updates.rs and lib.rs), and the start
 * page (start/index.html) shares with lib.rs, which cannot import them.
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

/**
 * Where the window hands the kit's start page its settings before the page's script runs (Site::start_page_window):
 * `{ address, health, name, background, text }`, the site's address, its health route's path, the app's name and its
 * two colors.
 */
export const START_PAGE_SETTINGS = '__APP_KIT_START_PAGE__';
/** The health route the start page asks by default, which every server on app-kit/server/start answers. */
export const START_PAGE_HEALTH = '/api/health';

/**
 * The kit's Settings window on the Mac (plugin/src/settings.rs, start/settings.html): its label, the only window
 * granted the switch's commands, and its page, beside the start page.
 */
export const SETTINGS_WINDOW = 'app-kit-settings';
export const SETTINGS_PAGE = 'settings.html';
/** Where the window hands the Settings page its settings before the page's script runs: `{ name, background?, text? }`. */
export const SETTINGS_PAGE_SETTINGS = '__APP_KIT_SETTINGS_PAGE__';
/** The plugin's commands behind the switch that opens the app at login (plugin/build.rs), called as `plugin:app-kit-window|<command>`. */
export const OPEN_AT_LOGIN_COMMANDS = ['open_at_login_status', 'open_at_login_set', 'open_login_items'] as const;
/** What the switch is told the login item is, as macOS reports it (plugin/src/login_item.rs). */
export const OPEN_AT_LOGIN_STATES = ['enabled', 'requires-approval', 'off', 'not-available'] as const;
