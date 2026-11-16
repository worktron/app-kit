// The types of names.js, which is plain JavaScript because first-paint.js imports it, and an app's vite.config loads
// that in Node, which refuses TypeScript from inside node_modules, where an app has the kit.

/** The local storage key holding '1' when this browser was signed in when it last looked, '0' when not. */
export const SIGNED_IN_KEY: 'app-kit.signedIn';

/** The attribute the first frame's script sets on <html> before the first paint when SIGNED_IN_KEY holds '1'. */
export const SIGNED_IN_BEFORE: 'data-signed-in-before';
