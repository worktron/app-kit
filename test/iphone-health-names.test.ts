/*
 * The plugin's Rust and Swift and the page half share names no compiler checks across them: a Rust `extern "C"`
 * function resolves to a Swift `@_cdecl` only when an app links, and a command name is a string. The kit has no iPhone
 * app to link or run, so this reads the sources and holds them together.
 */
import { expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BATCH_LIMIT, COMMANDS, HEART_RATE_BATCH_LIMIT, KEPT_LIMIT, KEPT_OUTCOMES, KEYS, LOG_PREFIX, OUTCOMES, PLUGIN, TRIGGERS } from '../tauri/iphone-health/names';

const plugin = join(import.meta.dir, '../tauri/iphone-health/plugin');
const read = (path: string) => readFileSync(join(plugin, path), 'utf8');
const swift = read('ios/Sources/IphoneHealthPlugin.swift');
const rules = read('ios/Sources/HealthSync.swift');
const rust = ['src/lib.rs', 'src/commands.rs', 'src/mobile.rs'].map(read).join('\n');
const crate = read('Cargo.toml').match(/^name = "(.+)"$/m)![1];

test('every native function the Rust calls is one the Swift defines, and the other way round', () => {
  const externBlocks = [...rust.matchAll(/extern "C" \{([\s\S]*?)\n\s*\}/g)].map((m) => m[1]).join('\n');
  const called = [...externBlocks.matchAll(/fn (\w+)\(/g)].map((m) => m[1]);
  const binding = rust.match(/ios_plugin_binding!\((\w+)\)/)![1];
  // The Simulator's and the phone's made-up samples are one function each, in either branch of an #if.
  const defined = [...new Set([...swift.matchAll(/@_cdecl\("(\w+)"\)/g)].map((m) => m[1]))];
  expect(called.length).toBe(4);
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
  for (const file of ['IphoneHealthPlugin.swift', 'HealthSync.swift']) expect(build).toContain(`ios/Sources/${file}`);
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
  expect(rules).toContain(`let heartRateAddressKey = "${KEYS.heartRate.address}"`);
  expect(rules).toContain(`let heartRateAnchorKey = "${KEYS.heartRate.anchor}"`);
  expect(rules).toContain(`let heartRateEarlierKey = "${KEYS.heartRate.earlier}"`);
  expect(rules).toContain(`let heartRateBatchLimit = ${HEART_RATE_BATCH_LIMIT}`);
  expect(swift).toContain(`private let logPrefix = "${LOG_PREFIX}"`);
});

test('the triggers and outcomes the Swift sends are the ones the page and the server read', () => {
  const triggers = rules.match(/enum HealthTrigger[\s\S]*?\n\}/)![0];
  expect([...triggers.matchAll(/case \w+ = "([^"]+)"/g)].map((m) => m[1])).toEqual([...TRIGGERS]);
  const outcomes = rules.match(/enum HealthOutcome[\s\S]*?\n\}/)![0];
  expect([...outcomes.matchAll(/case \w+ = "([^"]+)"/g)].map((m) => m[1])).toEqual([...OUTCOMES]);
  const kept = outcomes.match(/var kept: Bool[\s\S]*?case (\.[\w, .]+): return true/)![1];
  const keptNames = kept.split(',').map((c) => c.trim().slice(1));
  const named = Object.fromEntries([...outcomes.matchAll(/case (\w+) = "([^"]+)"/g)].map((m) => [m[1], m[2]]));
  expect(keptNames.map((c) => named[c])).toEqual([...KEPT_OUTCOMES]);
});

test('Health is read through the anchored query, with the watcher and background delivery', () => {
  expect(swift).toContain('HKAnchoredObjectQuery(type: sleepType, predicate: nil, anchor: anchor, limit: limit)');
  expect(swift).toContain('HKObserverQuery(sampleType: type');
  expect(swift).toContain('enableBackgroundDelivery(for: type, frequency: frequency)');
  expect(swift).toContain('TypeWatcher(type: sleepType, frequency: .immediate');
  expect(swift).toContain('errorDatabaseInaccessible');
  expect(swift).toContain('requiringSecureCoding: true');
});

test('heart rate is read with its own anchor, its series expanded, and woken for at most hourly', () => {
  expect(swift).toContain('HKAnchoredObjectQuery(type: heartRateType, predicate: nil, anchor: anchor, limit: limit)');
  expect(swift).toContain('TypeWatcher(type: heartRateType, frequency: .hourly');
  expect(swift).toMatch(/HKQuantitySeriesSampleQuery\(quantityType: heartRateType, predicate: HKQuery\.predicateForObjects\(with: ids\)\)/);
  expect(swift).toContain('query.includeSample = true');
  expect(swift).toContain('query.orderByQuantitySampleStartDate = true');
  expect(swift).toContain('HKUnit.count().unitDivided(by: .minute())');
  // Sleep and heart rate keep their places, addresses and kept attempts under their own keys.
  expect(swift).toContain('SavedState(address: addressKey, anchor: anchorKey, earlier: earlierKey)');
  expect(swift).toContain('SavedState(address: heartRateAddressKey, anchor: heartRateAnchorKey, earlier: heartRateEarlierKey)');
  expect(swift).toContain('batch: heartRateBatchLimit, words: .heartRate');
});

test('heart rate goes by its own answer from Health, not sleep\'s', () => {
  // An app upgraded from sleep alone has sleep's answer and not heart rate's, and a watcher started before the answer
  // never wakes, so every watch and sync of heart rate waits on heart rate's own question.
  expect(swift).toMatch(/func heartRateQuestionAnswered[^}]*questionAnswered\(read: heartRateType/);
  const heartRateWatches = [...swift.matchAll(/heartRateSync\.watchIfReady\(/g)].length;
  const gated = [...swift.matchAll(/heartRateQuestionAnsweredIfAsked \{ answered in\s+heartRateSync\.watchIfReady/g)].length;
  expect(heartRateWatches).toBe(3);
  expect(gated).toBe(3);
  expect(swift).not.toMatch(/healthQuestionAnswered \{[^}]*heartRateSync/);
  // The start asks only what is still to ask once heart rate is wanted, and sleep alone as it always has.
  expect(swift).toContain('guard heartRate else { return askForHealth(share: writeOnSimulator([sleepType]), read: [sleepType]) }');
  expect(swift).toContain('.filter(stillToAsk)');
  // A start without heart rate stops it before any way out of the start, and waits for its wakes to be off, so a start
  // that then fails still stops it, and one right after that gives it again turns them on last.
  const start = swift.slice(swift.indexOf('func startDirect('));
  expect(start.indexOf('if heartRateAddress == nil { stopHeartRate() }')).toBeGreaterThan(0);
  expect(start.indexOf('if heartRateAddress == nil { stopHeartRate() }')).toBeLessThan(start.indexOf('return json('));
  expect(swift).toMatch(/func stopHeartRate\(\)[\s\S]*?disableBackgroundDelivery\(for: heartRateType\) \{ _, _ in stopped\.signal\(\) \}[\s\S]*?stopped\.wait\(\)/);
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

test('the phone is marked as unlocked since it started whenever iOS says its data is readable', () => {
  expect(swift).toMatch(/if app\.isProtectedDataAvailable \{ markUnlocked\(\) \}/);
  expect(swift).toMatch(/protectedDataDidBecomeAvailableNotification[\s\S]*?markUnlocked\(\)[\s\S]*?watchIfReady/);
  expect(swift).toContain('.completeFileProtectionUntilFirstUserAuthentication');
});

test('the made-up nights write to Health only in a Simulator build', () => {
  // Each stretch from `#if targetEnvironment(simulator)` to its `#else`, the only code a Simulator build alone has.
  const simulatorOnly = [...swift.matchAll(/#if targetEnvironment\(simulator\)/g)].map((match) => [match.index, swift.indexOf('#else', match.index)]);
  expect(simulatorOnly.length).toBeGreaterThan(0);
  const outside = simulatorOnly.reduceRight((rest, [from, to]) => rest.slice(0, from) + rest.slice(to), swift);
  for (const write of ['healthStore.save(', 'healthStore.delete(', 'askForHealth(share: [sleepType]', 'askForHealth(share: [heartRateType]', 'HKQuantitySeriesSampleBuilder', '? Set(types) : nil']) {
    const at = swift.indexOf(write);
    expect(simulatorOnly.some(([from, to]) => at > from && at < to)).toBe(true);
    expect(outside).not.toContain(write);
  }
  // Start asks to write only through the helper that answers nil outside a Simulator build.
  expect(outside).toContain('askForHealth(share: writeOnSimulator([sleepType]), read: [sleepType])');
  expect(outside).toContain('askForHealth(share: writeOnSimulator(types), read: Set(types))');
  expect(outside).toMatch(/func writeOnSimulator\(_ types: \[HKSampleType\]\)[^}]*#else\s+return nil\s+#endif/);
  expect(outside).not.toContain('askForHealth(share: [');
});
