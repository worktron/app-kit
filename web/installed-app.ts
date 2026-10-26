/*
 * Where the page runs. A Tauri app's window puts its bridge on the page before any script of the page runs; its iPhone
 * build's web view says it is an iPhone or iPad. A web app added to the home screen opens with no browser around it,
 * which Safari says with navigator.standalone and every browser with the standalone display mode.
 */

/** Whether this page runs in a Tauri app's window, on a Mac or an iPhone. */
export function isTauriApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Whether this page runs in a Tauri app on an iPhone or iPad. */
export function isIphoneApp(): boolean {
  return isTauriApp() && /\b(iPhone|iPad)\b/.test(navigator.userAgent);
}

/**
 * Whether this page runs as an installed app with no browser controls around it: the iPhone app, or a web app opened
 * from the home screen. A Tauri app's Mac window is not one: it has no touch to pull with.
 */
export function isInstalledApp(): boolean {
  if (isTauriApp()) return isIphoneApp();
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
}
