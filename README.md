# app-kit

The baseline every app of ours ships with, written once instead of copied from the last app. One package with a folder for each kind of app, and two for what several kinds share. Practices' rules files say why each piece exists; this package is the code.

| Folder | Import names | What it holds |
| --- | --- | --- |
| `web/` | `app-kit/web` | Web apps: the web client kit, its sign-in gate and the provider interface the gate takes. |
| `extension/` | `app-kit/extension/...` | Browser extensions: the worker files Chrome loads, the native host, the test harness. |
| `tauri/` | `app-kit/tauri/sign-in`, `.../sign-in/server`, `app-kit/tauri/iphone-notifications`, `.../iphone-notifications/server`, `app-kit/tauri/iphone-sign-in` | Mac and iPhone apps built with Tauri: desktop sign-in through the browser, with its server routes; iPhone notifications through Apple's push service, with the plugin the shell builds and the server's sending; iPhone sign-in in Apple's sign-in sheet, with its plugin; the `app-kit iphone-simulator quiet` command, which keeps a simulator silent; the `app-kit testflight` commands, which upload an iPhone build after each landing. |
| `authentication/` | `app-kit/authentication/clerk`, `.../clerk/server`, `.../stand-in`, `.../stand-in/playwright`, `.../agent-keys`, `.../agent-keys/openapi` | Who is calling: Clerk's adapter, the test stand-in, and keys for agents with their API reference. |
| `server/` | `app-kit/server/google`, `app-kit/server/postgres` | Server-only pieces no kind of app owns: what a refusal from Google means, and the Postgres database opener on Drizzle. |
| `bin/`, `scripts/`, `test/` | the `app-kit` command | The command, the gates and the landing, and every unit test. |

A piece with a browser half keeps its server half beside it (`tauri/sign-in/server.ts`); a piece that is server only goes in `server/`. No vendor names a top folder.

## Taking it in

An app installs the kit at a release tag, straight from GitHub, which needs no credentials since the repository is public:

```sh
bun add github:worktron/app-kit#v0.11.0
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
| Error boundary | `ErrorBoundary` | A crash shows what failed and a Reload button, or the app's own `fallback`. A built page first asks the server which build it serves, and when that is a newer one, as after a deploy or a rollback that changed what an answer holds, it reloads by itself onto it, once. Give it the app's `placeholder`, which it draws while it asks. See below. |
| Saved copies of screens | `savedCopies`, `useScreenData`, `useSavedCopy`, `useSaveAfterDraw` | A screen seen before paints at once from the copy this browser saved, then from the server. Copies are kept per build and per person, deleted at sign-out, and saved only after they have drawn, so a deploy that changes an answer's shape, or is rolled back, never leaves a copy that crashes every load. See below. |
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
  <ErrorBoundary placeholder={<Wordmark />}>
    <SignInGate provider={provider} placeholder={<Wordmark />} signedOut={<SignInScreen />} waitForFirstDraw>
      <App />
    </SignInGate>
  </ErrorBoundary>,
);
```

