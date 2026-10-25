# app-kit

The baseline every app of ours ships with, written once instead of copied from the last app. One package with a folder for each kind of app, and two for what several kinds share. Practices' rules files say why each piece exists; this package is the code.

| Folder | Import names | What it holds |
| --- | --- | --- |
| `web/` | `app-kit/web` | Web apps: the web client kit, its sign-in gate and the provider interface the gate takes. |
| `extension/` | `app-kit/extension/...` | Browser extensions: the worker files Chrome loads, the native host, the test harness. |
| `tauri/` | `app-kit/tauri/sign-in`, `.../sign-in/server`, `app-kit/tauri/iphone-notifications`, `.../iphone-notifications/server` | Mac and iPhone apps built with Tauri: desktop sign-in through the browser, with its server routes; iPhone notifications through Apple's push service, with the plugin the shell builds and the server's sending. |
| `authentication/` | `app-kit/authentication/clerk`, `.../clerk/server`, `.../stand-in`, `.../stand-in/playwright`, `.../agent-keys`, `.../agent-keys/openapi` | Who is calling: Clerk's adapter, the test stand-in, and keys for agents with their API reference. |
| `server/` | `app-kit/server/google` | Server-only pieces no kind of app owns: what a refusal from Google means. |
| `bin/`, `scripts/`, `test/` | the `app-kit` command | The command, the gates and the landing, and every unit test. |

A piece with a browser half keeps its server half beside it (`tauri/sign-in/server.ts`); a piece that is server only goes in `server/`. No vendor names a top folder.

## Taking it in

An app installs the kit at a release tag, straight from GitHub, which needs no credentials since the repository is public:

```sh
bun add github:worktron/app-kit#v0.6.1
```

`bun.lock` then holds the exact commit and a hash of its download, so a build from the lockfile, such as Railway's `bun install --frozen-lockfile`, installs that commit and nothing newer. The kit ships TypeScript sources, which Vite and Bun compile with the app, except the Playwright steps, which are plain JavaScript; the web part needs React 19 and MUI 9, and `@clerk/react` 6 for the Clerk adapter. A server installs the kit as an app's client does: the package names React and MUI as peers for its web part, and the server pieces import neither. To upgrade, run the same `bun add` at the new tag and commit `package.json` and `bun.lock`; each app upgrades when it chooses.

## web/: the web client kit

`app-kit/web`: React and MUI, with sign-in behind an adapter so the provider can change without the apps changing. `rules/web-apps.md` is its list.

| Piece | Import | What it does |
| --- | --- | --- |
| Fetch wrapper | `request` | Sends the session's token, reads the status before the body, and returns the parsed JSON. A 401 is asked once more with a fresh token; refused again, sign-in comes up over the current address, once, never in a loop. |
| Server-unreachable line | `ConnectionLine`, `useServerReachable`, `onReconnect` | No answer, or a proxy's 502, 503 or 504, shows a line until the server answers again. While down it looks every five seconds and when the browser comes back online or the page back in front. |
| New-deploy line | `NewBuildLine`, `useNewBuild`, `lookForNewBuild` | An open page looks for a newer build when it comes back in front, at most once a minute, or at once on a pull to refresh, and shows a quiet line with Reload. It reloads by itself only once hidden, or after ten idle minutes, with nothing entered, unless the app passes `reloadsItself: false` to `useNewBuild`, or `reloadsItself={false}` to `NewBuildLine`, because its view holds something only in memory. |
| Reload after a failed screen load | `reloadOnFailedLoad` | A tab open across a deploy asks for screen code that is gone; Vite's `vite:preloadError` reloads the page once, with a guard so it never loops. |
| Error boundary | `ErrorBoundary` | A crash shows what failed and a Reload button, or the app's own `fallback`. |
| Links for rows and cards | `RowLink`, `NavigateProvider` | A whole row as a real `<a href>`: ⌘-click and middle-click open a new tab, a plain click moves through the app's navigate. |
| The phone's Text Size | `followTextSize`, `useTextScale` | On an iPhone or iPad, the page's root font size follows the Text Size chosen in Settings, which a web view otherwise ignores, so every size in rem follows; read again each time the page comes back in front. Anywhere else the scale is 1. See below. |
| Sign-in gate | `SignInGate`, `useSignIn`, `useSignOut`, `usePerson`, `useAppDrawn` | One steady placeholder until the provider knows who is signed in and, with `waitForFirstDraw`, until the app has drawn its first data. The app's sign-in screen at whatever address was asked for, so sign-in lands there. Sign-in and sign-out with no page load beyond the provider's own trip to Google. Continue as the account last used on this device, or Use a different account, which asks Google for its list. |
| Provider interface | `SignInProvider`, `ProviderSession`, `Outcome` | What the gate takes from a sign-in provider. The adapters are in `authentication/`, below. |

