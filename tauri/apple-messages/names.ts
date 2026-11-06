/*
 * The names and limits the Apple Messages page half shares with the plugin's Rust (plugin/) and with an app's server.
 * test/tauri-apple-messages.test.ts reads the plugin's sources and holds each to these, so a change on one side fails a
 * test rather than every upload. The page comes from the app's server and the plugin from the installed build, so a
 * command's name stays as it is.
 */

/** The plugin's name, as an app's shell registers it, and the start of its permission, `apple-messages:default`. */
export const PLUGIN = 'apple-messages';

/** The page's commands, each `plugin:apple-messages|<command>`. */
export const COMMANDS = {
  access: 'access',
  since: 'since',
  openFullDiskAccess: 'open_full_disk_access',
  reopen: 'reopen',
} as const;

/** What every log line of the page half and the plugin starts with. */
export const LOG_PREFIX = '[apple-messages]';

/** System Settings, Privacy & Security, Full Disk Access, the one address `open_full_disk_access` opens. */
export const FULL_DISK_ACCESS_PANE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';

/**
 * The upload's limits, in the units JavaScript counts a string's length in (UTF-16). The plugin cuts a text, a name,
 * a chat's people and a service to them, and skips a text whose guid is longer, so an app's server that refuses
 * anything past them never refuses a batch the plugin read. This file is their one owner: a server imports them from
 * `app-kit/tauri/apple-messages/server`.
 */
export const MAX_TEXT_UNITS = 20_000;
/** A chat's id and name, a person's handle and name. */
export const MAX_FIELD_UNITS = 300;
export const MAX_PARTICIPANTS = 100;
export const MAX_GUID_UNITS = 200;
export const MAX_SERVICE_UNITS = 40;
/** Texts per `since` call, so per upload. */
export const BATCH_SIZE = 500;

/** How many reads a row seen before its chat link is held back before it is skipped with a log line. */
export const HOLD_READS = 20;
