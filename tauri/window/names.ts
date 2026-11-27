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

/**
 * The menu check a Mac release runs on a worker Mac before it publishes (plugin/src/menu_check.rs, and the judge,
 * tauri/mac-release/menu-check-entry.ts): the variable that starts it in the app, and the words of its log lines,
 * `menu check: ` and then one of `starting`, `left alone, greyed out or hidden: ["Undo", …]`,
 * `the menu holds ["About Example", …, "Quit Example"]`,
 * `choosing <title> (<n> of <total>)`, `<title> (<n> of <total>) answered`,
 * `the app stopped answering after <title> (<n> of <total>) was chosen`, or that the app did not answer before any
 * item was chosen.
 */
export const MENU_CHECK_VARIABLE = 'APP_KIT_MENU_CHECK';

/**
 * The variable `app-kit mac release` builds with, set to the commit it builds (tauri/mac-release/release.ts), which the
 * window plugin reads at compile time (plugin/src/login_item.rs): only a copy the release command built turns open at
 * login on by itself at its first launch, for an app whose menu asks for that (`AppMenu::open_at_login_by_default`).
 */
export const MAC_RELEASE_VARIABLE = 'APP_KIT_MAC_RELEASE';
export const MENU_CHECK_LINE = 'menu check: ';
export const MENU_CHECK_STARTING = 'starting';
export const MENU_CHECK_HOLDS = 'the menu holds ';
export const MENU_CHECK_CHOOSING = 'choosing ';
export const MENU_CHECK_ANSWERED = ' answered';
export const MENU_CHECK_LEFT_ALONE = 'left alone, greyed out or hidden: ';
export const MENU_CHECK_STOPPED = 'the app stopped answering after ';
export const MENU_CHECK_STOPPED_END = ' was chosen';
export const MENU_CHECK_NEVER_ANSWERED = 'the app did not answer before any item was chosen';

/**
 * What the kit logs for each of its own menu items once it is chosen, which the menu check requires after choosing it:
 * the item's title as the kit's menu writes it (the whole title, or with `end`, how it ends), and words any one of
 * which in a later line of the kit's says it acted. The update item's title follows the update (plugin/src/updates.rs):
 * the check sees it as Check for Updates…, as up to date, or as failed to check, and it answers once the releases
 * answer, so its line may come after later items.
 */
/** What the kit logs, after the item's name, of Settings… or Sign Out handed to the page (plugin/src/menu.rs). */
const HANDED_TO_PAGE = 'chosen from the menu, bringing the window forward and handing it to the page';

export const MENU_CHECK_KIT_ITEMS: readonly { title: string; end?: true; lines: readonly string[] }[] = [
  ...['Check for Updates…', 'Could Not Check for Updates, Try Again', ' Is Up to Date'].map((title) => ({
    title,
    ...(title.startsWith(' ') ? { end: true as const } : {}),
    lines: ['no newer version is released', 'is released', 'is still the newest released', 'could not ask the releases', 'Check for Updates chosen, but'],
  })),
  { title: 'Settings…', lines: ['Settings opened', 'Settings chosen from the menu with the window open', HANDED_TO_PAGE] },
  { title: 'Sign Out', lines: [HANDED_TO_PAGE] },
  { title: 'Actual Size', lines: ['zoomed to'] },
  { title: 'Zoom In', lines: ['zoomed to'] },
  { title: 'Zoom Out', lines: ['zoomed to'] },
  { title: 'Reload', lines: ['Reload chosen'] },
];

/** The log target of the kit's window plugin: a warning or error under it during the menu check fails the check. */
export const MENU_CHECK_KIT_TARGET = 'tauri_plugin_app_kit_window';