### An app built on it

```tsx
import { ErrorBoundary, SignInGate, reloadOnFailedLoad, configureConnection, followTextSize } from 'app-kit/web';
import { clerkSignIn } from 'app-kit/authentication/clerk';

reloadOnFailedLoad();
configureConnection({ probePath: '/api/health' });
followTextSize();
const provider = clerkSignIn({ publishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY });

createRoot(root).render(
  <ErrorBoundary>
    <SignInGate provider={provider} placeholder={<Wordmark />} signedOut={<SignInScreen />} waitForFirstDraw>
      <App />
    </SignInGate>
  </ErrorBoundary>,
);
```

The app draws its own sign-in screen with `useSignIn()`: `lastAccount` for Continue as that account, `google('remembered')`, `google('choose')` and `google({ account })` for an account chosen in another window, `sendEmailCode` and `checkEmailCode`, and `notice` for what to say above the buttons. Its server answers `/sso-callback` (or the gate's `callbackPath`) with the app, since Google returns there. With `waitForFirstDraw`, the app is rendered from the start, so its requests go out, but none of it shows until it calls `useAppDrawn()`'s function, so the whole screen appears at once. Every screen calls it once its first data is in or has failed to come, and a screen with nothing to load calls it at once: a screen that never calls it stays hidden. Every request goes through `request`.

`web/e2e/fixture` is a whole one, which the kit's own browser test runs.

### Browser tests

The kit's own tests prove how each piece behaves: that the unreachable line comes and goes, that a newer deploy is found when the page comes back in front, that sign-in lands on the address asked for. An app's tests prove only its wiring: that it mounted the piece, where it shows, in its own words, and with which options, such as `reloadsItself: false`. An app does not test the kit's behavior again.

Three steps depend on how the kit works inside, so an app takes them from the kit rather than writing its own, from `app-kit/authentication/stand-in/playwright` beside the stand-in:

- `showPage(page)` brings the page back in front, as a phone does when the home-screen app returns. After `hidePage`, it makes the page visible again, since the kit looks only from a visible page.
- `hidePage(page)` hides the page, as when the person switches to another tab.
- `serveNewerBuild(page)` serves the index page as a newer deploy would, naming another built entry, and returns `{ stop }`, which serves the real page again. It throws at once if the page names no module script under `/assets/`, which is how the kit tells a page's build.

```ts
import { expect, test } from '@playwright/test';
import { serveNewerBuild, showPage } from 'app-kit/authentication/stand-in/playwright';

test('a newer deploy shows our own line under the bar', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await serveNewerBuild(page);
  await page.clock.fastForward('01:01');
  await showPage(page);
  await expect(page.locator('header').getByRole('status')).toHaveText(/Our app has changed/);
});
```

The steps are plain JavaScript with their types beside them, because Playwright's test runner leaves files under `node_modules` to Node, which refuses TypeScript there. An app whose browser tests sit outside the workspace that depends on the kit, such as a root `e2e/` folder beside `client/`, adds the kit to that workspace too, at the same tag.

### The phone's Text Size

An iPhone's web view, Safari's and the one a Tauri app runs in, ignores the Text Size set in Settings unless the page asks for it, and Apple has said it will stay that way (WebKit bug 187013). `followTextSize()`, called once at start, asks: it measures an element in Apple's body text style, which does take the setting, against its default of 17 pixels, and multiplies the page's root font size by that scale, the app's own root size if it sets one, from about 0.82 at the smallest size to about 3.12 at the largest accessibility size. It reads again each time the page comes back in front, since changing the setting means leaving the app.

- **Size text in rem.** MUI's theme does by default, so its typography follows with nothing more. A size in pixels follows only when the app multiplies it: `calc(14px * var(--text-scale, 1))`, the variable the kit sets beside the root size. Spacing in pixels stays as it is, as in Apple's own apps.
- **Lay screens out for the largest sizes.** At three times the default, a row of buttons or a fixed-height card no longer fits. `useTextScale()` gives the scale to code that changes a layout at large sizes, and re-renders when it changes; it follows the setting too, so an app using only the hook needs no `followTextSize()` call.
- **Off an iPhone or iPad the scale is 1**, and the root size is left alone. A Mac's Safari knows Apple's style but answers 13 pixels, its own fixed size, so the kit reads only on a touch device that answers at least 14, the smallest iPhone size. Playwright's WebKit, with an iPhone profile or without, is a Mac's and reads 1 too; only the iPhone Simulator shows the setting, as `web/text-size.ts` says how.

## extension/: the extension kit

`app-kit/extension`: what every browser extension of ours ships with. `rules/extensions.md` is its list. The worker files are plain JavaScript Chrome loads with no build step; the rest is TypeScript run by Bun on the Mac.

| Piece | Where | What it does |
| --- | --- | --- |
| Self-reload | `extension/worker/self-reload.js` | An extension loaded unpacked from its checkout reloads itself when the checkout's commit changes, when a file it loads is deleted, or, for a built folder, when the build on disk changes. A Web Store install never does. |
| Build identity | `extension/worker/build.js` | The version and the commit the worker loaded from, as `0.1.0-src (abc1234)`, and a record in `storage.local` of when this profile first ran that build. |
| Account identity | `extension/worker/account.js` | The profile's signed-in account from `chrome.identity.getProfileUserInfo`, with `identity.email` an optional permission asked for when a feature needs it. |
| Timers | `extension/worker/alarms.js` | Work on a clock runs on `chrome.alarms`, which survive Chrome stopping the worker, unlike `setInterval`. |
| Recorded errors | `extension/worker/errors.js` | The worker's uncaught errors, each with its time and build, kept in `storage.local`. |
| Native port | `extension/worker/port.js` | The worker's port to a native host, which reconnects, says hello with its build, and answers the host's status question with its build, commit and errors. |
| Native host | `app-kit/extension/host` | The host Chrome starts: it serves a unix socket for callers on the Mac (a command line, an MCP server, a server) and relays their requests to the extension. Also the client callers use, the status they read, the extension's ID from its key, and the manifest that tells Chrome about the host. |
| Status command | `app-kit extension status <socket>` | Prints what the host says: whether the extension is connected, its build, its commit and its kept errors. |
| Harness | `app-kit/extension/harness` | Loads the real extension in a hidden Chromium from a scratch git checkout, with its native host, for the extension's own tests: fire an alarm, commit, wait for the reload, count tabs. |
| Chrome stand-in | `app-kit/extension/testing/chrome` | An in-memory `chrome` for unit tests of a worker built on the kit. |

An extension installs app-kit the same way an app does, then copies the files Chrome loads into a folder of its own and commits them, because an unpacked extension loads from its checkout and a landing updates a checkout with git alone:

```sh
bun add github:worktron/app-kit#v0.6.1
bun run app-kit extension copy extension/kit
```

`bun run` runs the installed command and never downloads one, as `bunx` would from npm when the kit is not installed. Each copy's first line names the kit version it came from. A test in the extension keeps the copy current, comparing the code below that line, so a release that changes no worker file asks for no new copy:

```ts
import { workerCopyDiffers } from 'app-kit/extension/copy'
test('the kit copy is current', () => expect(workerCopyDiffers('extension/kit')).toEqual([]))
```

To upgrade, run the same `bun add` at the new tag, then the copy command again.

A worker built on it:

```js
import { every } from "./kit/alarms.js";
import { buildName, recordBuild } from "./kit/build.js";
import { watchWorkerErrors } from "./kit/errors.js";
import { nativePort } from "./kit/port.js";
import { checkForNewCheckout } from "./kit/self-reload.js";

const LOADED_FILES = ["extension/worker.js", "extension/kit/self-reload.js" /* every file the worker loads */];
let commit = null;

const port = nativePort({
  host: "com.example.tool",
  describe: () => ({ version: buildName(commit), commit }),
  answer: async (message) => ({ type: "answer", id: message.id /* , what the extension found */ }),
});

async function start() {
  const checked = await checkForNewCheckout(LOADED_FILES);
  commit = checked.commit;
  if (checked.reloading) return;
  await recordBuild(commit);
  port.connect();
}

watchWorkerErrors(self, () => buildName(commit));
every("check", 1, start);
chrome.runtime.onStartup.addListener(start);
chrome.runtime.onInstalled.addListener(start);
start();
```

`extension/test/fixture/worker.js` is a whole one, which the kit's own hidden-Chromium test loads.

The host:

```ts
import { serveHost } from 'app-kit/extension/host'
await serveHost({ socketPath, logPath, refuse: (request) => (allowed(request) ? null : 'never sent') })
```

A caller writes one JSON line with an `id` and a `type` to the socket and reads one line back with the same `id`; `ask(socketPath, line)` does both. The type `status` is the host's own. The socket belongs in the tool's Application Support folder (`applicationSupport(name)`), and its path must stay under 104 bytes.

## tauri/: Mac and iPhone apps

What a Tauri app's page, shell and server share: desktop sign-in, and iPhone notifications.

### Desktop sign-in

`app-kit/tauri/sign-in` and, for the server, `app-kit/tauri/sign-in/server`: Google refuses to sign in inside a desktop app's web view, so the app's window opens the default browser for it, and the browser hands the sign-in back through the app's own link. Practices' `rules/desktop-apps.md` and `rules/tauri.md` say why. The kit holds every decision and request; the app draws its own screens from the states the hooks give, and its shell passes the link into the page. The window's page is the app's own site, served by the server that mounts the routes, as a Tauri window onto the hosted app is, since the browser page and the routes are on the page's origin.

1. The window opens `desktopSignInAddress(account)` in the browser: `/desktop-sign-in`, with a nonce kept in the window's own storage and the account chosen in the window: `{ account }` for Continue as that account, `'choose'` for Use a different account, which shows Google's list even when the browser is signed in, or `null` for Continue with Google with no account remembered, which takes whoever the browser is signed in as. A second click asks with the same nonce.
2. In the browser, signed out, the app's sign-in screen goes to Google once per tab when `startGoogleHere()` says so, for `desktopSignInRequest().account` (Google's list for `'choose'` or `null`). Signed in, `useDesktopSignInBrowserPage({ session, scheme })` hands the account over; signed in as another account than the one named, or asked for Google's list, it signs out first, and the sign-in screen goes to Google; back from Google, whoever was picked there goes over. It asks the server for a one-time ticket, opens `<scheme>://sign-in?ticket=…&nonce=…`, and closes the tab once the server says the app has signed in. After a trip to Google the browser will not close the tab, so the app says the window is signed in.
3. The shell, given that link, dispatches `DESKTOP_SIGN_IN_EVENT` with `{ ticket, nonce }` when the page has set `DESKTOP_SIGN_IN_LISTENING`, else loads the app's address with `TICKET_PARAM` and `NONCE_PARAM` in its fragment, which the browser never sends, so the ticket is in no server's log. It JSON-encodes both values into its script and checks their characters, since any app on the Mac can open the link. Each app holds its shell to these names with a test that reads its Rust.
4. The page calls `listenForDesktopSignIn()` from its first script, and `useDesktopSignInWindow(session)` signs in with the link through the adapter's `ticket`, only when the nonce is the one the window asked with. The nonce is used up once the ticket works, so a fresh ticket after an expired one still signs in; links that come while one is being taken, or while signed in, are dropped. An iPhone app whose sign-in sheet returns the link to the page passes it to `desktopSignInArrived`.

