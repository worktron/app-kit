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
  installService: 'install_service',
  openConnectLink: 'open_connect_link',
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

/*
 * Messages Service: the Mac app that holds the one Full Disk Access grant and pushes texts to the server of each app
 * the person connects (its own repository, worktron/messages-service). These are the names it and the kit share; the
 * service's own tests hold its copy to them.
 */

/** The service's name in Applications and on screen, as `<name>.app`. */
export const SERVICE_APP_NAME = 'Messages Service';
/** Its bundle identifier: the installer finds an installed copy by it. Development builds use another. */
export const SERVICE_BUNDLE_ID = 'com.worktron.messages-service';
/** Its link scheme: `messages-service://connect?address=<the app's routes>&code=<one-time code>`. */
export const SERVICE_SCHEME = 'messages-service';
export const SERVICE_CONNECT_HOST = 'connect';
/** The service's releases' update manifest, which names the archive the installer and the updater both take. */
export const SERVICE_LATEST_JSON = 'https://github.com/worktron/messages-service/releases/latest/download/latest.json';
/** The release's platform key in that manifest. */
export const SERVICE_PLATFORM = 'darwin-aarch64';

/**
 * Where an app mounts the routes the service talks to (server.ts messagesServiceRoutes), relative to its origin:
 * - `GET  <routes>/about?code=<code>`: `{ name, account }`, the app's display name and the account the code was made for,
 *   which the service's window shows under the host (`{ name }` alone for a code that is unknown, used or expired);
 * - `POST <routes>/code`: a one-time code for the signed-in person, made for the connect link (session only);
 * - `POST <routes>/connect`: `{ code, secret }` from the service once the person says yes, answered `{ connection }`;
 * - `POST <routes>/texts/<connection>`: a batch, `{ texts }`, signed the Standard Webhooks way with that connection's
 *   secret; 200 stored, 401 a bad signature, 410 the connection is gone (the service stops pushing to it).
 */
export const MESSAGES_SERVICE_ROUTES = '/api/messages-service';
/** The paths under MESSAGES_SERVICE_ROUTES the app's sign-in check lets through: the service has no session. */
export const SERVICE_OPEN_PATHS = ['/about', '/connect', '/texts/'] as const;
/** How long a connect code can be used, once. */
export const CONNECT_CODE_MS = 10 * 60_000;
