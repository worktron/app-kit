/*
 * The window onto the hosted site's Rust (tauri/window/plugin/) shares names with the page that no compiler checks
 * across them: desktop sign-in's, and the window's own. The kit has no app to link it into, so this reads the Rust and
 * holds each name to the TypeScript, runs the iPhone's window.open script in the simulated page, and tests the page
 * half's hooks.
 */
import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import { readFileSync } from 'fs';
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
  NEWER_BUILD_EVENT,
  NEWER_BUILD_FLAG,
  RESTART_HOST,
  restartLink,
  useNewerBuildInstalled,
  useWindowFullScreen,
} from '../tauri/window';

const plugin = join(import.meta.dir, '../tauri/window/plugin');
const read = (path: string) => readFileSync(join(plugin, path), 'utf8');
const constant = (source: string, name: string) => source.match(new RegExp(`const ${name}: &str = "([^"]*)";`))?.[1];

const page = window as unknown as Record<string, unknown>;

afterEach(() => {
  cleanup();
  delete page[FULL_SCREEN_FLAG];
  delete page[NEWER_BUILD_FLAG];
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

test("the restart link is the app's own scheme with the host the window takes", () => {
  expect(restartLink('com.example.app')).toBe('com.example.app://restart');
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
  try {
    new Function(script)();
    expect(window.open('https://mail.example.com/thread/1')).toBeNull();
    expect(window.open('/settings')).toBeNull();
    expect(window.open()).toBeNull();
    expect(calls).toEqual([
      ['plugin:opener|open_url', { url: 'https://mail.example.com/thread/1' }],
      ['plugin:opener|open_url', { url: new URL('/settings', location.href).href }],
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