The app draws its own sign-in screen with `useSignIn()`: `lastAccount` for Continue as that account, `google('remembered')`, `google('choose')` and `google({ account })` for an account chosen in another window, `sendEmailCode` and `checkEmailCode`, and `notice` for what to say above the buttons. Its server answers `/sso-callback` (or the gate's `callbackPath`) with the app, since Google returns there. With `waitForFirstDraw`, the app is rendered from the start, so its requests go out, but none of it shows until it calls `useAppDrawn()`'s function, so the whole screen appears at once. Every screen calls it once its first data is in or has failed to come, and a screen with nothing to load calls it at once: a screen that never calls it stays hidden. Every request goes through `request`.

`web/e2e/fixture` is a whole one, which the kit's own browser test runs.

### A page open across a deploy

A tab left open on one build can be handed data in a shape only the next build knows: the server was deployed, or rolled back, while the page stayed. Drawing it crashes, and the kit mends that by itself. When a screen crashes on a built page, the error boundary asks the server for its index page, past every cache, and reads which built entry it names. When that is another build than the one running, the page reloads onto it, and the crash screen never shows. The same build means a real crash, which shows. While it asks, at most three seconds, it draws the `placeholder` it was given, the same one the sign-in gate has, so the person sees one steady screen through the crash, the reload and the sign-in gate; given none, it draws the crash while it asks. The page never reloads again toward the build it last reloaded toward in that tab, nor within 30 seconds of its last reload, so a crash the newer build has too, a reload that a cache answers with the old page, or two builds answering in turn mid-rollout ends on the crash screen rather than in a loop. With storage blocked the reload could not be remembered, so none is made. A boundary around one part of a page does not reload over text typed outside it. The console says what was decided and why, in lines starting `[app-kit] crash`.

The boundary sees only a crash while drawing. A screen keeps the server's answer as it came and reads it while drawing, so a shape it does not know crashes the draw, where the page can recover; reshaping the answer in the request's `.then` throws where nothing catches it, and the screen stays empty until a reload by hand.

The app's server sends the index page so that a browser never keeps it: `Cache-Control: no-cache` on `/` and on every address it answers with `index.html`, which makes the browser ask again on each load. Without the header a browser may reuse the page by its own guess, from its `Last-Modified` date, and a reload lands on the old build. The built files under `/assets/` are named after what they hold, so they are sent with `Cache-Control: public, max-age=31536000, immutable`, and a deploy never changes one under an old name.

### Saved copies of screens

A screen that paints first from the last answer it saw keeps that answer in the browser's storage, and a copy the running page cannot draw would crash every load before the screen could ask the server again; a hard reload does not clear it. Two rules keep that from happening. A copy is saved only after its screen has drawn it, in an effect, which React runs only for a draw that did not throw, so an answer in a newer shape, as an open page gets while a deploy goes out or is rolled back, crashes that one draw and is never saved. And copies are kept per build of the page, named by its built entry, so a copy saved by another build is never read; the other builds' copies are deleted as the app's copies are made. The dev server has no built entry to tell one version of the code from the next, so there nothing is kept.

Copies are kept per person too, the one the sign-in gate says is signed in (or `anyone` in an app without the gate), so nobody is drawn what another person saw on the same browser. Another person's copies are deleted the first time someone else's are read, and every copy is deleted as soon as the gate learns nobody is signed in.

```tsx
import { savedCopies, useScreenData } from 'app-kit/web';

// Once, as the app's code loads. Keys are `shop:copy:<build>:<person>:<path>`; the app's other keys under `shop:` are left alone.
const copies = savedCopies('shop');

function Shelf() {
  const shelf = useScreenData<ShelfAnswer>(copies, '/api/shelf');
  if (shelf.missing) return <NotFound />;
  if (!shelf.data) return <Loading failure={shelf.failure} retry={shelf.reload} />;
  return <ShelfList shelf={shelf.data} fetchedAt={shelf.fetchedAt} failure={shelf.failure} />;
}
```

`useScreenData` loads through `request`, again when the page comes back in front or the server can be reached again, and keeps what is shown while it loads. Only the latest load counts: an earlier answer that comes after a later one is dropped. `missing` is a 404, which also deletes that path's copy. `failure` says why the last load failed, beside the data still shown. When the path changes, the new path's copy paints at once, an answer for a path no longer shown is dropped, and `previous` holds the last path's data while the new one loads, for a screen to keep its frame from, never to show as the new path's data.

Call it in the component that draws the data, inside the error boundary that would catch its crash. A boundary below the caller lets the caller's draw finish, and the copy is saved though its screen crashed.

An app that holds its own state, such as edits shown before the server confirms them, takes only the storage half: `useSavedCopy(copies, key)` for the copy as it loads, and `useSaveAfterDraw(copies, key, copy)` with a new `{ data, fetchedAt }` each time the server sends data, never one rebuilt on every draw, since each new object is saved again.

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

A project that runs WebKit, such as one on Playwright's `devices['iPhone 15']` or `devices['Desktop Safari']`, starts it through the kit, so its runs stop flashing an icon in the Dock for every browser:

```ts
import { defineConfig, devices } from '@playwright/test';
import { webkitWithoutDockIcon } from 'app-kit/web/playwright-webkit';

export default defineConfig({
  projects: [{ name: 'iphone', use: { ...devices['iPhone 15'], launchOptions: webkitWithoutDockIcon() } }],
});
```

Playwright's WebKit is a Mac app whose Info.plist does not say it is a background app, so macOS puts it in the Dock as it starts, and a moment later WebKit turns itself into one; no launch option or environment setting changes that. `webkitWithoutDockIcon()` makes a copy-on-write clone of the WebKit Playwright installed, in `~/Library/Caches/app-kit/playwright-webkit/`, once per WebKit version, says in its Info.plist that it is a background app, signs it again ad hoc as Playwright's own is, and returns its path as the launch's `executablePath`. Playwright's own folder is never changed. A copy whose WebKit Playwright has since removed is removed with it. Off macOS, or with WebKit not installed, it returns no options, and Playwright starts its own WebKit, or says to install it; a step of making the copy that fails throws with that command's error.

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
bun add github:worktron/app-kit#v0.11.0
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

What a Tauri app's page, shell and server share: desktop sign-in, iPhone notifications, iPhone sign-in, an iPhone Simulator that runs silent, and TestFlight builds after each landing.

### Desktop sign-in

`app-kit/tauri/sign-in` and, for the server, `app-kit/tauri/sign-in/server`: Google refuses to sign in inside a desktop app's web view, so the app's window opens the default browser for it, and the browser hands the sign-in back through the app's own link. Practices' `rules/desktop-apps.md` and `rules/tauri.md` say why. The kit holds every decision and request; the app draws its own screens from the states the hooks give, and its shell passes the link into the page. The window's page is the app's own site, served by the server that mounts the routes, as a Tauri window onto the hosted app is, since the browser page and the routes are on the page's origin.

1. The window opens `desktopSignInAddress(account)` in the browser: `/desktop-sign-in`, with a nonce kept in the window's own storage and the account chosen in the window: `{ account }` for Continue as that account, `'choose'` for Use a different account, which shows Google's list even when the browser is signed in, or `null` for Continue with Google with no account remembered, which takes whoever the browser is signed in as. A second click asks with the same nonce.
2. In the browser, signed out, the app's sign-in screen goes to Google once per tab when `startGoogleHere()` says so, for `desktopSignInRequest().account` (Google's list for `'choose'` or `null`). Signed in, `useDesktopSignInBrowserPage({ session, scheme })` hands the account over; signed in as another account than the one named, or asked for Google's list, it signs out first, and the sign-in screen goes to Google; back from Google, whoever was picked there goes over. It asks the server for a one-time ticket, opens `<scheme>://sign-in?ticket=…&nonce=…`, and closes the tab once the server says the app has signed in. After a trip to Google the browser will not close the tab, so the app says the window is signed in.
3. The shell, given that link, dispatches `DESKTOP_SIGN_IN_EVENT` with `{ ticket, nonce }` when the page has set `DESKTOP_SIGN_IN_LISTENING`, else loads the app's address with `TICKET_PARAM` and `NONCE_PARAM` in its fragment, which the browser never sends, so the ticket is in no server's log. It JSON-encodes both values into its script and checks their characters, since any app on the Mac can open the link. Each app holds its shell to these names with a test that reads its Rust.
4. The page calls `listenForDesktopSignIn()` from its first script, and `useDesktopSignInWindow(session)` signs in with the link through the adapter's `ticket`, only when the nonce is the one the window asked with. The nonce is used up once the ticket works, so a fresh ticket after an expired one still signs in; links that come while one is being taken, or while signed in, are dropped. An iPhone app runs the browser page in Apple's sign-in sheet instead, which returns the link to the page (iPhone sign-in, below).

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

