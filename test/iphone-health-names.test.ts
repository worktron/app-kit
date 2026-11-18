/*
 * The plugin's Rust and Swift and the page half share names no compiler checks across them: a Rust `extern "C"`
 * function resolves to a Swift `@_cdecl` only when an app links, and a command name is a string. The kit has no iPhone
 * app to link or run, so this reads the sources and holds them together.
 */
import { expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BATCH_LIMIT, COMMANDS, KEPT_LIMIT, KEPT_OUTCOMES, KEYS, LOG_PREFIX, OUTCOMES, PLUGIN, TRIGGERS } from '../tauri/iphone-health/names';

const plugin = join(import.meta.dir, '../tauri/iphone-health/plugin');
const read = (path: string) => readFileSync(join(plugin, path), 'utf8');
const swift = read('ios/Sources/IphoneHealthPlugin.swift');
const rules = read('ios/Sources/SleepSync.swift');
const rust = ['src/lib.rs', 'src/commands.rs', 'src/mobile.rs'].map(read).join('\n');
const crate = read('Cargo.toml').match(/^name = "(.+)"$/m)![1];

test('every native function the Rust calls is one the Swift defines, and the other way round', () => {
  const externBlocks = [...rust.matchAll(/extern "C" \{([\s\S]*?)\n\s*\}/g)].map((m) => m[1]).join('\n');
  const called = [...externBlocks.matchAll(/fn (\w+)\(/g)].map((m) => m[1]);
  const binding = rust.match(/ios_plugin_binding!\((\w+)\)/)![1];
  // The Simulator's and the phone's `iphone_health_simulator_sleep` are one function, in either branch of an #if.
  const defined = [...new Set([...swift.matchAll(/@_cdecl\("(\w+)"\)/g)].map((m) => m[1]))];
  expect(called.length).toBe(3);
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
  for (const file of ['IphoneHealthPlugin.swift', 'SleepSync.swift']) expect(build).toContain(`ios/Sources/${file}`);
});

test('the Swift package builds the product named after the crate, which is what Tauri links', () => {
  const pkg = read('ios/Package.swift');
  expect([...pkg.matchAll(/name: "([\w-]+)"/g)].map((m) => m[1]).filter((n) => n !== 'Tauri')).toEqual([crate, crate, crate]);
});

test('the Swift saves under the keys and limits the page names, and logs as the page does', () => {
  expect(rules).toContain(`let addressKey = "${KEYS.address}"`);
  expect(rules).toContain(`let anchorKey = "${KEYS.anchor}"`);
  expect(rules).toContain(`let earlierKey = "${KEYS.earlier}"`);
  expect(rules).toContain(`let keptLimit = ${KEPT_LIMIT}`);
  expect(rules).toContain(`let batchLimit = ${BATCH_LIMIT}`);
  expect(swift).toContain(`private let logPrefix = "${LOG_PREFIX}"`);
});

test('the triggers and outcomes the Swift sends are the ones the page and the server read', () => {
  const triggers = rules.match(/enum SleepTrigger[\s\S]*?\n\}/)![0];
  expect([...triggers.matchAll(/case \w+ = "([^"]+)"/g)].map((m) => m[1])).toEqual([...TRIGGERS]);
  const outcomes = rules.match(/enum SleepOutcome[\s\S]*?\n\}/)![0];
  expect([...outcomes.matchAll(/case \w+ = "([^"]+)"/g)].map((m) => m[1])).toEqual([...OUTCOMES]);
  const kept = outcomes.match(/var kept: Bool[\s\S]*?case (\.[\w, .]+): return true/)![1];
  const keptNames = kept.split(',').map((c) => c.trim().slice(1));
  const named = Object.fromEntries([...outcomes.matchAll(/case (\w+) = "([^"]+)"/g)].map((m) => [m[1], m[2]]));
  expect(keptNames.map((c) => named[c])).toEqual([...KEPT_OUTCOMES]);
});

test('Health is read through the anchored query, with the watcher and background delivery', () => {
  expect(swift).toContain('HKAnchoredObjectQuery(type: sleepType, predicate: nil, anchor: anchor, limit: limit)');
  expect(swift).toContain('HKObserverQuery(sampleType: sleepType');
  expect(swift).toContain('enableBackgroundDelivery(for: sleepType, frequency: .immediate)');
  expect(swift).toContain('errorDatabaseInaccessible');
  expect(swift).toContain('requiringSecureCoding: true');
});

test('the send refuses redirects and asks iOS for time to finish', () => {
  expect(swift).toMatch(/willPerformHTTPRedirection[\s\S]*?completionHandler\(nil\)/);
  expect(swift).toContain('delegate: NoRedirects()');
  expect(swift).toMatch(/beginBackgroundTask[\s\S]*?coordinator\.expire\(\)/);
});

test('Health’s watcher answers every call, its errors included', () => {
  const watcher = swift.match(/HKObserverQuery\(sampleType[\s\S]*?healthStore\.execute\(query\)/)![0];
  expect(watcher.match(/completionHandler\(\)/g)!.length).toBe(2);
});

test('the made-up nights write to Health only in a Simulator build', () => {
  const simulatorOnly = swift.indexOf('#if targetEnvironment(simulator)');
  const otherwise = swift.indexOf('#else', simulatorOnly);
  expect(simulatorOnly).toBeGreaterThan(-1);
  for (const write of ['healthStore.save(', 'healthStore.delete(', 'askForHealth(share: [sleepType]']) {
    const at = swift.indexOf(write);
    expect(at).toBeGreaterThan(simulatorOnly);
    expect(at).toBeLessThan(otherwise);
  }
  expect(swift.slice(0, simulatorOnly)).toContain('askForHealth(share: nil, read: [sleepType])');
  expect(swift.slice(0, simulatorOnly)).not.toContain('askForHealth(share: [');
});