The server mounts the routes where the kit asks for them, behind its own sign-in check:

```ts
import { DESKTOP_SIGN_IN_ROUTES, desktopSignInRoutes } from 'app-kit/tauri/sign-in/server';

app.route(DESKTOP_SIGN_IN_ROUTES, desktopSignInRoutes({
  // A session's person only, never a key for agents': a ticket signs its holder in as that person.
  userId: (c) => getAuth(c, { acceptsToken: 'session_token' })?.userId ?? null,
  makeTicket: async (userId) => (await clerk.signInTokens.createSignInToken({ userId, expiresInSeconds: 60 })).token,
}));
```

Every request the part makes carries the session's own token, so it works without the gate. The server half needs Hono 4.

### iPhone notifications

`app-kit/tauri/iphone-notifications` for the page, `app-kit/tauri/iphone-notifications/server` for the server, and a Tauri plugin for the shell, in `tauri/iphone-notifications/plugin/`: an iPhone build gets notifications through Apple's push service, and a tap opens the page the notification is about, whether the app was closed, in the background or in front. Tauri's own notification plugin shows only notifications the app makes itself. The plugin is the kit's copy of tauri-plugin-mobile-push 0.1.4 (MIT or Apache 2.0), changed so that a tap reaches the page: the original receives it but never hands it over, and listens for taps only once the page asks for a token, after a tap that launched the app is gone. argon-watcher is the first app.

