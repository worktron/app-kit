/*
 * The Tauri steps (tauri/playwright.js) are plain JavaScript that Node loads from inside node_modules, so they cannot
 * import the names files, and copy the names instead. This reads the copies out of the steps and holds each to the
 * names file it comes from, so a rename in a plugin fails here rather than in an app's tests.
 */
import { expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as notifications from '../tauri/iphone-notifications/names';
import * as sheet from '../tauri/iphone-sign-in/names';
import * as desktop from '../tauri/sign-in/names';

const steps = readFileSync(join(import.meta.dir, '../tauri/playwright.js'), 'utf8');
const block = steps.match(/^const NAMES = \{\n([\s\S]*?)\n\};$/m)?.[1] ?? '';
const copied = Object.fromEntries([...block.matchAll(/^ {2}(\w+): '([^']*)',$/gm)].map((m) => [m[1], m[2]]));

test('every name the Tauri steps copy is the one its names file gives', () => {
  const notification = (command: string) => `plugin:${notifications.PLUGIN}|${command}`;
  expect(copied).toEqual({
    requestPermission: notification(notifications.COMMANDS.requestPermission),
    getToken: notification(notifications.COMMANDS.getToken),
    takeTappedAddress: notification(notifications.COMMANDS.takeTappedAddress),
    tappedEvent: notifications.TAPPED_EVENT,
    authenticate: `plugin:${sheet.PLUGIN}|${sheet.COMMANDS.authenticate}`,
    answerKey: sheet.ANSWER_KEY,
    linkHost: desktop.LINK_HOST,
    desktopSignInPath: desktop.DESKTOP_SIGN_IN_PATH,
    desktopSignInEvent: desktop.DESKTOP_SIGN_IN_EVENT,
    ticketParam: desktop.TICKET_PARAM,
    nonceParam: desktop.NONCE_PARAM,
  });
});

test('the steps read the iPhone sign-in command\'s arguments by the names the plugin takes', () => {
  expect(sheet.ARGUMENTS).toEqual({ payload: 'payload', url: 'url', callbackScheme: 'callbackScheme' });
  expect(steps).toContain('args?.payload?.url');
  expect(steps).toContain('args?.payload?.callbackScheme');
});
