/*
 * The plugin's Rust and Swift and the page half share names no compiler checks across them: a Rust `extern "C"`
 * function resolves to a Swift `@_cdecl` only when an app links, and a command name is a string. The kit has no iPhone
 * app to link or run, so this reads the sources and holds them together.
 */
import { expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { COMMANDS, LOG_PREFIX, PLUGIN } from '../tauri/iphone-dictation/names';

const plugin = join(import.meta.dir, '../tauri/iphone-dictation/plugin');
const read = (path: string) => readFileSync(join(plugin, path), 'utf8');
const swift = read('ios/Sources/IphoneDictationPlugin.swift');
const rules = read('ios/Sources/DictationRules.swift');
const rust = ['src/lib.rs', 'src/commands.rs', 'src/mobile.rs'].map(read).join('\n');
const crate = read('Cargo.toml').match(/^name = "(.+)"$/m)![1];

test('every native function the Rust calls is one the Swift defines, and the other way round', () => {
  const externBlocks = [...rust.matchAll(/extern "C" \{([\s\S]*?)\n\s*\}/g)].map((m) => m[1]).join('\n');
  const called = [...externBlocks.matchAll(/fn (\w+)\(/g)].map((m) => m[1]);
  const binding = rust.match(/ios_plugin_binding!\((\w+)\)/)![1];
  const defined = [...swift.matchAll(/@_cdecl\("(\w+)"\)/g)].map((m) => m[1]);
  expect(called.length).toBe(5);
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

test('the build script reruns on every Swift source', () => {
  const build = read('build.rs');
  for (const file of ['IphoneDictationPlugin.swift', 'DictationRules.swift']) expect(build).toContain(`ios/Sources/${file}`);
});

test('the Swift package builds the product named after the crate, which is what Tauri links', () => {
  const pkg = read('ios/Package.swift');
  expect([...pkg.matchAll(/name: "([\w-]+)"/g)].map((m) => m[1]).filter((n) => n !== 'Tauri')).toEqual([crate, crate, crate]);
});

test('the Swift logs as the page does', () => {
  expect(swift).toContain(`private let logPrefix = "${LOG_PREFIX}"`);
});

test('the recognizer adds punctuation, hints dictation and stays on the phone where it can', () => {
  expect(swift).toContain('request.addsPunctuation = true');
  expect(swift).toContain('request.taskHint = .dictation');
  expect(swift).toContain('if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }');
  expect(swift).toContain('ns.code == 201');
});

test('the Simulator’s stand-in is only in a Simulator build', () => {
  const standIn = swift.indexOf('private let standInResults');
  const simulatorOnly = swift.indexOf('#if targetEnvironment(simulator)');
  const otherwise = swift.indexOf('#else', simulatorOnly);
  expect(simulatorOnly).toBeGreaterThan(-1);
  expect(standIn).toBeGreaterThan(simulatorOnly);
  expect(standIn).toBeLessThan(otherwise);
  expect(rules).not.toContain('standIn');
});

test('the app going to the background and a page starting to load turn the microphone off', () => {
  expect(swift).toContain('UIApplication.didEnterBackgroundNotification');
  expect(rust).toMatch(/PageLoadEvent::Started[\s\S]*?end_dictation\(\)/);
  expect(rust).toContain('pub use commands::end_dictation;');
});
