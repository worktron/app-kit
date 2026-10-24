/*
 * The names the desktop sign-in shares with each app's shell, which is Rust and cannot import them. Each app holds its
 * shell to these with a test that reads its Rust and looks for each one, so a rename here fails that app's tests
 * rather than its sign-in.
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

/** For a page without the flag, still loading or from an older build: the shell loads the app's address with these. */
export const TICKET_PARAM = 'desktop_sign_in_ticket';
export const NONCE_PARAM = 'desktop_sign_in_nonce';
