/*
 * The page half of iPhone Health over a stand-in for the plugin's commands. What the plugin sends and when is held by
 * its Swift tests (tauri/iphone-health/plugin/ios/Tests/main.swift), run in scripts/gates.sh.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { simulatorHeartRate, simulatorSleep, startIphoneHealth, type HealthSend, type Invoke } from '../tauri/iphone-health';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const realAgent = navigator.userAgent;
const realLog = console.log;
const realError = console.error;

beforeEach(() => {
  console.log = console.error = () => {};
});

afterEach(() => {
  console.log = realLog;
  console.error = realError;
  Object.defineProperty(navigator, 'userAgent', { value: realAgent, configurable: true });
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

function onIphoneApp() {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  Object.defineProperty(navigator, 'userAgent', { value: IPHONE, configurable: true });
}

function plugin(answer: unknown | Error) {
  const calls: { command: string; args?: Record<string, unknown> }[] = [];
  const invoke: Invoke = (command, args) => {
    calls.push({ command, args });
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  return { calls, invoke };
}

test('on an iPhone app the start gives the plugin the address and answers how the send ended', async () => {
  onIphoneApp();
  const { calls, invoke } = plugin({ outcome: 'sent', samples: 6, deleted: 0, status: 200 });
  const answer = await startIphoneHealth({ endpoint: 'https://hub.example.com/api/sleep', invoke });
  expect(calls).toEqual([{ command: 'plugin:iphone-health|start', args: { endpoint: 'https://hub.example.com/api/sleep' } }]);
  expect(answer).toEqual({ outcome: 'sent', samples: 6, deleted: 0, status: 200 });
});

test('the start passes the heart-rate address and answers both counts', async () => {
  onIphoneApp();
  const heartRate: HealthSend = { outcome: 'sent', samples: 5000, deleted: 3, status: 200 };
  const { calls, invoke } = plugin({ outcome: 'nothing new', samples: 0, deleted: 0, status: null, heartRate });
  const answer = await startIphoneHealth({ endpoint: 'https://hub.example.com/api/sleep', heartRateEndpoint: 'https://hub.example.com/api/heart-rate', invoke });
  expect(calls).toEqual([
    { command: 'plugin:iphone-health|start', args: { endpoint: 'https://hub.example.com/api/sleep', heartRateEndpoint: 'https://hub.example.com/api/heart-rate' } },
  ]);
  expect(answer?.heartRate).toEqual(heartRate);
});

test('without a heart-rate address the start passes none, which stops heart rate’s sends', async () => {
  onIphoneApp();
  const { calls, invoke } = plugin({ outcome: 'sent', samples: 1, deleted: 0, status: 200 });
  await startIphoneHealth({ endpoint: 'https://hub.example.com/api/sleep', invoke });
  expect(calls[0].args).toEqual({ endpoint: 'https://hub.example.com/api/sleep' });
});

test('a build without the plugin answers null and the page goes on', async () => {
  onIphoneApp();
  const { invoke } = plugin(new Error('plugin iphone-health not found'));
  expect(await startIphoneHealth({ endpoint: 'https://hub.example.com/api/sleep', invoke })).toBeNull();
});

test('anywhere but an iPhone app nothing is called', async () => {
  const { calls, invoke } = plugin({ outcome: 'sent' });
  expect(await startIphoneHealth({ endpoint: 'https://hub.example.com/api/sleep', invoke })).toBeNull();
  expect(await simulatorSleep('add', { invoke })).toEqual({ error: 'not an iPhone app' });
  expect(await simulatorHeartRate('add', { invoke })).toEqual({ error: 'not an iPhone app' });
  expect(calls).toEqual([]);
});

test('the Simulator’s made-up nights go through their own command', async () => {
  onIphoneApp();
  const { calls, invoke } = plugin({ deleted: 'ABC' });
  expect(await simulatorSleep('delete', { invoke })).toEqual({ deleted: 'ABC' });
  expect(calls).toEqual([{ command: 'plugin:iphone-health|simulator_sleep', args: { action: 'delete' } }]);
});

test('the Simulator’s made-up heart rate goes through its own command', async () => {
  onIphoneApp();
  const { calls, invoke } = plugin({ added: 72, series: [{ uuid: 'S', count: 60 }] });
  expect(await simulatorHeartRate('add', { invoke })).toEqual({ added: 72, series: [{ uuid: 'S', count: 60 }] });
  expect(calls).toEqual([{ command: 'plugin:iphone-health|simulator_heart_rate', args: { action: 'add' } }]);
});
