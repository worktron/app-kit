/*
 * The plugin's Rust and Swift, the page half and the server half share names no compiler checks across them: a Rust
 * `extern "C"` function resolves to a Swift `@_cdecl` only when an app links, and a command or event name is a string.
 * The kit has no iPhone app to link or run, so this reads the sources and holds them together.
 */
import { expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ADDRESS_KEY, COMMANDS, COVERS_KEY, KEEP_KEY, LOG_PREFIX, PLUGIN, SENT_KEY, TAPPED_EVENT } from '../tauri/iphone-notifications/names';

const plugin = join(import.meta.dir, '../tauri/iphone-notifications/plugin');
const read = (path: string) => readFileSync(join(plugin, path), 'utf8');
const swift = read('ios/Sources/IphoneNotificationsPlugin.swift');
const rust = ['src/lib.rs', 'src/commands.rs', 'src/mobile.rs'].map(read).join('\n');
const crate = read('Cargo.toml').match(/^name = "(.+)"$/m)![1];

test('every native function the Rust calls is one the Swift defines, and the other way round', () => {
  const externBlocks = [...rust.matchAll(/extern "C" \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
  const called = [...externBlocks.matchAll(/fn (\w+)\(/g)].map((m) => m[1]);
  const binding = rust.match(/ios_plugin_binding!\((\w+)\)/)![1];
  const defined = [...swift.matchAll(/@_cdecl\("(\w+)"\)/g)].map((m) => m[1]);
  expect(called.length).toBeGreaterThan(0);
  expect([...called, binding].sort()).toEqual(defined.sort());
});

test('the commands the page calls are the ones the plugin builds, registers and allows', () => {
  const commands = Object.values(COMMANDS).sort();
  const built = JSON.parse(read('build.rs').match(/COMMANDS: &\[&str\] = (&?\[.*?\]);/)![1].replace(/^&/, '')) as string[];
  expect(built.sort()).toEqual(commands);
  const handler = rust.match(/generate_handler!\[([\s\S]*?)\]/)![1];
  expect([...handler.matchAll(/commands::(\w+)/g)].map((m) => m[1]).sort()).toEqual(commands);
  const allowed = read('permissions/default.toml');
  for (const command of commands) expect(allowed).toContain(`"allow-${command.replaceAll('_', '-')}"`);
  expect(rust).toContain(`::new("${PLUGIN}")`);
});

test('the Swift package builds the product named after the crate, which is what Tauri links', () => {
  const pkg = read('ios/Package.swift');
  expect(pkg).toContain(`name: "${crate}"`);
  expect([...pkg.matchAll(/name: "([\w-]+)"/g)].map((m) => m[1]).filter((n) => n !== 'Tauri')).toEqual([crate, crate, crate]);
});

test('the Swift keeps the payload’s address, dispatches the page’s event and logs as the page does', () => {
  expect(swift).toContain(`userInfo["${ADDRESS_KEY}"]`);
  expect(swift).toContain(`private let tappedEvent = "${TAPPED_EVENT}"`);
  expect(swift).toContain(LOG_PREFIX);
  expect(swift).not.toContain('[mobile-push]');
});

test('the Swift asks for the badge everywhere it asks for permission, and never sets the count, which is the server’s', () => {
  const asks = [...swift.matchAll(/requestAuthorization\(options: (\[.*?\])\)/g)].map((m) => m[1]);
  expect(asks.length).toBeGreaterThan(0);
  for (const options of asks) expect(options).toContain('.badge');
  expect(swift).not.toMatch(/setBadgeCount|applicationIconBadgeNumber|\.badge\s*=/);
});

test('with the app in front a passive notification shows no banner, and goes to the list and sets the badge as configured', () => {
  const present = swift.match(/willPresent notification[\s\S]*?\n {4}\}/)![0];
  expect(present).toContain('foregroundPresentation(for: notification)');
  const options = swift.match(/func foregroundPresentation\(for notification: UNNotification\)[\s\S]*?\n\}/)![0];
  expect(options).toContain('#available(iOS 15.0, *)');
  expect(options).toContain('.interruptionLevel == .passive');
  expect(options).toContain('.remove(.banner)');
  expect(options).not.toContain('.remove(.list)');
  expect(options).not.toContain('.remove(.badge)');
});

test('the Swift takes the notification delegate when the plugin starts and again when the window loads', () => {
  const load = swift.match(/override public func load\(webview: WKWebView\) \{([\s\S]*?)\n {4}\}/)![1];
  expect(load).toContain('takeNotificationDelegate(');
  const start = swift.match(/func initPlugin\(\) -> Plugin \{([\s\S]*?)\n\}/)![1];
  expect(start).toContain('takeNotificationDelegate(');
});

test('the Swift reads a keep list, a send time and the covered tags under the keys the server writes', () => {
  expect(swift).toContain(`private let sentKey = "${SENT_KEY}"`);
  expect(swift).toContain(`private let coversKey = "${COVERS_KEY}"`);
  expect(swift).toContain(`private let keepKey = "${KEEP_KEY}"`);
});

test('the Swift answers background pushes from plugin start, before any window or token request', () => {
  const start = swift.match(/func initPlugin\(\) -> Plugin \{([\s\S]*?)\n\}/)![1];
  expect(start).toContain('setUpBackgroundPush(');
  expect(swift).toContain('application:didReceiveRemoteNotification:fetchCompletionHandler:');
  expect(swift).toContain('UIApplication.didFinishLaunchingNotification');
});
