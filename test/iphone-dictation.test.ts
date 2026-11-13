/*
 * The page half of iPhone dictation over a stand-in for the plugin's commands, with the timer it asks by run by hand.
 * The plugin's own rules (which words settle, which start a token lets run) are held by its Swift tests, run in
 * scripts/gates.sh.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { AppRecognition, iphoneDictationReady, POLL_EVERY, STOP_WAIT, type AppRecognitionResultEvent, type Every, type Invoke } from '../tauri/iphone-dictation';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const realAgent = navigator.userAgent;
const realLog = console.log;
const realWarn = console.warn;

beforeEach(() => {
  console.log = console.warn = () => {};
});

afterEach(() => {
  console.log = realLog;
  console.warn = realWarn;
  Object.defineProperty(navigator, 'userAgent', { value: realAgent, configurable: true });
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

interface Call {
  command: string;
  args?: Record<string, unknown>;
}

/**
 * The plugin's side: a start whose answer the test lets go, what it has heard, and every call. `ask()` runs the page's
 * timer once and waits until the page has taken the answer.
 */
function plugin() {
  const calls: Call[] = [];
  let letStart: (token: number) => void = () => {};
  let started: Promise<{ token: number }> = new Promise((resolve) => (letStart = (token) => resolve({ token })));
  const heard = { words: '', ended: false, error: null as string | null };
  let lastAnswer: Promise<unknown> = Promise.resolve();
  let failHeard: string | null = null;
  const invoke: Invoke = (command, args) => {
    calls.push({ command, args });
    if (command === 'plugin:iphone-dictation|start_dictation') return started;
    if (command === 'plugin:iphone-dictation|dictation_heard') {
      lastAnswer = failHeard ? Promise.reject(new Error(failHeard)) : Promise.resolve({ ...heard });
      return lastAnswer;
    }
    if (command === 'plugin:iphone-dictation|stop_dictation' || command === 'plugin:iphone-dictation|cancel_dictation') return Promise.resolve(null);
    return Promise.reject(new Error(`unknown command ${command}`));
  };
  let run: (() => void) | null = null;
  let interval = 0;
  const every: Every = (ms, tick) => {
    interval = ms;
    run = tick;
    return () => (run = null);
  };
  return {
    calls,
    heard,
    invoke,
    every,
    interval: () => interval,
    polling: () => run !== null,
    async letStart(token: number) {
      letStart(token);
      await started;
      await Promise.resolve();
    },
    async ask() {
      if (!run) throw new Error('the page is not asking');
      run();
      await lastAnswer.catch(() => {});
      await Promise.resolve();
    },
    failHeardWith(message: string) {
      failHeard = message;
    },
    named: (command: string) => calls.filter((c) => c.command === `plugin:iphone-dictation|${command}`),
  };
}

function listen(p: ReturnType<typeof plugin>) {
  const r = new AppRecognition({ invoke: p.invoke, every: p.every });
  const results: { words: string; isFinal: boolean }[] = [];
  const errors: string[] = [];
  let ends = 0;
  r.onresult = (e: AppRecognitionResultEvent) => results.push({ words: e.results[0][0].transcript, isFinal: e.results[0].isFinal });
  r.onerror = (e) => errors.push(e.error);
  r.onend = () => ends++;
  return { r, results, errors, ends: () => ends };
}

test('it has the web SpeechRecognition’s shape and waits three seconds for the last words', () => {
  const r = new AppRecognition();
  expect(r.continuous).toBe(true);
  expect(r.interimResults).toBe(true);
  expect(r.lang).toBe('');
  expect([r.onresult, r.onerror, r.onend]).toEqual([null, null, null]);
  expect(typeof r.start).toBe('function');
  expect(typeof r.stop).toBe('function');
  expect(typeof r.abort).toBe('function');
  expect(r.stopWait).toBe(3000);
  expect(STOP_WAIT).toBe(3000);
});

test('a start sends the language and asks what it heard every 150 ms, handing each change on as the web would', async () => {
  const p = plugin();
  const l = listen(p);
  l.r.lang = 'en-US';
  l.r.start();
  expect(p.named('start_dictation')[0].args).toEqual({ lang: 'en-US' });
  await p.letStart(7);
  expect(p.interval()).toBe(POLL_EVERY);
  expect(POLL_EVERY).toBe(150);
  p.heard.words = 'Is it';
  await p.ask();
  await p.ask();
  p.heard.words = 'Is it raining?';
  await p.ask();
  expect(p.named('dictation_heard').map((c) => c.args)).toEqual([{ token: 7 }, { token: 7 }, { token: 7 }]);
  expect(l.results).toEqual([
    { words: 'Is it', isFinal: false },
    { words: 'Is it raining?', isFinal: false },
  ]);
});

