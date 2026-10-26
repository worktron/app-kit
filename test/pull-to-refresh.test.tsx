import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, cleanup, render, screen } from '@testing-library/react';
import { PULL_DISTANCE, PullToRefresh, pullMayStart } from '../web/PullToRefresh';

// Finger travel is halved, so letting go past the line takes twice its distance of finger.
const PAST = PULL_DISTANCE * 2 + 10;

let reload: ReturnType<typeof mock>;

beforeEach(() => {
  reload = mock(() => {});
  Object.defineProperty(window.location, 'reload', { value: reload, configurable: true });
  Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
  document.body.innerHTML = '';
});

afterEach(() => {
  cleanup();
  delete (window.location as { reload?: unknown }).reload;
  delete (navigator as { standalone?: unknown }).standalone;
});

/** A touch event from `target` with one finger at x, y; touchend has none down. */
function touch(type: string, target: EventTarget, x = 0, y = 0) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] });
  act(() => {
    target.dispatchEvent(event);
  });
}

/** A finger landing on `target`, moving by dx, dy in steps, and lifting. */
function pull(target: EventTarget, dy: number, dx = 0) {
  touch('touchstart', target, 100, 100);
  for (let i = 1; i <= 10; i++) touch('touchmove', target, 100 + (dx * i) / 10, 100 + (dy * i) / 10);
  touch('touchend', target);
}

function page(extra = '') {
  const holder = document.createElement('div');
  holder.innerHTML = `<main><p id="row">A row</p>${extra}</main>`;
  document.body.append(holder);
  return holder;
}

test('a pull past the line from the top of the page reloads it', () => {
  render(<PullToRefresh />);
  pull(page().querySelector('#row')!, PAST);
  expect(reload).toHaveBeenCalledTimes(1);
});

test('a pull let go short of the line, or a swipe more sideways than down, does nothing', () => {
  render(<PullToRefresh />);
  const row = page().querySelector('#row')!;
  pull(row, PULL_DISTANCE);
  pull(row, PAST, PAST + 20);
  expect(reload).not.toHaveBeenCalled();
});

test('the mark shows while pulling and says when letting go would refresh', () => {
  render(<PullToRefresh />);
  const row = page().querySelector('#row')!;
  touch('touchstart', row, 100, 100);
  touch('touchmove', row, 100, 140);
  expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Pull to refresh');
  touch('touchmove', row, 100, 100 + PAST);
  expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Release to refresh');
  touch('touchcancel', row);
  expect(screen.queryByRole('status')).toBeNull();
});

test('no pull starts in a field, a menu, a dialog or a scrolled element, nor with the page scrolled', () => {
  const holder = page('<input id="field"><div role="menu"><p id="item">Item</p></div><div id="list"><p id="inner">In a list</p></div>');
  expect(pullMayStart(holder.querySelector('#row'))).toBe(true);
  expect(pullMayStart(holder.querySelector('#field'))).toBe(false);
  expect(pullMayStart(holder.querySelector('#item'))).toBe(false);
  const list = holder.querySelector<HTMLElement>('#list')!;
  Object.defineProperty(list, 'scrollTop', { value: 40, configurable: true });
  expect(pullMayStart(holder.querySelector('#inner'))).toBe(false);
  Object.defineProperty(document.documentElement, 'scrollTop', { value: 200, configurable: true });
  try {
    expect(pullMayStart(holder.querySelector('#row'))).toBe(false);
  } finally {
    delete (document.documentElement as { scrollTop?: unknown }).scrollTop;
  }
});

test('a pull never reloads over text typed into a field, and the mark says why', () => {
  render(<PullToRefresh />);
  const holder = page('<textarea>half a note</textarea>');
  pull(holder.querySelector('#row')!, PAST);
  expect(reload).not.toHaveBeenCalled();
  expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Not reloaded: a field holds typed text');
});

test("a pull while the app's drag is on never pulls", () => {
  let dragging = false;
  render(<PullToRefresh ignoreWhile={() => dragging} />);
  const row = page().querySelector('#row')!;
  touch('touchstart', row, 100, 100);
  touch('touchmove', row, 100, 120);
  dragging = true;
  for (let y = 130; y <= 100 + PAST; y += 20) touch('touchmove', row, 100, y);
  touch('touchend', row);
  expect(reload).not.toHaveBeenCalled();
});

test("a refresh in place runs the app's refresh, looks for a newer build, and a second pull while it hangs reloads", async () => {
  const entry = Object.assign(document.createElement('script'), { type: 'module', src: '/assets/index-a.js' });
  document.head.append(entry);
  const realFetch = globalThis.fetch;
  const looked = mock(async () => new Response('<script type="module" src="/assets/index-a.js"></script>'));
  globalThis.fetch = looked as unknown as typeof fetch;
  let finish: () => void = () => undefined;
  const refresh = mock(() => new Promise<void>((resolve) => (finish = resolve)));
  try {
    const { useNewBuild } = await import('../web/new-build');
    function Looking() {
      useNewBuild();
      return null;
    }
    render(
      <>
        <Looking />
        <PullToRefresh onPull={refresh} />
      </>,
    );
    const row = page().querySelector('#row')!;
    pull(row, PAST);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(looked).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Refreshing');
    pull(row, PAST);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  } finally {
    globalThis.fetch = realFetch;
    entry.remove();
  }
});

test('in a browser tab it listens to nothing', () => {
  delete (navigator as { standalone?: unknown }).standalone;
  render(<PullToRefresh />);
  pull(page().querySelector('#row')!, PAST);
  expect(reload).not.toHaveBeenCalled();
  expect(screen.queryByRole('status')).toBeNull();
});
