import { useEffect, useRef, useState } from 'react';
import {
  FULL_SCREEN_EVENT,
  FULL_SCREEN_FLAG,
  MENU_EVENT,
  MENU_SETTINGS,
  MENU_SIGN_OUT,
  NEWER_BUILD_EVENT,
  NEWER_BUILD_FLAG,
  RESTART_HOST,
  UPDATE_EVENT,
  UPDATE_FLAG,
  UPDATE_HOST,
  UPDATE_STATES,
} from './names';

/*
 * The page half of the window onto the hosted site (plugin/, the Rust an app's shell builds). The Mac window tells the
 * page three things by a flag it sets and a window event it dispatches, and again as each page loads, so a page that
 * loads or listens late still knows: whether the window is in full screen, where its close, minimize and zoom buttons
 * hide; whether a newer build of the app is installed, for the page to offer a restart into it; and where an update from the
 * app's releases stands, for the page to offer Update. Outside the Mac window none is ever set. It also hands the page
 * the menu items that are the page's, Settings… and Sign Out.
 */

export {
  FULL_SCREEN_EVENT,
  FULL_SCREEN_FLAG,
  MENU_EVENT,
  MENU_SETTINGS,
  MENU_SIGN_OUT,
  NEWER_BUILD_EVENT,
  NEWER_BUILD_FLAG,
  RESTART_HOST,
  UPDATE_EVENT,
  UPDATE_FLAG,
  UPDATE_HOST,
  UPDATE_STATES,
} from './names';

const read = (name: string): unknown => (window as unknown as Record<string, unknown>)[name];
const flag = (name: string) => read(name) === true;

/** Whether the Mac window has said it is in full screen. */
export function windowFullScreen(): boolean {
  return flag(FULL_SCREEN_FLAG);
}

/** Whether the Mac window has said a newer build of the app is installed than the one running. */
export function newerBuildInstalled(): boolean {
  return flag(NEWER_BUILD_FLAG);
}

/** Where an update from the app's releases stands: found and offered, installing, or failed, when it may be tried again. */
export type AppUpdate = (typeof UPDATE_STATES)[number];

/** Where the Mac window has said an update from the app's releases stands, or null when it has said nothing. */
export function appUpdate(): AppUpdate | null {
  const state = read(UPDATE_FLAG);
  return UPDATE_STATES.find((known) => known === state) ?? null;
}

function useWindowValue<T>(get: () => T, event: string): T {
  const [now, setNow] = useState(get);
  useEffect(() => {
    const listener = () => setNow(get());
    // The flag may have been set between the first render and this listener.
    listener();
    window.addEventListener(event, listener);
    return () => window.removeEventListener(event, listener);
  }, [get, event]);
  return now;
}

/** Whether the Mac window is in full screen, for a top bar that clears the window's buttons only when they show. */
export function useWindowFullScreen(): boolean {
  return useWindowValue(windowFullScreen, FULL_SCREEN_EVENT);
}

/** Whether a newer build of the app is installed, for the page to offer a restart into it, a link to `restartLink(scheme)`. */
export function useNewerBuildInstalled(): boolean {
  return useWindowValue(newerBuildInstalled, NEWER_BUILD_EVENT);
}

/**
 * Where an update from the app's releases stands: "available" or "failed", when the page may offer Update, a link to
 * `updateLink(scheme)`, or "installing". Null outside the Mac window, and until the window has found an update. The
 * app's menu offers the same, so updating never waits on the page. `useUpdate` puts it together with a newer build
 * installed and a newer deploy, for the one update line.
 */
export function useAppUpdate(): AppUpdate | null {
  return useWindowValue(appUpdate, UPDATE_EVENT);
}

/**
 * The link that restarts the app into the newer build, for the page to open in the window (`location.href = …`).
 * `scheme` is the app's own link scheme, the one `Site::scheme` names. With no newer build installed the window
 * ignores it.
 */
export function restartLink(scheme: string): string {
  return `${scheme}://${RESTART_HOST}`;
}

/**
 * The link that installs the update found and restarts into it, for the page to open in the window. With no update
 * found, or one already installing, the window ignores it.
 */
export function updateLink(scheme: string): string {
  return `${scheme}://${UPDATE_HOST}`;
}

export { UpdateLine, useUpdate, updateMessage, takeUpdate, type Update } from './lines';

/** A menu item the page carries out: Settings… or Sign Out. */
export type WindowMenuItem = typeof MENU_SETTINGS | typeof MENU_SIGN_OUT;

/**
 * Runs `act` each time `item` is chosen from the Mac window's menu, which `AppMenu` builds with `.settings()` or
 * `.sign_out()`. The window has already come forward. Outside the Mac window it never runs.
 */
export function useWindowMenu(item: WindowMenuItem, act: () => void): void {
  const latest = useRef(act);
  latest.current = act;
  useEffect(() => {
    const listener = (event: Event) => {
      if ((event as CustomEvent<unknown>).detail === item) latest.current();
    };
    window.addEventListener(MENU_EVENT, listener);
    return () => window.removeEventListener(MENU_EVENT, listener);
  }, [item]);
}
