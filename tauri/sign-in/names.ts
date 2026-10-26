/*
 * The names the desktop sign-in shares with the app's shell, which is Rust and cannot import them. The kit's window
 * plugin (tauri/window/plugin) is that shell, and test/tauri-window.test.ts reads its Rust and holds it to each one, so
 * a rename here fails the kit's tests rather than a sign-in. An app that writes its own shell holds it to these with a
 * test of its own.
 */

/** The browser page that signs the desktop app in. The app's window opens it in the default browser, never in itself. */
export const DESKTOP_SIGN_IN_PATH = '/desktop-sign-in';

/** Where the app's server mounts `desktopSignInRoutes`. */
export const DESKTOP_SIGN_IN_ROUTES = '/api/desktop-sign-in';

/** The host of the link the browser opens to hand the sign-in to the app: `<scheme>://sign-in?ticket=…&nonce=…`. */
export const LINK_HOST = 'sign-in';

/**
 * The window event the shell dispatches with `{ ticket, nonce }` as its detail, for a page that has set the flag below,
 * so the page signs in where it is with no page load.
 */
export const DESKTOP_SIGN_IN_EVENT = 'app-kit-desktop-sign-in';
export const DESKTOP_SIGN_IN_LISTENING = '__APP_KIT_TAKES_DESKTOP_SIGN_IN__';

/**
 * For a page without the flag, still loading or from an older build: the shell loads the app's address with these in
 * its fragment (`#desktop_sign_in_ticket=…&desktop_sign_in_nonce=…`), which the browser never sends to the server.
 */
export const TICKET_PARAM = 'desktop_sign_in_ticket';
export const NONCE_PARAM = 'desktop_sign_in_nonce';
