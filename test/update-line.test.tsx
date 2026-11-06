/*
 * The app's one update line (tauri/window/lines.tsx): which update it offers when the site has a newer deploy, the Mac
 * window has found a release, or a newer build of the app is installed, alone or together; what it says for each, in
 * an app and in a browser tab; and what its button does.
 */
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { NewBuildLine } from '../web/lines';
import { lookForNewBuild } from '../web/new-build';
import { NEWER_BUILD_EVENT, NEWER_BUILD_FLAG, UPDATE_EVENT, UPDATE_FLAG, UpdateLine, updateMessage, useUpdate } from '../tauri/window';

const page = window as unknown as Record<string, unknown>;
const realFetch = globalThis.fetch;
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

const tell = (flag: string, event: string, value: unknown) => {
  page[flag] = value;
  window.dispatchEvent(new Event(event));
};
const release = (state: unknown) => tell(UPDATE_FLAG, UPDATE_EVENT, state);
const installed = () => tell(NEWER_BUILD_FLAG, NEWER_BUILD_EVENT, true);

/** Runs the page as the app's Tauri window, on a Mac unless an iPhone's agent is given. */
const inTheApp = (agent = MAC) => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
  Object.defineProperty(navigator, 'userAgent', { value: agent, configurable: true });
};

/** The page is a built one, and the index page names another build: a newer deploy is waiting. */
const deployed = async () => {
  document.head.innerHTML = '<script type="module" src="/assets/index-a.js"></script>';
  globalThis.fetch = mock(async () => new Response('<script type="module" src="/assets/index-b.js"></script>')) as unknown as typeof fetch;
};

const reload = mock(() => {});
const opened: string[] = [];

beforeEach(() => {
  reload.mockClear();
  opened.length = 0;
  Object.defineProperty(window.location, 'reload', { value: reload, configurable: true });
  Object.defineProperty(window.location, 'href', {
    configurable: true,
    get: () => 'https://app.example.com/',
    set: (to: string) => opened.push(to),
  });
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  document.head.innerHTML = '';
  delete page[UPDATE_FLAG];
  delete page[NEWER_BUILD_FLAG];
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  delete (navigator as { userAgent?: unknown }).userAgent;
  delete (window.location as { reload?: unknown }).reload;
  delete (window.location as { href?: unknown }).href;
});

test('with nothing newer, the line draws nothing, and a state the page does not know draws nothing either', () => {
  inTheApp();
  const { container } = render(<UpdateLine appName="Atlas" scheme="com.example.app" />);
  expect(container.innerHTML).toBe('');
  act(() => release('something newer'));
  expect(container.innerHTML).toBe('');
});

test('in the Mac app, a deploy alone is the app\'s update, and Update reloads the page', async () => {
  inTheApp();
  await deployed();
  render(<UpdateLine appName="Atlas" scheme="com.example.app" reloadsItself={false} />);
  act(() => lookForNewBuild());
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Atlas has an update.Update'));
  screen.getByRole('button', { name: 'Update' }).click();
  expect(reload).toHaveBeenCalledTimes(1);
  expect(opened).toEqual([]);
});

test('a release found beside a deploy is one line, whose Update installs the release', async () => {
  inTheApp();
  await deployed();
  render(<UpdateLine appName="Atlas" scheme="com.example.app" reloadsItself={false} />);
  act(() => lookForNewBuild());
  await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  act(() => release('available'));
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status').textContent).toBe('Atlas has an update.Update');
  screen.getByRole('button', { name: 'Update' }).click();
  expect(opened).toEqual(['com.example.app://update']);
  expect(reload).not.toHaveBeenCalled();
});