### iPhone sign-in

`app-kit/tauri/iphone-sign-in` for the page, and a Tauri plugin for the shell, in `tauri/iphone-sign-in/plugin/`: Google refuses to sign in inside the app's web view, so an iPhone build runs desktop sign-in's browser page in Apple's sign-in sheet (`ASWebAuthenticationSession`) instead of the default browser. The sheet slides over the app, shares Safari's Google sign-in, and closes when that page opens the app's sign-in link, which it hands back to the page instead of to iOS: no switch to Safari, no "open this app?" question, and no page load. The server's routes and the browser page are desktop sign-in's, above. The plugin is the kit's copy of tauri-plugin-web-auth 1.0.0 (MIT), changed so the sheet shows: the original keeps no hold on the sheet and looks for a window the way scene-based apps have none, so iOS shows it in a window nobody sees. argon-watcher is the first app.

The plugin keeps the original's names where the page and the shell see them, the plugin `web-auth` and its command `authenticate`, since the page comes from the app's server and the plugin from the installed build: a renamed plugin would leave every phone not reinstalled at that deploy unable to sign in with Google.

In `src-tauri/Cargo.toml`, after `bun install`, with the path from `src-tauri` to the `node_modules` that holds the kit:

```toml
[target.'cfg(target_os = "ios")'.dependencies]
tauri-plugin-web-auth = { path = "../node_modules/app-kit/tauri/iphone-sign-in/plugin" }
```

