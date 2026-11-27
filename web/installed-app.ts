/*
 * Where the page runs. A Tauri app's window puts its bridge on the page before any script of the page runs; its iPhone
 * build's web view says it is an iPhone or iPad, and its Android build's says Android. A web app added to the home
 * screen opens with no browser around it, which Safari says with navigator.standalone and every browser with the
 * standalone display mode.
 */

/** Whether this page runs in a Tauri app's window, on a Mac, an iPhone or an Android phone. */
export function isTauriApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Whether this page runs in a Tauri app on an iPhone or iPad. */
export function isIphoneApp(): boolean {
  return isTauriApp() && /\b(iPhone|iPad)\b/.test(navigator.userAgent);
}

/**
 * Whether this page runs in a Tauri app on an Android phone or tablet. The page's check for the Mac's browser sign-in,
 * a Tauri app that is not an iPhone app, already takes it in, which is right: Google refuses sign-in inside its web view.
 */
export function isAndroidApp(): boolean {
  return isTauriApp() && /\bAndroid\b/.test(navigator.userAgent);
}

/**
 * Whether this page runs as an installed app with no browser controls around it: the iPhone or Android app, or a web
 * app opened from the home screen. A Tauri app's Mac window is not one: it has no touch to pull with.
 */
export function isInstalledApp(): boolean {
  if (isTauriApp()) return isIphoneApp() || isAndroidApp();
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
}

/**
 * Whether this page runs as an app rather than in a browser tab: the Mac, iPhone or Android app, or a web app opened
 * from the home screen. People there do not think of it as a page, so the update line speaks of an update, not a
 * reload. Kept to the kit: apps ask `isInstalledApp` or `isTauriApp`.
 */
export function isAppWindow(): boolean {
  return isTauriApp() || isInstalledApp();
}
