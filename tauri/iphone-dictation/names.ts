/*
 * The names the iPhone dictation page half shares with the plugin's Rust and Swift (plugin/).
 * test/iphone-dictation-names.test.ts reads the plugin's sources and holds each to these, so a rename on one side fails
 * a test rather than every press of the microphone.
 */

/** The plugin's name, as an app's shell registers it, and the start of its permission, `iphone-dictation:default`. */
export const PLUGIN = 'iphone-dictation';

/** The page's commands, each `plugin:iphone-dictation|<command>`. */
export const COMMANDS = {
  start: 'start_dictation',
  heard: 'dictation_heard',
  stop: 'stop_dictation',
  cancel: 'cancel_dictation',
} as const;

/** What every log line of the page half and the plugin starts with. */
export const LOG_PREFIX = '[iphone-dictation]';
