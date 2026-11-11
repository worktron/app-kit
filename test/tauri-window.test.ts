/*
 * The window onto the hosted site's Rust (tauri/window/plugin/) shares names with the page that no compiler checks
 * across them: desktop sign-in's, and the window's own. The kit has no app to link it into, so this reads the Rust and
 * holds each name to the TypeScript, runs the iPhone's window.open script in the simulated page, and tests the page
 * half's hooks.
 */
import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  DESKTOP_SIGN_IN_EVENT,
  DESKTOP_SIGN_IN_LISTENING,
  DESKTOP_SIGN_IN_PATH,
  LINK_HOST,
  NONCE_PARAM,
  TICKET_PARAM,
} from '../tauri/sign-in/names';
import {
  FULL_SCREEN_EVENT,
  FULL_SCREEN_FLAG,
  MENU_EVENT,
  MENU_SETTINGS,
  MENU_SIGN_OUT,
  NEWER_BUILD_EVENT,
  NEWER_BUILD_FLAG,
  RESTART_HOST,
  restartLink,
  UPDATE_EVENT,
  UPDATE_FLAG,
  UPDATE_HOST,
  UPDATE_STATES,
  updateLink,
  useAppUpdate,
  useNewerBuildInstalled,
  useWindowFullScreen,
  useWindowMenu,
} from '../tauri/window';
import { START_PAGE_HEALTH, START_PAGE_SETTINGS } from '../tauri/window/names';

const plugin = join(import.meta.dir, '../tauri/window/plugin');
const read = (path: string) => readFileSync(join(plugin, path), 'utf8');
const constant = (source: string, name: string) => source.match(new RegExp(`const ${name}: &str = "([^"]*)";`))?.[1];

const page = window as unknown as Record<string, unknown>;

afterEach(() => {
  cleanup();
  delete page[FULL_SCREEN_FLAG];
  delete page[NEWER_BUILD_FLAG];
  delete page[UPDATE_FLAG];
  delete page.__TAURI_INTERNALS__;
});

test("the shell hands the page its sign-in under desktop sign-in's names", () => {
  const rust = read('src/sign_in.rs');
  expect(constant(rust, 'SIGN_IN_PATH')).toBe(DESKTOP_SIGN_IN_PATH);
  expect(constant(rust, 'LINK_HOST')).toBe(LINK_HOST);
  expect(constant(rust, 'SIGN_IN_EVENT')).toBe(DESKTOP_SIGN_IN_EVENT);
  expect(constant(rust, 'SIGN_IN_LISTENING')).toBe(DESKTOP_SIGN_IN_LISTENING);
  expect(constant(rust, 'TICKET_PARAM')).toBe(TICKET_PARAM);
  expect(constant(rust, 'NONCE_PARAM')).toBe(NONCE_PARAM);
});

test('the Mac window tells the page under the names its hooks read', () => {
  const rust = read('src/mac.rs');
  expect(constant(rust, 'FULL_SCREEN_FLAG')).toBe(FULL_SCREEN_FLAG);
  expect(constant(rust, 'FULL_SCREEN_EVENT')).toBe(FULL_SCREEN_EVENT);
  expect(constant(rust, 'NEWER_BUILD_FLAG')).toBe(NEWER_BUILD_FLAG);
  expect(constant(rust, 'NEWER_BUILD_EVENT')).toBe(NEWER_BUILD_EVENT);
  expect(constant(rust, 'RESTART_HOST')).toBe(RESTART_HOST);
});

test('the Mac window tells the page where an update stands under the names its hook reads', () => {
  const rust = read('src/updates.rs');
  expect(constant(rust, 'UPDATE_FLAG')).toBe(UPDATE_FLAG);
  expect(constant(rust, 'UPDATE_EVENT')).toBe(UPDATE_EVENT);
  expect(constant(rust, 'UPDATE_HOST')).toBe(UPDATE_HOST);
  const states = [...rust.matchAll(/UpdateState::\w+ => "([^"]+)"/g)].map((match) => match[1]);
  expect(states).toEqual([...UPDATE_STATES]);
});

test("the Mac menu hands the page Settings and Sign Out under the names its hook reads", () => {
  const rust = read('src/menu.rs');
  expect(constant(rust, 'MENU_EVENT')).toBe(MENU_EVENT);
  expect(constant(rust, 'SETTINGS')).toBe(MENU_SETTINGS);
  expect(constant(rust, 'SIGN_OUT')).toBe(MENU_SIGN_OUT);
});

test('the window hands the start page its settings under the name the page reads, with the health route every kit server answers', () => {
  const rust = read('src/lib.rs');
  expect(constant(rust, 'START_PAGE_SETTINGS')).toBe(START_PAGE_SETTINGS);
  expect(constant(rust, 'START_PAGE_HEALTH')).toBe(START_PAGE_HEALTH);
  expect(constant(rust, 'START_PAGE')).toBe('index.html');
  const startPage = readFileSync(join(import.meta.dir, '../tauri/window/start/index.html'), 'utf8');
  expect(startPage).toContain(`window.${START_PAGE_SETTINGS};`);
  for (const key of ['address', 'health', 'name', 'background', 'text']) {
    expect(startPage).toContain(`settings.${key}`);
    expect(rust).toContain(`"${key}": `);
  }
  expect(readFileSync(join(import.meta.dir, '../server/start/index.ts'), 'utf8')).toContain(`app.get('${START_PAGE_HEALTH}'`);
});

