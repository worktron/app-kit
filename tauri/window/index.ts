import { useEffect, useState } from 'react';
import { FULL_SCREEN_EVENT, FULL_SCREEN_FLAG, NEWER_BUILD_EVENT, NEWER_BUILD_FLAG, RESTART_HOST } from './names';

/*
 * The page half of the window onto the hosted site (plugin/, the Rust an app's shell builds). The Mac window tells the
 * page two things by a flag it sets and a window event it dispatches, and again as each page loads, so a page that
 * loads or listens late still knows: whether the window is in full screen, where its close, minimize and zoom buttons
 * hide, and whether a newer build of the app is installed, for the page to offer Restart. Outside the Mac window
 * neither is ever set.
 */

export { FULL_SCREEN_EVENT, FULL_SCREEN_FLAG, NEWER_BUILD_EVENT, NEWER_BUILD_FLAG, RESTART_HOST } from './names';

const flag = (name: string) => (window as unknown as Record<string, unknown>)[name] === true;

/** Whether the Mac window has said it is in full screen. */
export function windowFullScreen(): boolean {
  return flag(FULL_SCREEN_FLAG);
}

/** Whether the Mac window has said a newer build of the app is installed than the one running. */
export function newerBuildInstalled(): boolean {
  return flag(NEWER_BUILD_FLAG);
}

function useWindowFlag(read: () => boolean, event: string): boolean {
  const [now, setNow] = useState(read);
  useEffect(() => {
    const listener = () => setNow(read());
    // The flag may have been set between the first render and this listener.
    listener();
    window.addEventListener(event, listener);
    return () => window.removeEventListener(event, listener);
  }, [read, event]);
  return now;
}

/** Whether the Mac window is in full screen, for a top bar that clears the window's buttons only when they show. */
export function useWindowFullScreen(): boolean {
  return useWindowFlag(windowFullScreen, FULL_SCREEN_EVENT);
}

/** Whether a newer build of the app is installed, for the page to offer Restart, a link to `restartLink(scheme)`. */
export function useNewerBuildInstalled(): boolean {
  return useWindowFlag(newerBuildInstalled, NEWER_BUILD_EVENT);
}

/**
 * The link that restarts the app into the newer build, for the page to open in the window (`location.href = …`).
 * `scheme` is the app's own link scheme, the one `Site::scheme` names. With no newer build installed the window
 * ignores it.
 */
export function restartLink(scheme: string): string {
  return `${scheme}://${RESTART_HOST}`;
}