How a tap reaches the page: the plugin keeps the notification's page until the page takes it, and the page takes it when it starts (a tap that launched the app), each time it comes back in front (a tap with the app in the background), and when the plugin dispatches `TAPPED_EVENT` (a tap on a banner with the app in front). Only a page on the app's own site opens; anything else is refused and logged. Every step logs a line starting `[iphone-notifications]`, in the page's console and in the phone's log, and a tap that opened its page logs `[iphone-notifications] opened /alerts/3 from a tap`.

The shell builds the plugin from the kit that bun installed, so `package.json` stays the only place that names the kit's version and the page and the plugin always come from one release. Run `bun install` before any Rust build. In `src-tauri/Cargo.toml`, with the path from `src-tauri` to the `node_modules` that holds the kit:

```toml
[target.'cfg(target_os = "ios")'.dependencies]
tauri-plugin-iphone-notifications = { path = "../node_modules/app-kit/tauri/iphone-notifications/plugin" }
```

In the shell, registered after `tauri_plugin_notification` when the app has it, and with the permission granted to the page; a permission the shell names that no plugin defines stops the app at launch:

```rust
#[cfg(target_os = "ios")]
let builder = builder
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_iphone_notifications::init());
// ...
let page = CapabilityBuilder::new("page").remote(format!("{origin}/*")).window(MAIN)
    .permission("iphone-notifications:default");
```

