// The page half of Web Push, against a stand-in browser: its push manager, its worker container and its permission.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { ApiError } from '../web/fetch';
import { startWebPush, turnOffWebPush, turnOnWebPush, webPushState, WORKER_ADDRESS, type WebPushSubscription } from '../web/push/page';

const KEY = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
const OTHER_KEY = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

const decode = (key: string) => Uint8Array.from(Buffer.from(key, 'base64url'));

/** The stand-in browser: what the page asked of it, in order, and the subscription it holds. */
let browser: {
  permission: NotificationPermission;
  answer: NotificationPermission;
  calls: string[];
  subscription: FakeSubscription | null;
  made: number;
};

class FakeSubscription {
  readonly endpoint: string;
  readonly options: { applicationServerKey: ArrayBuffer };
  constructor(key: Uint8Array) {
    browser.made++;
    this.endpoint = `https://fcm.googleapis.com/fcm/send/phone-${browser.made}`;
    this.options = { applicationServerKey: key.slice().buffer };
  }
  toJSON() {
    return { endpoint: this.endpoint, keys: { p256dh: `p256dh-${browser.made}`, auth: 'auth' } };
  }
  async unsubscribe() {
    browser.calls.push(`unsubscribe ${this.endpoint}`);
    if (browser.subscription === this) browser.subscription = null;
    return true;
  }
}

const registration = {
  pushManager: {
    getSubscription: async () => browser.subscription,
    subscribe: async ({ applicationServerKey }: { applicationServerKey: Uint8Array }) => {
      browser.calls.push('subscribe');
      browser.subscription = new FakeSubscription(applicationServerKey);
      return browser.subscription;
    },
  },
};

function place(agent: string, { standalone = false, tauri = false, touch = 0 } = {}) {
  Object.defineProperty(navigator, 'userAgent', { value: agent, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touch, configurable: true });
  Object.defineProperty(navigator, 'standalone', { value: standalone, configurable: true });
  Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false }), configurable: true });
  if (tauri) Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
}

const realMatchMedia = window.matchMedia;
const realConsole = { log: console.log, error: console.error };
beforeEach(() => {
  browser = { permission: 'default', answer: 'granted', calls: [], subscription: null, made: 0 };
  console.log = () => {};
  console.error = () => {};
  localStorage.clear();
  Object.defineProperty(window, 'PushManager', { value: function PushManager() {}, configurable: true });
  Object.defineProperty(window, 'Notification', {
    value: {
      get permission() {
        return browser.permission;
      },
      requestPermission: async () => {
        browser.calls.push('ask');
        browser.permission = browser.answer;
        return browser.answer;
      },
    },
    configurable: true,
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      register: async (address: string) => {
        browser.calls.push(`register ${address}`);
        return registration;
      },
      get ready() {
        return Promise.resolve(registration);
      },
      getRegistration: async () => registration,
    },
    configurable: true,
  });
  place(ANDROID, { standalone: true });
});
afterEach(() => {
  console.log = realConsole.log;
  console.error = realConsole.error;
  for (const name of ['PushManager', 'Notification', '__TAURI_INTERNALS__']) delete (window as unknown as Record<string, unknown>)[name];
  for (const name of ['serviceWorker', 'userAgent', 'maxTouchPoints', 'standalone']) delete (navigator as unknown as Record<string, unknown>)[name];
  Object.defineProperty(window, 'matchMedia', { value: realMatchMedia, configurable: true });
});

function server(refuse?: (subscription: WebPushSubscription) => unknown) {
  const registered: WebPushSubscription[] = [];
  return {
    registered,
    register: async (subscription: WebPushSubscription) => {
      browser.calls.push(`register with server ${subscription.endpoint}`);
      const refusal = refuse?.(subscription);
      if (refusal) throw refusal;
      registered.push(subscription);
    },
  };
}

test('an iPhone or iPad browser tab needs the Home Screen; opened from there it can ask', async () => {
  place(IPHONE);
  expect(await webPushState()).toBe('needs-home-screen');
  place(IPAD_AS_MAC, { touch: 5 });
  expect(await webPushState()).toBe('needs-home-screen');
  place(IPHONE, { standalone: true });
  expect(await webPushState()).toBe('off');
  // A Mac's Safari names a Mac too, but has no touch screen: an ordinary browser.
  place(IPAD_AS_MAC);
  expect(await webPushState()).toBe('off');
});

test("a Tauri app's window, and a browser with no Web Push, are unsupported", async () => {
  place(IPHONE, { tauri: true });
  expect(await webPushState()).toBe('unsupported');
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  delete (window as unknown as Record<string, unknown>).PushManager;
  place(IPHONE, { standalone: true });
  expect(await webPushState()).toBe('unsupported');
});

test('the state follows the permission and the subscription, and asks the person nothing', async () => {
  expect(await webPushState()).toBe('off');
  browser.permission = 'denied';
  expect(await webPushState()).toBe('denied');
  browser.permission = 'granted';
  expect(await webPushState()).toBe('off');
  browser.subscription = new FakeSubscription(decode(KEY));
  expect(await webPushState()).toBe('on');
  expect(browser.calls).toEqual([]);
});

test('turning on asks for permission before anything is awaited, then subscribes with the key and tells the server', async () => {
  const s = server();
  const turning = turnOnWebPush({ publicKey: KEY, register: s.register });
  // Still inside the tap: the question went out before the first await.
  expect(browser.calls).toEqual(['ask']);
  expect(await turning).toBe('on');
  expect(browser.calls).toEqual(['ask', `register ${WORKER_ADDRESS}`, 'subscribe', 'register with server https://fcm.googleapis.com/fcm/send/phone-1']);
  expect(s.registered).toEqual([{ endpoint: 'https://fcm.googleapis.com/fcm/send/phone-1', keys: { p256dh: 'p256dh-1', auth: 'auth' } }]);
  expect(new Uint8Array(browser.subscription!.options.applicationServerKey)).toEqual(decode(KEY));
});