In the shell, with the permission granted to the page:

```rust
#[cfg(target_os = "ios")]
let builder = builder.plugin(tauri_plugin_web_auth::init());
// ...
let page = CapabilityBuilder::new("page").remote(format!("{origin}/*")).window(MAIN)
    .permission("web-auth:default");
```

The page, where its Continue with Google would open the browser page on the Mac; `scheme` is the app's own link scheme, the one desktop sign-in's link opens:

```ts
import { desktopSignInAddress } from 'app-kit/tauri/sign-in';
import { signInInSheet } from 'app-kit/tauri/iphone-sign-in';

const handedOver = await signInInSheet(desktopSignInAddress(account), { scheme: 'com.example.app' });
if (!handedOver) setBusy(false);
```

It hands the link to `useDesktopSignInWindow`, which signs in only when the nonce is the window's, and answers whether it handed one over: false when the sheet was cancelled or failed, or closed on any link that is not the app's sign-in. iOS asks the person once whether the app may use the site to sign in. One sheet is open at a time; a second call while one is up is refused. Every step logs a line starting `[iphone-sign-in]`, in the page's console and in the phone's log, and a sheet that opened logs `[iphone-sign-in] sheet started for <host>`.

### A silent iPhone Simulator

`app-kit iphone-simulator quiet <udid>`: a simulator booted with `xcrun simctl boot`, with no window, plays its notification tones and keyboard clicks on the Mac's speakers, and Apple gives no command to mute it; silent mode still plays the notification tone at full volume. The step sends the simulator's sound to BlackHole, a free virtual audio device that plays nowhere, the same setting as Xcode's Sound Output menu. The simulator reads that setting only at boot, so when a booted simulator's sound goes anywhere else the step shuts it down, saves BlackHole in its audio settings file and boots it again, once; a later run finds it silent and touches nothing. On a simulator that is shut down, the step only saves the setting, so its next boot already plays nowhere, with no boot of its own.

An app's simulator script runs it after the boot and before the install:

```sh
xcrun simctl bootstatus "$udid" -b >/dev/null
bun run app-kit iphone-simulator quiet "$udid"
xcrun simctl install "$udid" "$app"
```

A script that erases its simulator on every run runs it between the erase and the boot instead, since `simctl erase` deletes the saved setting and running the step after the boot would cost a second boot each time:

```sh
xcrun simctl erase "$udid"
bun run app-kit iphone-simulator quiet "$udid"
xcrun simctl boot "$udid"
xcrun simctl bootstatus "$udid" -b >/dev/null
```