Only one object can be iOS's notification delegate. Tauri's notification plugin takes it when it starts and ignores pushes, so this plugin takes it when it starts and again once the window loads, logging which plugin it took it from. On an iPhone, taps on notifications the app made through Tauri's plugin then do nothing, as they did with the original plugin.

The page, from its first script after sign-in; `register` sends the device to the app's server, and `open` is the router's navigate (without it the page loads the address):

```ts
import { startIphoneNotifications } from 'app-kit/tauri/iphone-notifications';

startIphoneNotifications({
  register: (device) => request('/api/push/apple', { method: 'POST', body: JSON.stringify(device) }),
  open: (page) => navigate(page),
});
```

It runs only in a Tauri app whose user agent names an iPhone (or an iPad, which by default names a Mac and so is left out) and does nothing elsewhere, so the Mac app shares the page. It registers on every launch, which covers Apple changing the token. `device` is `{ token, environment }`: the plugin says which of Apple's services the token is for, `development` for a debug build (installed from Xcode) and `production` for a release build (TestFlight and the App Store). A release build signed for development would say production, and Apple calls its token bad; the server logs each retired token with the service it was sent to. The app's build needs the Push Notifications capability, `aps-environment` in its entitlements.

The server keeps the devices and sends:

```ts
import { sendToApple } from 'app-kit/tauri/iphone-notifications/server';

const result = await sendToApple(devices, { title, body, url: '/alerts/3', tag }, { topic: 'com.example.app', ttlSeconds: 4 * 60 * 60 });
for (const token of result.gone) await forgetAppleDevice(token);
```

`topic` is the iPhone app's bundle id. The push key comes from `APPLE_PUSH_KEY_ID`, `APPLE_PUSH_TEAM_ID` and `APPLE_PUSH_KEY` (the .p8 file's contents); with any missing it sends nothing. `url` is the page a tap opens, and the payload carries only its path, query and fragment, so a debug build whose page runs on a dev server opens the same page there. A device Apple calls unregistered or bad comes back in `gone` for the app to remove; since the phone registers again on its next launch, a token removed by mistake comes back. A send that Apple has not answered in 15 seconds counts as failed.

## authentication/: who is calling

A person signed in through a sign-in provider, or an agent with a person's key. Nothing outside `authentication/clerk/` imports Clerk, which `test/clerk-imports.test.ts` holds, so every other part works with another provider.

| Piece | Import | What it does |
| --- | --- | --- |
| Clerk | `app-kit/authentication/clerk` | `clerkSignIn({ publishableKey })`, the first adapter for the web kit's sign-in gate. |
| Clerk for the key check | `app-kit/authentication/clerk/server` | `clerkCaller`, which reads a request's caller from Clerk for `requireCaller`. |
| Stand-in | `app-kit/authentication/stand-in` | `standInSignIn()`, a provider with no network for tests of the kit and of apps built on it. |
| Playwright steps | `app-kit/authentication/stand-in/playwright` | `showPage`, `hidePage` and `serveNewerBuild`, for an app's browser tests. See Browser tests above. |
| Keys for agents | `app-kit/authentication/agent-keys` | `requireCaller` and `callerOf`: a person's key reads the GET routes the app lists. |
| API reference | `app-kit/authentication/agent-keys/openapi` | The OpenAPI descriptions and reference page that show a key those routes. |