test("the README's frontendDist is the start page's folder in the kit bun installed, which holds the page alone", () => {
  const readme = readFileSync(join(import.meta.dir, '../README.md'), 'utf8');
  const dist = readme.match(/"frontendDist": "\.\.\/node_modules\/app-kit\/([^"]+)"/)![1]!;
  expect(dist).toBe('tauri/window/start');
  // Tauri bundles the whole folder into every app.
  expect(readdirSync(join(import.meta.dir, '..', dist))).toEqual(['index.html']);
});

/** What the Mac window does to tell the page: sets the flag, then dispatches the event. */
function tell(flag: string, event: string, value: boolean) {
  page[flag] = value;
  window.dispatchEvent(new Event(event));
}

test('the full-screen hook reads a flag set before it listened, then follows each event', () => {
  expect(renderHook(() => useWindowFullScreen()).result.current).toBe(false);
  cleanup();
  page[FULL_SCREEN_FLAG] = true;
  const { result } = renderHook(() => useWindowFullScreen());
  expect(result.current).toBe(true);
  act(() => tell(FULL_SCREEN_FLAG, FULL_SCREEN_EVENT, false));
  expect(result.current).toBe(false);
  act(() => tell(FULL_SCREEN_FLAG, FULL_SCREEN_EVENT, true));
  expect(result.current).toBe(true);
});

test('the newer-build hook is false until the window says so, and true from then on', () => {
  const { result } = renderHook(() => useNewerBuildInstalled());
  expect(result.current).toBe(false);
  act(() => tell(NEWER_BUILD_FLAG, NEWER_BUILD_EVENT, true));
  expect(result.current).toBe(true);
  cleanup();
  // A page that loads after the window told the last one reads the flag the window sets again on each load.
  expect(renderHook(() => useNewerBuildInstalled()).result.current).toBe(true);
});

test("the restart and update links are the app's own scheme with the hosts the window takes", () => {
  expect(restartLink('com.example.app')).toBe('com.example.app://restart');
  expect(updateLink('com.example.app')).toBe('com.example.app://update');
});

test('the update hook reads a state set before it listened, follows each one, and ignores what it does not know', () => {
  expect(renderHook(() => useAppUpdate()).result.current).toBeNull();
  cleanup();
  page[UPDATE_FLAG] = 'available';
  const { result } = renderHook(() => useAppUpdate());
  expect(result.current).toBe('available');
  const tellUpdate = (state: unknown) => {
    page[UPDATE_FLAG] = state;
    window.dispatchEvent(new Event(UPDATE_EVENT));
  };
  act(() => tellUpdate('installing'));
  expect(result.current).toBe('installing');
  act(() => tellUpdate('failed'));
  expect(result.current).toBe('failed');
  act(() => tellUpdate('something newer'));
  expect(result.current).toBeNull();
});

test("on the iPhone, window.open hands its address, made whole, to the opener and opens nothing in the page", async () => {
  const script = read('src/iphone.rs').match(/WINDOW_OPEN_SCRIPT: &str = r#"([\s\S]*?)"#;/)![1];
  const calls: [string, unknown][] = [];
  let refuse = false;
  page.__TAURI_INTERNALS__ = {
    invoke: (command: string, args: unknown) => {
      calls.push([command, args]);
      return refuse ? Promise.reject(new Error('not allowed')) : Promise.resolve();
    },
  };
  const opened = window.open;
  const inPlace: unknown[][] = [];
  window.open = (...args: unknown[]) => {
    inPlace.push(args);
    return window;
  };
  try {
    new Function(script)();
    expect(window.open('https://mail.example.com/thread/1')).toBeNull();
    expect(window.open('/settings', '_blank')).toBeNull();
    expect(window.open()).toBeNull();
    // A target naming this window, or one holding it, moves the app's own window, as the web view does by itself.
    expect(window.open('/settings', '_self')).toBe(window);
    expect(window.open('/inbox', '_TOP', 'noopener')).toBe(window);
    expect(calls).toEqual([
      ['plugin:opener|open_url', { url: 'https://mail.example.com/thread/1' }],
      ['plugin:opener|open_url', { url: new URL('/settings', location.href).href }],
    ]);
    expect(inPlace).toEqual([
      ['/settings', '_self', undefined],
      ['/inbox', '_TOP', 'noopener'],
    ]);
    // An address the opener refuses is warned about, never thrown into the page.
    refuse = true;
    const warn = console.warn;
    try {
      const warned = new Promise<unknown[]>((resolve) => {
        console.warn = (...line: unknown[]) => resolve(line);
      });
      expect(window.open('file:///etc/passwd')).toBeNull();
      expect(await warned).toEqual(['[app-kit-window] could not open a new window:', 'Error: not allowed']);
    } finally {
      console.warn = warn;
    }
  } finally {
    window.open = opened;
  }
});

test('the README shows the shell that plugin/tests/readme.rs compiles', () => {
  const readme = readFileSync(join(import.meta.dir, '../README.md'), 'utf8');
  const section = readme.split('### A window onto the hosted site')[1]!.split('\n### ')[0]!;
  const shell = section.match(/```rust\n([\s\S]*?)```/)![1]!;
  expect(read('tests/readme.rs')).toContain(shell);
});

test('a menu hook runs for its own item each time it is chosen, with the newest act, and stops when the page leaves', () => {
  const choose = (item: string) => window.dispatchEvent(new CustomEvent(MENU_EVENT, { detail: item }));
  const chosen: string[] = [];
  const { rerender, unmount } = renderHook(({ label }) => useWindowMenu(MENU_SETTINGS, () => chosen.push(label)), {
    initialProps: { label: 'first' },
  });
  choose(MENU_SETTINGS);
  choose(MENU_SIGN_OUT);
  rerender({ label: 'second' });
  choose(MENU_SETTINGS);
  unmount();
  choose(MENU_SETTINGS);
  expect(chosen).toEqual(['first', 'second']);
});