test('a page that joins the results’ transcripts, as one written for the web does, gets the punctuated words whole', async () => {
  const p = plugin();
  const r = new AppRecognition({ invoke: p.invoke, every: p.every });
  let heard = '';
  r.onresult = (e) => {
    heard = Array.from(e.results).map((x) => x[0]?.transcript ?? '').join(' ');
  };
  r.start();
  await p.letStart(1);
  p.heard.words = 'Hello there. How are you?';
  await p.ask();
  expect(heard).toBe('Hello there. How are you?');
});

test('a stop sends the stop, and the last words come final before the one end', async () => {
  const p = plugin();
  const l = listen(p);
  l.r.start();
  await p.letStart(3);
  p.heard.words = 'Bring a';
  await p.ask();
  l.r.stop();
  l.r.stop();
  expect(p.named('stop_dictation').map((c) => c.args)).toEqual([{ token: 3 }]);
  expect(l.ends()).toBe(0);
  p.heard.words = 'Bring a coat.';
  p.heard.ended = true;
  await p.ask();
  expect(l.results.at(-1)).toEqual({ words: 'Bring a coat.', isFinal: true });
  expect(l.ends()).toBe(1);
  expect(l.errors).toEqual([]);
  expect(p.polling()).toBe(false);
});

test('a stop before the plugin answered the start is sent with the token once it comes', async () => {
  const p = plugin();
  const l = listen(p);
  l.r.start();
  l.r.stop();
  expect(p.named('stop_dictation')).toEqual([]);
  await p.letStart(4);
  expect(p.named('stop_dictation').map((c) => c.args)).toEqual([{ token: 4 }]);
  p.heard.ended = true;
  await p.ask();
  expect(l.ends()).toBe(1);
  expect(l.results).toEqual([]);
});

test('an abort before the plugin answered the start cancels that start when its token comes, and never asks', async () => {
  const p = plugin();
  const l = listen(p);
  l.r.start();
  l.r.abort();
  expect(l.errors).toEqual(['aborted']);
  expect(l.ends()).toBe(1);
  await p.letStart(5);
  expect(p.named('cancel_dictation').map((c) => c.args)).toEqual([{ token: 5 }]);
  expect(p.polling()).toBe(false);
});

test('an abort while listening cancels, ends once, and later answers change nothing', async () => {
  const p = plugin();
  const l = listen(p);
  l.r.start();
  await p.letStart(6);
  l.r.abort();
  l.r.abort();
  expect(p.named('cancel_dictation').map((c) => c.args)).toEqual([{ token: 6 }]);
  expect(l.ends()).toBe(1);
  expect(p.polling()).toBe(false);
});

test('an error from the plugin comes in the web’s words, then the end', async () => {
  const p = plugin();
  const l = listen(p);
  l.r.start();
  await p.letStart(8);
  p.heard.ended = true;
  p.heard.error = 'not-allowed';
  await p.ask();
  expect(l.errors).toEqual(['not-allowed']);
  expect(l.ends()).toBe(1);
});

test('a start the plugin refuses, as anywhere but an iPhone, is an error and an end', async () => {
  const l = listen(plugin());
  const r = new AppRecognition({ invoke: () => Promise.reject(new Error('dictation through Apple’s speech recognizer is on the iPhone only')) });
  r.onerror = l.r.onerror;
  r.onend = l.r.onend;
  r.start();
  await Promise.resolve();
  await Promise.resolve();
  expect(l.errors).toEqual(['dictation through Apple’s speech recognizer is on the iPhone only']);
  expect(l.ends()).toBe(1);
});

test('a failed read of what it heard cancels the start and ends with the reason', async () => {
  const p = plugin();
  const l = listen(p);
  l.r.start();
  await p.letStart(9);
  p.failHeardWith('the plugin is gone');
  await p.ask();
  expect(p.named('cancel_dictation').map((c) => c.args)).toEqual([{ token: 9 }]);
  expect(l.errors).toEqual(['the plugin is gone']);
  expect(l.ends()).toBe(1);
});

test('with interim results off only the final words come', async () => {
  const p = plugin();
  const l = listen(p);
  l.r.interimResults = false;
  l.r.start();
  await p.letStart(2);
  p.heard.words = 'Half';
  await p.ask();
  p.heard.words = 'Half done.';
  p.heard.ended = true;
  await p.ask();
  expect(l.results).toEqual([{ words: 'Half done.', isFinal: true }]);
});

test('each object listens once, as the web’s does', async () => {
  const p = plugin();
  const r = new AppRecognition({ invoke: p.invoke, every: p.every });
  r.start();
  expect(() => r.start()).toThrow('already started');
});

test('dictation is ready only in the iPhone app whose build has the plugin', async () => {
  const p = plugin();
  expect(await iphoneDictationReady({ invoke: p.invoke })).toBe(false);
  expect(p.calls).toEqual([]);
  Object.defineProperty(navigator, 'userAgent', { value: IPHONE, configurable: true });
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  expect(await iphoneDictationReady({ invoke: p.invoke })).toBe(true);
  expect(await iphoneDictationReady({ invoke: () => Promise.reject(new Error('plugin iphone-dictation not found')) })).toBe(false);
});
