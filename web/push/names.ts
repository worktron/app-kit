/*
 * The names the page half, the server half, the notification worker (worker.js) and the Vite plugin (vite.js) share.
 * The two plain JavaScript files cannot import this one, since Node refuses TypeScript inside node_modules, so
 * test/web-push-names.test.ts reads them and holds each copy to these.
 */

/** Where the app's site serves the kit's notification worker, which the Vite plugin serves and the page registers. */
export const WORKER_ADDRESS = '/push-worker.js';

/** The number a declarative push message carries in `web_push`, which tells the browser it may show it with no code. */
export const DECLARATIVE_PUSH = 8030;

/** What every log line of the page half, the worker and the server half starts with. */
export const LOG_PREFIX = '[web-push]';

/** What a phone's browser gives the page to send to, as `PushSubscription.toJSON()` has it, and what the server keeps. */
export type WebPushSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };
