// The kit's notification worker, run against a stand-in of the worker's global scope: what each push shows, that it
// shows inside the push's own lifetime whatever the data, and which window a tap opens.
import { beforeEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dir, '../web/push/worker.js'), 'utf8');
const ORIGIN = 'https://app.example.com';

type Shown = { title: string; options: Record<string, unknown> };
type Window = { url: string; focused: number; navigated: string[]; failsToNavigate?: boolean };

/** One loaded worker: its listeners, what it showed and opened, and the windows its site has open. */
function worker(options: { controlled?: Window[]; refuses?: (options: Record<string, unknown>) => boolean; badge?: boolean } = {}) {
  const listeners = new Map<string, (event: unknown) => void>();
  const shown: Shown[] = [];
  const opened: string[] = [];
  const badges: (number | 'cleared')[] = [];
  const controlled = options.controlled ?? [];
  const client = (w: Window) => ({
    url: w.url,
    focus: async () => {
      w.focused++;
      return client(w);
    },
    navigate: async (url: string) => {
      if (w.failsToNavigate) throw new TypeError('navigate failed');
      w.navigated.push(url);
      return client(w);
    },
  });
  const scope = {
    location: new URL(`${ORIGIN}/push-worker.js`),
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    skipWaiting: () => {
      throw new Error('skipWaiting was called');
    },
    registration: {
      showNotification: async (title: string, opts: Record<string, unknown>) => {
        if (options.refuses?.(opts)) throw new TypeError('refused option');
        shown.push({ title, options: opts });
      },
    },
    clients: {
      claim: () => {
        throw new Error('clients.claim was called');
      },
      // Without includeUncontrolled, as the worker asks: only the windows it controls.
      matchAll: async (query: { includeUncontrolled?: boolean }) => (query.includeUncontrolled ? [] : controlled.map(client)),
      openWindow: async (url: string) => {
        opened.push(url);
        return null;
      },
    },
  };
  const navigator: Record<string, unknown> = {};
  if (options.badge) {
    navigator.setAppBadge = async (n: number) => void badges.push(n);
    navigator.clearAppBadge = async () => void badges.push('cleared');
  }
  const quiet = { log: () => {}, warn: () => {}, error: () => {} };
  new Function('self', 'navigator', 'console', source)(scope, navigator, quiet);

  /** Fire a push; resolves once every promise it handed to waitUntil has settled, and says whether one rejected. */
  async function push(data: { json: () => unknown; text: () => string } | null) {
    const waits: Promise<unknown>[] = [];
    listeners.get('push')!({ data, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    expect(waits).toHaveLength(1);
    const settled = await Promise.allSettled(waits);
    return settled.every((s) => s.status === 'fulfilled');
  }
  async function tap(data: unknown) {
    const waits: Promise<unknown>[] = [];
    let closed = false;
    listeners.get('notificationclick')!({ notification: { data, close: () => (closed = true) }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    expect(closed).toBe(true);
  }
  return { listeners, shown, opened, badges, push, tap };
}

const json = (value: unknown) => ({ json: () => value, text: () => JSON.stringify(value) });
const text = (value: string) => ({
  json: () => {
    throw new SyntaxError('not JSON');
  },
  text: () => value,
});

let w: ReturnType<typeof worker>;
beforeEach(() => {
  w = worker();
});

test('it listens only for pushes and taps: no install, activate or fetch handler, so it never swaps code or answers for the page', () => {
  expect([...w.listeners.keys()].sort()).toEqual(['notificationclick', 'push']);
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  expect(code).not.toMatch(/skipWaiting|clients\.claim|['"]fetch['"]/);
});

test('a declarative message shows its title, body, tag and page, and sounds again when it replaces one', async () => {
  expect(await w.push(json({ web_push: 8030, notification: { title: 'Chore done', body: 'Sam fed the cat', navigate: `${ORIGIN}/chores/3`, tag: 'chores', renotify: true } }))).toBe(true);
  expect(w.shown).toEqual([
    { title: 'Chore done', options: { body: 'Sam fed the cat', data: { url: `${ORIGIN}/chores/3` }, navigate: `${ORIGIN}/chores/3`, tag: 'chores', renotify: true } },
  ]);
});

test('a quiet one is silent and never renotifies, and with no tag there is no renotify, which Chrome refuses', async () => {
  await w.push(json({ web_push: 8030, notification: { title: 'T', body: 'B', navigate: `${ORIGIN}/`, tag: 'x', silent: true } }));
  await w.push(json({ web_push: 8030, notification: { title: 'T', body: 'B', navigate: `${ORIGIN}/` } }));
  expect(w.shown[0]!.options).toEqual({ body: 'B', data: { url: `${ORIGIN}/` }, navigate: `${ORIGIN}/`, tag: 'x', silent: true });
  expect(w.shown[1]!.options).toEqual({ body: 'B', data: { url: `${ORIGIN}/` }, navigate: `${ORIGIN}/` });
});

test("a plain message, as argon-watcher's server sends, shows the same way", async () => {
  await w.push(json({ title: 'Alert', body: 'Something changed', url: '/alerts/3', tag: 'a' }));
  expect(w.shown).toEqual([{ title: 'Alert', options: { body: 'Something changed', data: { url: `${ORIGIN}/alerts/3` }, navigate: `${ORIGIN}/alerts/3`, tag: 'a', renotify: true } }]);
});

test('no data, text, JSON with no title and a page on another site each still show a notification', async () => {
  expect(await w.push(null)).toBe(true);
  expect(await w.push(text('hello'))).toBe(true);
  expect(await w.push(json(null))).toBe(true);
  expect(await w.push(json({ web_push: 8030, notification: { title: 42, navigate: 'https://elsewhere.example.com/x' } }))).toBe(true);
  expect(w.shown.map((s) => [s.title, s.options.body, (s.options.data as { url: string }).url])).toEqual([
    ['app.example.com', undefined, `${ORIGIN}/`],
    ['app.example.com', 'hello', `${ORIGIN}/`],
    ['app.example.com', '', `${ORIGIN}/`],
    ['app.example.com', '', `${ORIGIN}/`],
  ]);
});

test('options the browser refuses fall back to the title and body, and nothing the push waits on ever rejects', async () => {
  const strict = worker({ refuses: (options) => 'navigate' in options });
  expect(await strict.push(json({ web_push: 8030, notification: { title: 'T', body: 'B', navigate: `${ORIGIN}/x` } }))).toBe(true);
  expect(strict.shown).toEqual([{ title: 'T', options: { body: 'B', data: { url: `${ORIGIN}/x` } } }]);
  const refusesAll = worker({ refuses: () => true });
  expect(await refusesAll.push(json({ title: 'T', body: 'B' }))).toBe(true);
});

test("the icon's number is set, and 0 clears it, where the browser has one", async () => {
  const withBadge = worker({ badge: true });
  await withBadge.push(json({ web_push: 8030, notification: { title: 'T', navigate: `${ORIGIN}/` }, app_badge: 3 }));
  await withBadge.push(json({ web_push: 8030, notification: { title: 'T', navigate: `${ORIGIN}/` }, app_badge: 0 }));
  expect(withBadge.badges).toEqual([3, 'cleared']);
  // Without the badge API the notification still shows.
  expect(await w.push(json({ web_push: 8030, notification: { title: 'T', navigate: `${ORIGIN}/` }, app_badge: 3 }))).toBe(true);
  expect(w.shown).toHaveLength(1);
});

test('a tap brings a controlled window of the site forward and moves it to the page', async () => {
  const open: Window = { url: `${ORIGIN}/home`, focused: 0, navigated: [] };
  const other: Window = { url: 'https://elsewhere.example.com/', focused: 0, navigated: [] };
  const tapped = worker({ controlled: [other, open] });
  await tapped.tap({ url: `${ORIGIN}/chores/3` });
  expect(open).toEqual({ url: `${ORIGIN}/home`, focused: 1, navigated: [`${ORIGIN}/chores/3`] });
  expect(other.focused).toBe(0);
  expect(tapped.opened).toEqual([]);
});

test('with no controlled window, or one that cannot be moved, a tap opens a window at the page', async () => {
  await w.tap({ url: `${ORIGIN}/chores/3` });
  expect(w.opened).toEqual([`${ORIGIN}/chores/3`]);
  const stuck: Window = { url: `${ORIGIN}/home`, focused: 0, navigated: [], failsToNavigate: true };
  const failing = worker({ controlled: [stuck] });
  await failing.tap({ url: `${ORIGIN}/chores/3` });
  expect(failing.opened).toEqual([`${ORIGIN}/chores/3`]);
});

test("a tap never opens another site: it opens the app's root", async () => {
  await w.tap({ url: 'https://elsewhere.example.com/x' });
  await w.tap({ url: '//elsewhere.example.com/x' });
  await w.tap(undefined);
  expect(w.opened).toEqual([`${ORIGIN}/`, `${ORIGIN}/`, `${ORIGIN}/`]);
});