test('a no, or no answer, turns nothing on', async () => {
  const s = server();
  browser.answer = 'denied';
  expect(await turnOnWebPush({ publicKey: KEY, register: s.register })).toBe('denied');
  browser.permission = 'default';
  browser.answer = 'default';
  expect(await turnOnWebPush({ publicKey: KEY, register: s.register })).toBe('off');
  expect(s.registered).toEqual([]);
  expect(browser.calls).toEqual(['ask', 'ask']);
});

test('turning on in a tab on an iPhone asks nothing and says it needs the Home Screen', async () => {
  place(IPHONE);
  expect(await turnOnWebPush({ publicKey: KEY, register: server().register })).toBe('needs-home-screen');
  expect(browser.calls).toEqual([]);
});

test('every start checks the subscription in, making one when Safari dropped it while permission stayed', async () => {
  const s = server();
  browser.permission = 'granted';
  await startWebPush({ publicKey: async () => KEY, register: s.register });
  expect(browser.calls).toEqual([`register ${WORKER_ADDRESS}`, 'subscribe', 'register with server https://fcm.googleapis.com/fcm/send/phone-1']);
  browser.calls.length = 0;
  await startWebPush({ publicKey: KEY, register: s.register });
  expect(browser.calls).toEqual([`register ${WORKER_ADDRESS}`, 'register with server https://fcm.googleapis.com/fcm/send/phone-1']);
});

test("a start with a subscription made with another key than the app's now makes it again", async () => {
  const s = server();
  browser.permission = 'granted';
  browser.subscription = new FakeSubscription(decode(OTHER_KEY));
  await startWebPush({ publicKey: KEY, register: s.register });
  expect(browser.calls).toEqual([`register ${WORKER_ADDRESS}`, 'unsubscribe https://fcm.googleapis.com/fcm/send/phone-1', 'subscribe', 'register with server https://fcm.googleapis.com/fcm/send/phone-2']);
});

test('a start before permission registers the worker and nothing else', async () => {
  await startWebPush({ publicKey: KEY, register: server().register });
  expect(browser.calls).toEqual([`register ${WORKER_ADDRESS}`]);
});

test("a subscription another account holds is dropped and a fresh one given, once; any other refusal stays the app's and leaves it off", async () => {
  let refusals = 0;
  const s = server(() => (refusals++ === 0 ? new ApiError('taken', 409, null) : null));
  expect(await turnOnWebPush({ publicKey: KEY, register: s.register })).toBe('on');
  expect(browser.calls.slice(2)).toEqual([
    'subscribe',
    'register with server https://fcm.googleapis.com/fcm/send/phone-1',
    'unsubscribe https://fcm.googleapis.com/fcm/send/phone-1',
    'subscribe',
    'register with server https://fcm.googleapis.com/fcm/send/phone-2',
  ]);
  expect(s.registered.map((r) => r.endpoint)).toEqual(['https://fcm.googleapis.com/fcm/send/phone-2']);

  browser.subscription = null;
  const failing = server(() => new ApiError('down', 500, null));
  await expect(turnOnWebPush({ publicKey: KEY, register: failing.register })).rejects.toThrow('down');
  // The subscription the server refused is gone, so the switch never reads on while nothing can reach the phone.
  expect(browser.calls.at(-1)).toBe('unsubscribe https://fcm.googleapis.com/fcm/send/phone-3');
  expect(await webPushState()).toBe('off');
  // A start never throws.
  await startWebPush({ publicKey: KEY, register: failing.register });
});

test("an app with its own worker never has the kit's registered over it", async () => {
  const s = server();
  expect(await turnOnWebPush({ publicKey: KEY, register: s.register, ownWorker: true })).toBe('on');
  await startWebPush({ publicKey: KEY, register: s.register, ownWorker: true });
  expect(browser.calls.filter((call) => call.startsWith('register /'))).toEqual([]);
});

test('turning off unsubscribes, has the server forget the phone, and keeps it off at the next start', async () => {
  const s = server();
  await turnOnWebPush({ publicKey: KEY, register: s.register });
  const forgotten: string[] = [];
  expect(await turnOffWebPush({ forget: async (endpoint) => void forgotten.push(endpoint) })).toBe('off');
  expect(forgotten).toEqual(['https://fcm.googleapis.com/fcm/send/phone-1']);
  expect(await webPushState()).toBe('off');

  browser.calls.length = 0;
  await startWebPush({ publicKey: KEY, register: s.register });
  expect(browser.calls).toEqual([`register ${WORKER_ADDRESS}`]);
  // Turning on again clears it.
  expect(await turnOnWebPush({ publicKey: KEY, register: s.register })).toBe('on');
  expect(browser.calls.at(-1)).toBe('register with server https://fcm.googleapis.com/fcm/send/phone-2');
});

test('a server that fails to forget leaves the phone off all the same', async () => {
  browser.permission = 'granted';
  browser.subscription = new FakeSubscription(decode(KEY));
  expect(await turnOffWebPush({ forget: async () => Promise.reject(new Error('offline')) })).toBe('off');
  expect(browser.subscription).toBeNull();
});

test('turning off with permission denied is remembered, so allowing notifications again later never turns them on', async () => {
  const s = server();
  browser.permission = 'denied';
  expect(await turnOffWebPush({ forget: async () => {} })).toBe('denied');
  browser.permission = 'granted';
  await startWebPush({ publicKey: KEY, register: s.register });
  expect(browser.calls).toEqual([`register ${WORKER_ADDRESS}`]);
  expect(s.registered).toEqual([]);
});