### The adapter

A provider is `{ Root, useSession, GoogleReturn }` (`web/sign-in/provider.ts`): its own context around the app; a hook giving whether it has loaded, who is signed in, a token (fresh on demand), Google sign-in to a callback path naming an account or asking for the list, an emailed code sent and checked, a sign-in with a one-time ticket from the app's server, and sign-out that stays on the page; and a component that finishes the return from Google. Another provider is another adapter, and the apps change only which one they pass to the gate.

Clerk-specific, by design: the Clerk adapter starts Google through Clerk's classic sign-in resource, since its newer one takes no account to sign in as. A part of an app that needs more of Clerk than the adapter asks for uses Clerk's own hooks inside the gate, whose provider is Clerk's. An app with its own `ClerkProvider` and no gate reads the adapter's session with `clerkSignIn({ publishableKey }).useSession()` inside it.

The Clerk instance needs Google on for sign-in and emailed codes as an email sign-in strategy, since the adapter signs in with both. In the settings Clerk's command line tool reads and writes (`clerk config patch`), that is `connection_oauth_google` with `enabled` and `authenticatable` true, and `auth_email` with `used_for_sign_in` true and `email_code` among its `sign_in_strategies`. A production instance copies them from development when it is created as a clone, and Google there also needs the app's own Google OAuth client.

### Keys for agents

`app-kit/authentication/agent-keys`: a person makes a key in the app's Settings, and an agent or script sends it as `Authorization: Bearer <key>` to read that person's own data. The app's server names the GET routes a key may read; every other route stays session-only. Clerk holds the keys: it makes, lists and revokes them in the API keys tab of its own profile screen (or its `<APIKeys />` component), and checks each one on every request.

```ts
import { clerkMiddleware } from '@clerk/hono';
import { requireCaller, callerOf } from 'app-kit/authentication/agent-keys';
import { clerkCaller } from 'app-kit/authentication/clerk/server';

app.use('/api/*', clerkMiddleware());
app.use(
  '/api/*',
  requireCaller({
    caller: clerkCaller,
    readableByKey: ['GET /api/profiles/:id/decisions', 'GET /api/profiles/:id/matters', 'ALL /api/*'],
    openPaths: ['/api/oauth/gmail/callback'],
  }),
);

app.get('/api/profiles/:id/decisions', (c) => listDecisions(callerOf(c).personId, c.req.param('id')));
// ...
app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));
```

- **The list decides.** Each entry is the method and the path as the app registered it. The check reads every route Hono matched for the request after it, and lets a key through only when all of them are listed, since any of them could run: the first unless it passes the request on with `next()`, and an `app.all` handler cannot be told from middleware. So the app lists its catch-alls too, such as a not-found answer `ALL /api/*` and a page fallback registered as `*`, which Hono records as `GET /*`. A literal route such as `/api/items/export`, registered beside a listed `/api/items/:id`, is never let through by mistake. A refusal's log line names the unlisted route. A key is refused on anything but GET (and HEAD, which runs the GET route), but a GET can still write, so a listed route must never write, not even behind a query flag such as `?check=1`.
- **Mount the check last.** After `clerkMiddleware()` and every other middleware, right before the routes: middleware mounted after it, the app's or a sub-app's, could answer a key's request, so a key is refused wherever any matches, and the log names it. Hono records middleware and an `app.all` route the same way, method `ALL` and its path, so a listed `ALL /api/*` also lets through middleware mounted at `/api/*` after the check.
- **Handlers read the person with `callerOf(c).personId`.** A handler that asks Clerk for a session itself, such as `getAuth(c, { acceptsToken: 'session_token' })`, refuses every key the check let through. An app swaps its one helper for `callerOf`.
- **The answers.** A key on a write or on a route not listed gets 403 with why. No sign-in, or a revoked, expired or unknown key, gets 401. A key Clerk could not check, because Clerk could not be reached or answered with an error, gets 503, so an agent does not report a working key as revoked. Every decision about a key is logged with the key's name and id, never its secret.
- **Only a person's own keys.** A key owned by an organization, and Clerk's other kinds of machine token, are refused.
- **Revoking takes about a minute.** Measured on 2026-10-24: Clerk's key check kept accepting a revoked key for 55 seconds, though its key lookup said revoked at once.
- **Switching it on.** In the Clerk Dashboard, for each instance: Configure, Developers, API keys, Enable API keys, with user API keys on and organization keys off. The page under Instance, also called API keys, is the app's own Clerk secret keys, not this.
- **The agent's side.** The person pastes the key into 1Password, and the agent reads it where it calls: `curl -H "Authorization: Bearer $(op read 'op://<vault>/<item>/credential')" https://<app>/api/...`. An agent starts at the app's `/api/reference.json` (below), which lists what its key may read.

