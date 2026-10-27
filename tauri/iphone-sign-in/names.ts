/*
 * The names the iPhone sign-in page half shares with the plugin's Rust and Swift (plugin/). They are the original
 * plugin's, tauri-plugin-web-auth's, which iPhone builds installed before the kit had it already answer to: the page
 * comes from the app's server and the plugin from the installed build, so a rename would break sign-in on every phone
 * not reinstalled at the moment of the deploy. test/iphone-sign-in-names.test.ts reads the plugin's sources and holds
 * each to these.
 */

/** The plugin's name, as the shell registers it, and the start of its permission, `web-auth:default`. */
export const PLUGIN = 'web-auth';

/** The page's command, `plugin:web-auth|authenticate`. */
export const COMMANDS = {
  authenticate: 'authenticate',
} as const;

/**
 * The command's arguments: `{ payload: { url, callbackScheme, callbackHost?, callbackPath? } }`. With a host and path,
 * the kit's plugin waits for the hand-back over https where iOS allows it; the original plugin ignores them.
 */
export const ARGUMENTS = {
  payload: 'payload',
  url: 'url',
  callbackScheme: 'callbackScheme',
  callbackHost: 'callbackHost',
  callbackPath: 'callbackPath',
} as const;

/** The key of the command's answer that holds the link the sheet closed on. */
export const ANSWER_KEY = 'callbackUrl';

/** What every log line of the page half and the plugin starts with. */
export const LOG_PREFIX = '[iphone-sign-in]';
