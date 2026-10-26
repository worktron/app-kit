import { afterEach, expect, test } from 'bun:test';
import { isInstalledApp, isIphoneApp, isTauriApp } from '../web/installed-app';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';

function place({ tauri = false, agent = MAC, standalone, displayMode = false }: { tauri?: boolean; agent?: string; standalone?: boolean; displayMode?: boolean }) {
  if (tauri) Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
  Object.defineProperty(navigator, 'userAgent', { value: agent, configurable: true });
  if (standalone !== undefined) Object.defineProperty(navigator, 'standalone', { value: standalone, configurable: true });
  const matches = (query: string) => displayMode && query === '(display-mode: standalone)';
  Object.defineProperty(window, 'matchMedia', { value: (query: string) => ({ matches: matches(query) }), configurable: true });
}

const realMatchMedia = window.matchMedia;
afterEach(() => {
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  delete (navigator as { userAgent?: unknown }).userAgent;
  delete (navigator as { standalone?: unknown }).standalone;
  Object.defineProperty(window, 'matchMedia', { value: realMatchMedia, configurable: true });
});

test('a browser tab is no installed app', () => {
  place({});
  expect([isTauriApp(), isIphoneApp(), isInstalledApp()]).toEqual([false, false, false]);
});

test("a web app opened from the home screen is one, by Safari's flag or the standalone display mode", () => {
  place({ agent: IPHONE, standalone: true });
  expect(isInstalledApp()).toBe(true);
  place({ displayMode: true });
  expect(isInstalledApp()).toBe(true);
});

test("the Tauri iPhone app is one, and a Tauri app's Mac window is not, though it may say standalone", () => {
  place({ tauri: true, agent: IPHONE });
  expect([isTauriApp(), isIphoneApp(), isInstalledApp()]).toEqual([true, true, true]);
  place({ tauri: true, agent: MAC, displayMode: true });
  expect([isTauriApp(), isIphoneApp(), isInstalledApp()]).toEqual([true, false, false]);
});