It prints one line starting `[iphone-simulator]` and exits 0 whatever it finds, so a Mac without BlackHole still runs the app, with a line saying how to install it (`brew install --cask blackhole-2ch`, then `sudo killall coreaudiod` so macOS's audio service sees it). It exits 1 only when the simulator did not boot again after its own restart, since the device is then down. When the setting is saved but the simulator still plays elsewhere, it says so and does not restart again.

### TestFlight

`app-kit testflight upload` and `app-kit testflight watch`: an iPhone build reaches TestFlight after each landing that changes the iPhone app, with nobody running anything. The upload builds the commit checked out, checks the build, uploads it and waits until App Store Connect has processed it. The watcher, run by a background job on a Mac every five minutes, notices when an app's main has moved and runs the app's own upload in a clone of its own.

The upload, from the app's checkout:

```sh
bun run app-kit testflight upload
```

It uploads only a commit on `origin/main`'s first-parent line, from a clean tree, since the build number is the commit count (`git rev-list --count HEAD`) and a branch's number above main's would make Apple refuse every lower one. It puts Rust's own folder first on `PATH`, builds with `bunx tauri ios build --ci --export-method app-store-connect` and the build number as `bundleVersion`, with Apple's `rsync` ahead of Homebrew's, and puts back only the values Tauri wrote into `src-tauri/gen/apple/ExportOptions.plist` and `src-tauri/gen/apple/<app>_iOS/Info.plist`. It refuses an `.ipa` whose `CFBundleVersion` is not the build number or whose `Info.plist` does not say `ITSAppUsesNonExemptEncryption` false, and, with push, one not signed for production. It reads the App Store Connect key from 1Password once, writes it to a temporary folder for altool that is removed however the upload ends, and polls App Store Connect for up to 30 minutes until the build is processed, then prints its TestFlight state. A number App Store Connect already holds counts as uploaded. Stopped by a signal, as the watcher's time limit stops it, it stops the programs it started, removes the key's folder and puts the plists back. Every line starts `[testflight]`; it exits 3 when the app did not compile and 1 for any other failure. The comment at the top of `tauri/testflight/upload.ts` says what each step works around.

The watcher, one pass, for each app's git address:

```sh
bun bin/app-kit.ts testflight watch https://github.com/worktron/argon-watcher.git https://github.com/worktron/timescale.git
```

A background job runs it from a copy of the kit at a release tag, with SSH addresses; fetches never prompt. For each app it fetches main into its own clone under `$XDG_STATE_HOME/app-kit/testflight/<app>/` (`~/.local/state/app-kit/testflight/<app>/` by default), and when main's head is the one it judged last it does nothing and writes nothing. Otherwise it checks out main's commit, removes everything not committed but `node_modules` and `src-tauri/target`, runs `bun install --frozen-lockfile`, reads the key, and asks App Store Connect for the app's builds. Its newest build, by number, decides: the changes from that build's commit to main's head are judged together, so two landings between passes count as one, and an app change followed by a documentation-only landing still uploads. Which files count follows from the app's Tauri setup: when `frontendDist` in `src-tauri/tauri.conf.json` is an address, the iPhone app is only `src-tauri/`, `package.json` and `bun.lock`, since the website reaches phones when it deploys; otherwise it is every file but `*.md`, `.claude/`, `docs/`, `*.test.*`, `test/`, `tests/` and `e2e/`. An upload runs the app's own `bun run app-kit testflight upload --token-only` at background priority, keeping the Mac awake while it runs, so each app's pinned kit decides how it is built. Each step has a time limit: the fetch 2 minutes, the install 10, the build 60, the upload and processing 45. A build that did not compile is held until main moves; any other failure, a failed link included, is tried again after an hour. A pass in which a step failed for any app exits 1. A watcher stopped mid-pass, as launchd stops its job, stops the upload it started.

Every decision is one line in `~/.local/state/app-kit/testflight/testflight.log`, with its reason:

```
2026-10-25T14:00:03.000Z urge-surfer: uploading build 130 (1a2b3c4): app files changed since build 128 (src/coast.tsx)
2026-10-25T14:09:41.000Z urge-surfer: uploaded build 130 (1a2b3c4), processed
2026-10-25T15:20:02.000Z urge-surfer: skipped: no app files changed since build 130
2026-10-25T15:20:04.000Z argon-watcher: waiting: main's app-kit has no testflight upload
```

Each build's output is in `<app>/build-<n>.log`, with the try before it in `build-<n>.log.1`, for the ten newest builds, and `<app>/record.json` holds the main commit judged last and the last failure. An app whose newest TestFlight build names no commit on main, such as one uploaded from a branch, gets one upload to settle it; one whose newest build is above main's count is skipped until main passes it.

Once per Apple team, by its Account Holder:

1. Xcode signed in to the Account Holder's Apple account (Xcode, Settings, Accounts). Signing goes through it, and Apple makes the distribution certificate and profile in its cloud; the API key only uploads, since an App Manager key may not use that cloud certificate.
2. An App Store Connect API team key: App Store Connect, Users and Access, Integrations, App Store Connect API, Team Keys, role App Manager. The `.p8` file downloads once. Keep it in 1Password as the item "App Store Connect API" with the fields "key id", "issuer id" and "private key" (the file's text). One key serves every app on the team.
3. Rust's release tools: `rustup component add llvm-tools` and `rustup target add aarch64-apple-ios`. Without llvm-tools, Xcode 27's release build hides the Swift entry points of Tauri and its plugins and the link fails; a release build made before installing it needs `src-tauri/target/aarch64-apple-ios/release` removed.

Once per app:

1. The app record: App Store Connect, Apps, +, New App. The API cannot make one, and altool fails with "Unable to find Apple ID for Bundle ID" until it exists.
2. `src-tauri/Info.ios.plist` saying `ITSAppUsesNonExemptEncryption` false, or App Store Connect asks the export question of every build; and `CFBundleIconName` `AppIcon` when `Info.plist` names a Mac icon.
3. A TestFlight tester group with access to every build, or a processed build reaches nobody. The API can make one with the same key (`POST /v1/betaGroups` with `isInternalGroup` and `hasAccessToAllBuilds` true) and add testers (`POST /v1/betaTesters`); `POST /v1/betaTesterInvitations` sends the invitation. An invitation that never arrives may be a mail filter on `email.apple.com`.

The watcher reads the key without Touch ID through a 1Password service account that may read only the key's vault, whose token is kept in the Mac's login keychain. Once, by the 1Password account's owner:

1. In 1Password on the web: Developer, Service Accounts.
2. Create a vault named "TestFlight", and move the item "App Store Connect API" into it.
3. Create a service account named "TestFlight upload" with read access to the vault "TestFlight" only, and copy its token.
4. In Terminal on the Mac that runs the watcher, paste the token at this command's prompt:

   ```sh
   security add-generic-password -a "$USER" -s "app-kit testflight" -w
   ```

The token is handed only to the `op` call, never to the build's programs. Until it is in the keychain, the watcher logs "waiting for the 1Password token" each hour and uploads nothing; an upload run by hand without it uses the signed-in `op`, which asks for Touch ID. The first build from the background job may show macOS's "codesign wants to access key" dialog; choose Always Allow, or the build stops at its time limit and the log says so.

## authentication/: who is calling

A person signed in through a sign-in provider, or an agent with a person's key. Nothing outside `authentication/clerk/` imports Clerk, which `test/clerk-imports.test.ts` holds, so every other part works with another provider.

| Piece | Import | What it does |
| --- | --- | --- |
| Clerk | `app-kit/authentication/clerk` | `clerkSignIn({ publishableKey })`, the first adapter for the web kit's sign-in gate. |
| Clerk for the server | `app-kit/authentication/clerk/server` | `clerkCaller`, which reads a request's caller from Clerk for `requireCaller`, and `clerkVerifiedEmails`, which reads a user's verified addresses from Clerk for `ownerCheckByEmail`. |
| Stand-in | `app-kit/authentication/stand-in` | `standInSignIn()`, a provider with no network for tests of the kit and of apps built on it. |
| Playwright steps | `app-kit/authentication/stand-in/playwright` | `showPage`, `hidePage` and `serveNewerBuild`, for an app's browser tests. See Browser tests above. |
| WebKit out of the Dock | `app-kit/web/playwright-webkit` | `webkitWithoutDockIcon`, the launch options that run Playwright's WebKit from a copy macOS keeps out of the Dock. See Browser tests above. |
| Keys for agents | `app-kit/authentication/agent-keys` | `requireCaller` and `callerOf`: a person's key reads the GET routes the app lists. |
| API reference | `app-kit/authentication/agent-keys/openapi` | The OpenAPI descriptions and reference page that show a key those routes. |
| Owner only | `app-kit/authentication/owner` | `requireOwner` and `ownerCheckByEmail`: a server that serves one person lets only them in. |

### The adapter

A provider is `{ Root, useSession, GoogleReturn }` (`web/sign-in/provider.ts`): its own context around the app; a hook giving whether it has loaded, who is signed in, a token (fresh on demand), Google sign-in to a callback path naming an account or asking for the list, an emailed code sent and checked, a sign-in with a one-time ticket from the app's server, and sign-out that stays on the page; and a component that finishes the return from Google. Another provider is another adapter, and the apps change only which one they pass to the gate.

Clerk-specific, by design: the Clerk adapter starts Google through Clerk's classic sign-in resource, since its newer one takes no account to sign in as. A part of an app that needs more of Clerk than the adapter asks for uses Clerk's own hooks inside the gate, whose provider is Clerk's. An app with its own `ClerkProvider` and no gate reads the adapter's session with `clerkSignIn({ publishableKey }).useSession()` inside it.

The Clerk instance needs Google on for sign-in and emailed codes as an email sign-in strategy, since the adapter signs in with both. In the settings Clerk's command line tool reads and writes (`clerk config patch`), that is `connection_oauth_google` with `enabled` and `authenticatable` true, and `auth_email` with `used_for_sign_in` true and `email_code` among its `sign_in_strategies`. A production instance copies them from development when it is created as a clone, and Google there also needs the app's own Google OAuth client.

### Owner only

`app-kit/authentication/owner`: a server that serves one person, its owner, lets only them in. The owner is whoever signed in with the owner's email address, verified; an address the sign-in provider has not verified never counts.

```ts
import { Hono } from 'hono';
import { clerkMiddleware, getAuth } from '@clerk/hono';
import { every } from 'hono/combine';
import { clerkVerifiedEmails } from 'app-kit/authentication/clerk/server';
import { ownerCheckByEmail, requireOwner, type OwnerEnv } from 'app-kit/authentication/owner';

const isOwner = ownerCheckByEmail(process.env.OWNER_EMAIL!, clerkVerifiedEmails({ secretKey: process.env.CLERK_SECRET_KEY }));
const app = new Hono<OwnerEnv>();
app.use('/api/*', every(clerkMiddleware(), requireOwner({ identify: (c) => getAuth(c).userId ?? null, isOwner, appName: 'Argon' })));
app.get('/api/items', (c) => listItems(c.get('userId')));
```

- **The answers.** Nobody signed in gets 401 `{"error":"Sign in first"}`; someone signed in who is not the owner gets 403 `{"error":"This account is not allowed to use <appName>"}`, and a log line naming the route and the user id. The owner goes on, with their user id as `userId` on the context.
- **Asked once per user.** `ownerCheckByEmail` keeps each user's answer, yes or no, for the life of the process, and requests that arrive together share one lookup, so the provider is asked once per user, not per request. A lookup that fails, such as the provider unreachable, is not kept. So a change to a user's addresses takes a restart of the server: a user whose owner address is taken off stays let in, and an owner refused before verifying the address stays refused, until then.
- **Another provider** passes its own `identify` and its own reader of a user's verified addresses; nothing in `app-kit/authentication/owner` imports Clerk.

Needs `hono` 4.12 or later; with Clerk, `@clerk/hono` 0.1.93 or later and `@clerk/backend` 3 or later.

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

## server/: for an app's server

### What a refusal from Google means

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

### The Postgres database

`app-kit/server/postgres`, for an app's server on Drizzle: one way to open its database, Railway's Postgres in production and PGlite, Postgres compiled to WebAssembly and run in the process, everywhere else. Each call takes the app's own schema and the folder drizzle-kit generates its migrations into, and brings the database up to date with Drizzle's migrator before it returns.

```ts
import { openDb } from 'app-kit/server/postgres';
import { join } from 'node:path';
import * as schema from './schema';

// On Railway the URL is required: without it the server would run on a folder in its container, which the next
// deploy throws away. Elsewhere a folder keeps the laptop's data.
const location = process.env.DATABASE_URL ?? (process.env.RAILWAY_ENVIRONMENT_NAME ? undefined : '.data/db');
if (!location) throw new Error('DATABASE_URL is not set: give this service a reference to the Postgres service');

export const db = await openDb(location, {
  schema,
  migrationsFolder: join(import.meta.dir, '../drizzle'),
});
```

| `openDb(location, ...)` with | Opens |
| --- | --- |
| A `postgres://` or `postgresql://` URL, such as Railway's `DATABASE_URL` | A Postgres server, through postgres-js |
| A folder | PGlite kept on disk in that folder, for local use |
| `:memory:` | PGlite in memory, gone when it closes |

Each open logs one line naming what it opened, `database: opened Postgres at <host>/<database>, migrated` or `database: opened PGlite in <folder>, migrated`, never the password, so a deploy log shows which database the server is on. Every database it gives has `close()`, which ends the connection or shuts PGlite down; an open whose migration fails closes it before it throws. Migrations are only ever drizzle-kit's: `bunx drizzle-kit generate` writes them from the schema, and the next open runs them, on Railway as on the laptop. Drizzle applies the pending ones in one transaction and takes no lock, so two instances opening the same database at once can both try a pending migration: one applies it, the other fails to start with nothing half done, and its restart finds the migration applied. An app run as one Railway instance never meets this.

In tests, `openTestDb({ schema, migrationsFolder })` gives an empty, migrated in-memory database, one per call. Migrating takes most of a second, so the first call in a test process migrates one database and keeps its files, and every later call for the same folder starts from a copy of them. Each one holds a few hundred megabytes, and `bun test` runs every file in one process, so a test file closes them all after each test:

```ts
import { afterEach, test } from 'bun:test';
import { closeTestDbs, openTestDb } from 'app-kit/server/postgres';

afterEach(closeTestDbs);

test('records a visit', async () => {
  const db = await openTestDb({ schema, migrationsFolder });
  // ...
});
```

Needs `drizzle-orm` 0.45, `@electric-sql/pglite` 0.5 and `postgres` 3.4, which the kit names as optional peers, so an app without a database installs none of them. An app that uses it installs all three as dependencies, not dev dependencies, whichever database it opens: the one module imports both drivers, so a server that opens only Railway's Postgres still loads PGlite at start, and one on PGlite still loads `postgres`.

## bin/, scripts/ and test/: develop

`bun test`, `bun run typecheck`, `bun run lint`, `bun run test:e2e` for the web fixture in a hidden Chromium and the kit's WebKit kept out of the Dock, and `bun test ./extension/e2e/harness.e2e.ts` for the extension fixture through the harness (`bunx playwright install chromium webkit` first). `scripts/gates.sh` runs all five, then builds the Rust and Swift of the iPhone notifications and iPhone sign-in plugins for the iPhone simulator, with Rust from rustup and its `aarch64-apple-ios-sim` target, in one build folder all checkouts share. A change to `extension/worker/` is followed by `bun bin/app-kit.ts extension copy extension/test/fixture/kit`, which a test checks.

Releases are tags, `v<version>`, matching `package.json`'s version, on the commit main lands at, so a release is always a commit main holds. A tag never moves; a fix is a new tag. While the version is 0.x, a patch release needs no change in the apps and a minor one may, which its commit messages say.

A branch never sets the version. Its commits say what kind of change it is, with a line beside Co-Authored-By:

```
Release: minor
```

`minor`, `patch` or `none`; a branch that changes only plan files needs none. `scripts/land-main.sh` lands it: it rebases onto main, works out the next version from main's, commits it along with the install lines above, runs `scripts/gates.sh`, moves main and pushes the tag. If another branch lands while the gates run, it starts again with the next number, up to three times. It refuses a branch that edits the version itself or says no kind of change, and a run that stops before main moves leaves the branch as it was, with no version commit on it. One that moved main but could not push the tag says so, and the next landing pushes that tag first.

The repository is public. Main moves forward with a push that is never forced, which adds no commit, so every commit keeps Worktron as its author and committer. A pull request's merge buttons write a new committer, the merging account, for every commit, merge, squash and rebase alike. `test/public.test.ts` fails on any personal email, home folder or name in the files or the history.