Needs `hono` 4.12 or later and `@clerk/hono` 0.1.93 or later.

### API reference

`app-kit/authentication/agent-keys/openapi`: the app describes its routes next to their code with `hono-openapi`, and the kit generates two OpenAPI descriptions from them: the whole one for a signed-in person, and one holding only the GET routes a key may read, for an agent. Both end with a section on calling the API with a key, written from the key's description, so no app writes that prose by hand. People read it on a Scalar reference page.

```ts
import { describeRoute, resolver, validator } from 'hono-openapi';
import { z } from 'zod';
import { Scalar } from '@scalar/hono-api-reference';
import { callerOf } from 'app-kit/authentication/agent-keys';
import { openApiDescriptions, REFERENCE_PAGE_SETTINGS } from 'app-kit/authentication/agent-keys/openapi';

const READABLE = ['GET /api/reference.json', 'GET /api/profiles/:id/decisions', 'ALL /api/*'];
// ...requireCaller({ caller: clerkCaller, readableByKey: READABLE }) as above, then the routes:

app.get(
  '/api/profiles/:id/decisions',
  describeRoute({ summary: 'List the decisions on a profile', responses: { 200: { description: 'The decisions', content: { 'application/json': { schema: resolver(Decisions) } } } } }),
  validator('param', z.object({ id: z.string().uuid() })),
  (c) => listDecisions(callerOf(c).personId, c.req.valid('param').id),
);

const descriptions = openApiDescriptions(app, { title: 'Argon', description: 'What the app keeps for you.', readableByKey: READABLE });
app.get('/api/reference.json', describeRoute({ summary: "This API's OpenAPI description" }), async (c) =>
  c.json(await descriptions.forCaller(callerOf(c))),
);
app.get('/api/reference', Scalar({ ...REFERENCE_PAGE_SETTINGS, pageTitle: 'Argon API', url: '/api/reference.json' }));
// ...then the not-found catch-all, last.
```

- **One list.** The same `READABLE` goes to `requireCaller` and to `openApiDescriptions`, and lists `GET /api/reference.json`, so an agent with a key reads its own description there and a signed-in person reads the whole one. The page itself is not listed: only a signed-in person opens it. A signed-out person sees `{"error":"unauthorized"}`, so the app links the page from its own signed-in screens.
- **Generated once.** Each description is generated on first use, after every route is registered, and kept for the life of the server.
- **A key's description is generated from only its routes**, the same strings the key check compares, so it holds no schema that only another route uses.
- **The test.** `undescribedForKey(app, READABLE)` names each listed GET route a key would not see described: no `describeRoute`, only a `validator`, or a route the generator drops. Catch-alls are skipped. An app's test expects `[]`.
- **Describing a route.** `describeRoute` gives the summary; `validator` from `hono-openapi` replaces `zValidator` from `@hono/zod-validator` and puts the schema in the description. Its 400 answer differs: `{ success: false, error: [issues], data }`, which echoes the input back. Zod 4, or Zod 3.25 with `zod-to-json-schema`.
- **The reference page stays on the app's host.** `REFERENCE_PAGE_SETTINGS` turns off what Scalar does by default that leaves it:
  - its AI agent, on by default on localhost, which uploads the description to Scalar;
  - its hosted proxy, through which a test request from a deployed app goes to Scalar's server with any key typed into the page;
  - its developer toolbar, whose Share and Deploy send the description to Scalar's cloud;
  - its fonts and its telemetry.

  It also pins Scalar's script to one release on jsDelivr, so a page that carries the session never runs a newer script than the one checked, and draws its first frame in the system's light or dark. The page asks only the app and `cdn.jsdelivr.net`. An app with a content security policy allows `https://cdn.jsdelivr.net/npm/@scalar/` and inline scripts on that page, or passes Scalar its nonce (`nonce: c.get('secureHeadersNonce')`).

