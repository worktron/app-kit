import { afterEach, beforeEach, expect, test } from 'bun:test';
import { startIphoneNotifications, tappedPage, type Invoke, type IphoneDevice } from '../tauri/iphone-notifications';
import { TAPPED_EVENT } from '../tauri/iphone-notifications/names';

const ORIGIN = 'http://localhost:5173';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const realAgent = navigator.userAgent;

let stop = () => {};

function setAgent(agent: string) {
  Object.defineProperty(navigator, 'userAgent', { value: agent, configurable: true });
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** The plugin's side: a tapped address it hands over once, and a device token after permission. */
function phone(opts: { permission?: Promise<{ granted: boolean }>; token?: () => Promise<unknown> } = {}) {
  let tapped: string | null = null;
  const calls: string[] = [];
  const invoke: Invoke = async (command) => {
    calls.push(command);
    if (command === 'plugin:iphone-notifications|take_tapped_address') {
      const address = tapped;
      tapped = null;
      return address;
    }
    if (command === 'plugin:iphone-notifications|request_permission') return opts.permission ?? { granted: true };
    if (command === 'plugin:iphone-notifications|get_token') return opts.token ? opts.token() : { token: 'ab12', environment: 'development' };
    throw new Error(`unknown command ${command}`);
  };
  return { invoke, calls, tap: (address: string) => (tapped = address) };
}

/** Every line the page half logs, and a wait for the line that means a step is done. */
const realConsole = { log: console.log, warn: console.warn, error: console.error };
let lines: string[] = [];
let waiters: { text: string; resolve: () => void }[] = [];
function record(...args: unknown[]) {
  const line = args.map(String).join(' ');
  lines.push(line);
  waiters = waiters.filter((w) => (line.includes(w.text) ? (w.resolve(), false) : true));
}
function logged(text: string): Promise<void> {
  if (lines.some((line) => line.includes(text))) return Promise.resolve();
  return new Promise((resolve) => waiters.push({ text, resolve }));
}

beforeEach(() => {
  lines = [];
  waiters = [];
  console.log = console.warn = console.error = record;
  setAgent(IPHONE);
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  setVisibility('visible');
});

afterEach(() => {
  Object.assign(console, realConsole);
  stop();
  stop = () => {};
  setAgent(realAgent);
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

test('a tapped address on the app’s own site opens as its path, query and fragment', () => {
  expect(tappedPage('/', ORIGIN)).toBe('/');
  expect(tappedPage('/a?b#c', ORIGIN)).toBe('/a?b#c');
  expect(tappedPage(`${ORIGIN}/alerts/3?x=1#top`, ORIGIN)).toBe('/alerts/3?x=1#top');
});

test('a tapped address on another site, or one a browser would read as another site, is refused', () => {
  expect(tappedPage('https://evil.example.com/alerts', ORIGIN)).toBeNull();
  expect(tappedPage('//evil.example.com/x', ORIGIN)).toBeNull();
  expect(tappedPage(`${ORIGIN}//evil.example.com/x?q=1#f`, ORIGIN)).toBeNull();
  expect(tappedPage(`${ORIGIN}/\\evil.example.com`, ORIGIN)).toBeNull();
  expect(tappedPage('http://localhost:5174/alerts', ORIGIN)).toBeNull();
  expect(tappedPage('javascript:alert(1)', ORIGIN)).toBeNull();
  expect(tappedPage('http://[', ORIGIN)).toBeNull();
});

test('a tap that launched the app opens its page when the page starts', async () => {
  const p = phone();
  p.tap('/alerts/3');
  const opened: string[] = [];
  stop = startIphoneNotifications({ register: async () => {}, open: (page) => opened.push(page), invoke: p.invoke });
  await logged('opened /alerts/3 from a tap');
  expect(opened).toEqual(['/alerts/3']);
});

test('a tap with the app in the background opens its page when the app comes back in front, once', async () => {
  const p = phone();
  const opened: string[] = [];
  stop = startIphoneNotifications({ register: async () => {}, open: (page) => opened.push(page), invoke: p.invoke });
  setVisibility('hidden');
  p.tap('/digest');
  setVisibility('visible');
  await logged('opened /digest from a tap');
  // Back in front again with no new tap, then a later tap: only the later one opens next.
  setVisibility('hidden');
  setVisibility('visible');
  p.tap('/later');
  window.dispatchEvent(new Event(TAPPED_EVENT));
  await logged('opened /later from a tap');
  expect(opened).toEqual(['/digest', '/later']);
});

test('a tap on a banner with the app in front opens its page on the plugin’s event, once', async () => {
  const p = phone();
  const opened: string[] = [];
  stop = startIphoneNotifications({ register: async () => {}, open: (page) => opened.push(page), invoke: p.invoke });
  p.tap(`${ORIGIN}/alerts/9`);
  window.dispatchEvent(new Event(TAPPED_EVENT));
  await logged('opened /alerts/9 from a tap');
  window.dispatchEvent(new Event(TAPPED_EVENT));
  p.tap('/alerts/10');
  window.dispatchEvent(new Event(TAPPED_EVENT));
  await logged('opened /alerts/10 from a tap');
  expect(opened).toEqual(['/alerts/9', '/alerts/10']);
});

test('a tap on another site is taken and never opened', async () => {
  const p = phone();
  p.tap('https://evil.example.com/');
  const opened: string[] = [];
  stop = startIphoneNotifications({ register: async () => {}, open: (page) => opened.push(page), invoke: p.invoke });
  await logged('refused a tap on https://evil.example.com/: not a page of http://localhost:5173');
  expect(opened).toEqual([]);
});

test('a permission question nobody answers still lets a tap open', async () => {
  const p = phone({ permission: new Promise(() => {}) });
  p.tap('/alerts/1');
  const opened: string[] = [];
  const registered: IphoneDevice[] = [];
  stop = startIphoneNotifications({ register: async (d) => void registered.push(d), open: (page) => opened.push(page), invoke: p.invoke });
  await logged('opened /alerts/1 from a tap');
  expect(opened).toEqual(['/alerts/1']);
  expect(registered).toEqual([]);
});

test('the phone registers with its token and Apple environment', async () => {
  const p = phone();
  const registered: IphoneDevice[] = [];
  stop = startIphoneNotifications({ register: async (d) => void registered.push(d), invoke: p.invoke });
  await logged('registered this phone for development');
  expect(registered).toEqual([{ token: 'ab12', environment: 'development' }]);
});

test('no token, a refused permission or a failed registration leaves the app working', async () => {
  const noToken = phone({ token: async () => ({ token: '', environment: 'production' }) });
  const registered: IphoneDevice[] = [];
  const stopNoToken = startIphoneNotifications({ register: async (d) => void registered.push(d), open: () => {}, invoke: noToken.invoke });
  await logged('no device token from Apple: not registered');
  stopNoToken();
  expect(registered).toEqual([]);

  const unsigned = phone({ permission: Promise.resolve({ granted: false }), token: () => Promise.reject(new Error('no push entitlement')) });
  const stopUnsigned = startIphoneNotifications({ register: async (d) => void registered.push(d), open: () => {}, invoke: unsigned.invoke });
  await logged('notifications not allowed');
  await logged('registration failed');
  stopUnsigned();
  expect(registered).toEqual([]);

  lines = [];
  const offline = phone();
  offline.tap('/after');
  const opened: string[] = [];
  stop = startIphoneNotifications({ register: () => Promise.reject(new Error('offline')), open: (page) => opened.push(page), invoke: offline.invoke });
  await logged('registration failed');
  await logged('opened /after from a tap');
  expect(opened).toEqual(['/after']);
});

test('the Mac app and a browser make no plugin call', () => {
  for (const [agent, tauri] of [[MAC, true], [IPHONE, false]] as const) {
    setAgent(agent);
    if (!tauri) delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    const p = phone();
    const stopOne = startIphoneNotifications({ register: async () => {}, open: () => {}, invoke: p.invoke });
    setVisibility('hidden');
    setVisibility('visible');
    window.dispatchEvent(new Event(TAPPED_EVENT));
    stopOne();
    // Each call starts synchronously, so a call made would be here already.
    expect(p.calls).toEqual([]);
  }
});