test('while the release installs the line says so and offers nothing, and a failure offers Try again', () => {
  inTheApp();
  page[UPDATE_FLAG] = 'installing';
  render(<UpdateLine appName="Atlas" scheme="com.example.app" />);
  expect(screen.getByRole('status').textContent).toBe('Updating Atlas. It restarts once the new version is in place.');
  expect(screen.queryByRole('button')).toBeNull();
  act(() => release('failed'));
  expect(screen.getByRole('status').textContent).toBe('Atlas could not update.Try again');
  screen.getByRole('button', { name: 'Try again' }).click();
  expect(opened).toEqual(['com.example.app://update']);
  // Once the window has nothing to offer again, the line goes.
  act(() => release(undefined));
  expect(screen.queryByRole('status')).toBeNull();
});

test('a newer build installed over the running app is its update, and Update restarts into it', () => {
  inTheApp();
  render(<UpdateLine appName="Atlas" scheme="com.example.app" />);
  act(() => installed());
  expect(screen.getByRole('status').textContent).toBe('Atlas has an update.Update');
  act(() => release('available'));
  screen.getByRole('button', { name: 'Update' }).click();
  expect(opened).toEqual(['com.example.app://restart']);
});

test('an install under way comes before a newer build on disk, which the install itself puts there before it restarts', () => {
  inTheApp();
  const { result } = renderHook(() => useUpdate());
  act(() => release('installing'));
  act(() => installed());
  expect(result.current).toBe('installing');
});

test('a deploy reloads the hidden page by itself only while it is the one update', async () => {
  inTheApp();
  await deployed();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  try {
    page[UPDATE_FLAG] = 'available';
    render(<UpdateLine appName="Atlas" scheme="com.example.app" />);
    act(() => lookForNewBuild());
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    const hide = () => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    // A release is offered: the page waits for its Update, which loads the newest page anyway.
    hide();
    expect(reload).not.toHaveBeenCalled();
    // The release is gone, so the deploy is the one update: the page, still hidden, loads it at once.
    act(() => release(undefined));
    expect(reload).toHaveBeenCalledTimes(1);
  } finally {
    delete (document as { visibilityState?: unknown }).visibilityState;
  }
});

test('in a browser tab the line is the page that changed, with Reload', async () => {
  await deployed();
  render(<UpdateLine appName="Atlas" scheme="com.example.app" reloadsItself={false} />);
  act(() => lookForNewBuild());
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Atlas has changed since this page loaded.Reload'));
  screen.getByRole('button', { name: 'Reload' }).click();
  expect(reload).toHaveBeenCalledTimes(1);
});

test("the website's own line speaks of an update in the iPhone app and in a web app opened from the home screen", async () => {
  inTheApp(IPHONE);
  await deployed();
  const iphone = render(<NewBuildLine appName="Atlas" reloadsItself={false} />);
  act(() => lookForNewBuild());
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Atlas has an update.Update'));
  iphone.unmount();
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  const realMatchMedia = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', { value: (query: string) => ({ matches: query === '(display-mode: standalone)' }), configurable: true });
  try {
    render(<NewBuildLine appName="Atlas" reloadsItself={false} />);
    act(() => lookForNewBuild());
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Atlas has an update.Update'));
  } finally {
    Object.defineProperty(window, 'matchMedia', { value: realMatchMedia, configurable: true });
  }
});

test("the line's words are the ones an app drawing its own lines gets", () => {
  expect(updateMessage('Atlas', 'available', true)).toEqual({ message: 'Atlas has an update.', action: 'Update' });
  expect(updateMessage('Atlas', 'restart', true)).toEqual({ message: 'Atlas has an update.', action: 'Update' });
  expect(updateMessage('Atlas', 'deploy', true)).toEqual({ message: 'Atlas has an update.', action: 'Update' });
  expect(updateMessage('Atlas', 'deploy', false)).toEqual({ message: 'Atlas has changed since this page loaded.', action: 'Reload' });
  expect(updateMessage('Atlas', 'installing', true).action).toBeNull();
  expect(updateMessage('Atlas', 'failed', true).action).toBe('Try again');
});