Needs `hono-openapi` 1.5 or later, and `@scalar/hono-api-reference` for the page.

## server/: the Google part

`app-kit/server/google`, for an app's server: what a refusal from Google means, read the same way in every app. It takes the answer to a call made with a grant the app holds, whether the token came from Clerk or from the app's own Google sign-in: any Google API (Gmail, Calendar, Drive), or a refresh at Google's token endpoint. A sign-in's first exchange of its code is not one: Google answers `invalid_grant` there too, for a code that is stale or used, and the sign-in starts again. It has no React and no packages.

```ts
import { readGoogleResponse } from 'app-kit/server/google';

let response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
let refusal = response.ok ? null : await readGoogleResponse(response);
if (refusal?.kind === 'freshToken') {
  response = await fetch(url, { headers: { Authorization: `Bearer ${await freshToken()}` } });
  refusal = response.ok ? null : await readGoogleResponse(response, { tokenWasFresh: true });
}
```

| Google's answer | Reads as |
| --- | --- |
| The token endpoint's `invalid_grant`: revoked, expired (Testing mode ends a grant after about 7 days) or a changed password | `reconnect`, why `revoked` |
| A 403 with `insufficientPermissions` or `ACCESS_TOKEN_SCOPE_INSUFFICIENT`: the grant lacks the permission, usually a box left unticked on Google's consent screen | `reconnect`, why `missingAccess` |
| A 401 from an API | `freshToken`; with `tokenWasFresh`, `reconnect`, why `revoked` |
| `rateLimitExceeded`, `userRateLimitExceeded`, `quotaExceeded` or `RATE_LIMIT_EXCEEDED` (sent as a 403 as often as a 429), a 429, or a 500, 502, 503 or 504 | `later`, with `retryAfterMs` from Retry-After |
| Anything else: an API the Google Cloud project has not switched on (`accessNotConfigured`), a permission on the item itself, a 404, a 410 `fullSyncRequired`, the token endpoint's `invalid_client` | `failed` |

Every reading carries Google's own `reason` and a one-line `message` for the log. Only answers with a recorded or Google-documented sample have a meaning; anything else reads as `failed` until one is recorded. What the person sees is the app's: its server sends the words with the status, a reconnect names the service ("Reconnect Google Calendar"), says how old what is shown is, and for `missingAccess` says to tick the box on Google's screen.

## bin/, scripts/ and test/: develop

`bun test`, `bun run typecheck`, `bun run lint`, `bun run test:e2e` for the web fixture in a hidden Chromium, and `bun test ./extension/e2e/harness.e2e.ts` for the extension fixture through the harness (`bunx playwright install chromium` first). `scripts/gates.sh` runs all five, then builds the iPhone notifications plugin's Rust and Swift for the iPhone simulator, with Rust from rustup and its `aarch64-apple-ios-sim` target, in one build folder all checkouts share. A change to `extension/worker/` is followed by `bun bin/app-kit.ts extension copy extension/test/fixture/kit`, which a test checks.

Releases are tags, `v<version>`, matching `package.json`'s version, on the commit main lands at, so a release is always a commit main holds. A tag never moves; a fix is a new tag. While the version is 0.x, a patch release needs no change in the apps and a minor one may, which its commit messages say.

A branch never sets the version. Its commits say what kind of change it is, with a line beside Co-Authored-By:

```
Release: minor
```

`minor`, `patch` or `none`; a branch that changes only plan files needs none. `scripts/land-main.sh` lands it: it rebases onto main, works out the next version from main's, commits it along with the install lines above, runs `scripts/gates.sh`, moves main and pushes the tag. If another branch lands while the gates run, it starts again with the next number, up to three times. It refuses a branch that edits the version itself or says no kind of change, and a run that stops before main moves leaves the branch as it was, with no version commit on it. One that moved main but could not push the tag says so, and the next landing pushes that tag first.

The repository is public. Main moves forward with a push that is never forced, which adds no commit, so every commit keeps Worktron as its author and committer. A pull request's merge buttons write a new committer, the merging account, for every commit, merge, squash and rebase alike. `test/public.test.ts` fails on any personal email, home folder or name in the files or the history.
