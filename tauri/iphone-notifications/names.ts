/*
 * The names the iPhone notifications page half shares with the plugin's Rust and Swift (plugin/) and with the server
 * half. test/iphone-notifications-names.test.ts reads the plugin's sources and holds each to these, so a rename on one
 * side fails a test rather than every tap.
 */

/** The plugin's name, as an app's shell registers it, and the start of its permission, `iphone-notifications:default`. */
export const PLUGIN = 'iphone-notifications';

/** The page's commands, each `plugin:iphone-notifications|<command>`. */
export const COMMANDS = {
  requestPermission: 'request_permission',
  getToken: 'get_token',
  takeTappedAddress: 'take_tapped_address',
  keepNotifications: 'keep_notifications',
} as const;

/**
 * The window event the plugin dispatches when a notification is tapped with the page open. It carries nothing: the
 * page takes the address with `take_tapped_address`, as it does at start and on coming to the front.
 */
export const TAPPED_EVENT = 'app-kit-notification-tapped';

/** The key in Apple's payload, beside `aps`, that holds the page the notification is about. */
export const ADDRESS_KEY = 'url';

/** The key beside `aps` that holds when the server sent an alert or a keep list, in milliseconds since 1970. */
export const SENT_KEY = 'sent';

/** The key beside `aps` that holds the tags an alert stands for, such as a summary of several things. */
export const COVERS_KEY = 'covers';

/** The key beside `aps` that holds a silent push's list of the tags whose notifications stay. */
export const KEEP_KEY = 'keep';

/** What every log line of the page half and the plugin starts with. */
export const LOG_PREFIX = '[iphone-notifications]';
