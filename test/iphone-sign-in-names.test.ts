/*
 * The plugin's Rust and Swift and the page half share names no compiler checks across them: Tauri runs the Swift method
 * named by a string in the Rust, the Swift reads the page's arguments by their keys, and Tauri names the permissions
 * after the crate's `links` key. The kit has no iPhone app to link or run, so this reads the sources and holds them
 * together.
 */
import { expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ANSWER_KEY, ARGUMENTS, COMMANDS, LOG_PREFIX, PLUGIN } from '../tauri/iphone-sign-in/names';
import { BACK_OVER_HTTPS, BACK_PARAM } from '../tauri/sign-in/names';

const plugin = join(import.meta.dir, '../tauri/iphone-sign-in/plugin');
const read = (path: string) => readFileSync(join(plugin, path), 'utf8');
const swift = read('ios/Sources/WebAuthPlugin.swift');
const rust = ['src/lib.rs', 'src/commands.rs', 'src/mobile.rs', 'src/models.rs'].map(read).join('\n');
const cargo = read('Cargo.toml');
const crate = cargo.match(/^name = "(.+)"$/m)![1];

test('the Rust binds the Swift function that starts the plugin', () => {
  const binding = rust.match(/ios_plugin_binding!\((\w+)\)/)![1];
  expect([...swift.matchAll(/@_cdecl\("(\w+)"\)/g)].map((m) => m[1])).toEqual([binding]);
});

test('the command the page calls is the one the plugin builds, registers, runs in Swift and allows', () => {
  const commands = Object.values(COMMANDS).sort();
  const built = JSON.parse(read('build.rs').match(/COMMANDS: &\[&str\] = (&?\[.*?\]);/)![1].replace(/^&/, '')) as string[];
  expect(built.sort()).toEqual(commands);
  const handler = rust.match(/generate_handler!\[([\s\S]*?)\]/)![1];
  expect([...handler.matchAll(/commands::(\w+)/g)].map((m) => m[1]).sort()).toEqual(commands);
  expect([...rust.matchAll(/run_mobile_plugin\("(\w+)"/g)].map((m) => m[1]).sort()).toEqual(commands);
  expect([...swift.matchAll(/@objc public func (\w+)\(_ invoke: Invoke\)/g)].map((m) => m[1]).sort()).toEqual(commands);
  const allowed = read('permissions/default.toml');
  for (const command of commands) expect(allowed).toContain(`"allow-${command.replaceAll('_', '-')}"`);
  expect(rust).toContain(`Builder::new("${PLUGIN}")`);
  expect(rust).toContain(`pub async fn ${COMMANDS.authenticate}<R: Runtime>(\n    app: AppHandle<R>,\n    ${ARGUMENTS.payload}: `);
});

test('the Swift and the Rust read the arguments and answer under the page’s keys', () => {
  expect(swift).toContain(`let ${ARGUMENTS.url}: String`);
  expect(swift).toContain(`let ${ARGUMENTS.callbackScheme}: String`);
  expect(swift).toContain(`"${ANSWER_KEY}": `);
  // The Rust models are snake case, read and written in camel case.
  expect(rust.match(/#\[serde\(rename_all = "camelCase"\)\]/g)).toHaveLength(2);
  expect(rust).toContain(`pub ${ARGUMENTS.url}: String`);
  expect(rust).toContain('pub callback_scheme: String');
  expect(rust).toContain('pub callback_url: String');
  // The hand-back over https: optional, so a page from before it, which sends neither, still opens the sheet.
  expect(swift).toContain(`let ${ARGUMENTS.callbackHost}: String?`);
  expect(swift).toContain(`let ${ARGUMENTS.callbackPath}: String?`);
  expect(rust).toContain('pub callback_host: Option<String>');
  expect(rust).toContain('pub callback_path: Option<String>');
  expect([ARGUMENTS.callbackHost, ARGUMENTS.callbackPath]).toEqual(['callbackHost', 'callbackPath']);
  expect(ARGUMENTS.callbackScheme).toBe('callbackScheme');
  expect(ANSWER_KEY).toBe('callbackUrl');
});

test('the crate, its links key and the Swift package carry the plugin’s name, which Tauri names its permissions by', () => {
  expect(crate).toBe(`tauri-plugin-${PLUGIN}`);
  expect(cargo).toContain(`links = "${crate}"`);
  const pkg = read('ios/Package.swift');
  expect([...pkg.matchAll(/name: "([\w-]+)"/g)].map((m) => m[1]).filter((n) => n !== 'Tauri')).toEqual([crate, crate, crate]);
});

test('the Swift asks the browser page for the hand-back over https by the names the page reads', () => {
  // Added to the query as the page encoded it, never through queryItems, which writes a '+' in an email back bare.
  expect(swift).toContain(`[asking.percentEncodedQuery, "${BACK_PARAM}=${BACK_OVER_HTTPS}"]`);
  expect(swift).not.toContain('queryItems');
  expect(swift).toContain('callback: .https(host: host, path: path)');
});

test('the Swift logs as the page does', () => {
  expect(swift).toContain(LOG_PREFIX);
  expect(swift).toContain(`${LOG_PREFIX} sheet started`);
});
