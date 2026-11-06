# app-kit

The baseline every app of ours ships with, written once instead of copied from the last app. One package with a folder for each kind of app, and a folder for each thing several kinds share. Practices' rules files say why each piece exists; this package is the code.

| Folder | Import names | What it holds |
| --- | --- | --- |
| `web/` | `app-kit/web`, `.../server`, `.../first-paint`, `.../playwright`, `.../playwright-webkit` | Web apps: the web client kit, the MUI theme for each look, its sign-in gate and the provider interface the gate takes, the server's sending of the built page, a Vite plugin for the first frame, and the steps browser tests share. |
| `extension/` | `app-kit/extension/...` | Browser extensions: the worker files Chrome loads, the Amazon requests never sent among them, the plain look's stylesheet for their pages, the native host, the test harness. |
| `tauri/` | `app-kit/tauri/sign-in`, `.../sign-in/server`, `app-kit/tauri/iphone-notifications`, `.../iphone-notifications/server`, `app-kit/tauri/iphone-sign-in`, `app-kit/tauri/window`, `app-kit/tauri/playwright` | Mac and iPhone apps built with Tauri: a window onto the hosted site, with the plugin the shell builds and the Mac menu bar; desktop sign-in through the browser, with its server routes; iPhone notifications through Apple's push service, with the plugin the shell builds and the server's sending; iPhone sign-in in Apple's sign-in sheet, with its plugin; the `app-kit iphone run` command, which builds the app and starts it on a Simulator or a paired iPhone, with at most two Simulators on the Mac at once, each shut down 10 minutes after its app starts; the `app-kit iphone-simulator quiet` command, which keeps a simulator silent; the `app-kit testflight` commands, which upload an iPhone build after each landing; the `app-kit mac` commands, which publish a Mac release every installed copy updates itself to; the bridge faked for browser tests. |
| `swift/` | the Swift files of `swift/menu-bar` and `swift/mac-app`, built by the app | Mac apps built in Swift: the menu bar theme, with its panel, pieces, tokens and bundled font, and a window's pieces and controls in the plain look; and the Mac app package: the log, launch at login, the Dock icon while a window is open, the native messaging host, the build for About, the refresh after wake and a program run with a time limit. |
| `command-line/` | `app-kit/command-line` | Command-line tools: the `--version` line with the commit it runs from, help and wrong usage with their exit codes, color on a terminal only, opening the browser with an off switch, the warning when installed from a worktree, a secret read from 1Password, and the runner for outside programs with a time limit. |
| `authentication/` | `app-kit/authentication/clerk`, `.../clerk/server`, `.../clerk/playwright`, `.../clerk/testing`, `.../stand-in`, `.../stand-in/playwright`, `.../agent-keys`, `.../agent-keys/openapi`, `.../agent-keys/testing`, `.../server-sign-in` | Who is calling: Clerk's adapter, with its test steps and a stand-in for its server API, the test stand-in, keys for agents with their API reference and a check of every route, and whether a server requires sign-in. |
| `server/` | `app-kit/server/start`, `app-kit/server/every`, `app-kit/server/process-usage`, `app-kit/server/google`, `app-kit/server/postgres`, `app-kit/amazon-orders`, `app-kit/amazon-cart` | Server-only pieces no kind of app owns: the server's start and its clean stop, a job on a clock, one reading of what a Mac process has used, what a refusal from Google means, the Postgres database opener on Drizzle, and reading Amazon's order, cart and product pages, the last into the request that adds to a cart. |
| `icons/` | the `app-kit icons render` command | Every icon an app ships, drawn from the drawings it commits: Mac and iPhone icon sets, a Tauri app's icons, the menu bar image, the extension's icons and the web's. |
| `look/` | `app-kit/look` | The two looks' colors and sizes, the only owner of them: the plain look, the system typeface on warm paper with the app's accent, and the console look. Every web theme, extension stylesheet and Swift view takes its values from here. |
| `bin/`, `scripts/`, `test/` | the `app-kit` command | The command, the gates and the landing, and every unit test. |

A piece with a browser half keeps its server half beside it (`tauri/sign-in/server.ts`); a piece that is server only goes in `server/`. No vendor names a top folder.

## Taking it in

An app installs the kit at a release tag, straight from GitHub, which needs no credentials since the repository is public:

```sh
bun add github:worktron/app-kit#v0.41.0
```

`bun.lock` then holds the exact commit and a hash of its download, so a build from the lockfile, such as Railway's `bun install --frozen-lockfile`, installs that commit and nothing newer. The kit ships TypeScript sources, which Vite and Bun compile with the app, except the Playwright steps, which are plain JavaScript; the web part needs React 19 and MUI 9, and `@clerk/react` 6 for the Clerk adapter. A server installs the kit as an app's client does: the package names React and MUI as peers for its web part, and the server pieces import neither. To upgrade, run the same `bun add` at the new tag and commit `package.json` and `bun.lock`; each app upgrades when it chooses.

## web/: the web client kit

`app-kit/web`: React and MUI, with sign-in behind an adapter so the provider can change without the apps changing. `rules/web-apps.md` is its list.

| Piece | Import | What it does |
| --- | --- | --- |
| Fetch wrapper | `request` | Sends the session's token, reads the status before the body, and returns the parsed JSON. A 401 is asked once more with a fresh token; refused again, sign-in comes up over the current address, once, never in a loop. A request marked `keepalive`, as one sent while the page is being left, starts at once. See below. |
| Server-unreachable line | `ConnectionLine`, `useServerReachable`, `onReconnect` | No answer, or a proxy's 502, 503 or 504, shows a line until the server answers again. While down it looks every five seconds and when the browser comes back online or the page back in front. So the app's own server never answers 502, 503 or 504 for a failure past it, such as a call to Google that failed: that is a 500, or the line says the app cannot be reached and every screen loads again. |
| New-deploy line | `NewBuildLine`, `useNewBuild`, `lookForNewBuild` | An open page looks for a newer build when it comes back in front, at most once a minute, or at once on a pull to refresh, and shows a quiet line: in a browser tab "Argon has changed since this page loaded." with Reload, and in an app (the iPhone app, a web app opened from the home screen, the Mac window) "Argon has an update." with Update, which reloads the page too, since people in an app do not think of a page. An app on the Mac window draws `UpdateLine` instead (below). It reloads by itself only once hidden, or after ten idle minutes, with nothing entered, unless the app passes `reloadsItself: false` to `useNewBuild`, or `reloadsItself={false}` to `NewBuildLine`, because its view holds something only in memory. |
| One update line | `UpdateLine`, `useUpdate`, `updateMessage`, `takeUpdate`, from `app-kit/tauri/window` | The one line about updates for an app on the Mac window, in place of `NewBuildLine`: "Argon has an update." with Update for a newer deploy of the site, a release found in the app's releases, a newer build installed over the running app, or any of them at once, Update doing what that needs: a deploy alone reloads the page, a release opens `updateLink(scheme)`, which installs it and restarts the app into it, and a newer build installed opens `restartLink(scheme)`, either restart loading the newest page too. While a release installs, "Updating Argon. It restarts once the new version is in place."; if it failed, "Argon could not update." with Try again. In a browser tab it is `NewBuildLine`'s Reload line. Nothing installs or restarts by itself; a deploy alone reloads by itself as `useNewBuild` says, unless `reloadsItself={false}`. A page puts `<UpdateLine appName="Argon" scheme="com.example.argon" />` under its bar everywhere. An app that draws its own lines takes which update with `useUpdate`, its words from `updateMessage(appName, update, inApp)` and its button's act from `takeUpdate(update, scheme)`. See [A window onto the hosted site](#a-window-onto-the-hosted-site). |
| Reload after a failed screen load | `reloadOnFailedLoad` | A tab open across a deploy asks for screen code that is gone; Vite's `vite:preloadError` reloads the page once, with a guard so it never loops. |
| Error boundary | `ErrorBoundary` | A crash shows what failed and a Reload button, or the app's own `fallback`. A built page first asks the server which build it serves, and when that is a newer one, as after a deploy or a rollback that changed what an answer holds, it reloads by itself onto it, once. Give it the app's `placeholder`, which it draws while it asks. See below. |
| Saved copies of screens | `savedCopies`, `useScreenData`, `useSavedCopy`, `useSaveAfterDraw` | A screen seen before paints at once from the copy this browser saved, then from the server. Copies are kept per build and per person, deleted at sign-out, and saved only after they have drawn, so a deploy that changes an answer's shape, or is rolled back, never leaves a copy that crashes every load. See below. |
| Page titles | `nameApp`, `useTitle`, `titleFor` | The app names itself once at start (`nameApp('argon-watcher')`), and each screen calls `useTitle('Inbox')`, which writes "Inbox · argon-watcher" while the screen shows and puts back the title it found when it goes; `useTitle(null)` shows the app's name alone. One call per screen: a layout that calls it too runs after the screen and wins. |
| How long ago | `age`, `useNow`; `age` also from `app-kit/web/age`, with no React | `age(when, now)` writes how long ago something happened in the words every app and the menu bar theme use: "just now" under a minute, "5m ago" under an hour, "3h ago" on the same day, "yesterday" on the day before, "4d ago" under a week, then the date, "Oct 9", with the year when it is another. Days are the reader's calendar days in their time zone, so eleven at night read at one in the morning two days on is "2d ago"; `{ timeZone, locale }` names another reader, as a server writing for one does. A time up to a minute ahead, as a clock a little ahead gives, is "just now", and further ahead the date. The words are the kit's own rather than `Intl.RelativeTimeFormat`'s, which change with the browser and the locale. `useNow()` is the time now for a screen that shows ages: read again once a minute while the page is in view and at once when it comes back, and not at all while it is hidden. |
| Hover intent | `HoverIntent`, `useHoverIntent`, `screenPointOf`, `TRAVEL_PX`, `HOLD_PX`, `LIST_WAIT_MS`, `FOCUS_WAIT_MS` | When the pointer may act without a click, one rule for every surface. A pointer that has not moved does nothing: its first report after a key or the window losing the keyboard only marks where it rests. Once it has travelled 16 pixels from there, `onOver` hears the row under it at once and on every change, so a row lights as the pointer enters it and goes dark as it leaves, and in a menu, where the lit row is the keyboard's selection, that row is the selection; a list scrolled under a still pointer moves what is lit. What it opens or focuses, and selecting a row that opens something, waits for `onHold`, once it holds within 6 pixels for 100ms in a list or 250ms for focus. `useHoverIntent` restarts it on a key anywhere in the window and on the window losing the keyboard, and `onKeyboardLeft` adds the app's own word for that, as a desktop app told by macOS has. The menu bar theme's `PointerIntent` is the same rule in Swift. |
| Not-found page | `NotFound` | What an address the app does not know draws, at that address: "Nothing is at" the address, and a link home (`home`, `/` unless given), with the page title "Not found". Never a redirect home, which makes a stale link look as if it worked. It tells the sign-in gate it has drawn, so it shows under `waitForFirstDraw`. |
| Links for rows and cards | `RowLink`, `NavigateProvider` | A whole row as a real `<a href>`: ⌘-click and middle-click open a new tab, a plain click moves through the app's navigate. |
| Text size | `followTextSize`, `useTextScale`, `chooseTextSize`, `useTextSize`, `TEXT_SIZES`, `TextSizeSetting` | On an iPhone or iPad, the page's root font size follows the Text Size chosen in Settings or Control Center, which a web view otherwise ignores, so every size in rem follows, at once. A size from 85% to 200% chosen on this device replaces it, everywhere, and `TextSizeSetting` is the settings row that chooses it. With no size chosen, anywhere but a phone the scale is 1. See below. |
| Fields that never zoom | `fieldsNeverZoom`, `FIELD_FONT_SIZE`, `rem` | A text field's size is 16 pixels or the Text Size's size, whichever is larger, so iPhone Safari never zooms into it at a small Text Size and it still grows at a large one. `rem(px)` writes a pixel size as one that follows Text Size. See below. |
| Pull to refresh | `PullToRefresh`, `isInstalledApp`, `isIphoneApp` | In an installed app, the iPhone app or a web app opened from the home screen, a pull down from the top of the page reloads it, or runs the app's own refresh and looks for a newer deploy. Never over typed text, and never from a field, a menu, a dialog, a scrolled list or a sideways swipe. See below. |
| The first frame | `firstPaint`, from `app-kit/web/first-paint` | A Vite plugin that paints the page in the app's colors, light or dark or the app's own choice, with the phone's bar to match, before any of the app's code loads. See below. |
| The first draw after the fonts | `waitForFonts` | Holds the first draw until the app's faces are in, at most a second and a half, so no text swaps from a fallback face. See below. |
| Sign-in gate | `SignInGate`, `useSignIn`, `useSignOut`, `usePerson`, `useAppDrawn` | One steady placeholder until the provider knows who is signed in and, with `waitForFirstDraw`, until the app has drawn its first data. The app's sign-in screen at whatever address was asked for, so sign-in lands there. Sign-in and sign-out with no page load beyond the provider's own trip to Google. Continue as the account last used on this device, or Use a different account, which asks Google for its list. The person's own Sign out forgets the account, so the next sign-in screen offers Google plainly; a session the server ends keeps it, so signing back in is one tap. With `signUp`, an emailed code to an address with no account makes the account once the code is checked; without, the address is told it has none (`noAccountFor`). Given a null provider, it draws the app with no sign-in. |
| Account menu | `AccountMenu` | A quiet button at the right end of the app's bar, the word Account or the person's initial in a circle, with a menu that says who is signed in (the name above the address when the provider knows it), the app's own items (a screen as a real link, or an act) and Sign out. It draws nothing outside the sign-in gate or with no provider. Optional: an app that wants Sign out elsewhere uses `useSignOut` and `usePerson`. See below. |
| Provider interface | `SignInProvider`, `ProviderSession`, `Outcome` | What the gate takes from a sign-in provider. The adapters are in `authentication/`, below. |
| The built page, from the server | `serveBuiltPage`, from `app-kit/web/server` | The app's server sends the folder Vite built: the index page for every address the app draws, asked for again on each load, the files Vite built kept for a year, a 404 for a missing file and a JSON 404 under `/api/`, never the page. See below. |

### An app built on it

```tsx
import { ErrorBoundary, SignInGate, reloadOnFailedLoad, configureConnection, followTextSize, nameApp } from 'app-kit/web';
import { signInFromEnvironment } from 'app-kit/authentication/clerk';

reloadOnFailedLoad();
nameApp('argon-watcher');
configureConnection({ probePath: '/api/health' });
followTextSize();
const provider = signInFromEnvironment(import.meta.env);

createRoot(root).render(
  <ErrorBoundary placeholder={<Wordmark />}>
    <SignInGate provider={provider} placeholder={<Wordmark />} signedOut={<SignInScreen />} waitForFirstDraw>
      <App />
    </SignInGate>
  </ErrorBoundary>,
);
```

`signInFromEnvironment` picks who signs in from the build's settings: the stand-in under `VITE_SIGN_IN=stand-in`, for browser tests; Clerk with `VITE_CLERK_PUBLISHABLE_KEY`; and nobody with neither, for a server that runs open on this machine (see Sign-in when hosted, below), where the gate draws the app straight away. A hosted build that lost its key is not left open by this: its server refuses to start without its own keys. Pass `clerkSignIn({ publishableKey })` instead to pick Clerk outright.

The app draws its own sign-in screen with `useSignIn()`: `lastAccount` for Continue as that account (null after the person signs out), `google('remembered')`, `google('choose')` and `google({ account })` for an account chosen in another window, `sendEmailCode` and `checkEmailCode`, and `notice` for what to say above the buttons. Its server answers `/sso-callback` (or the gate's `callbackPath`) with the app, since Google returns there. With `waitForFirstDraw`, the app is rendered from the start, so its requests go out, but none of it shows until it calls `useAppDrawn()`'s function, so the whole screen appears at once. Every screen calls it once its first data is in or has failed to come, and a screen with nothing to load calls it at once: a screen that never calls it stays hidden. Every request goes through `request`.

`web/e2e/fixture` is a whole one, which the kit's own browser test runs.

Sign out goes in the account menu rather than on a screen of its own:

```tsx
<header>
  <Wordmark />
  <AccountMenu button="initial" items={[{ label: 'Settings', href: '/settings' }, { label: 'Switch profile', onSelect: switchProfile }]} />
</header>
```

What an app can choose:

- `items`: its own entries, between who is signed in and Sign out, in the order given. `{ label, href }` is one of its screens, a real link through the app's `NavigateProvider`, as `RowLink` is, so ⌘-click opens it in a new tab; `{ label, onSelect }` is an act, such as switching profile or showing diagnostics. With none, the menu holds who is signed in and Sign out.
- `button`: `'word'` (the default) draws Account; `'initial'` draws the first letter of the person's name, or of the address with no name, in a hairline circle. Either way the button's name for a screen reader is Account.
- `showName`: the person's name goes above the address when the provider knows it (Clerk's full name; `usePerson().name`). `showName={false}` leaves it out.

Sign out is last, under a line, in the menu's plain text color. In a Tauri window, Sign Out is in the Mac menu bar too (`useWindowMenu`, below), and the account menu still says who is signed in.

### A page open across a deploy

A tab left open on one build can be handed data in a shape only the next build knows: the server was deployed, or rolled back, while the page stayed. Drawing it crashes, and the kit mends that by itself. When a screen crashes on a built page, the error boundary asks the server for its index page, past every cache, and reads which built entry it names. When that is another build than the one running, the page reloads onto it, and the crash screen never shows. The same build means a real crash, which shows. While it asks, at most three seconds, it draws the `placeholder` it was given, the same one the sign-in gate has, so the person sees one steady screen through the crash, the reload and the sign-in gate; given none, it draws the crash while it asks. The page never reloads again toward the build it last reloaded toward in that tab, nor within 30 seconds of its last reload, so a crash the newer build has too, a reload that a cache answers with the old page, or two builds answering in turn mid-rollout ends on the crash screen rather than in a loop. With storage blocked the reload could not be remembered, so none is made. A boundary around one part of a page does not reload over text typed outside it. The console says what was decided and why, in lines starting `[app-kit] crash`.

The boundary sees only a crash while drawing. A screen keeps the server's answer as it came and reads it while drawing, so a shape it does not know crashes the draw, where the page can recover; reshaping the answer in the request's `.then` throws where nothing catches it, and the screen stays empty until a reload by hand.

The app's server sends the index page so that a browser never keeps it: `Cache-Control: no-cache` on `/` and on every address it answers with `index.html`, which makes the browser ask again on each load. Without the header a browser may reuse the page by its own guess, from its `Last-Modified` date, and a reload lands on the old build. The files Vite builds are named after what they hold, so they are sent with `Cache-Control: public, max-age=31536000, immutable`, and a deploy never changes one under an old name. A file the app put in `public/` keeps its own name, so it is asked for again like the page, whatever its name looks like. `serveBuiltPage` from `app-kit/web/server` tells them apart by the record of what Vite built, which the app's Vite config turns on with `build: { manifest: true }`; without it every file is asked for again, and the server's console says so once. It is mounted after the app's own routes:

```ts
// vite.config.ts
export default defineConfig({ build: { manifest: true } });

// the server
import { serveBuiltPage } from 'app-kit/web/server';

const page = serveBuiltPage('dist');
app.get('*', (c) => page(c.req.raw)); // Hono; a bare Bun.serve passes it as its fetch
```

A missing file, any address with a file's extension, is a 404 rather than the page, so an old build asking for screen code a deploy removed gets an answer `reloadOnFailedLoad` reads, never HTML it would try to run. An address under `/api/` that no route took is a JSON 404, `{ "error": "Not found" }`; an app whose API is elsewhere passes `{ api: '/v1/' }`. Only GET and HEAD are answered, and an escaped `..` never leaves the folder. It is a plain `(Request) => Promise<Response>` with no React, so the server imports it without the web part's peers. The kit's own browser tests serve their fixture through it.

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

These steps depend on how the kit works inside, so an app takes them from the kit rather than writing its own, from `app-kit/authentication/stand-in/playwright` beside the stand-in:

- `showPage(page)` brings the page back in front, as a phone does when the home-screen app returns. After `hidePage`, it makes the page visible again, since the kit looks only from a visible page.
- `hidePage(page)` hides the page, as when the person switches to another tab: `document.visibilityState` reads `hidden` and `document.hidden` reads true, for code that asks either way.
- `lockFor(page, ms)` is the phone locked for `ms` and unlocked: the page hides, its clock jumps that far past the page's own time with no timer fired, as a locked phone runs none, and it shows again. It needs `page.clock.install()` before the page loads, and throws without it. `performance.now()` and audio time do not move.
- `signInByCode(page, email, options)` signs in on the app's own screen by emailed code: it types the address in the textbox named Email and presses Enter, then `STAND_IN_CODE` in the one named Code and presses Enter. `emailField` and `codeField` take the app's own fields, `code` another code, and `submit: false` leaves out the last Enter, for a field that signs in at its last digit. Clerk's development instance takes the same code, 424242, for an address with +clerk_test in it, once the page has Clerk's testing token, and only a few times a minute.
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

#### Steps every app's tests wrote for themselves

`app-kit/web/playwright` holds the steps the apps each wrote, and the traps each one relearned:

- `countLoads(page)` returns `{ loads }`, the page loads from then on, for holding sign-in and sign-out to none.
- `watchFrames(context, { root })`, before the page loads, notes every frame's background and whether the app's root (`#root` by default) has any text; `takeFrames(page)` returns the frames since the last call, and `expectSteady(frames, background)` fails unless every one is drawn, all in that one background. A page load paints an empty page, and a page whose first frame is not in its own colors flashes.
- `finger(page)` is a finger, through Chrome's debugging protocol, since Playwright's own touch is taps alone; Chromium only. `slide(from, to, { holdMs, steps })` lands, holds (a quarter second or more is a long press), moves and lifts. Without a hold the landing and the first moves go together, since on a busy machine a round trip each would leave the finger still long enough to be a long press, and the finger settles before it lifts, since a lift at speed leaves Chromium a fling that takes the next tap as its stop. A tap within about a quarter second of a lift still makes no click in Chromium, so a test clicks there instead, as a finger is slower than a test. A page that takes swipes says so with `touch-action`, or Chromium pans it instead.
- `noNewWindows`, a fixture for `test.extend({ noNewWindows })` that runs for every test, fails any test that opens a new window. It refuses a `window.open` or a link that would open a new window, in the page, before the browser sees them, and lets one aimed at the page's own window (`_self`, `_parent`, `_top`) move it as usual: Playwright's WebKit on a Mac hands such a link to the Mac's own app, such as Maps, in front of the person's work. A window opened any other way fails the test too, after it opened.
- `largestTextSize(pageOrContext)`, before the page loads, is the phone's largest Text Size for an app that calls `followTextSize()`: the kit's reading answers 3.12, as an iPhone at its largest accessibility size does, so the root size, `--text-scale` and `useTextScale()` grow together. The page also reads the screen as taking touch.
- `expectFits(page)` fails when anything reaches past the screen's right edge, unless it is inside a box that scrolls sideways, or when the page is wider than the screen, naming each element and the start of its text. It measures against the viewport's width, since a phone's browser widens its layout to fit what overflows.

```ts
import { expect } from '@playwright/test';
import { expectFits, largestTextSize, noNewWindows } from 'app-kit/web/playwright';
import { testWithOfflineAudio } from 'app-kit/web/playwright-offline-audio';

export const test = testWithOfflineAudio({ startsOnTap: true }).extend<{ noNewWindows: void }>({ noNewWindows });

test('the home screen fits at the largest Text Size', async ({ page }) => {
  await largestTextSize(page);
  await page.goto('/');
  await expectFits(page);
});
```

Every init script in these steps reaches the page as its source, so it holds no class fields, which Playwright's compiler turns into helpers that exist only in the test's own file; an app's own init scripts take the same care.

#### A Tauri build's page

`app-kit/tauri/playwright` runs a page as the app's Tauri build, for the parts of the kit that run only there, with names copied from the kit's names files and held to them by a test:

- `fakeTauri(page, options)`, before the page loads, puts a stand-in for the shell's bridge (`window.__TAURI_INTERNALS__`) in the page, answering the kit's plugins as they answer: `iphoneNotifications: { granted, token, environment }`, `iphoneSignIn: { ticket, nonce }` with the nonce `asked`, `other` or `cancel`, `macApp: true` for the Mac app, whose `window.open` goes to the default browser and so only records the address here, and `answers` for an app's own plugins' commands. Any other command is refused with "no <command> here". The window's redeem of the code its sign-in link carries is answered with that code as the ticket, so a test hands over a ticket where the code goes; the app's own server tests hold the real route. The iPhone plugins need `test.use({ userAgent: IPHONE_USER_AGENT })`, since the kit's iPhone halves run only in an iPhone's app, and throw without it. `tauriCalls(page)` lists the commands the page sent.
- `tapNotification(page, address)` is a notification tapped with the app open; `launchedByTap(page, address)` one that launched the app, which the next load of the page takes.
- `windowAsksForSignIn(page, click)` presses the app's Continue with Google and returns the nonce the window asked the browser's sign-in page with. With `macApp` it reads the address the page asked the shell to open; otherwise the sign-in page's load is cancelled, in the page or a window it opened, so the page stays put. Cancelled, never answered with No Content: Playwright 1.64 reports a 204 for a page load in Chromium as finished, and the click then waits for a page that never comes (microsoft/playwright#43279, fixed for 1.65).
- `handOverSignIn(page, { ticket, nonce })` is the shell handing the browser's sign-in to a page that listens for it, after `fakeTauri`, with the ticket where the link's code goes; `loadWithSignIn(page, { ticket, nonce }, path)` is the shell loading a page still on its way with the sign-in in its fragment.

#### Against Clerk's development instance

`app-kit/authentication/clerk/playwright`, with `@clerk/testing` installed beside it, signs a browser test in to a real Clerk development instance:

- `throwawayUser({ secretKey, domain, prefix })` makes a user at `<prefix>-<10 hex>+clerk_test@<domain>`, with a random password for an instance that asks one, and returns its `email`, `userId`, `ticket()`, a one-time sign-in ticket made from its id, and `remove()`. A test's fixture removes it when the test ends, so the instance, capped at 100 users, holds only the users of tests still running.
- `signInWithTicket(page, ticket)` signs a page of the app in, once it has loaded Clerk, through Clerk's testing library, and waits until the page has a signed-in user. It logs every answer of 400 or more from Clerk with the page it came from, and when Clerk refuses for too many requests it waits as the refusal's Retry-After says and adds the wait to the test's time limit.
- `removeThrowawayUsers({ secretKey, domain, prefix, olderThanMs })` removes the users of that shape older than an hour, the ones a run stopped before its fixtures could, for a global setup or teardown. It never touches a user at any other address, such as a fixed `owner+clerk_test@example.com`, or one young enough to belong to another run still going.
- `withClerkBackoff(what, call, options)` runs a call to Clerk's Backend API and waits as long as a 429 asks, up to 20 seconds unless told more, as every step above does: the instance counts requests across every run on the machine.

Clerk's testing library needs `clerkSetup()` in the suite's global setup, which reads the instance's keys and sets the testing token the sign-in sends; without it the sign-in throws saying so:

```ts
// e2e/global-setup.ts, named as globalSetup in playwright.config.ts
import { clerkSetup } from '@clerk/testing/playwright';
export default () => clerkSetup();
```

The development instance answers every sign-in from Playwright's WebKit with "Too many requests", so sign-ins run in Chromium.

### Sound in browser tests

A page's Web Audio in an app's browser tests plays on the browser's offline engine, so the tests never open the Mac's speakers. A gain of zero before the speakers is not enough: a running AudioContext opens the output device whatever it plays, in Chromium and in WebKit, and what reaches it is heard. Sending the test browsers to BlackHole, as a silent iPhone Simulator does, is no answer here, since macOS chooses one output device for the whole Mac and the person's own sound would go with it. An app makes its tests' `test` once, in one file its specs share, from `app-kit/web/playwright-offline-audio`:

```ts
// e2e/test.ts
import { testWithOfflineAudio } from 'app-kit/web/playwright-offline-audio';

export const test = testWithOfflineAudio({ startsOnTap: true });
export { expect } from '@playwright/test';
```

Every spec imports `test` from that file, never from `@playwright/test`, which a lint rule can hold (oxlint's or eslint's `no-restricted-imports`, naming `test` from `@playwright/test` in the specs). A step in one spec's `beforeEach` covers that spec alone: an app that had it in one file still played the sea aloud from another spec that took a call. `testWithOfflineAudio(options)` returns Playwright's `test` with `offlineAudio` on every browser context it gives a test, and so on its `page`; an app with fixtures of its own adds them with `.extend` on what it returns. A context a test makes itself with `browser.newContext()` is not covered and takes `offlineAudio` by hand.

`offlineAudio(contextOrPage, options)` adds an init script that makes every AudioContext the pages create, and `webkitAudioContext` where the browser has one, an OfflineAudioContext, the engine that renders into memory, paced to the clock: it renders 20ms ahead, suspends itself and goes on once the clock catches up. Sources, filters, gains, scheduled ramps and analysers run as they would on a speaker, `onended` fires, and `currentTime` moves with time. `state`, `statechange`, `resume()`, `suspend()` and `close()` behave as a page sees them on a speaker; the engine's own suspension at each step never reaches the page. They settle whatever the page's timers do, as a browser's do, so they work under Playwright's clock installed and paused; the sound itself is paced by the page's clock, so under Playwright's clock `currentTime` moves only as that clock does. Without options, a context starts running on its own a moment after it is made, as in a browser that lets a page play sound. With `startsOnTap: true` it follows an iPhone's rule: it starts suspended, and `resume()` starts it only during a tap, rejecting with NotAllowedError otherwise, until it has started once. Playwright runs `page.evaluate` as a tap, so a test of the rule itself makes its context from the page's own script.

A context holds ten minutes of stereo sound, at 48,000 samples a second unless the page asks for another rate; past that its graph stops and `currentTime` holds. Both engines take memory only as the sound renders, about 380 KB for each second a context runs (ten contexts that each ran a second and closed added 18 MB to Chromium), and a closed context keeps what it rendered until its page goes away. What only a speaker has is missing: `createMediaElementSource` and the media stream nodes, while `baseLatency` and `outputLatency` read 0 and `setSinkId` changes nothing. An `<audio>` or `<video>` element plays outside Web Audio and is not covered.

`web/e2e/offline-audio.e2e.ts` holds it. A test made by `testWithOfflineAudio`, with no step of its own, plays a graph and opens no device, while a context it makes by hand opens one. While a page plays a graph through the step, in Chromium and in the kit's WebKit, it records macOS's audio service, which says of each process whether it has an output device open (Core Audio's list of processes, which needs no permission, read by `web/e2e/audio-output.swift`), and fails if the test's own browser opens one. The same page without the step must be seen opening one, played through a gain of zero so it is silent, so a record that hears nothing cannot pass. Other sessions playing sound at the same time are told apart by process: Chromium's audio process descends from the test's own process, and WebKit's GPU process, which macOS starts with no parent of the browser's, runs from the test's own copy of WebKit.

### Server tests

Two pieces let an app's server tests under Bun ask its real routes as a real caller:

- `fakeClerkApi()` from `app-kit/authentication/clerk/testing` answers Clerk's Backend API for Clerk's own middleware, so the middleware and `clerkCaller` run as they do in production. It sets `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` for the middleware, and gives `signedIn(personId, { authorizedParty })`, headers with a session token signed by a key it serves as Clerk's, `withKey('valid' | 'notFound')`, headers with a key for agents answered from Clerk's recorded answers, `key`, the person, id and name of the valid one, and `restore()`, called after each test, which puts back the fetch and the environment. Nothing is put in place of a module: Bun keeps a module replaced with `mock.module` replaced for every test file after it in the same run, which would hand the stand-in to files testing the real thing.
- `routesLetThrough({ app, prefix, openPaths, readableByKey, as })` from `app-kit/authentication/agent-keys/testing` walks every route the app registered under `prefix` and returns a line for each that answered otherwise than `requireCaller` would: nobody gets 401 everywhere but the open paths, and a key gets past the check only on the routes listed for it, GET or ALL, and 403 on everything else. `as('nobody' | 'key')` gives each request's headers. No route under the prefix is a line too.

```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { fakeClerkApi, type FakeClerkApi } from 'app-kit/authentication/clerk/testing';
import { routesLetThrough } from 'app-kit/authentication/agent-keys/testing';
import { app, READABLE_BY_KEY } from './app';

// Clerk's middleware reads its keys on each request, so the stand-in can start after the app is made.
let clerk: FakeClerkApi;
beforeEach(() => (clerk = fakeClerkApi()));
afterEach(() => clerk.restore());

test('every API route is guarded, and a key reads only the routes listed for it', async () => {
  const as = (who: 'nobody' | 'key') => (who === 'key' ? clerk.withKey() : {});
  expect(await routesLetThrough({ app, prefix: '/api', openPaths: ['/api/health'], readableByKey: READABLE_BY_KEY, as })).toEqual([]);
});
```

### The look

`lookTheme(look, options)` is the MUI theme for one of the kit's two looks, built from the tokens file (`app-kit/look`), so the app keeps no copy of the colors. The plain look is the system typeface on warm paper, #f6f5f2 in light and #1d1e20 in dark, following the system's setting through MUI's CSS variables, with the app's accent for actions and links; the console look is the console apps' theme, JetBrains Mono on #050505 in dark and #fbfbfb in light, its body text at 14 and its smaller text at 13. Both follow the system's light or dark setting through MUI's CSS variables, with no setting of their own. An app sets its look, in plain its accent, and nothing else of the look:

```tsx
import { lookTheme, fieldsNeverZoom } from 'app-kit/web'

const theme = lookTheme({ name: 'plain', accent: { light: '#2f5fa7', dark: '#8fb0e6' } }, { components: fieldsNeverZoom })
// or, for a console app: lookTheme({ name: 'console' })

<ThemeProvider theme={theme}><CssBaseline />…</ThemeProvider>
```

- **The kit builds the theme.** MUI works out the palette's light, dark and contrast colors, the typography and the color schemes only from `createTheme`'s first argument, and merges later arguments in raw, so a palette passed after would draw without them. The app's own options go in `lookTheme`'s second argument, merged into the kit's before MUI computes anything: components, breakpoints, `fieldsNeverZoom`.
- **The plain look's pieces in MUI.** A section's label is `<Typography variant="overline">` (12 at 600 in muted, no capitals); a title `variant="h6"` (17); a row is a `ListItem` (at least 48 high, a hairline below, no side padding), with what goes on the right, a status word, an action, a `Switch` or a menu, as a child after its `ListItemText` rather than a `secondaryAction`, which sits over the row and keeps only 48 pixels clear; status is `<Typography variant="body2" color="success">` and its siblings; an action is a `Button`, a word in the accent with nothing filled, and a removal `<Button color="error">`; the `Switch` is the kit's, 28 by 16; a menu that reads as text is `<Select variant="standard">`; a text field is a `TextField` in a hairline box. No paper, card or app bar has a shadow or a box of its own.
- **Page width and row height stay the app's**, as the console apps' `layout` objects hold them; the theme carries neither.
- **Colors by role, light or dark.** Both themes hold every one of the look's colors under the palette's `look` key, so MUI writes a variable for each, `--mui-palette-look-<role>`, that takes the light or the dark value with the system's setting. `colorVariables` names them: `colorVariables.secondary` is `var(--mui-palette-look-secondary)`. An app whose code names colors by role, as the console apps' `colors` objects do, swaps that object for `colorVariables` in one file. A see-through tint is `color-mix(in srgb, ${colorVariables.info} 30%, transparent)`, never hex digits added after a variable.
- **Under CSS variables, `theme.palette` holds the light colors only.** Code that reads a color in JavaScript reads `theme.vars.palette`, which names the variables, or, for a value a library needs as a hex string (a terminal, a canvas), `CONSOLE[scheme]` or `plainColors(accent)[scheme]`, with the scheme from MUI's `useColorScheme()`.
- `CONSOLE`, `plainColors(accent)`, `PLAIN_SIZES` and `FONTS` from `app-kit/look` give the values to code that draws outside MUI, as a chart or a canvas does.

`web/e2e/look.e2e.ts` draws a settings page in both looks, each in light and in dark, in the fixture's hidden Chromium, and holds its colors and the role variables to the tokens.

### Text size

An iPhone's web view, Safari's and the one a Tauri app runs in, ignores the Text Size set in Settings unless the page asks for it, and Apple has said it will stay that way (WebKit bug 187013). `followTextSize()`, called once at start, asks: it measures an element in Apple's body text style, which does take the setting, against its default of 17 pixels, and multiplies the page's root font size by that scale, the app's own root size if it sets one, from about 0.82 at the smallest size to about 3.12 at the largest accessibility size. Text Size changed from Control Center leaves the app in front with no page event, so the kit keeps that element in the page and reads again the moment it resizes, as a simulated iPhone's Safari showed; a size set for one app alone, in Control Center or Settings' Per-App Settings, reaches that app's web view the same way, by WebKit's source (not yet run on a device).

A person can also choose a size on this device: 85%, 100%, 115%, 125%, 150%, 175% or 200%, the Mac window's zoom steps in that range (`TEXT_SIZES`). A chosen size replaces the phone's rather than multiplying it, is kept in the browser's own storage, apart from any account, and applies off a phone too, where there is no Text Size to follow. Put the row on the app's settings page:

```tsx
import { TextSizeSetting } from 'app-kit/web'

<Typography variant="overline" component="h2">Display</Typography>
<List disablePadding><TextSizeSetting /></List>
```

It reads "Same as the phone", with the phone's own size beside it in the menu, or "Standard" off a phone, then the seven sizes, in the plain look's menu that reads as text (Text Size Studies, https://share.worktron.com/Pr3FS9jBNFa5YCzy, option A). The page resizes as the menu closes, so nothing moves under the finger, and at the largest sizes the menu goes under its name. `chooseTextSize(size)` sets it from code, null to follow the phone again, and `useTextSize()` gives `{ scale, choice, phone }` to a setting of the app's own. A choice made in another tab is read when this one comes back in front.

- **Do not add `<meta name="text-scale">`** to an app that calls `followTextSize()`. Browsers are starting to scale the root size by the system's text size under that tag, and the kit would then scale it a second time.

- **Size text in rem.** MUI's theme does by default, so its typography follows with nothing more. A size in pixels follows only when the app multiplies it: `calc(14px * var(--text-scale, 1))`, the variable the kit sets beside the root size. Spacing in pixels stays as it is, as in Apple's own apps.
- **Lay screens out for the largest sizes.** At three times the default, a row of buttons or a fixed-height card no longer fits. `useTextScale()` gives the scale to code that changes a layout at large sizes, and re-renders when it changes; it follows the setting too, so an app using only the hook needs no `followTextSize()` call.
- **Off an iPhone or iPad the scale is 1** until a size is chosen, and the root size is left alone. A Mac's Safari knows Apple's style but answers 13 pixels, its own fixed size, so the kit reads only on a touch device that answers at least 14, the smallest iPhone size. Playwright's WebKit, with an iPhone profile or without, is a Mac's and reads 1 too; only the iPhone Simulator shows the setting, as `web/text-size.ts` says how.
- **Text fields stay at 16 pixels or more.** At the smallest Text Size a field sized 1rem is about 13 pixels, and iPhone Safari zooms the page into a field under 16 as it takes focus, and stays zoomed. `FIELD_FONT_SIZE` is `max(16px, 1rem)`; for MUI's fields, every one built on InputBase, pass `fieldsNeverZoom` as `createTheme`'s second argument, `createTheme(appTheme, { components: fieldsNeverZoom })`, which merges it into the app's own `MuiInputBase` settings. A font size the app sets on the input slot overrides it, so set none there. Turning zoom off in the viewport tag instead would also stop pinch zoom on Android and in the iPhone app.
- **`rem(px)`** turns a size in pixels at the default root of 16 into rem, for a theme written in pixels, where MUI's own `theme.typography.pxToRem` does not exist yet.

### Pull to refresh

An installed app has no browser controls, so without a pull a stuck page or a new deploy means killing the app. `<PullToRefresh />`, mounted once outside the app's `ErrorBoundary` so a crashed page can still be pulled, reloads the page on a pull past the line from the top. `isInstalledApp()` says where it runs: the Tauri iPhone app, or a web app opened from the home screen; a browser tab keeps its own reload and Safari's own pull, and a Tauri app's Mac window has no touch.

```tsx
<ErrorBoundary placeholder={<Wordmark />}>…</ErrorBoundary>
<PullToRefresh top={BAR_HEIGHT} onPull={refetchEverything} ignoreWhile={() => dragging.current} />
```

- `onPull` refreshes in place instead, for an app that fetches everything again without losing its view. The mark spins until a promise it returns settles, and the page looks for a newer deploy at once (`lookForNewBuild`). A second pull while it has not settled reloads, so a refresh that hangs never leaves the app without one.
- A pull never reloads over text typed into a field; the mark says why and nothing happens.
- It starts only with the page at its top, outside a field, a menu, a dialog or a scrolled element, and only when the finger moves down more than sideways, so a row swipe never turns into one. `ignoreWhile` holds it off during a drag of the app's own.
- `top` places the mark below the app's bar; the top safe area is added. The mark draws in the theme's paper, divider and text colors.
- The default reload loads a newer build only where no service worker holds the old page. An app with one passes an `onPull` that updates the worker first.

### The first frame and the fonts

Until the app's code loads, a page with no background paints white, or in the wrong scheme, on every load, and text drawn before its font file arrives swaps a moment later. `firstPaint`, in the app's `vite.config.ts`, puts a style and a few lines of script at the end of `index.html`'s head that set the page's colors before the first paint:

```ts
import { firstPaint } from 'app-kit/web/first-paint';

plugins: [
  react(),
  firstPaint({ schemes: { light: { background: '#fff8f0', color: '#2c2420' }, dark: { background: '#14110f', color: '#efe6dc', dark: true } } }),
],
```

- The script sets `--page-background` and `--page-color` on the root (or the names given in `variables`), `color-scheme`, `data-scheme`, and every `theme-color` tag, making one if the page has none; the style paints `html, body` in those variables. The app's styles read the same variables, and its own code changes them later.
- Without `choose` it follows the system's light or dark setting, and follows it again when that changes. `choose` is a JavaScript expression run in the head that names the scheme, for a choice of the app's own, such as the hour of day: `choose: "new Date().getHours() >= 20 ? 'night' : 'day'"`.
- It is plain JavaScript, since a Vite config loads it in Node, which refuses TypeScript from inside `node_modules`.

`waitForFonts(faces)` resolves once each face is in, or after `FONT_WAIT_MS`, 1.5 seconds, and never rejects. Draw the app in its `then`, and let `index.html` show the app's wordmark until then, so the page is never blank: `#root:empty::before { content: 'Shop'; … }`.

```tsx
void waitForFonts(['500 1em "Cormorant Variable"', '400 1em "DM Sans Variable"']).then(() => createRoot(root).render(<App />));
```

Each face's `@font-face` must already be in a stylesheet the page has, or there is nothing to wait for; the console says so. It asks with `document.fonts.load`, since WebKit's `document.fonts.check()` answers true for a face not yet loaded.

### A request sent as the page is left

`request` waits for the sign-in provider's token before it sends, and a page being left may be gone before the token arrives, so what it sent never leaves: a deleted item is back on the next load. Marked `keepalive`, a request starts at once, with the token the provider holds now, and goes on after the page is gone:

```ts
const send = () => void request(`/api/tasks/${id}`, { method: 'DELETE', keepalive: true });
window.addEventListener('pagehide', send);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && send());
```

- Send on the page being hidden as well as on `pagehide`: iOS fires no `pagehide` when an app is swiped away. A send on both reaches the server twice, so it must be one the server takes twice.
- A token that expired while the phone slept is not sent, and the session cookie holds the same expired token, so the server refuses it; the retry then waits for a fresh token, which works while the page is still open. A page already gone loses that request, and the console says a keepalive request went without a token.
- The browser holds all keepalive requests in flight to 64 KB of body between them; over that it refuses the request, which reads as the server being unreachable.
- A provider gives that token through `tokenNow()` on its session; the Clerk adapter and the stand-in have it.

## extension/: the extension kit

`app-kit/extension`: what every browser extension of ours ships with. `rules/extensions.md` is its list. The worker files are plain JavaScript Chrome loads with no build step; the rest is TypeScript run by Bun on the Mac.

| Piece | Where | What it does |
| --- | --- | --- |
| Self-reload | `extension/worker/self-reload.js` | An extension loaded unpacked from its checkout reloads itself when the checkout's commit changes, when a file it loads is deleted, or, for a built folder, when the build on disk changes. A Web Store install never does. |
| Build identity | `extension/worker/build.js` | The version and the commit the worker loaded from, as `0.1.0-src (abc1234)`, and a record in `storage.local` of when this profile first ran that build. |
| Account identity | `extension/worker/account.js` | The profile's signed-in account from `chrome.identity.getProfileUserInfo`, with `identity.email` an optional permission asked for when a feature needs it. |
| Timers | `extension/worker/alarms.js` | Work on a clock runs on `chrome.alarms`, which survive Chrome stopping the worker, unlike `setInterval`. |
| Recorded errors | `extension/worker/errors.js` | The worker's uncaught errors, each with its time and build, kept in `storage.local`. |
| Showing a link | `extension/worker/show.js` | `showLink(url)` brings forward a tab already showing the address, raising its window, before it opens a new tab, as the extensions rule asks. Needs the `tabs` permission or access to the sites it shows. See below. |
| Native port | `extension/worker/port.js` | The worker's port to a native host, which reconnects, says hello with its build, answers the host's status question with its build, commit and errors, and answers every other request: with the extension's reply, a refusal when it has none, or the error it threw, so no caller waits out the host's timeout. |
| Never-sent Amazon requests | `extension/worker/amazon-never-sent.js` | `refusal(method, path, body)` gives the reason a request to www.amazon.com is never sent, or null: checkout, placing an order, payment, addresses, sign-in and changes to subscriptions, in the path, the query or the body, however the body is encoded. See below. |
| Native host | `app-kit/extension/host` | The host Chrome starts: it serves a unix socket for callers on the Mac (a command line, an MCP server, a server) and relays their requests to the extension. Also the client callers use, the status they read, the extension's ID from its key, and the manifest that tells Chrome about the host. |
| Install command | `app-kit extension install-host` | Tells Chrome about the native host: a launcher that runs it with Bun's absolute path, and the manifest Chrome reads, naming the extension's ID from its key. |
| Status command | `app-kit extension status <socket>` | Prints what the host says: whether the extension is connected, its build, its commit and its kept errors; when nothing is connected, why and the fix. |
| Plain look | `extension/look.css`, copied as `look.css` | The plain look for a popup or an options page, plain CSS with no build step: the look's colors as CSS variables, light and dark by the system's setting, written from the tokens file as it is copied, and the kit's rules for its pieces and controls. |
| Harness | `app-kit/extension/harness` | Loads the real extension in a hidden Chromium from a scratch git checkout, with its native host, for the extension's own tests: fire an alarm, commit, wait for the reload, count tabs. |
| Chrome stand-in | `app-kit/extension/testing/chrome` | An in-memory `chrome` for an extension's unit tests, with the network refused unless the test answers it. See below. |
| Host test helper | `app-kit/extension/testing/host` | Runs a native host the way Chrome does, with the test as the extension answering as the kit's port does, for the host's own tests. |

An extension installs app-kit the same way an app does, then copies the files Chrome loads into a folder of its own and commits them, because an unpacked extension loads from its checkout and a landing updates a checkout with git alone:

```sh
bun add github:worktron/app-kit#v0.41.0
bun run app-kit extension copy extension/kit
```

`bun run` runs the installed command and never downloads one, as `bunx` would from npm when the kit is not installed. The files land directly in the folder given, the one the worker imports them from, with `look.css`, the plain look's stylesheet for the extension's pages; `copy` refuses, writing nothing, a folder that holds none of them while a folder below it holds copies, and a file of the same name that is not a copy. Each copy's first line names the kit version it came from. A test in the extension keeps the copy current, comparing the code below that line, so a release that changes no worker file asks for no new copy, and another checks that the worker's list for self-reload names every file it imports:

```ts
import { unlistedImports, workerCopyDiffers } from 'app-kit/extension/copy'
import { LOADED_FILES } from '../extension/worker.js'
test('the kit copy is current', () => expect(workerCopyDiffers('extension/kit')).toEqual([]))
test('the worker lists every file it loads', () => expect(unlistedImports('.', LOADED_FILES)).toEqual([]))
```

To upgrade, run the same `bun add` at the new tag, then the copy command again.

A page in the plain look links the copied stylesheet, says it follows dark too, and sets only its accent:

```html
<meta name="color-scheme" content="light dark" />
<link rel="stylesheet" href="kit/look.css" />
<style>:root { --accent-light: #2f5fa7; --accent-dark: #8fb0e6 }</style>

<main class="page">
  <p class="title">Belongs in work@example.com</p>
  <p class="subtitle">This tab is in client@example.com</p>
  <div class="label">Profiles</div>
  <div class="rows">
    <div class="row"><span class="name"><b>work@example.com</b><small>Where it belongs</small></span><button class="action">Open it there</button></div>
    <div class="row"><span class="name">client@example.com<small>This tab</small></span><span class="status ok">Signed in</span></div>
    <label class="row"><span class="name">Ask before moving a tab</span><input class="switch" type="checkbox" role="switch" /></label>
    <label class="row"><span class="name">Open others in</span><select class="menu"><option>Personal</option></select></label>
    <div class="row"><label class="name">Test a link<input class="field" /></label><button class="action">Test</button></div>
    <div class="row"><span class="name">Link memory</span><button class="action remove">Forget all</button></div>
  </div>
  <p class="build">Answered by My Extension 1.0.0 (abc1234)</p>
</main>
```

Its pieces: `.page` (20 pixel sides, as a popup's; an options page sets `--side: var(--side-window)`, `--row: var(--row-window)` and `--title: var(--title-window)`), `.title`, `.subtitle`, `.label` above a section, `.text`, `.rows` of `.row` between hairlines (at least 44 high, a `.name` with a `<small>` detail, and one thing on the right), `.status` in `.ok`, `.warn`, `.error` or `.waiting`, `.action` (a word in the accent; `.main` for the page's main one, `.remove` in the error color, `.block` for one on a line of its own with a `<small>` under it), `.switch` on a checkbox, `.menu` on a select, `.field` on an input, `.note`, and `.build` at the foot, with the version and commit from `worker/build.js`. The stylesheet declares `color-scheme: light dark`, so Chrome's own scrollbars and form parts follow dark too. Its copy opens with a CSS comment naming the kit version, since a `//` line would be read as part of the rule after it, and `workerCopyDiffers` and `app-kit extension check` hold it current as they do the worker files. `extension/e2e/harness.e2e.ts` draws the fixture's popup with it, light and dark, in the hidden Chromium.

A worker built on it:

```js
import { every } from "./kit/alarms.js";
import { buildName, recordBuild } from "./kit/build.js";
import { watchWorkerErrors } from "./kit/errors.js";
import { nativePort } from "./kit/port.js";
import { checkForNewCheckout } from "./kit/self-reload.js";

export const LOADED_FILES = ["extension/worker.js", "extension/kit/self-reload.js" /* every file the worker loads */];
let commit = null;

const port = nativePort({
  host: "com.example.tool",
  describe: () => ({ version: buildName(commit), commit }),
  // The reply, without type or id, which the port adds; null for a request it has no answer for, which the port refuses.
  answer: async (message) => (message.type === "lookup" ? { found: "what the extension found" } : null),
});

async function start() {
  const checked = await checkForNewCheckout(LOADED_FILES);
  commit = checked.commit;
  if (checked.reloading) return;
  await recordBuild(commit);
  port.connect();
}

// Only inside Chrome: the Chrome stand-in has no runtime.id, so a unit test can import the worker without starting it.
if (globalThis.chrome?.runtime?.id) {
  watchWorkerErrors(self, () => buildName(commit));
  every("check", 1, start);
  chrome.runtime.onStartup.addListener(start);
  chrome.runtime.onInstalled.addListener(start);
  start();
}
```

`extension/test/fixture/worker.js` is a whole one, which the kit's own hidden-Chromium test loads.

A link the extension opens, from its popup, a menu or the native host, goes through `showLink`:

```js
import { showLink } from "./kit/show.js";

const { how, tabsUnreadable } = await showLink("https://mail.example.com/inbox");
```

A tab already showing the address (compared as an address, so `HTTPS://EXAMPLE.COM` finds `https://example.com/`) comes forward, its window focused and brought back when minimized, and the answer is `existing-tab`. With none, the link opens in a new tab of the last focused window, which is raised (`new-tab`), or in a new focused window when the profile has none (`new-window`). Only a web address (http or https) or one of the extension's own pages opens; anything else is `refused`, and a call Chrome refuses is `failed`, never thrown.

Chrome gives an extension a tab's address only with the `tabs` permission or access to that page's site, and ignores `tabs.query`'s address filter without them, so `showLink` reads every tab and compares each address itself. Without either for the link's site it cannot find the tab already open: the answer carries `tabsUnreadable: true`, the worker logs it once, and the link opens in a new tab. The extension's own pages count only under `tabs`. Requests for one link take turns: the second, with its own options, finds the tab the first opened when the extension may read it, so two at once open one tab; without that, each opens its own, as every request does then. `tabs` warns "Read your browsing history" at install; access to the extension's own site is the narrower choice when its links go only there. Name the permission to the owner before an extension ships it, as the rule asks.

Two options, for an extension with more to it: `skip(tab)`, for tabs never brought forward, such as the extension's own check tabs, and `open(url, opening)`, which wraps the opening of a new tab or window (`opening()` opens it and gives back the new tab's id), for a hold that must let this link through.

The host:

```ts
import { serveHost } from 'app-kit/extension/host'
await serveHost({ socketPath, logPath, refuse: (request) => (allowed(request) ? null : 'never sent') })
```

A caller writes one JSON line with an `id` and a `type` to the socket and reads one line back with the same `id`; `ask(socketPath, line)` does both. The type `status` is the host's own. The socket belongs in the tool's Application Support folder (`applicationSupport(name)`); keep its path under 104 bytes, since Bun reaches a longer one but a Node or Python caller on macOS cannot. What arrives on the socket is whatever a caller wrote, unchecked: `refuse` gets it as plain JSON and checks the fields it reads.

Tell Chrome about the host from the main checkout, never a worktree, which goes away when its work lands:

```sh
bun run app-kit extension install-host com.example.tool src/host.ts . --description "Relays the tool's requests to the extension"
```

It reads the extension's ID from the key in `./manifest.json`, writes a launcher at `~/Library/Application Support/com.example.tool/host` that runs `src/host.ts` with the absolute path of the Bun running the command (Chrome started from the Dock has launchd's short `PATH`), with the host's errors appended to `host-errors.log` beside it, and writes `com.example.tool.json` into Chrome's `NativeMessagingHosts` folder. It prints both, and the folder to pick in Load unpacked. It checks the name against Chrome's rule, the description, the host, the manifest's key and the checkout before it writes anything, and refuses a worktree unless `--from-worktree` says it is meant. Chrome starts the host in the launcher's folder, so Bun reads no `.env` from the checkout.

When no host answers, `app-kit extension status <socket> com.example.tool .` says why, with the fix: Chrome has no registration for the host, or one it cannot read or would ignore; the launcher, its Bun or its script is gone, as when it pointed into a worktree since removed; it runs from a worktree; the registration allows another extension than the folder's; or, with all of that right, the extension is not running, with the newest lines of the host's error log. An app's own status command calls the same check, `diagnoseHost({ name, extensionFolder })` from `app-kit/extension/host`.

A host's own test runs it as Chrome would, with the test as the extension:

```ts
import { startHostAsChrome } from 'app-kit/extension/testing/host'
const host = await startHostAsChrome({ command: [process.execPath, 'src/host.ts'], env: { TOOL_DIR: dir }, logPath: join(dir, 'host.log'), answer: (message) => ({ echoed: message.text }) })
// ... ask(socketPath, ...) ...
await host.stop()
```

### Amazon requests never sent

An extension that reaches Amazon in the person's own signed-in browser keeps its own short list of the paths it asks for, and checks every request against `extension/worker/amazon-never-sent.js` besides, so neither a mistake in its own list nor a request its server hands it whole ever starts a purchase:

```js
import { landedOutside, refusal } from "./kit/amazon-never-sent.js";

const reason = refusal(method, path, body) ?? ownListRefusal(method, path);
if (reason) return { ok: false, reason };
const answer = await fetch(`https://www.amazon.com${path}`, { method, body, credentials: "include" });
if (landedOutside(answer.url)) return { ok: false, reason: "The answer came from a page that is never read" };
```

| Export | What it does |
| --- | --- |
| `refusal(method, path, body)` | Null when nothing in the request is on the list, else the reason. Only GET and POST are sent, only to a path on www.amazon.com, and a GET carries no body. The path and the query are checked against the list (checkout, placing an order, Buy Now, payment and the wallet, addresses, sign-in, account settings, devices, and every subscription page but the list of them), leaving out the search words, so a search for "address book" is a search. The body is checked for the phrases that start a purchase after decoding it as Amazon would, each `%XX` and JSON `\uXXXX` escape on its own and again until nothing changes. |
| `landedOutside(url)` | Whether an answer that ended at `url`, after its redirects, left www.amazon.com or ended on a page from the list, so its text is not handed back. A redirect to sign-in is not counted: it is how Amazon answers someone signed out. |
| `plainText(body)` | A body decoded as `refusal` reads it. |
| `NEVER_SENT`, `AMAZON_ORIGIN` | The reason `refusal` gives for a request on the list, and `https://www.amazon.com`. |

The list is amazon-connector's, where it was worked out against Amazon's real pages; `app-kit/amazon-cart`'s `addRequest` gives requests that pass it.

### The Chrome stand-in

The worker's unit tests run against an in-memory `chrome`. Importing `app-kit/extension/testing/chrome` installs it on `globalThis`; name it in the test start-up file (bunfig.toml's `preload`) or import it first in each test file, and call `reset(files, manifest)` before each test:

```ts
import { addTab, answerNetwork, reset, sendToWorker, shim } from 'app-kit/extension/testing/chrome'

beforeEach(() => reset({}, { version: '1.0.0', permissions: ['tabs'] }))

test('the popup asks which tabs show the inbox', async () => {
  const tab = addTab({ url: 'https://mail.example.com/inbox', active: true })
  answerNetwork((request) => Response.json({ unread: 3 }))
  start()
  expect(await sendToWorker({ type: 'inbox-tabs' })).toEqual({ tabs: [tab.id], unread: 3 })
  expect(shim.networkRequests).toEqual([{ url: 'https://api.example.com/unread', method: 'GET' }])
})
```

What it fakes, each behaving as Chrome does where a test could tell:

- **The network.** A request to anything but the extension's own files (`shim.files`, by path) and `data:` or `blob:` addresses is recorded in `shim.networkRequests` and refused with Chrome's offline error, `TypeError: Failed to fetch`, unless the test answers it with `answerNetwork(request => Response)`. A test cannot reach the internet without saying so.
- **Storage.** `storage.local` and `storage.session`: `get` by one key, several, an object of defaults, or `null` for all, each a copy; `set`, `remove`, `clear`. A test reads them as `shim.local` and `shim.session`.
- **Tabs and windows.** `addWindow()` and `addTab({ url, active, windowId })` make them; the first window is focused, and the tab given back is the live one. `tabs.query` takes address patterns (one or a list, as Chrome's match patterns, a port matching that port alone and `*` any), `active`, `windowId`, `currentWindow`, `groupId` and `pinned`; `tabs.get`, `create`, `update` and `remove` fire `onCreated`, `onUpdated`, `onActivated` and `onRemoved`. Closing the active tab makes the next one active, the rest move up, and a window left with no tab closes. A tab's address, title and icon are left out, and an address pattern matches it not at all, unless the manifest or a grant holds `tabs`, or an origin covers the page. `windows.get`, `getAll` and `getLastFocused` (`populate` for the tabs), `create`, `update` and `remove`, with `onFocusChanged` and `onRemoved`; closing the focused window hands the focus to another. A tab or window that is gone throws Chrome's `No tab with id: 7.`. Ids are never reused in a run.
- **Messages.** `sendToWorker(message, sender)` sends a page's message to the worker's `runtime.onMessage` listeners and gives back the answer: what was passed to `sendResponse` after a listener returned true, or what a returned promise resolved to (Chrome 148 and later), the first to answer winning, as in Chrome's message passing guide. An async listener answers every message, with `null` when it returns nothing. A promise rejected with an Error rejects with its message. The worker's own `runtime.sendMessage` is recorded in `shim.sentMessages` and refused, as Chrome does with no page open to hear it.
- **The native host.** `sendNativeMessage` is answered by `shim.nativeHost(host, message)` and refused with Chrome's "Specified native messaging host not found." when there is none; each is recorded in `shim.nativeMessages`. `connectNative` gives a port recorded in `shim.ports`, whose `posted` lists what the worker sent, `deliver(message)` sends it one from the host, and `close(error)` closes it with the error in `runtime.lastError` for the disconnect listeners, as Chrome does for a host it could not start.
- **Permissions and the account.** `permissions.contains`, `request`, `remove` and `getAll`, with origins, counting what the manifest holds and a wider origin as covering a narrower one, never the reverse, and reading a host permission's path as `/*`, as Chrome does, and `onAdded` and `onRemoved`; `grant({ permissions, origins })` grants as the person would. `identity.getProfileUserInfo` leaves the email out unless the manifest or a grant holds `identity.email`; `signIn(account)`, or `signIn(null)`, fires `onSignInChanged`.
- **Alarms.** `create`, `get`, `getAll`, `clear` and `clearAll`; `fireAlarm(name)` delivers one as it comes due.
- **The rest.** The manifest (`runtime.getManifest`), `runtime.getURL`, `runtime.reload` (counted in `shim.reloads`), `onInstalled`, `onStartup` and Web Locks, which Bun lacks. There is no `runtime.id`, so a worker that starts only inside Chrome stays still when a test imports it. `reset()` clears every listener, as a kit worker adds its own when it starts.

What one extension alone uses, it adds with `extend`, once, in its start-up file or at the top of a test file. What it adds stays across `reset()`, and its events, made with `ChromeEvent` (whose `emit` a test calls as Chrome would), are cleared by it. `extend` refuses to replace what the stand-in has, so a test never runs against two versions of one call:

```ts
import { ChromeEvent, extend } from 'app-kit/extension/testing/chrome'

export const badge = { text: '' }
extend({
  action: { setBadgeText: async ({ text }: { text: string }) => void (badge.text = text) },
  contextMenus: { create: () => {}, onClicked: new ChromeEvent() },
  identity: { getAuthToken: async () => ({ token: 'token-1' }) },
})
```

## tauri/: Mac and iPhone apps

What a Tauri app's page, shell and server share: a window onto the hosted site, Mac releases the installed app updates itself to, desktop sign-in, iPhone notifications, iPhone sign-in, a run on the Simulator or an iPhone, an iPhone Simulator that runs silent, and TestFlight builds after each landing.

### A window onto the hosted site

A Tauri plugin for the shell, in `tauri/window/plugin/` (`tauri-plugin-app-kit-window`), and `app-kit/tauri/window` for the page: a Mac or iPhone app whose window loads its own hosted site gets what every such shell wrote by hand. The window loads the site, so sign-in, data and every deploy are the site's. The plugin adds:

- Desktop sign-in's shell half (step 3 below). It reads the browser's `<scheme>://sign-in` link off Tauri's own open event, takes only a code (in the link's `ticket` field) and a nonce in the characters they are written in, and hands both to the page as JSON in a window event, or, while the window is still on a start page, loads the site with them in its fragment. The kit holds the names, so an app keeps no copy of them and no test that reads its Rust.
- Links. The site and its subdomains stay in the window; other sites go to the default browser, and mail, phone and text links to their apps; files, scripts and other schemes do nothing; desktop sign-in's browser page always goes out. A request for a new window (a link with target=_blank, `window.open`) goes out the same way, on the iPhone too, whose web view otherwise drops it.
- The page's grant, named as local and remote. A built app counts a page under `frontendDist` as local, and a grant for remote pages alone left an installed app's page with no permissions at all, which a debug build hid.
- On the Mac: closing hides the window and the app runs on; a Dock click brings it back; the page is not suspended while hidden (WebKit suspends a hidden page after about five minutes, which stops its polls); the window opens centered, back where it was, and maximized without the zoom animation; View's Actual Size, Zoom In and Zoom Out are kept across launches; and the page hears when the window goes into or out of full screen and when a newer build has been installed over the running one, for it to offer a restart into it, which `UpdateLine` offers as Update.
- On the Mac, updates from the app's releases, when its `tauri.conf.json` has `plugins.updater` (Releases and updates, below).
- On the Mac, the menu bar practices' desktop app rule asks for (`AppMenu`): the app's menu with About, which shows the version and the commit the build was made from, Check for Updates… when the app updates itself, Settings… (⌘,) and Sign Out when the app has them, Services, Hide and Quit; File's Close Window (⌘W); the Edit menu, without which a text field loses ⌘C and ⌘V; View's zoom, Reload (⌘R) and Enter Full Screen; and Window's Minimize (⌘M), Zoom and Bring All to Front, where macOS lists the open windows.

Each decision is logged by host only, never a path, query or fragment, where a sign-in ticket can be.

In `src-tauri/Cargo.toml`, after `bun install`, with the path from `src-tauri` to the `node_modules` that holds the kit. Tauri 2.12.5 or later, whose restart opens the app through macOS, so it comes back in front as itself:

```toml
[dependencies]
tauri = "2.12.5"
tauri-plugin-app-kit-window = { path = "../node_modules/app-kit/tauri/window/plugin" }
tauri-plugin-deep-link = "2"
tauri-plugin-opener = "2"

[target.'cfg(target_os = "macos")'.dependencies]
tauri-plugin-window-state = "2"
```

The shell, for the Mac and the iPhone, which `main` (or `run`) runs with `shell(tauri::Builder::default()).run(tauri::generate_context!())`:

```rust
use tauri::window::Color;
use tauri::{Manager, Runtime, WebviewUrl};
use tauri_plugin_app_kit_window::{log_to_file, show_once_placed, Site};
#[cfg(target_os = "macos")]
use tauri_plugin_app_kit_window::AppMenu;

/// The site this build loads: a dev server's address when the build is given one, else the site.
const PAGE: &str = match option_env!("TAURI_PAGE_ADDRESS") {
    Some(address) => address,
    None => "https://app.example.com",
};

/// The commit About names, which the release command passes in (`APP_COMMIT=$(git rev-parse --short HEAD)`).
#[cfg(target_os = "macos")]
const COMMIT: &str = match option_env!("APP_COMMIT") {
    Some(commit) => commit,
    None => "development",
};

fn shell<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    let site = Site::new(PAGE.parse().expect("PAGE is an address")).scheme("com.example.app");
    let builder = builder
        .plugin(log_to_file("example_app"))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init());
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::new()
            .with_state_flags(tauri_plugin_window_state::StateFlags::all() - tauri_plugin_window_state::StateFlags::VISIBLE)
            .build(),
    );
    #[cfg(target_os = "macos")]
    let builder = builder.menu(|app| AppMenu::new().settings().sign_out().commit(COMMIT).build(app));
    let builder = builder.plugin(site.plugin());
    builder.setup(move |app| {
        app.add_capability(site.capability().permission("core:window:allow-start-dragging"))?;
        let start = WebviewUrl::External(site.address().clone());
        let window = site
            .window(app, start)
            .title("Example")
            .inner_size(1280.0, 860.0)
            .background_color(Color(5, 5, 5, 255))
            .build()?;
        show_once_placed(&window);
        Ok(())
    })
}
```

- The order matters. The opener comes before the window plugin, which otherwise stops the app at launch saying so; on the Mac, window-state comes before it too, registered without `StateFlags::VISIBLE`, since that flag shows the window before it zooms.
- `scheme` is the app's own link scheme, which the deep-link plugin registers from `tauri.conf.json`. Desktop sign-in's link arrives on it and the page restarts the app through it; an app with no sign-in and no update line leaves it out, and then needs no deep-link plugin.
- `start` is the site, or a page the app bundles that goes on to it: the window keeps `tauri://localhost`. The background color is the page's own first frame, so a load is never a white flash.
- The address comes in at build time. An iPhone build compiles inside an Xcode step that Tauri passes only variables whose names start with `TAURI_`, so the variable is named that way for the Mac too.
- A frame the page embeds from another site (a video, a map) goes to the browser on every load, since WebKit asks about every frame, unless `.keep_in_window(host)` keeps its host. Each address sent out is logged with a reminder of this. Cloudflare's bot check, which Clerk's sign-up shows, is kept already. An app's own `on_navigation` on the window runs first and can only refuse an address, never keep one.
- `log_to_file("example_app")`, with the app's crate name as Rust writes it, logs the app's and the kit's decisions to `~/Library/Logs/<identifier>/`, one file of up to a megabyte, and warnings from anything else.
- On the Mac, `AppMenu` builds the menu bar: `.settings()` adds Settings… and `.sign_out()` Sign Out, which the page carries out (below), and `.commit(COMMIT)` names in About the commit the release command builds from, which Cargo builds into the app again whenever `APP_COMMIT` changes; a build without it says `development`. The window carries out Reload and the zoom itself; the rest are macOS's own items, with its shortcuts. An app adds items of its own to File or View through `menu.get(FILE_MENU)` or `menu.get(VIEW_MENU)` and the submenu's `insert`, and handles them in its own `on_menu_event`. `show(app)` brings the window to the front, as for a global shortcut, and `zoom_items(app)` gives View's three zoom items to an app that builds its own menu.
- An iPhone page with a service worker: `.limit_navigations_to_app_bound_domains(true)` on the window, with the site and `localhost` in `WKAppBoundDomains` in `Info.ios.plist`, since an iPhone web view runs a service worker only for app-bound domains.

The page:

```tsx
import { UpdateLine, useWindowFullScreen, useWindowMenu } from 'app-kit/tauri/window';

const fullScreen = useWindowFullScreen(); // the window's buttons are hidden: the top bar starts at its usual margin
useWindowMenu('settings', () => navigate('/settings')); // Settings… (⌘,), with the window already brought forward
useWindowMenu('sign-out', () => void signOut());
<UpdateLine appName="Example" scheme="com.example.app" /> // "Example has an update." with Update for a deploy, a release or a newer build installed, else nothing
```

The restart link (`restartLink(scheme)`, which `UpdateLine` opens) works only once a newer build is installed, so no page or frame can restart the app at will. The window tells the page by a flag as well as an event, and again as each page loads, so a page that listens late still knows. A menu item is told once, by its event, as a click is.

An app moving onto the plugin drops its own copy of the sign-in Rust and the test that held it to the kit's names. An app that had its own names for full screen or a newer build ships its shell on the plugin first and moves its page to these hooks once that build is installed, or the first install misses its offer to restart into the newer build.

The decisions are tested in Rust (`cargo test` in `tauri/window/plugin/`), the menu bar as macOS holds it in `plugin/tests/menu.rs`, which builds it on the main thread and reads it back, never shown, and the shared names, the page hooks and the iPhone's `window.open` script in `test/tauri-window.test.ts`; `plugin/tests/readme.rs` compiles the shell above. What needs a screen is checked in the first app that takes the plugin, by its log: `the window was closed, so it is hidden`, `a newer build is installed`, `sent a link for https://… out of the window`.

### Releases and updates

`app-kit mac release` and `app-kit mac key`, and the window plugin's half: a Mac app on the kit publishes a release with one command, and every installed copy finds it and offers to update, so a Mac without a checkout stays current. The releases live in a public GitHub repository of the app's own, which holds only built apps; Tauri's updater reads its newest release's `latest.json` and checks the update's signature against the public key in the app's `tauri.conf.json` before it puts the update in place.

Once per Mac that releases: a code signing identity in its keychain, the same for every build, since macOS ties an app's permissions (Full Disk Access, for one) to its signature, and a build signed ad hoc is signed differently each time. A self-signed one is enough for apps that run only on your own Macs: Keychain Access, Certificate Assistant, Create a Certificate, type Code Signing. `security find-identity -p codesigning` lists what the keychain holds; the release takes one macOS does not trust, as a self-signed one is until it is marked trusted.

Once per app:

1. The releases repository, public and not empty: `gh repo create <owner>/<app>-releases --public --add-readme`.
2. The key that signs its updates, from the folder holding `src-tauri`: `bun run app-kit mac key <owner>/<app>-releases`. It makes the key with no password, keeps it in 1Password's Personal vault as "<productName> update signing key" (the private key and the public key as two fields), and prints the block for `tauri.conf.json`. It never replaces an item that exists, since a new key would strand every installed copy; the key is in no program's arguments and no file.
3. In `src-tauri/tauri.conf.json`, the printed block under `plugins`, and the identity:

   ```json
   "bundle": { "macOS": { "signingIdentity": "Example Code Signing" } },
   "plugins": {
     "updater": {
       "pubkey": "<the public key>",
       "endpoints": ["https://github.com/<owner>/<app>-releases/releases/latest/download/latest.json"],
       "requireSignedVersion": true
     }
   }
   ```

   `requireSignedVersion` has the updater refuse a release whose signature was made for another version, so nobody can pass an older signed build off as a newer one in `latest.json`. Anything the build needs made before Tauri's own (Argon's icon, compiled by `actool`) goes in `build.beforeBuildCommand`, which the release's `tauri build` runs first.

Each release, from the folder holding `src-tauri`, at landed code:

```sh
bun run app-kit mac release
```

It refuses a Mac that is not Apple silicon, a checkout with uncommitted changes anywhere in it, a HEAD not on `origin/main`, and a folder that differs from `origin/main` (after fetching it); a config with no signing identity, one the keychain lacks, or no updater settings; an endpoint that is not a GitHub release's `latest.json`; a releases repository that is not public, is empty, or gh may not write to; and a key whose public half is not the config's. The version is one past the higher of the last release and the config's `version`, so raising the config's version starts a new minor version; only gh's "release not found" counts as no releases, and any other failure stops it. It reads the key from 1Password, which asks for Touch ID, runs `bun install --frozen-lockfile`, and builds with `bunx tauri build --bundles app --config '{"version": …, "bundle": {"createUpdaterArtifacts": true}}'`, the key in the build's environment alone and `APP_COMMIT` set to the commit, which About shows. It then refuses a build not signed by the identity, an update whose signature does not name the version (Tauri's command-line tool records it from 2.12.0), and a checkout that changed during the build. It publishes the archive under a name GitHub keeps as it is (`Past.the.Break.app.tar.gz` for "Past the Break"), its signature and `latest.json` as release `v<version>`, marked the latest; gh makes the release a draft until every file is up, so no installed copy sees half of one. Every line starts `[mac release]`; it exits 0 published and 1 for anything else. It does not install the build: the copy in Applications takes it as an update, as every other Mac does.

The first install on a Mac, from the release, with nothing marked as downloaded from the web, so macOS opens it without asking:

```sh
gh release download --repo <owner>/<app>-releases --pattern '*.app.tar.gz' --dir /tmp/<app>-release && tar -xzf /tmp/<app>-release/*.app.tar.gz -C /Applications
```

The installed app, on the window plugin, with no line in its shell: when `tauri.conf.json` has `plugins.updater`, the plugin registers Tauri's updater itself and asks the releases at launch and each time the window comes forward, at most once an hour, never while an update installs. A newer version found is offered in the menu, whose Check for Updates… after About asks at once and shows the answer in place (up to date, Update to 0.1.9, Updating to 0.1.9…, or that it could not), and to the page by `useAppUpdate`, which `UpdateLine` (above) offers as Update, told again as each page loads. Update, from the menu or the page's link to `updateLink(scheme)`, downloads the update, checks its signature, puts it in place of the app and restarts into it; a later release found meanwhile takes the place of the one offered. A build run outside an app bundle, as `tauri dev` runs one, never asks, and its menu says updates come only in the installed app. A copy built by hand carries the config's version, below every release, so it is offered the last release; nothing is lost by taking it. An app that builds its own menu instead of `AppMenu` adds `update_item(app)` to it. Each decision is in the app's log: `updates are on`, `version 0.1.9 is released, running 0.1.8, offering Update`, `no newer version is released`, `version 0.1.9 installed, restarting into it`.

The release is tested against stand-ins for gh, 1Password, the keychain, codesign and Tauri's build in `test/mac-release.test.ts`, and the key in `test/mac-key.test.ts`; the window's half in Rust (`plugin/src/updates.rs`), against a releases feed the test serves with a release signed as Tauri signs one, through the check, the offer to the page and a download whose signature is checked, and a feed signed by another key or for another version, which is refused. Putting an update in place of a running app and restarting it need the app installed and its window on the screen, so they are checked in the first app that takes it, by its log.

### Desktop sign-in

`app-kit/tauri/sign-in` and, for the server, `app-kit/tauri/sign-in/server`: Google refuses to sign in inside a desktop app's web view, so the app's window opens the default browser for it, and the browser hands the sign-in back through the app's own link. Practices' `rules/desktop-apps.md` and `rules/tauri.md` say why. The kit holds every decision and request; the app draws its own screens from the states the hooks give, and its shell passes the link into the page. The window's page is the app's own site, served by the server that mounts the routes, as a Tauri window onto the hosted app is, since the browser page and the routes are on the page's origin.

Any app on the computer can claim the app's link scheme, and any can open the browser page, so two things keep another app from signing in as the person. The link carries only a one-time code, which the server turns into a ticket only for the secret the window keeps and never sends, so a caught link is worth nothing. And the browser page hands over only when the person clicks, since nothing in its address tells the app's window from another app that made up its own secret: the page names the account and the app, with words such as "only if you just chose Continue with Google in the app". Only links the operating system proves belong to the app (Apple's associated domains) make this safe without the click, which so far only the iPhone's sheet does (iPhone sign-in, below).

1. The window opens `desktopSignInAddress(account)` in the browser: `/desktop-sign-in`, with the fingerprint of a secret kept in the window's own storage as its nonce, and the account chosen in the window: `{ account }` for Continue as that account, `'choose'` for Use a different account, which shows Google's list even when the browser is signed in, or `null` for Continue with Google with no account remembered, which takes whoever the browser is signed in as. A second click asks with the same secret.
2. In the browser, signed out, the app's sign-in screen goes to Google once per tab when `startGoogleHere()` says so, for `desktopSignInRequest().account` (Google's list for `'choose'` or `null`). Signed in, `useDesktopSignInBrowserPage({ session, scheme })` decides; signed in as another account than the one named, or asked for Google's list, it signs out first, and the sign-in screen goes to Google; back from Google, whoever was picked there goes over. Then it is `ready`: the app draws the account and a button that calls `handOver()`. On the click it asks the server for a one-time code for the window's fingerprint, opens `<scheme>://sign-in?ticket=<code>&nonce=…`, and closes the tab once the server says the app has signed in. After a trip to Google the browser will not close the tab, so the app says the window is signed in. `again()`, for a link that expired or a sign-out that failed, is the person's click too. In another site's frame the page is `not-from-app` and never offers the click. Opened by the iPhone's sheet waiting for the hand-back over https, with `back=https`, in an iPhone's or iPad's browser, it skips `ready` and goes to `backLink`, `<site>/desktop-sign-in/back#ticket=<code>&nonce=…`, instead; in any other browser it ignores `back=https`, since a program on a Mac could add it and read the address from the browser's history.
3. The shell, given that link, dispatches `DESKTOP_SIGN_IN_EVENT` with `{ ticket, nonce }` when the page has set `DESKTOP_SIGN_IN_LISTENING`, else loads the app's address with `TICKET_PARAM` and `NONCE_PARAM` in its fragment, which the browser never sends, so the code is in no server's log. The fields keep the names installed shells take, so the code travels as `ticket`. It JSON-encodes both values into its script and checks their characters, since any app on the Mac can open the link. The kit's window plugin does all of this (A window onto the hosted site, above), held to these names by the kit's own test; an app that writes its own shell instead holds it to them with a test that reads its Rust.
4. The page calls `listenForDesktopSignIn()` from its first script, and `useDesktopSignInWindow(session)`, only when the nonce is the window's own fingerprint, turns the code into a ticket at the server with its secret and signs in with it through the adapter's `ticket`. The secret is used up once the ticket works, so a fresh code after an expired one still signs in; links that come while one is being taken, or while signed in, are dropped. An iPhone app runs the browser page in Apple's sign-in sheet instead, which returns the link to the page (iPhone sign-in, below).

A later Google consent, such as asking for calendar access after sign-in, starts in the browser the same way: Google refuses it in the window, and Clerk refuses to finish a trip to Google that the window started (`authorization_invalid`), since Google returns to Clerk in the browser.

The server mounts the routes where the kit asks for them, behind its own sign-in check, which lets through `DESKTOP_SIGN_IN_OPEN_PATH` alone: there the window, still signed out, turns its code into a ticket, and the secret is its proof. An app tests that through its whole server, with the check in front, since the kit's own tests mount the routes bare. The ticket is made only then, so it never travels in a link; every refusal there logs a line starting `[desktop-sign-in]`.

```ts
import { DESKTOP_SIGN_IN_OPEN_PATH, DESKTOP_SIGN_IN_ROUTES, desktopSignInRoutes } from 'app-kit/tauri/sign-in/server';

// The paths the app's sign-in check lets through with no one signed in.
const OPEN_PATHS = new Set(['/api/health', DESKTOP_SIGN_IN_OPEN_PATH]);

app.route(DESKTOP_SIGN_IN_ROUTES, desktopSignInRoutes({
  // A session's person only, never a key for agents': a code signs its holder's window in as that person.
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

Two more fields keep a notification quiet and put a count on the app's icon:

```ts
await sendToApple(devices, { title, body, url: '/alerts/3', quiet: true, badge: 3 }, options); // quiet, with a count
await sendToApple(devices, { badge: 3 }, options); // only the count
await sendToApple(devices, { badge: 0 }, options); // clears the icon
```

`quiet: true` sends the alert at Apple's passive level with no sound: it goes to the Notification Center list without lighting the screen or playing anything, and with the app in front the plugin leaves out the banner. Apple's interruption levels start at iOS 15, so an older phone shows a quiet notification as a normal alert, with no sound. Without `quiet`, a notification sounds and shows as it always has.

`badge` sets the number on the app's icon, and 0 clears it. The count is the server's: the plugin asks for permission to show it, and nothing on the phone changes or clears it, so the number drops only when the server sends a lower one. With the app in front, iOS applies it only when the shell's `ForegroundPresentationOptions` include `badge`, as the default and `silent()` do and `none()` does not.

With no `title` and no `body` the push carries only the badge, with no alert and no sound, and with no `url` it leaves out the address too. TypeScript refuses a title without a body, `quiet` without an alert, and a payload with neither an alert nor a badge. It stays an `alert` push at priority 10, which is the push type Apple names for a badge, and it has no `content-available`, which Apple reserves for a silent update that leaves out `alert`, `badge` and `sound`.

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

It hands the link to `useDesktopSignInWindow`, which signs in only when the nonce is the window's fingerprint and the server takes its secret, and answers whether it handed one over: false when the sheet was cancelled or failed, or closed on any link that is not the app's sign-in. iOS asks the person once whether the app may use the site to sign in. One sheet is open at a time; a second call while one is up is refused. Every step logs a line starting `[iphone-sign-in]`, in the page's console and in the phone's log, and a sheet that opened logs `[iphone-sign-in] sheet started for <host>, waiting for <scheme or address>`.

#### Sign-in with one tap

The browser page's click is there because any app can claim the app's link scheme. From iOS 17.4 the sheet can wait instead for an address on the app's own site, `<site>/desktop-sign-in/back`, which iOS gives only to the app that site names, so the page hands over with no click and sign-in is one tap, Apple's prompt. `handBackOverHttps: true` asks for it:

```ts
const handedOver = await signInInSheet(desktopSignInAddress(account), { scheme: 'com.example.app', handBackOverHttps: true });
```

The plugin then adds `back=https` to the address and waits for the site's address over https. On older iOS, with a build whose plugin predates it, or when iOS refuses it, it waits for the app's link and the page asks for the click, as without the option; a refusal logs `[iphone-sign-in] sheet refused https://<site>/desktop-sign-in/back:` with Apple's reason. iOS refuses it, before the sheet shows, when the build has no entitlement for the site, when the site's file does not name the app, and when the phone has not fetched that file, which it does only when the app is installed or updated, never on a Simulator, and on some iOS 26 phones not even then. The page takes only the address exactly as the browser page writes it, since iOS also matches it with another port, case or a slash at the end.

In this order, since Apple's servers keep a failed fetch of the file and a phone keeps it until the next build:

1. The site serves `/.well-known/apple-app-site-association` as `application/json`, with no redirect, before the page's catch-all and outside any sign-in check, with the app's team and bundle id under `webcredentials` alone (an `applinks` entry would also send the path to the app from Safari):

   ```json
   { "webcredentials": { "apps": ["<team id>.com.example.app"] } }
   ```

2. `https://app-site-association.cdn-apple.com/a/v1/<site's host>` answers with that file: Apple's servers have it.
3. In Apple's developer portal, the app's identifier has Associated Domains, and the build's provisioning profile is made again after it.
4. The iPhone build's entitlements, `src-tauri/gen/apple/<app>_iOS/<app>_iOS.entitlements`, hold the site with no `?mode=developer`:

   ```xml
   <key>com.apple.developer.associated-domains</key>
   <array><string>webcredentials:<site's host></string></array>
   ```

5. A build with them is installed, then the page passes `handBackOverHttps: true`. A page that asks before then costs only the click.

### Running on the Simulator or an iPhone

`app-kit iphone run sim` and `app-kit iphone run phone`, run from a Tauri app's checkout, build its iPhone app and start it, in place of the `scripts/iphone.sh` each app carried:

- **sim** builds for the Simulator and starts the app on the checkout's own Simulator: one named after the app's `productName`, or in a linked worktree `<productName> (<worktree folder>)`, so two threads on the same app never install over each other's build or screenshot the other's. It is made once, as an iPhone 17 with no runtime named, so simctl takes the newest runtime that runs one; naming the newest runtime failed with "Incompatible device" once a runtime made for a single new model was installed. The sound step of [A silent iPhone Simulator](#a-silent-iphone-simulator) runs before the boot, and booting through simctl opens no Simulator window. It then stops the copy running, installs, starts the app, and prints the `xcrun simctl io <udid> screenshot` line for a look without a window.
- **A Simulator it boots shuts itself down.** A booted Simulator runs about 250 processes and 4 GB until someone shuts it down, and Apple's tools never do; three left booted for hours made a Mac with 64 GB barely usable. So each one `sim` boots shuts down 10 minutes after its app starts, which the run prints as a time, and `app-kit iphone-simulator keep <udid> [<minutes>]` moves to that many minutes from now (10 by default, 30 at most) while a check is still going. A watcher process started with it, in a session of its own, shuts it down at that time, or at once when the checkout it belongs to is deleted, whatever happened to the run, the agent's shell or its thread. A run that fails after the boot, or is stopped, shuts its Simulator down itself. A Simulator already running when the run starts, booted some other way, is used and given no time.
- **At most two Simulators run on the Mac at once**, counted from the Mac's own list of booted ones, whoever booted them. After its build, a run that finds both places taken waits until the soonest shut-down time among them, saying which Simulators hold the places and until when, and boots once one has gone; when none of them has a time from the kit, it fails at once, naming them. Each decision is a line with its reason in `~/.local/state/app-kit/simulators/simulators.log` (under `$XDG_STATE_HOME` when set), beside one file per Simulator the kit holds a time for.
- **phone** takes the iPhone paired with this Mac, a connected one first, and prints its name. Signing needs the phone in the team's development profile for the app; Xcode adds it only during a build for that phone, and Tauri's build never is one, so when no profile holds the phone, one `xcodebuild -allowProvisioningDeviceRegistration` of the project's scheme runs first, with Xcode signed in to the team (Xcode, Settings, Accounts). Then it builds signed for development, installs and starts the app. A locked phone installs it but opens nothing, and the command exits 1 with Apple's reason and says to unlock it.
- Every build and Xcode call runs without the terminal's `FORCE_COLOR`, the 1Password token and the App Store Connect key, with Rust's folder first on the path (`tauri/build-env.ts`, the environment the TestFlight upload builds in too): Tauri's Xcode project passes `${FORCE_COLOR}` to its Rust step as a flag, where a terminal's `3` reads as a chip architecture. A project that already has a value written there, by a regeneration outside the kit, is refused before the build, with the line to fix.
- A `<udid>` after `sim` or `phone` picks another Simulator or phone. Ctrl-C stops the build with the command. Each choice prints one line starting `[iphone]`; the exit code is 0 when the app is running, 1 otherwise.

Tauri's own `tauri ios run` opens the Simulator's window and never registers a phone, so the kit does not use it.

An app replaces its script with two lines in its package.json, and deletes `scripts/iphone.sh` and its test:

```json
"iphone": "app-kit iphone run sim",
"iphone:phone": "app-kit iphone run phone"
```

The script's `SIMULATOR=`, `PHONE=` or `ARGON_PHONE=` becomes the udid argument, `bun run iphone <udid>`. An app that sets something before the build keeps a short script that ends with `exec bun run app-kit iphone run sim "$@"`, as Argon does for its page's address from its dev server (Tauri passes only `TAURI_`-prefixed variables into the Xcode step). The Simulator the old script made, such as `argon`, is no longer used; `xcrun simctl delete argon` removes it.

#### Testing the iPhone app yourself

For an agent, with any version of the kit: run the real app on a Simulator, tap it and look at it before asking anyone to try something. None of this puts a window on the screen or plays a sound.

0. **Check whether the Simulator is needed at all.** A booted Simulator costs the Mac hundreds of processes, and at most two run at once, so a check that a browser can make goes to the app's own Playwright tests at phone size instead. For an app that is a window onto its hosted site, the page is the app, and a phone-sized browser test checks: the layout at iPhone width and height; what each tap on the page does; slides, swipes and pull to refresh's page side, through the kit's `finger` (Chromium only, in `app-kit/web/playwright`); the notch and home-bar safe areas, with Chromium's `Emulation.setSafeAreaInsetsOverride` through `page.context().newCDPSession(page)`; fields large enough that iOS never zooms on them, as their computed font size; text and colors; sign-in through the stand-in; and the page's calls to the shell, its half of notifications and of sign-in, through `app-kit/tauri/playwright`. What only iOS draws needs the Simulator: native controls inside the page (the date and time wheels, `<select>` menus, the on-screen keyboard and how the page moves around it), the phone's Text Size, the insets iOS really gives, Apple's sign-in sheet, the notification permission prompt and a notification arriving, the shell opening the right address and sending outside links to Safari, and the app's own log.
1. **Choose the page.** A build loads what was compiled into it, and an app whose page is a hosted site loads the deployed site unless told otherwise, so a page changed on this branch never shows and a pass means nothing. For an app whose shell reads `TAURI_PAGE_ADDRESS`, as in [its shell's code above](#a-window-onto-the-hosted-site), run this checkout's server and page and build with `TAURI_PAGE_ADDRESS=http://localhost:<port> bun run iphone`, using the page's port as this checkout's dev server printed it, since a worktree's differs from the one the app declares. Check that address with `curl` before the build: Vite on its default settings answers on `localhost` and refuses `127.0.0.1`, and an address that does not answer still builds and exits 0, with a blank app. An app with another variable or a script of its own says so in its README. An app that bundles its page (`frontendDist` a folder) needs none of this.
2. **Get past sign-in.** Signed-in screens need no real account: run the local server and page with the app's test sign-in, the kit's stand-in or the app's own bypass settings, which its README names. Only what a person's own account alone shows needs that person.
3. **Run it.** `bun run iphone` builds the app, starts it on this checkout's own Simulator and prints its udid and the time it shuts down, 10 minutes on. Drive only that one: other threads have their own running. A check that needs longer runs `app-kit iphone-simulator keep <udid>` before the time comes; a Simulator past its time is gone, and the next `bun run iphone` brings it back after a build that has little left to do.
4. **Look.** `xcrun simctl io <udid> screenshot <file.png> && sips --resampleWidth <width> <file.png>`, then read the file. `<width>` is the screen's width in points: 402 on the iPhone 17 the kit makes, otherwise the first `frame` in `axe describe-ui --udid <udid>`. A pixel of the shrunk picture is then one tap point, so a position read off it is the position to tap, whatever size the agent's image reader shows the full one at. Leave the shrink off to read small detail.
5. **Tap.** `axe tap --udid <udid> -x <x> -y <y> --post-delay 1.5`, or `axe swipe --udid <udid> --start-x <x> --start-y <y> --end-x <x> --end-y <y> --post-delay 1.5`, or `axe type '<text>' --udid <udid>` and `axe key 40 --udid <udid>` for Return, which take no delay. Exit 0 means the tap was sent, not that it landed: on iOS 27 a tap with no delay can be dropped with no error. Keep the delay and look after every step, which also catches what iOS puts in the way: on a new Simulator, the first tap in a text box raises a sheet about sliding to type, with a Continue button. `axe type` acts as a hardware keyboard, so the on-screen keyboard drops away and positions read before it move; to see that keyboard, tap the box and do not type. A swipe down at the top of a page in an installed app is a pull to refresh, which reloads it.
6. **Read what is at a position.** `axe describe-ui --point <x>,<y> --udid <udid>` reads the page: the text is in `AXLabel` or `AXValue`, with the exact frame in points, and it answers for whatever is on top there. `axe describe-ui` with no point and `axe tap --label` see only native pieces, such as a menu the page opens; the page itself is not in that tree.
7. **Shut it down** as soon as the check is done, without waiting for its time: `xcrun simctl shutdown <udid>`, the checkout's own Simulator only. That frees its place for another thread at once.

`axe` installs with `brew install cameroncooke/axe/axe`. The Simulator also takes `xcrun simctl push <udid> <bundle id> <payload.json>` for a notification and `xcrun simctl addmedia <udid> <file>` for a photo, and the app's data, its log included, is under `xcrun simctl get_app_container <udid> <bundle id> data`.

A Simulator is not a phone. What only a phone shows, and is worth asking a person to try once all the above has passed: how the app feels and how fast it runs, the sensors, Apple's real push service, and the one-tap hand-back of [Sign-in with one tap](#sign-in-with-one-tap), which never works on a Simulator.

### A silent iPhone Simulator

`app-kit iphone-simulator quiet <udid>`: a simulator booted with `xcrun simctl boot`, with no window, plays its notification tones and keyboard clicks on the Mac's speakers, and Apple gives no command to mute it; silent mode still plays the notification tone at full volume. The step sends the simulator's sound to BlackHole, a free virtual audio device that plays nowhere, the same setting as Xcode's Sound Output menu. The simulator reads that setting only at boot, so when a booted simulator's sound goes anywhere else the step shuts it down, saves BlackHole in its audio settings file and boots it again, once; a later run finds it silent and touches nothing. On a simulator that is shut down, the step only saves the setting, so its next boot already plays nowhere, with no boot of its own.

`app-kit iphone run sim` runs it before the boot. An app's own simulator script runs it after the boot and before the install:

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

An app's Playwright browsers are kept silent another way, since BlackHole for them would mean the whole Mac's output: see Sound in browser tests, under web/.

It prints one line starting `[iphone-simulator]` and exits 0 whatever it finds, so a Mac without BlackHole still runs the app, with a line saying how to install it (`brew install --cask blackhole-2ch`, then `sudo killall coreaudiod` so macOS's audio service sees it). It exits 1 only when the simulator did not boot again after its own restart, since the device is then down. When the setting is saved but the simulator still plays elsewhere, it says so and does not restart again.

### TestFlight

`app-kit testflight upload` and `app-kit testflight watch`: an iPhone build reaches TestFlight after each landing that changes the iPhone app, and again before the newest build expires, with nobody running anything. The upload builds the commit checked out, checks the build, uploads it and waits until App Store Connect has processed it. The watcher, run by a background job on a Mac every five minutes, notices when an app's main has moved and runs the app's own upload in a clone of its own.

The upload, from the app's checkout, or from the folder holding its Tauri project when that is a subfolder of the repository:

```sh
bun run app-kit testflight upload
```

It uploads only a commit on `origin/main`'s first-parent line, from a clean tree, since the build number is the commit count (`git rev-list --count HEAD`) and a branch's number above main's would make Apple refuse every lower one. It puts Rust's own folder first on `PATH`, builds with `bunx tauri ios build --ci --export-method app-store-connect` and the build number as `bundleVersion`, signed with the team's distribution certificate from 1Password and the app's App Store provisioning profile from App Store Connect, so no Apple account need be signed in to Xcode, with Apple's `rsync` ahead of Homebrew's, and puts back only the values Tauri wrote into `src-tauri/gen/apple/ExportOptions.plist` and `src-tauri/gen/apple/<app>_iOS/Info.plist`. Before building, it refuses an app whose App Store icon, the 1024 entry of `src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset` (dark and tinted entries aside), is missing or has a pixel that is not fully opaque, which Apple would refuse only after the whole build, and names `app-kit icons render` as the fix. It refuses an `.ipa` whose `CFBundleVersion` is not the build number or whose `Info.plist` does not say `ITSAppUsesNonExemptEncryption` false, and, with push, one not signed for production. It reads the App Store Connect key from 1Password once, writes it to a temporary folder for altool that is removed however the upload ends, and polls App Store Connect for up to 30 minutes until the build is processed, then prints its TestFlight state. A number App Store Connect already holds counts as uploaded. Stopped by a signal, as the watcher's time limit stops it, it stops the programs it started, removes the key's folder and puts the plists back. Every line starts `[testflight]`; it exits 3 when the app did not compile and 1 for any other failure. The comment at the top of `tauri/testflight/upload.ts` says what each step works around.

The watcher, one pass, for each app's git address:

```sh
bun bin/app-kit.ts testflight watch https://github.com/worktron/argon-watcher.git https://github.com/worktron/timescale.git
```

An app whose Tauri project is in a subfolder of its repository, with that folder's own `package.json` and `bun.lock`, names the folder after a `#` on its address, as Timescale names `desktop/`:

```sh
bun bin/app-kit.ts testflight watch https://github.com/worktron/timescale.git#desktop
```

The install, the build and the upload then run in that folder, its `src-tauri/target` is kept, its `src-tauri/tauri.conf.json` is the one read, and only files under it count as the app's. GitHub's repository names hold no `#`, and the folder may hold only letters, digits, `.`, `_`, `-` and `/`, since it reaches `git clean` as a pattern; any other entry, or a folder main does not have, is a failed pass for that app with a line naming it. A repository is watched at one folder: a second entry for it is refused the same way, since both would share one clone and one record. A folder that is one of the root's bun workspaces is not handled: its packages land in the root's `node_modules`.

A background job runs it from a copy of the kit at a release tag, with SSH addresses; fetches never prompt. For each app it fetches main into its own clone under `$XDG_STATE_HOME/app-kit/testflight/<app>/` (`~/.local/state/app-kit/testflight/<app>/` by default), and when main's head is the one it judged last it does nothing and writes nothing. Otherwise it checks out main's commit, removes everything not committed but `node_modules` and the Tauri project's `src-tauri/target`, runs `bun install --frozen-lockfile`, reads the key, and asks App Store Connect for the app's builds. Its newest build, by number, decides: the changes from that build's commit to main's head are judged together, so two landings between passes count as one, and an app change followed by a documentation-only landing still uploads. Which files count follows from the app's Tauri setup: when `frontendDist` in `src-tauri/tauri.conf.json` is an address, the iPhone app is only `src-tauri/`, `package.json` and `bun.lock`, since the website reaches phones when it deploys; otherwise it is every file but `*.md`, `.claude/`, `docs/`, `*.test.*`, `test/`, `tests/` and `e2e/`.

TestFlight builds expire 90 days after their upload, and testers then see "Beta Has Expired", so an app whose iPhone shell rarely changes would stop opening. From 15 days before the day App Store Connect gives as the newest build's `expirationDate`, and after it, main's head goes up with no app file changed, once main has moved past that build; the build number is main's commit count, so until main moves the watcher writes one line saying the build expires and the next landing uploads a fresh one. An unmoved main is judged again once, on the day the newest build enters its last 15 days, so the key is read only then. A build App Store Connect gives no expiry date is never renewed, and neither is one expired early, by hand or by Apple, before its date. An upload runs the app's own `bun run app-kit testflight upload --token-only` at background priority, keeping the Mac awake while it runs, so each app's pinned kit decides how it is built. Each step has a time limit: the fetch 2 minutes, the install 10, the build 60, the upload and processing 45. A build that did not compile is held until main moves; any other failure, a failed link included, is tried again after an hour. A pass in which a step failed for any app exits 1. A watcher stopped mid-pass, as launchd stops its job, stops the upload it started.

Every decision is one line in `~/.local/state/app-kit/testflight/testflight.log`, with its reason:

```
2026-10-25T14:00:03.000Z urge-surfer: uploading build 130 (1a2b3c4): app files changed since build 128 (src/coast.tsx)
2026-10-25T14:09:41.000Z urge-surfer: uploaded build 130 (1a2b3c4), processed
2026-10-25T15:20:02.000Z urge-surfer: skipped: no app files changed since build 130
2026-10-25T15:20:04.000Z argon-watcher: waiting: main's app-kit has no testflight upload
2026-12-30T09:05:01.000Z argon-watcher: uploading build 212 (5e6f7a8): build 209 expires on 2027-01-12
```

Each build's output is in `<app>/build-<n>.log`, with the try before it in `build-<n>.log.1`, for the ten newest builds, and `<app>/record.json` holds the main commit judged last, the last failure, and when an unmoved main is judged again for the newest build's expiry. An app whose newest TestFlight build names no commit on main, such as one uploaded from a branch, gets one upload to settle it; one whose newest build is above main's count is skipped until main passes it.

Once per Apple team, by its Account Holder:

1. An App Store Connect API team key: App Store Connect, Users and Access, Integrations, App Store Connect API, Team Keys, role App Manager. The `.p8` file downloads once. Keep it in 1Password as the item "App Store Connect API" with the fields "key id", "issuer id" and "private key" (the file's text). One key serves every app on the team.
2. The distribution certificate, below.
3. Rust's release tools: `rustup component add llvm-tools` and `rustup target add aarch64-apple-ios`. Without llvm-tools, Xcode 27's release build hides the Swift entry points of Tauri and its plugins and the link fails; a release build made before installing it needs `src-tauri/target/aarch64-apple-ios/release` removed.

Once per app:

1. The app record: App Store Connect, Apps, +, New App. The API cannot make one, and altool fails with "Unable to find Apple ID for Bundle ID" until it exists.
2. `src-tauri/Info.ios.plist` saying `ITSAppUsesNonExemptEncryption` false, or App Store Connect asks the export question of every build; and `CFBundleIconName` `AppIcon` when `Info.plist` names a Mac icon.
3. A TestFlight tester group with access to every build, or a processed build reaches nobody. The API can make one with the same key (`POST /v1/betaGroups` with `isInternalGroup` and `hasAccessToAllBuilds` true) and add testers (`POST /v1/betaTesters`); `POST /v1/betaTesterInvitations` sends the invitation. An invitation that never arrives may be a mail filter on `email.apple.com`.
4. iPhone icons with no alpha channel. App Store Connect refuses an App Store icon with a pixel that is not fully opaque ("Invalid large app icon", 90717), and `bunx tauri icon` writes every iPhone icon with an alpha channel, some with edges a shade see-through. Draw them with `app-kit icons render --icon-set src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset` (icons/, below), which draws them with none, and commit them. The upload reads the App Store icon's pixels before it builds and refuses one with any see-through pixel; an alpha channel whose pixels are all opaque goes up.

The watcher reads the key without Touch ID through a 1Password service account that may read only the key's vault, whose token is kept in the Mac's login keychain. Once, by the 1Password account's owner:

1. In 1Password on the web: Developer, Service Accounts.
2. Create a vault named "TestFlight", and move the item "App Store Connect API" into it.
3. Create a service account named "TestFlight upload" with read access to the vault "TestFlight" only, and copy its token.
4. In Terminal on the Mac that runs the watcher, paste the token at this command's prompt:

   ```sh
   security add-generic-password -a "$USER" -s "app-kit testflight" -w
   ```

The token is handed only to the `op` call, never to the build's programs. Until it is in the keychain, the watcher logs "waiting for the 1Password token" each hour and uploads nothing; an upload run by hand without it uses the signed-in `op`, which asks for Touch ID.

#### The distribution certificate

The upload signs with the team's Apple Distribution certificate, kept in 1Password as the item "TestFlight distribution certificate" in the vault "TestFlight", with the fields "certificate" (the `.p12` file, base64) and "password" (the `.p12`'s password). A team has one distribution certificate, and Apple gives it a year. The upload matches it to Apple's record by its serial number and refuses to build once Apple says it has expired, or lists it no more, naming this section. Make it, and make it again when that happens, in a folder only you can read outside any checkout, with macOS's own `/usr/bin/openssl` (Homebrew's, often first on `PATH`, writes a `.p12` older Tauri cannot import):

1. `umask 077`, then `/usr/bin/openssl genrsa -out key.pem 2048` and `/usr/bin/openssl req -new -key key.pem -out request.csr -subj "/CN=TestFlight distribution/C=US"`.
2. Ask Apple for the certificate with the team key: `POST /v1/certificates` with `certificateType` `DISTRIBUTION` and the request's text as `csrContent`, and write the answer's `certificateContent` (base64) out as `certificate.cer`. An App Manager team key made it in November 2026; Apple's pages say only the Account Holder or an Admin may, so when the API refuses, the Account Holder uploads `request.csr` on Apple's developer site (Certificates, Identifiers & Profiles, Certificates, +, Apple Distribution) and downloads `certificate.cer`. Put the private key in 1Password before anything waits on a person, so it never sits in a file.
3. `/usr/bin/openssl x509 -inform DER -in certificate.cer -out certificate.pem`, a password from `/usr/bin/openssl rand -hex 24`, and `/usr/bin/openssl pkcs12 -export -inkey key.pem -in certificate.pem -name "Apple Distribution" -out certificate.p12` with it.
4. Keep the `.p12` in base64 and its password in the item's two fields, editing the item when it exists rather than making a second, then remove the folder.

Never revoke the certificate while builds are in testing: Apple says builds uploaded but not yet submitted for review may then be marked invalid. Its expiry does not affect apps already on the App Store.

Each upload fetches the app's active App Store profile for that certificate from App Store Connect, writes it into Xcode's profile folder by its uuid, and makes it when the app has none. Where Apple refuses the key making it, the upload says so and names the bundle id: make it once on the developer site (Profiles, +, App Store Connect, the app's bundle id, the certificate), and again after each new certificate. Tauri's way of signing with a given certificate leaves things behind that the upload puts back: a keychain of its own holding the private key, which is deleted, a copy of the profile, which is removed, and the signing settings in the committed Xcode project, which is put back when nothing else in it changed. One signing build runs on a Mac at a time; a second is refused while the first holds the lock. The upload needs Tauri CLI 2.12.1 or later, since earlier ones put the profile setting outside the iPhone target. `tauri/testflight/signing.ts` says the details.

## swift/: Mac apps built in Swift

What a Mac app written in Swift takes from the kit: the menu bar theme, with a window's pieces in the plain look, and the Mac app package, what every Swift Mac app writes for itself. A Swift app builds the kit's Swift files as they are at a tag, from the copy bun installs, or from any copy of the folder at that tag.

### Menu bar theme

A menu bar app's panel, in one of two looks, one per app. The plain look, the default, is for people who never open a terminal: the system typeface on warm paper (#f6f5f2, and #1d1e20 in dark), the app's own accent for its actions, and no boxes, from the Plain Look Studies page's option C. The console look is the look of metamax and the console tools: their colors and JetBrains Mono. Both draw the same pieces at the same sizes: 13 point text, 44 point rows, 3 point corners inside and 8 on the panel, and status said in colored words, never chips; the plain look's lines have 20 point sides, the console look's 14. The pieces are SwiftUI views; they sit in a panel under the menu bar icon that behaves as a menu does. They are the Fleet Menu Studies page's options F and G: F is a list with a page for each item, G lists every problem at once.

An app chooses its look once, at launch, before anything draws, with `Look.app`:

```swift
Look.app = .plain(accent: Accent(light: 0x2f5fa7, dark: 0x8fb0e6))   // the default, here with Beeline's blue
Look.app = .console                                                     // an agent tool's
```

Every panel, side page and snapshot the app draws reads it as it draws. An app on the console look sets it everywhere a screen can be drawn before launch reaches it: at the top of `main.swift`, before any argument handling, so a `--snapshot` command that draws without launching draws in the console look too, and in the set-up of every test or test program that draws a snapshot. An app that took the theme before it had two looks drew in the console look without asking; after upgrading, it draws plain until it sets `.console`.

| Piece | What it draws |
| --- | --- |
| `MenuBarPanel(width:state:content:)` | The panel under the icon: Escape closes it (after its `onEscape`, which a page uses to go back to its list), as does a click anywhere outside it; up and down move through the rows and Return acts; ⌘ with a footer item's key runs that item. It takes the keys without making the app active, so the app in front stays in front, and opens on the Space in front, over a full-screen app too. `attach(to:)` hooks it to a status item: on macOS 27 and later through the item's expanded interface session, as Apple's header asks, and before that, or when the app is built with an older SDK, through the icon's button. It fits its content, and scrolls only when the screen is too short, keeping a line the keys choose in sight, and opens again at the top. A row's side page opens in a second panel beside it, its first line level with the row, on the right or, at the screen's edge, on the left, when the pointer holds on the row, on a click, or on Return or Right, which also select the page's first line; the list never moves, and its row stays lit. Up and down then move within the page, Left or Escape close it and go back to the row, resting on another row swaps it, and a click outside both panels closes everything. The side panel never takes the keys, so the app in front stays in front. `onOpen` runs as a closed panel opens, before it is sized and shown, so what it changes draws in the first frame: the place to read what SwiftUI cannot observe, and to hold a list still while the panel is open. |
| `Header(_:status:note:back:)` | The 40 point top line: a back mark when `back` is given (then the whole line goes back), the title in bold on one line, cut in the middle when it is too long so a path keeps its start and its end, its status in words, and a note on the right in muted, such as how old the status is, which the title gives way to. |
| `Row(_:status:age:id:action:)` | The 44 point row: the name in a 92 point column, its status in words, cut short with an ellipsis, its age, and `›` on the right, as a menu's submenu arrow says a click opens something; selected, the `›` brightens. A click anywhere on it acts. `Row(_:trailing:opens:id:action:)` is the same row without a name: its words run across it, such as a link, with a trailing text in secondary on the right, such as the account it opens in; `opens: false` leaves the `›` off a row whose click acts in place rather than opening a page. Either row takes a `page:` in place of its action, `Row(_:status:age:id:page:)` and `Row(_:trailing:id:page:)`, passed by its label: its side page, which opens beside the list as a menu's submenu does. |
| `SubLine(_:)` | A line of detail under a header, in secondary. |
| `ProblemBlock(_:hint:copy:)` | A problem on a page: its title in red, what to do in secondary, and the exact command or line in a `CodeBox`. |
| `CodeBox(_:id:)` | The thing to copy, wrapped to show all of it, with "copy" in blue that turns to "copied" in green once it is on the pasteboard. A click anywhere on the box copies. |
| `ItemGroup(_:age:items:)`, `ItemLine(_:copy:id:)` | G's group: a 36 point heading with the age, and a 26 point line for each problem in red, with "copy" on the right, or "by hand" in muted when there is nothing to copy. |
| `GroupLine(_:status:age:)` | A group with nothing under it, such as a Mac that is fine. |
| `Footer(_:trailing:)`, `FooterItem(_:key:action:)` | The 36 point last line: its actions with their ⌘ keys, the last ones (Quit) on the right. The arrow keys reach them after the lines above, as a menu's last items. A menu bar app's are Settings… (⌘,), Check for Updates…, About and Quit (⌘Q), as practices' desktop app rule lists. |
| `Words`, `Tone` | Status in colored words: `Words("has never reported", .error).then("+1", .muted)`. |
| `Look`, `Accent` | The app's look, `Look.app`: `.plain(accent:)`, the default, with the app's accent as a light and a dark sRGB value, Beeline's blue unless given, or `.console`. |
| `Palette`, `Metrics`, `Typeface` | The tokens: the twelve colors metamax's web client and the console tools share, and `hover`, the selected line's fill, each with its console dark value, its `light` one and its `plain(accent:)` pair, `hex(for:in:)` giving the one a look and appearance draw; the heights and sizes, with `Metrics.inset` the look's sides; and the faces: the system font in plain, its monospaced face for a command in a `CodeBox`, and in console the bundled JetBrains Mono 2.304 (Regular, SemiBold and Bold, under the SIL Open Font License in `Fonts/OFL.txt`). |
| `snapshot(width:scale:appearance:look:state:content:)` | Any screen drawn to a PNG with nothing on the screen, through the same hosting view the panel uses, for an app's headless checks. With `state.openSide(_:)` called on a row's id, it draws that row's side page beside the panel, as the side panel shows it. It draws in the dark appearance unless `appearance` is `NSAppearance(named: .aqua)`, never in the machine's own setting, so a render is the same at any hour, and in `Look.app` unless `look` is given, which it sets for the draw and puts back after. In the console look it throws when the bundled font is not loaded, rather than draw in another. A `PanelState` given to it shows a row as selected or a box as copied. |

Each line the arrow keys stop on has an id, unique in its panel and its side pages together: a row's is its name (a row without one is given its `id:`), an item line's its group, text and command, a code box's its block's title and text, a footer item's its label, and `id:` sets one where those could repeat.

Each look has a dark appearance and a light one, and the panel draws in the app's appearance: the Mac's Light or Dark setting unless the app pins one, switching while it is open when the setting changes. In the plain look, every word in a tone but muted reads at 4.5 to 1 or better on the panel and a selected line, in light and in dark; the info tone, "copy" among it, is the app's accent as given, so an app's own accent has to read at 4.5 to 1 itself on #f6f5f2 and #ecebe6 in light and on #1d1e20 and #2a2c2f in dark, as the default blue does. In the console look's light, every word in a tone but muted reads at 4.5 to 1 or better on the panel, a code box and a selected line; muted, the faint ages, counts, notes and ⌘ keys, is as faint as it is in dark, on purpose. An app that wants the dark appearance always pins it, as any Mac app does: `NSApp.appearance = NSAppearance(named: .darkAqua)`.

Hover follows the pointer as a menu's highlight does, once the pointer has moved: after the panel opens or a key is pressed, the pointer's next position is where it rests, and once it has travelled 16 points from there, a line lights as the pointer enters it and goes dark as it leaves. A still pointer, a bump under 16 points, and a list scrolled by the keys under a still pointer light nothing, so the keys' choice stands. A row's side page waits for the pointer to hold on the row within 6 points for 100ms, so crossing other rows on the way into an open page leaves it open. The selected line, whether the keys or the pointer chose it, fills in `hover`. A click always acts at once. `PointerIntent` holds the rule, the same one as the web's `HoverIntent`, whose numbers it is held to.

An app takes it in in three steps. First the kit, at a release tag:

```sh
bun add github:worktron/app-kit#v0.41.0
```

Then the build. An Xcode project or a Swift package adds `node_modules/app-kit/swift/menu-bar` as a local package (in Xcode, Add Package Dependencies, then Add Local; in a Package.swift, `.package(path: "node_modules/app-kit/swift/menu-bar")`) and depends on its `MenuBarTheme` product, whose fonts come with it. A bare `swiftc` build compiles the theme into a module of its own first, so its names never meet the app's (Fleet has a `Row` of its own), and copies the fonts into the app's resources:

```sh
kit=node_modules/app-kit/swift/menu-bar
swiftc -parse-as-library -emit-library -static -emit-module -module-name MenuBarTheme \
  -emit-module-path build/MenuBarTheme.swiftmodule -o build/libMenuBarTheme.a "$kit"/Sources/MenuBarTheme/*.swift
swiftc -I build -L build -lMenuBarTheme Sources/*.swift -o My.app/Contents/MacOS/My
cp -R "$kit/Sources/MenuBarTheme/Fonts" My.app/Contents/Resources/
```

A build that decides whether to rebuild from a hash of its sources, as Fleet's does, puts the kit's version in that hash too. Last, the app's Info.plist sets `LSUIElement` to true, so the app has no Dock icon. The theme runs on macOS 14 and later. It builds with the macOS 26 SDKs too, which have no status item session: the session is compiled only when AppKit is the macOS 27 SDK's (`canImport(AppKit, _version: 2700)`), and the gates build it against the newest macOS 26 SDK the Command Line Tools keep.

```swift
import AppKit
import MenuBarTheme
import SwiftUI

struct Menu: View {
    let model: Fleet   // the app's own @Observable model
    var body: some View {
        if let mac = model.page {
            Header(mac.name, status: Words("\(mac.problems.count) problems", .error), note: mac.age) { model.page = nil }
            ForEach(mac.problems) { ProblemBlock($0.title, hint: $0.hint, copy: $0.copy) }
        } else {
            Header("fleet", status: model.summary, note: model.readAt)
            ForEach(model.macs) { mac in Row(mac.name, status: mac.worst, age: mac.age) { model.page = mac } }
        }
        Footer([FooterItem("settings", key: ",") { openSettings() }, FooterItem("about") { openAbout() }],
               trailing: [FooterItem("quit", key: "q") { NSApp.terminate(nil) }])
    }
}

if !Typeface.register() { log("menu bar font: \(Typeface.problem ?? "unknown")") }
let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
item.button?.image = NSImage(named: "MenuBarIcon")
let panel = MenuBarPanel(width: 400) { Menu(model: model) }
panel.onOpen = { model.reload() }   // what the app reads from disk, drawn in the first frame
panel.onEscape = {
    guard model.page != nil else { return false }
    model.page = nil
    return true
}
panel.attach(to: item)
```

`swift/menu-bar/e2e/compare-mockups.ts` checks the theme against the Studies page: a headless Chromium draws the five screens of `e2e/mockups.html` (the page's own CSS and markup, with stand-in names, since this repository is public), the theme draws the same five in the console look, whose mockups they are, and each is held to the mockup's size, backgrounds, lines and the place and color of every run of text, within 2 points. It writes the pairs side by side to `test-results/menu-bar/side-by-side`. It is run by hand after a change to the look, not by the gates, since it holds one text engine's letters to another's. The gates run the theme's Swift tests (`swift test` in `swift/menu-bar`) and build it the bare `swiftc` way (`e2e/swiftc-build.sh`), against the current SDK and again against the newest macOS 26 SDK the Command Line Tools keep, at the theme's macOS 14 floor, as a Mac not yet on macOS 27 builds it. That second build uses the current Swift compiler with the older SDK, so it catches an API only the new SDK declares, not a language feature only the new compiler has. What no test reaches is a real click on a real menu bar icon: the session's start and end call the same open and close the tests drive.

### Windows in the plain look

The same package draws a Mac window in the plain look, as the Plain Look Studies page's option C draws Beeline's setup window and Settings: a page on the paper with no boxes or grouped forms, sections under a muted label, rows between hairlines, status in colored words, actions as words in the accent, and the kit's own controls instead of macOS's. They read `Look.app` for their colors, as the panel does, and `PlainMetrics` for their sizes: 24 point sides, 24 between sections, 8 from a label to what it labels, rows of 48 at least.

```swift
WindowPage {
    SectionLabel("Starting", first: true)
    Lines {
        WindowRow("Open Beeline when you log in", detail: "Starts at login. Turn off to start it yourself.") {
            Switch("Open Beeline when you log in", isOn: $settings.opensAtLogin)
        }
        WindowRow("Open them in") { TextMenu(selection: $settings.profile, options: profiles.map { (value: $0.id, name: $0.name) }) }
        WindowRow("Test a link") { HairlineField("A link", text: $link) } trailing: { ActionWord("Test") { test(link) } }
    }
    SectionLabel("Chrome profiles")
    Lines {
        ForEach(profiles) { WindowRow($0.name, detail: $0.email, strong: true) { StatusWord("Connected", .ok) } }
    }
    FootNote("Each profile lists the sites Beeline saw it signed in to.")
    BuildLine("Beeline \(version), \(commit)")
}
```

| Piece | What it draws |
| --- | --- |
| `WindowPage(content:)` | The window's content on the paper, 24 points in from each side, 20 above and 24 below. |
| `PageTitle(_:subtitle:)` | A page's title at 17 in semibold, and what the page is for under it in secondary. |
| `SectionLabel(_:first:)` | A section's label, 12 at semibold in muted, 24 below what is above it and 8 above what it labels; the page's `first` sits 4 from the top. |
| `Lines(content:)`, `WindowRow(_:detail:strong:below:trailing:)` | Rows between hairlines: the name (in semibold when `strong`, for a thing's name rather than a setting's), a detail in secondary, what goes under them (a field), and on the right a status word, an action, a switch or a menu. |
| `StatusWord(_:_:)` | A status in a colored word, in a `Tone`. |
| `ActionWord(_:main:removes:action:)` | An action as a word in the accent, `main` in semibold for the page's main one, `removes` in the error color, which means removal and failure only. |
| `ActionBar(leading:trailing:)`, `FootNote(_:)`, `BuildLine(_:)` | The page's foot: what is said there and its main action; a line of explanation in secondary; and the build, as About shows it. |
| `Switch(_:isOn:)`, `SwitchStyle`, `.lookSwitch` | The switch, 28 by 16: a muted outline and knob when off, the accent with a paper knob when on. A `ToggleStyle`, so any `Toggle` can take it; the label is what VoiceOver reads, since the row says what it sets. |
| `TextMenu(selection:options:)` | A choice among a few that reads as text: the chosen name and a chevron over a hairline, opening a menu on a click. SwiftUI takes no custom picker style, so it is a view of its own. |
| `HairlineField(_:text:)` | A text field in a hairline box with 4 point corners, its text at 12. SwiftUI takes no custom text field style, so it is a view of its own. |
| `windowSnapshot(width:scale:appearance:look:content:)` | A window's page drawn to a PNG with nothing on the screen, as tall as it lays out, in the appearance and look given, as `snapshot` does for the panel. |

`menu-bar-snapshots render` draws the Studies page's three window screens after the panel's (`window-setup`, `window-profiles`, `window-general`). `test/look-swift.test.ts` reads `Tokens.swift` and `Look.swift` and holds every color and size to the tokens file, `look/index.ts`, so the Swift side cannot drift from the web's and the extension's.

### Mac app

What every Swift Mac app writes for itself, as practices' desktop app rule lists it: its log, launch at login, the Dock icon while a window is open, the native messaging host when the app is its own, the build it runs for About, work on a clock that catches up after the Mac wakes, and running another program with a time limit. It is one Swift package, `swift/mac-app`, with one module, `MacApp`, and no part of it depends on the menu bar theme. Each piece takes the app's names (its folder, its host, its extensions, its Info.plist key) as inputs, and what it touches on the Mac (the login item, the Dock, Chrome's folder, macOS's notification centers) has a default the app uses and a stand-in its tests pass.

| Piece | What it does |
| --- | --- |
| `AppLog(file:limit:)` | The app's log: `note("step", "detail", …)` writes the time in UTC to the millisecond, then its fields, tab-separated, tabs and line breaks in a field turned into spaces. Past `limit` (1 MiB) the file is cut to its newest half at a line start and renamed into place. The app and its native host may write the same file: each line goes in under a lock, and a writer whose file another trimmed away while it waited opens it again, so no line is lost. `tail(n)` gives the newest lines, for an app's `log` command. `AppLog.link(_:keepPath:)` writes a link without its query, fragment or credentials, and without its path for one that carries a token. `AppLog.applicationSupport("My App")` is the folder in Application Support. |
| `LaunchAtLogin(item:log:)`, `LaunchAtLoginToggle(_:launch:)` | Opening at login, through macOS's own login item (`SMAppService.mainApp`), which System Settings lists and lets the person turn off: `isEnabled` reads it from macOS each time, and `set(_:)` answers what macOS has afterwards, so a refusal leaves the switch where macOS left it, with the reason in the log. `startIfAsked()` turns it on when the app was started with `--start-at-login` and prints `start at login: <status>`, the line an installer waits for. The toggle is the switch for Settings. An app whose launch agent restarts it after an update, as Fleet's does, keeps its agent instead. |
| `DockIcon.follow()`, `AppWindows.show(log:open:)`, `AppWindows.openSettingsScene(log:)` | No Dock icon, except while one of the app's windows is open: `follow` sets the app regular each time a window becomes key and accessory when the last one closes, whatever made the window, and panels never count. `show` brings a window to the front from the menu bar: it gives the app its icon, asks macOS to bring it forward, runs the app's opener, and on the next turn of the run loop brings the window forward and asks again, because since macOS 14 activating is only a request; it logs when the app still was not in front. `openSettingsScene` opens SwiftUI's Settings scene through the app menu's Settings… item (⌘,), since SwiftUI's `openSettings` does nothing from a menu bar panel, and logs when the item is missing. |
| `NativeHost(name:description:extensionIDs:)` | The app as Chrome's native messaging host for its extensions: `install(executable:in:)` writes the manifest into `NativeHost.chromeHostsFolder()`, renamed into place and only when it changed, naming the running executable; `NativeHost.claims(executable:installed:testFolder:)` says whether this build should, so a Debug build never takes Chrome's host from the installed copy in Applications; `allows(origin:)` checks the extension Chrome started the host for (its first argument); `frame` and `readMessage` are Chrome's framing; `NativeHost.extensionID(key:)` is an extension's ID from the `key` in its manifest. A command line tool's host is the extension kit's, `app-kit/extension/host`. |
| `AppBuild(commitKey:)` | The running build: its version, and the commit the installer stamped into Info.plist under the app's key, or "development build" for one nothing stamped. `description` is "1.2.0, 683f92e"; `showAbout()` is the standard About panel with both. |
| `Refresh(every:afterWake:work:)` | Work on a clock, such as a poll: it runs every `every` seconds and `afterWake` seconds after each wake, on NSWorkspace's notification center, the only one macOS posts the wake on. It does not run at once. Keep it for as long as the app runs; `stop()` ends it. |
| `Program.run(_:arguments:directory:environment:limit:)` | Another program run to its end, at most `limit` seconds, off the main thread, synchronously or with `await`: it gives back the exit code or signal, the output and error output, and whether the limit stopped it. The program runs in a process group of its own, which the limit stops whole (SIGTERM, then SIGKILL a second later), so a script's children end with it; it inherits nothing of the app's but input from /dev/null and its two outputs, which are read at once. An app started from Finder has launchd's short PATH: `Program.searchPath(adding: Program.toolFolders())` puts bun's and Homebrew's folders in front. |

An app takes it in as it takes the theme: the kit at a release tag, then `node_modules/app-kit/swift/mac-app` as a local package (in Xcode, Add Package Dependencies, then Add Local; in a Package.swift, `.package(path: "node_modules/app-kit/swift/mac-app")`) with a dependency on its `MacApp` product, or, in a bare `swiftc` build, a module of its own, so its names never meet the app's:

```sh
kit=node_modules/app-kit/swift/mac-app
swiftc -parse-as-library -emit-library -static -emit-module -module-name MacApp \
  -emit-module-path build/MacApp.swiftmodule -o build/libMacApp.a "$kit"/Sources/MacApp/*.swift
swiftc -I build -L build -lMacApp Sources/*.swift -o My.app/Contents/MacOS/My
```

The installer stamps the commit as the build's Info.plist key (`<key>MyCommit</key><string>$(MY_COMMIT)</string>`, with `MY_COMMIT="$(git rev-parse --short HEAD)"`, and " with uncommitted changes" after it when `git diff --quiet HEAD` fails), and names the log's file in the app's AGENTS.md. A menu bar app's delegate then reads:

```swift
import AppKit
import MacApp

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let log = AppLog(file: AppLog.applicationSupport("My App").appendingPathComponent("events.log"))
    let build = AppBuild(commitKey: "MyCommit")
    let model = Model()   // the app's own
    var dock: DockIcon.Following?
    var refresh: Refresh?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let launch = LaunchAtLogin(log: log)
        launch.startIfAsked()
        log.note("started", build.description, "launch at login \(launch.statusWords)")
        dock = DockIcon.follow()
        model.read()
        refresh = Refresh(every: 300, afterWake: 5) { [weak self] in self?.model.read() }
    }

    /// Opening the app again (Spotlight, Finder, the Dock) opens Settings: the menu bar icon is the only other way in.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        log.note("reopen", "opened Settings")
        AppWindows.openSettingsScene(log: log)
        return false
    }
}
```

and a status read in the model is `let outcome = try await Program.run(bun, arguments: ["bin/status.ts", "--json"], directory: checkout, limit: 30)`, with `outcome.timedOut` written to the log when the limit stopped it.

The gates run the package's Swift tests (`swift test` in `swift/mac-app`) and its bare `swiftc` build (`e2e/swiftc-build.sh`), in Swift 5 mode and against the newest macOS 26 SDK at the macOS 14 floor, at no warnings. Every test writes only to its own folder in `/tmp/app-kit-tests/<pid>`, and `StaysOffTheMachineTests` fails a test file that reaches the Mac's own login item, Dock, app in front, Chrome folder or notification centers. What no test reaches is macOS itself: a real login item, a real window coming forward, and Chrome starting the host, which each app checks once it takes the package in.

## command-line/: command-line tools

`app-kit/command-line`: what every command-line tool ships from its first version, as practices' command-line rules list it, so each tool answers the same way. The `app-kit` command itself is built on it.

```ts
import { join } from 'node:path';
import { readArguments, versionLine } from 'app-kit/command-line';
import packageJson from '../package.json';

const USAGE = `tool <command>

  sync [--json]     send the notes up; --json prints what changed, as JSON

Exit codes: 0 done; 1 the command failed; 2 wrong usage`;

const args = process.argv.slice(2);
const { values, positionals } = readArguments(args, {
  usage: USAGE,
  version: () => versionLine(packageJson, join(import.meta.dir, '..')),
  options: { json: { type: 'boolean' } },
  allowPositionals: true,
});
```

- **`versionLine(packageJson, folder)`** is `<name> <version> (<commit>)`, `folder` being the tool's own (where its `package.json` is). The commit is that checkout's own when the folder is the top of one; installed from GitHub into an app's `node_modules`, it is the commit the app's `bun.lock` pinned, never the app's own, which git would find by looking upward; with neither it says the commit is unknown.
- **Help and wrong usage.** `readArguments(args, { usage, version, options, allowPositionals })` answers no arguments, `help`, `-h` and `--help` (alone, or `-h` and `--help` after a subcommand) with the usage on stdout, and `--version` alone with the version line, both exiting 0; then reads the rest with `util.parseArgs` in its strict mode, so an unknown flag or a flag missing its value prints what was wrong and the usage on stderr and exits 2, never ignored. A tool that reads its own subcommands calls `answerHelpOrVersion(args, { usage, version })` first and `wrongUsage(usage, reason)` for anything it does not take. The usage lists the exit codes; each means one thing.
- **`useColor(stream, env)`**, `process.stdout` and `process.env` by default: true only when the output goes to a terminal and `NO_COLOR` is unset or empty. `FORCE_COLOR` is not looked at: agents' shells set it, and Bun's own `styleText` then colors output piped to a file.
- **`openInBrowser(url, { offSwitch })`** prints the full address, which a terminal makes clickable, and opens it unless the environment variable `offSwitch` names (`DFRACT_NO_OPEN`) is set, or the code runs under `bun test`, which sets `NODE_ENV` to `test`. A tool's own tests pass `open`, a stand-in, so a mistake can never open a browser on the screen.
- **`warnIfWorktree(folder)`**, for an install command: a tool run from its checkout runs from the main one, which follows main, never a worktree, which goes away when its work lands. It prints the warning on stderr, naming the main checkout to install from, and returns it; `worktreeOf(folder)` gives both folders.
- **`opRead(reference)`** reads an `op://` reference with 1Password's `op read`, with nothing added, under a time limit of a minute that leaves room for Touch ID's prompt. A failure throws with the reference and `op`'s own last line, never the secret, and anything that is not a reference is refused without printing it, since it may be the secret pasted by mistake.
- **`runCommand(command, { cwd, env, input, timeoutMs, output })`** runs another program in a process group of its own, and gives back its exit code, the end of its output and errors together as they came (`out`), and each apart (`stdout`, `stderr`), so a tool that parses a program's output never reads a warning such as `du`'s "Permission denied" as part of it. `output(chunk, stream)` hears each piece as it comes, with `'stdout'` or `'stderr'`, for a tool that shows a long scan's progress line by line. Past `timeoutMs` the whole group is stopped, everything the program started included, which `Bun.spawn`'s own timeout does not do: it signals the program alone. A program that ignores the polite signal is forced to stop five seconds later, and when the program ends, whatever it left running in its group goes with it. `stopRunning(signal)` passes a signal on to every group still running, for a command stopped itself (`STOP_SIGNALS`), and a test stands in for every outside program by passing its own `Run`. The kit's TestFlight, `iphone run` and `icons render` commands run every outside program through it; the Swift Mac app package has the same for a Swift app.

## authentication/: who is calling

A person signed in through a sign-in provider, or an agent with a person's key. Nothing outside `authentication/clerk/` imports Clerk, which `test/clerk-imports.test.ts` holds, so every other part works with another provider.

| Piece | Import | What it does |
| --- | --- | --- |
| Clerk | `app-kit/authentication/clerk` | `clerkSignIn({ publishableKey })`, the first adapter for the web kit's sign-in gate; `signInFromEnvironment(import.meta.env)`, which picks Clerk, the stand-in or nobody from the page's build settings; and `useClerkSession`, the adapter's session inside an app's own ClerkProvider. |
| Clerk for the server | `app-kit/authentication/clerk/server` | `clerkCaller`, which reads a request's caller from Clerk for `requireCaller`; `clerkVerifiedEmails`, which reads a user's verified addresses from Clerk for `ownerCheckByEmail`; and `clerkServerSignIn`, the server check below with Clerk's keys. |
| Sign-in when hosted | `app-kit/authentication/server-sign-in` | `serverSignIn`: a server refuses to start hosted without its sign-in settings, and without any of them on the dev Mac runs open to this machine only. See below. |
| Stand-in | `app-kit/authentication/stand-in` | `standInSignIn()`, a provider with no network for tests of the kit and of apps built on it. |
| Playwright steps | `app-kit/authentication/stand-in/playwright` | `showPage`, `hidePage`, `lockFor`, `serveNewerBuild`, `signInByCode` and `STAND_IN_CODE`, for an app's browser tests. See Browser tests above. |
| Clerk development instance steps | `app-kit/authentication/clerk/playwright` | `throwawayUser`, `signInWithTicket`, `removeThrowawayUsers` and `withClerkBackoff`, for browser tests against a real development instance. See Browser tests above. |
| Clerk for server tests | `app-kit/authentication/clerk/testing` | `fakeClerkApi`, a stand-in for Clerk's Backend API under Clerk's own middleware. See Server tests above. |
| Route check | `app-kit/authentication/agent-keys/testing` | `routesLetThrough`, which says which routes nobody or a key reaches otherwise than `requireCaller` would. See Server tests above. |
| Shared test steps | `app-kit/web/playwright`, `app-kit/tauri/playwright` | Page loads, steady frames, a finger, no new windows, the largest Text Size and a fit check; the Tauri bridge faked for the kit's plugins and desktop sign-in. See Browser tests above. |
| WebKit out of the Dock | `app-kit/web/playwright-webkit` | `webkitWithoutDockIcon`, the launch options that run Playwright's WebKit from a copy macOS keeps out of the Dock. See Browser tests above. |
| Sound in browser tests | `app-kit/web/playwright-offline-audio` | `testWithOfflineAudio`, Playwright's `test` with every context's Web Audio on the browser's offline engine, so no speaker opens, and `offlineAudio`, the step it adds to each context. See Sound in browser tests above. |
| Keys for agents | `app-kit/authentication/agent-keys` | `requireCaller` and `callerOf`: a person's key reads the GET routes the app lists. |
| API reference | `app-kit/authentication/agent-keys/openapi` | The OpenAPI descriptions and reference page that show a key those routes. |
| Owner only | `app-kit/authentication/owner` | `requireOwner` and `ownerCheckByEmail`: a server that serves one person lets only them in. |

### The adapter

A provider is `{ Root, useSession, GoogleReturn }` (`web/sign-in/provider.ts`): its own context around the app; a hook giving whether it has loaded, who is signed in (an id, the address, and the name when it knows one), a token (fresh on demand), Google sign-in to a callback path naming an account or asking for the list, an emailed code sent and checked, a sign-in with a one-time ticket from the app's server, and sign-out that stays on the page; and a component that finishes the return from Google. Another provider is another adapter, and the apps change only which one they pass to the gate.

Clerk-specific, by design: the Clerk adapter starts Google through Clerk's classic sign-in resource, since its newer one takes no account to sign in as. A part of an app that needs more of Clerk than the adapter asks for uses Clerk's own hooks inside the gate, whose provider is Clerk's. An app with its own `ClerkProvider` and no gate reads the adapter's session with `useClerkSession()` inside it. While nobody is signed in, the adapter keeps the place where Clerk's bot check draws its challenge (`<div id="clerk-captcha" />`) after the app, so a sign-up Clerk suspects can still prove it is a person.

**Sign-up by emailed code**, with the gate's `signUp`, goes through Clerk's sign-in-or-sign-up flow: the sign-in is started with `signUpIfMissing`, so an address with or without an account gets a code alike and nobody learns from the first step who has one; a right code for an address with no account then makes the account (`signUp.create({ transfer: true })`) and signs in to it. The instance must take sign-ups (sign-up mode public, not restricted or waitlist), and must need nothing at sign-up beyond the verified email: no password, no required name, no legal consent. Otherwise the account is left unfinished, the person is told "Making your account did not finish", and the server log names the fields Clerk still wants. An instance that takes no new accounts answers with a line saying so. What Clerk answers was recorded against a development instance (`test/fixtures/clerk-sign-up.json`), except the right code's answer for a new address, which comes from Clerk's documentation.

The Clerk instance needs Google on for sign-in and emailed codes as an email sign-in strategy, since the adapter signs in with both. In the settings Clerk's command line tool reads and writes (`clerk config patch`), that is `connection_oauth_google` with `enabled` and `authenticatable` true, and `auth_email` with `used_for_sign_in` true and `email_code` among its `sign_in_strategies`. A production instance copies them from development when it is created as a clone, and Google there also needs the app's own Google OAuth client.

### Sign-in when hosted

`app-kit/authentication/server-sign-in`: a server decides from its environment whether it requires sign-in, and can never come up open where others reach it.

```ts
import { getAuth } from '@clerk/hono';
import { clerkServerSignIn, clerkVerifiedEmails } from 'app-kit/authentication/clerk/server';
import { ownerCheckByEmail, requireOwner } from 'app-kit/authentication/owner';

const port = Number(process.env.PORT ?? 6301);
const signIn = clerkServerSignIn({ env: process.env, also: ['OWNER_EMAIL'], port });
app.use('/api/*', signIn.middleware);
if (signIn.required) {
  const isOwner = ownerCheckByEmail(signIn.values.OWNER_EMAIL, clerkVerifiedEmails({ secretKey: signIn.values.CLERK_SECRET_KEY }));
  app.use('/api/*', requireOwner({ identify: (c) => getAuth(c).userId ?? null, isOwner, appName: 'Getter' }));
} else {
  // Open on this machine: every request is the local owner.
  app.use('/api/*', async (c, next) => {
    c.set('userId', 'local');
    await next();
  });
}
Bun.serve({ hostname: signIn.hostname, port, fetch: app.fetch });
```

- **Every setting set** (`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` and the app's `also`): sign-in is required, the server listens on every interface, and `middleware` is Clerk's. With `APP_ORIGIN` set, Clerk takes only sessions made for that site.
- **None set, on the dev Mac**: the server runs open. It listens on 127.0.0.1 only, and `middleware` answers 403 to a request from any other machine, read from the socket and from the `X-Forwarded-For` a proxy on this machine such as Caddy adds, so a forgotten `hostname` or a local proxy fails closed. Open means none of the settings is in the server's environment. Anything that reaches the open server, a Vite proxy or a test's health check, names `127.0.0.1`, not `localhost`, which can resolve to the IPv6 address first; the log line names the address.
- **Hosted** (any of `RAILWAY_ENVIRONMENT`, `RAILWAY_ENVIRONMENT_NAME`, `RAILWAY_PROJECT_ID`, or `NODE_ENV=production`) **without every setting**, or **only some set anywhere**: it refuses to start, naming each missing setting.

Each decision logs one `[sign-in]` line with its reason. Another provider calls `serverSignIn({ env, settings })` with its own settings and puts its own middleware in front when sign-in is required; nothing in `app-kit/authentication/server-sign-in` imports Clerk.

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

### Starting the server

`app-kit/server/start`: every app's server starts the same way. `appServer({ service })` is a Hono app with five things on it already: the request log, the refusal of writes other websites send, `GET /api/health`, errors answered as JSON, and a JSON 404 under `/api/`. `listen(app, options)` serves it and stops it cleanly. A whole server, with the database, keys for agents and the built page:

```ts
import { clerkMiddleware } from '@clerk/hono';
import { requireCaller, callerOf } from 'app-kit/authentication/agent-keys';
import { clerkCaller } from 'app-kit/authentication/clerk/server';
import { openDb } from 'app-kit/server/postgres';
import { appServer, listen } from 'app-kit/server/start';
import { serveBuiltPage } from 'app-kit/web/server';
import { join } from 'node:path';
import * as schema from './schema';

const db = await openDb(process.env.DATABASE_URL || '.data/db', { schema, migrationsFolder: join(import.meta.dir, '../drizzle') });

const app = appServer({ service: 'argon-watcher' });
app.use('/api/*', clerkMiddleware());
// The page's catch-all, registered as `*`, matches /api/items too, so a key's read lists it (Hono records it as GET /*).
app.use('/api/*', requireCaller({ caller: clerkCaller, readableByKey: ['GET /api/items', 'GET /*'] }));
app.get('/api/items', async (c) => c.json(await listItems(db, callerOf(c).personId)));

const page = serveBuiltPage(join(import.meta.dir, '../dist'));
app.get('*', (c) => page(c.req.raw));

listen(app, { onStop: () => db.close() });
```

and in `railway.json`, so Railway waits for the clean stop instead of killing the server at once:

```json
{ "deploy": { "healthcheckPath": "/api/health", "drainingSeconds": 10 } }
```

- **Writes other websites send.** A page on any site the person has open can send a write to any server, one on this machine included, and a browser's cross-origin rules stop the page reading the answer, never the write. So a request that can change something (any method but GET, HEAD and OPTIONS, and a websocket's opening) is refused `403 { error: 'This server takes no writes sent from another website.' }`, with a log line naming the site, unless the browser says the app's own page sent it (`Sec-Fetch-Site: same-origin`, or `none` for an address typed or an extension's request) or it carries neither `Sec-Fetch-Site` nor `Origin`, as a script, a webhook or curl does: every browser names one on a cross-site write. The body's type is not looked at, so an app's own `cors()` cannot open a write to another site. A site whose pages must call the server, such as the same app on another Mac, is named in `otherSites` (`appServer({ service, otherSites: ['http://192.168.1.20:5900'] })`): its writes pass, its page may send the person's cookies with them, and its cross-origin questions are answered, which no other site's are. The page served through Vite's proxy in development is the app's own page. `otherSiteCheck()` is exported alone too, for an app not built on `appServer`. A server running open on this machine (`serverSignIn` with no settings) also refuses a request sent to any name but `localhost`, `*.localhost`, a `127.` address and `[::1]`: a page whose own name is pointed at 127.0.0.1 is the same site as the server to the browser, and only the name it used gives it away. A proxy on this machine in front of an open server, such as Caddy, serves it under a `*.localhost` name for the same reason.
- **The health route** answers `{ ok: true, service, commit }` before any sign-in check, since the app's routes and checks go on after it. `commit` is the commit Railway built from (`RAILWAY_GIT_COMMIT_SHA`), null elsewhere, so a check after a deploy can confirm which code production serves.
- **The request log** prints one line per request once it is answered, `GET /api/items?[redacted] 200 12ms`, with any query replaced whole. Hono's own logger prints the query as it came, and on an OAuth callback that is a live sign-in code in the hosted log. `requestLog()` is exported alone too, for an app not built on `appServer`.
- **Errors.** An `HTTPException` a route or middleware throws goes out as it was made, so the agent keys' 401 keeps its `{ error: 'unauthorized' }` and a check its WWW-Authenticate header. Any other error is logged with its stack and answered `500 { error: 'Something went wrong on the server.' }`, never the error's own message, which could carry what the person should not see. An address under `/api/` that no route takes is `404 { error: 'Not found' }`.
- **Listening.** `listen` hands Bun.serve every option it is given as it is (`hostname`, `websocket`, `maxRequestBodySize`, `idleTimeout`), takes `PORT` when no port is given, then 3000, and logs the address once. A websocket route uses Hono's `upgradeWebSocket` and passes Hono's `websocket` from `hono/bun` to `listen`.
- **Stopping.** On SIGTERM, which Railway sends before a deploy replaces the server, or SIGINT, it stops taking requests and gives open ones `graceMs` (5 seconds unless given) to finish. Then it closes what is still open, since a live-update stream never ends by itself and Bun waits for every connection, with websockets told 1001, going away. It runs `onStop` (a database's `close()`, a repeating job's stop) and exits. Railway sends SIGKILL at once unless `drainingSeconds` is set, so set it longer than the grace.

Needs `hono` 4.12 or later.

### A job on a clock

`app-kit/server/every`: a server's job that runs every so often, such as a check for new mail or a digest. `every(name, intervalMs, job, { runAtStart })` runs it every `intervalMs`, and gives back `stop`, which `listen`'s `onStop` calls:

```ts
import { every } from 'app-kit/server/every';
import { appServer, listen } from 'app-kit/server/start';

const app = appServer({ service: 'argon-watcher' });
const stopTriage = every('mailbox triage', 30 * 60_000, () => triageMailboxes(db), { runAtStart: true });

listen(app, { onStop: async () => { await stopTriage(); await db.close(); } });
```

- **Never two at once.** The next run is set only once the last has settled, one interval after the last one started, or at once when the last took longer than that. setInterval starts a run while the last one goes on, so a slow run sends an alarm twice or changes the same mailbox twice; here a due run is never skipped and a slow one is never stacked.
- **A failure.** A run that throws is logged as `mailbox triage failed:` with its stack (to `print`, console.log unless given), and the next run still happens. Bun.cron, which also never stacks runs, ends the process on a throw unless the app listens for unhandled rejections.
- **Stopping.** `stop()` ends the clock and waits for a run in progress, so the database is closed after the last run, not under it. Bun.cron's stop does not wait.
- `runAtStart` runs the job as soon as `every` is called, rather than first after one interval. An interval that is not a number of milliseconds above 0, or is past the longest delay a timer holds (`LONGEST_DELAY_MS`, about 24.8 days, which Bun cuts to 1ms), is refused, since the job would run back to back.
- It imports nothing, so a worker with no web server takes it too. It is for one server: two copies of the app on two machines each run it, and a job that must run once across them takes a lock of its own.

### What a Mac process has used

`app-kit/server/process-usage`: one reading of one macOS process's CPU time, memory and disk, finished child processes included. `ps` and every other reader miss a process that lived between two samples. The kernel adds a child's CPU time, and all its own children's, to its parent's child total when the child is reaped, so that time is still there to read in the parent.

```ts
import { readProcessUsage } from 'app-kit/server/process-usage';

const usage = readProcessUsage(pid);
if (usage) console.log(usage.ownCpuSeconds + usage.finishedChildrenCpuSeconds, usage.footprintBytes);
```

| Field | What it is |
| --- | --- |
| `pid` | The pid it read. |
| `startedAt` | A bigint, only for comparing: the same pid and the same `startedAt` is the same process, since macOS reuses a pid. |
| `ownCpuSeconds` | User and system CPU time of the process itself, as `ps -o time=` shows it. |
| `finishedChildrenCpuSeconds` | User and system CPU time of its reaped children and of theirs, which `ps` never shows. A child still running, or one that has ended and is not yet reaped, is not in it. |
| `residentBytes`, `footprintBytes` | Memory in physical pages, as `ps -o rss=` shows it, and the physical footprint Activity Monitor calls Memory, which counts what is compressed and swapped too. |
| `diskReadBytes`, `diskWriteBytes` | What it has read from and written to disk since it started. A read the file cache answers is not in it. |

- **Null.** It answers null when macOS will not say: another user's process, a process gone, or not macOS. A pid that is not a whole number a C int holds is null too, since the kernel would read some other process.
- **One reading.** Every number is a total since the process started. Sampling, the differences between readings and who owns a process stay in the app. A difference is only good between two readings with the same `pid` and `startedAt`.
- **Where to run it.** It calls `proc_pid_rusage` through `bun:ffi`, which Bun marks experimental and which a Bun runtime alone has, and it takes a process of its own for a server that must not go down with a crash there. Importing it loads nothing: `bun:ffi` and the two libraries are opened at the first reading on a Mac, and never off one.

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

A permission is known to be missing only from Google's own answer, `missingAccess` above: the list of permissions Clerk reports for a token it holds has been seen to name one the grant no longer carries. Every reading carries Google's own `reason` and a one-line `message` for the log. Only answers with a recorded or Google-documented sample have a meaning; anything else reads as `failed` until one is recorded. What the person sees is the app's: its server sends the words with the status, a reconnect names the service ("Reconnect Google Calendar"), says how old what is shown is, and for `missingAccess` says to tick the box on Google's screen.

### The Postgres database

`app-kit/server/postgres`, for an app's server on Drizzle: one way to open its database, Railway's Postgres in production and PGlite, Postgres compiled to WebAssembly and run in the process, everywhere else. Each call takes the app's own schema and the folder drizzle-kit generates its migrations into, and brings the database up to date with Drizzle's migrator before it returns.

```ts
import { openDb } from 'app-kit/server/postgres';
import { join } from 'node:path';
import * as schema from './schema';

// On Railway the URL is required: without it the server would run on a folder in its container, which the next
// deploy throws away. Elsewhere a folder keeps the laptop's data.
const location = process.env.DATABASE_URL || (process.env.RAILWAY_ENVIRONMENT_NAME ? undefined : '.data/db');
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

An empty location is refused, never read as a folder. Each open logs one line naming what it opened, `database: opened Postgres at <host>/<database>, migrated` or `database: opened PGlite in <folder>, migrated`, never the password, so a deploy log shows which database the server is on. Every database it gives has `close()`, which ends the connection or shuts PGlite down; an open whose migration fails closes it before it throws. Migrations are only ever drizzle-kit's: `bunx drizzle-kit generate` writes them from the schema, and the next open runs them, on Railway as on the laptop. Drizzle applies the pending ones in one transaction and takes no lock, so two instances opening the same database at once can both try a pending migration: one applies it, the other fails to start with nothing half done, and its restart finds the migration applied. An app run as one Railway instance never meets this.

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

### Reading Amazon's order pages

`app-kit/amazon-orders`, kept in `server/amazon-orders/`, for a server or a tool that holds Amazon's order pages: the page's HTML goes in and orders come out, read the same way everywhere, so a change at Amazon is fixed once. It fetches nothing: Amazon has no API and only the person's own browser can get these pages, so `ordersPath` and `orderDetailsPath` say what to ask Amazon for, and whoever asks hands the answer over as text.

```ts
import { orderDetailsPath, ordersPath, readOrderDetails, readOrders } from 'app-kit/amazon-orders';

const page = await pageFromTheBrowser(ordersPath('months-3', 0));
for (const order of readOrders(page)) {
  // A big order's card names a few products and counts the rest. Its details page may name them all, or read as none.
  const more = order.moreItems ? readOrderDetails(await pageFromTheBrowser(orderDetailsPath(order.orderNumber))) : [];
}
```

| Export | What it gives |
| --- | --- |
| `readOrders(html)` | One page of order history as `Order[]`: `orderNumber`, `placed` (an ISO date or null), `total` (dollars or null), `status` (Amazon's own line, such as "Delivered October 18", "Arriving tomorrow", "Cancelled" or "Refunded", or null), `items` and `moreItems`, the products the card counted and did not name. A page with no order cards, such as a sign-in page, reads as none. |
| `readOrderDetails(html)` | The products on one order's details page as `OrderItem[]`: `asin`, `name` and `store`. It reads the item rows of a Fresh or Whole Foods delivery and the lines of an in-store receipt that have a product link. A regular order's page reads as none, and so does loose produce on a receipt. |
| `ordersPath(period, page)`, `orderDetailsPath(orderNumber)` | The address on amazon.com of each page. The history is asked for in the clear, through the page's own fallback for when its decryption library is missing. An in-store order's card links to another address; Amazon answers this one by sending it to the receipt. |
| `PERIODS` | The periods the history filters by: `last30`, `months-3`, then this year and the twelve before it, worked out when the module loads. |
| `parse`, `textOf`, `dollars`, `isoDate` | What the readers read a page with, for another reader of Amazon's pages: a page to search with `querySelector` and `querySelectorAll`, with its scripts and styles dropped, an element's text with its whitespace collapsed, "$5.97" as a number, "Oct 17, 2026" as "2026-10-17". |
| `STORES`, `STORE_NAMES`, `storeOfBrand`, `Store` | Amazon's three stores by the names people see (Amazon Fresh, Whole Foods Market, Amazon), and the store for a brand id in Amazon's addresses. |

- **What never comes out.** A details page also holds the delivery address, the card's last digits and products Amazon recommends. The readers read item rows only, so none of them reaches an answer, but the HTML itself holds them: a server keeps what is read and discards the page, and logs no part of it.
- **A page sent to a server.** Reading fetches nothing a page names and runs nothing in it, since a page is parsed into a template, which is never attached to a document. A test holds that with a page full of preload links, stylesheets, frames and scripts pointed at a server of its own. The size of a page a server accepts is the server's to limit: the largest real order page recorded is about 1 MB and reads in about 350 ms, and a page nested tens of thousands of levels deep throws a RangeError, which the server catches as it would any page it cannot read.

Needs `happy-dom` 21, which the kit names as an optional peer, so an app that does not take this part installs none of it. An app that does installs it as a dependency, since its server loads it to read a page. This import name has no folder in it because a tool on a person's own Mac takes it as a server does.

### Reading an Amazon cart page

`app-kit/amazon-cart`, kept in `server/amazon-cart/`, reads one store's cart page the way `app-kit/amazon-orders` reads order pages: the page's HTML goes in, the cart's lines come out, and nothing is fetched. `cartPath(store)` says what to ask Amazon for. It reads with `app-kit/amazon-orders`' `parse`, so it needs `happy-dom` the same way, and takes its `Store` names from there.

```ts
import { cartPath, NotTheCart, readCart } from 'app-kit/amazon-cart';

const page = await pageFromTheBrowser(cartPath('Amazon Fresh'));
try {
  const cart = readCart(page, 'Amazon Fresh');
  // cart.lines: what is in the cart now; an empty list is a cart with nothing in it.
} catch (error) {
  if (!(error instanceof NotTheCart)) throw error;
  // Not the cart: say nothing about what is in it, and log error.kind and error.message.
}
```

| Export | What it gives |
| --- | --- |
| `readCart(html, store)` | The store's cart as `Cart`: `store`, `lines` (each `asin`, `name`, `price` in dollars or null, `quantity` and `lineId`, Amazon's id for the line), `items`, Amazon's own count of the items, which can differ from the lines' quantities added up, and `url`, the cart's address, where the person checks out. "Buy it again" suggestions, saved-for-later items and the other stores' carts shown on the same page are not lines. |
| `NotTheCart` | What `readCart` throws for a page that is not that store's cart, so it never reads as an empty cart: `kind` is `signed-out` when Amazon showed the page to someone not signed in, and `not-this-cart` for anything else (another store's cart, a page refusing the request, a change at Amazon, including a cart Amazon counts items in with no line the reader knows), with `store` and a message giving the reason. |
| `cartPath(store)` | The address on amazon.com of the store's cart page: each grocery store has its own, and regular Amazon's shows the grocery carts collapsed. |
| `Cart`, `CartLine`, `NotTheCartKind` | The types. |

- **How a page is known as the store's cart.** A grocery cart page (Amazon Fresh, Whole Foods Market) has one expanded grocery cart whose checkout box names the store's brand id; regular Amazon's has its active cart; and a header reading "Hello, sign in" is a signed-out page, whatever else it holds. These marks are read from real pages, recorded on 2026-10-22 and 2026-11-05.
- **An empty grocery cart has never been recorded.** Whether its page keeps the checkout box naming the store is unknown. If it does, it reads as a cart with no lines; if not, `readCart` throws `NotTheCart` with the reason "The page's grocery cart has no checkout box naming its store", rather than guessing that the cart is empty. A signed-in empty regular cart has not been recorded either: signed out, its active cart is there, empty, so it is expected to read as a cart with no lines. `test/fixtures/amazon-cart/README.md` keeps what is known and how to record the rest.
- **What never comes out.** A cart page's header holds the person's name and delivery town; the reader reads the cart's lines and counts only. A server keeps what is read and discards the page.

### Adding to an Amazon cart

`app-kit/amazon-cart` also reads a product's page into the one request Amazon's own add button makes for one of it, for the person's own browser to send with its cookies. Nothing here sends it: a server reads the page the browser fetched, and hands the request back to the browser, which checks it against the never-sent list (`extension/worker/amazon-never-sent.js`) and posts it as given.

```ts
import { addRequest, NotTheProduct, productPath } from 'app-kit/amazon-cart';

const page = await pageFromTheBrowser(productPath(asin, 'Whole Foods Market'));
try {
  const request = addRequest(page, asin, 'Whole Foods Market');
  if ('notForSale' in request) return { added: false, reason: request.notForSale };
  await postFromTheBrowser(request.path, request.body, request.headers);
  // Read the cart after (cartPath, readCart) to say how many are in it.
} catch (error) {
  if (!(error instanceof NotTheProduct)) throw error;
  // Not the product's page: send nothing, and log error.kind and error.message.
}
```

| Export | What it gives |
| --- | --- |
| `productPath(asin, store)` | The address on amazon.com of the product's page as the store sells it: each grocery store's has its brand id, regular Amazon's is the bare product page. |
| `addRequest(html, asin, store)` | `{ path, body, headers }`, the POST that adds one, or `{ notForSale }` with the reason in plain words ("Whole Foods Market does not sell it right now", "Amazon sells it only through Amazon Fresh or Whole Foods Market"). A grocery store's add is its button's own data, posted as JSON to `/alm/addtofreshcart`. Regular Amazon's is the add form's token, client name, product and offer with a quantity of one, posted form-encoded to `/cart/add-to-cart?ref=dp_start-bbf_1_glance`, never to the form's own address, which also takes Buy Now. |
| `NotTheProduct` | What `addRequest` throws for a page that is not the product's page, so nothing is sent from it: `kind` is `signed-out` when Amazon showed the page to someone not signed in, and `not-this-product` for anything else (another product's page, a page refusing the request, an add button or form naming another product, a form with no token), with `asin`, `store` and a message giving the reason. |
| `AddRequest`, `NotTheProductKind` | The types. |

- **How a page is known as the product's page.** Its canonical link ends in the product number, on every product page recorded on 2026-10-22 and 2026-11-05, a store's page of a product it does not sell included, which has neither add button nor form. A signed-out product page has the whole add form, so a header reading "Hello, sign in" is checked first.
- **Another store's offer is never posted for the store asked.** Recorded on 2026-11-05: an Amazon Fresh product's page on regular Amazon offers it for delivery with a form that fills a grocery cart (its `cartType` is `LOCAL_MARKET`) and for pickup with Whole Foods Market's button. So regular Amazon's add refuses a form with a cart type, and a grocery add refuses a button naming another store, saying which store sells it.
- **One at a time.** The grocery button adds one per press, so a quantity is that many posts of the same request, stopping at the first that fails; reading the cart before and after says how many went in.

## look/: the two looks

`app-kit/look`: the only owner of the looks' values, plain TypeScript with no packages, which `lookTheme` (web), the copied `look.css` (extension) and the Swift package's tokens all take from. `CONSOLE` holds the console look's colors, light and dark; `plainColors(accent)` the plain look's, with `DEFAULT_ACCENT`, Beeline's blue, as info unless the app gives its own; `PLAIN_SIZES` and `CONSOLE_SIZES` the sizes; `FONTS` the typefaces. A change to a value here changes every surface at once: the extension's copy at its next `app-kit extension copy`, and the Swift copy by hand in `swift/menu-bar/Sources/MenuBarTheme/Tokens.swift`, which `test/look-swift.test.ts` fails until it matches.

## icons/: one drawing, every icon

`app-kit icons render` draws every icon an app ships from the drawings it commits, so no app keeps an icon script of its own. An app commits its drawings in one folder, `design/icon` by default:

- `app-icon.svg`, 1024 square, with its tile on Apple's macOS grid: an 824 rounded square at 100, with a corner radius near 186, and see-through around it. The Mac's icons are this drawing as it is; drawn on that grid, macOS 26 and later show it without the grey plate they put under an icon of another shape. The iPhone's icons and the Apple touch icon are its tile alone, its corners filled in the tile's own colour (read just inside the middle of its top edge) and with no alpha channel, since iOS rounds the corners itself and the App Store refuses an icon with any see-through pixel. The favicon is the tile alone with its rounded corners kept, so it reads on a light or a dark tab bar.
- `mark.svg`, square, the drawing with no tile, when the app has an extension: its icons.
- `glyph.svg`, when the app has a menu bar icon: copied into the menu bar's image set as a vector template image.

A drawing may link to another beside it, as `<image href="mark.svg">` draws the mark on the tile; a link to anything outside the folder is refused, since it would draw nothing there. Text is drawn in whatever font this Mac has, so a drawing turns its text into paths. A drawing that fills its whole square, as many iPhone and web icons were drawn, goes on the grid inside a 1024 frame:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <clipPath id="tile"><rect x="100" y="100" width="824" height="824" rx="186"/></clipPath>
  <image href="full-bleed.svg" x="100" y="100" width="824" height="824" clip-path="url(#tile)"/>
</svg>
```

The command names where each set goes, so an app keeps it as a script in `package.json` and runs it after changing a drawing, then commits what it wrote with the drawings:

```json
"icons": "app-kit icons render --icon-set Beeline/Assets.xcassets/AppIcon.appiconset --menu-bar Beeline/Assets.xcassets/MenuBarIcon.imageset --extension extension/icons --toolbar-color '#1f1f1f'"
```

- `--icon-set <AppIcon.appiconset>`, as often as the app has sets: every image its `Contents.json` lists, at its size and scale, to its file name, a Mac entry from the app icon and an iPhone, iPad or App Store entry from the tile. Dark and tinted entries are left to the system, which makes them from the light one. A set with no `Contents.json` is refused: Xcode makes the set, and for a Tauri iPhone app `bunx tauri ios init` makes `src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset`. An Icon Composer icon (`AppIcon.icon`) beside a set is what macOS and iOS 26 and later show; the command says so, and the set covers older systems.
- `--tauri <src-tauri>`: the icons `tauri.conf.json` lists under `bundle.icon`, from the app icon: `NxN.png`, `NxN@2x.png`, `icon.png` at 512, and `icon.icns`, made by macOS's `iconutil`. A Windows `.ico` and a Liquid Glass `.icon` or `Assets.car` are left as they are.
- `--menu-bar <MenuBarIcon.imageset>`: `glyph.svg`, under the `.svg` name the set's `Contents.json` gives, with a template `Contents.json` written when it has none.
- `--extension <folder>`: `icon-16.png` and `icon-32.png` for the toolbar, and `icon-48.png` drawn at 40 and `icon-128.png` at 96 with see-through edges, the inset Chrome's image guidelines ask for. `--toolbar-color <#hex>` draws the 16 and 32 in one colour, every pixel keeping its own transparency, however the mark's shapes are coloured, where a mark's shades blur together at toolbar size.
- `--web <folder>`, the folder the app serves as its root: `favicon.ico` (16, 32 and 48), `apple-touch-icon.png` (180), and `icon-192.png` and `icon-512.png` for the manifest, the app icon as it is, which Chrome on the Mac shows in the Mac's own shape. The page and the manifest name them:

```html
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```

```json
"icons": [
  { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
  { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
]
```

It draws with sharp, whose prebuilt binaries carry librsvg, the engine `rsvg-convert` draws with, so it needs neither Homebrew nor a browser; Beeline's icons drawn by it match those its own script drew with `rsvg-convert` within one shade in 255. The kit names sharp as an optional peer, so an app that draws icons adds it with `bun add -d sharp`, and the command says so when it is missing. A drawing not 1024 square, a set entry with no file name or one that leads out of its folder, or any failure while drawing stops it before it writes anything, and each file is written under another name and renamed into place, so none is left cut short. The same drawings draw the same bytes, so a rerun changes nothing in git.

## testing/: what every kind's tests share

### The test start-up file

`app-kit/testing/start-up`: every `bun test` process keeps its temporary files in a folder of its own, `/tmp/<project>-tests/<pid>`, outside the system temporary folder, which slows every process started in it as it fills. A project names it in `bunfig.toml`:

```toml
[test]
preload = ["app-kit/testing/start-up"]
```

- **The folder's name** is the `name` in `package.json` where `bun test` runs, with a scope's `@` dropped and its `/` made a `-`, so `@perf-buddy/server` is `/tmp/perf-buddy-server-tests`; with no name, it is the folder's own name.
- **Only a folder of this user's.** `/tmp` is shared by every account, so the folder is used only when it is a real folder this user owns that no one else can write to. Anything else (a link, a file, a folder of another account or one others can write to) stops the tests with what it found, before any test runs.
- **What it sets.** `TMPDIR` is the process's folder, and `os.tmpdir()` reads it on every call, so every `mkdtempSync(join(tmpdir(), ...))` lands there. `TEST_SHARED_TMPDIR` keeps the system folder, for what every test process shares, such as port reservations. A child started with `Bun.spawn` and no `env` keeps the start-up `TMPDIR`; pass `env: process.env`.
- **Cleaning up.** `bun test` runs no exit handler, so each process removes the folders of processes that have ended rather than its own. Under `--parallel` the file runs once per test file, each time with the environment the worker started with, so only the first file in a process sweeps.

It is the setup skill's test start-up file, held in one place.

## bin/, scripts/ and test/: develop

`bun test`, `bun run typecheck`, `bun run lint`, `bun run test:e2e` for the web fixture in a hidden Chromium and the kit's WebKit kept out of the Dock, and `bun test ./extension/e2e/harness.e2e.ts` for the extension fixture through the harness (`bunx playwright install chromium webkit` first). `scripts/gates.sh` runs all five, then builds the Rust and Swift of the iPhone notifications and iPhone sign-in plugins for the iPhone simulator, with Rust from rustup and its `aarch64-apple-ios-sim` target, in one build folder all checkouts share, and runs the menu bar theme's Swift tests and its bare swiftc build. A change to `extension/worker/` is followed by `bun bin/app-kit.ts extension copy extension/test/fixture/kit`, which a test checks.

Releases are tags, `v<version>`, matching `package.json`'s version, on the commit main lands at, so a release is always a commit main holds. A tag never moves; a fix is a new tag. While the version is 0.x, a patch release needs no change in the apps and a minor one may, which its commit messages say.

A branch never sets the version. Its commits say what kind of change it is, with a line beside Co-Authored-By:

```
Release: minor
```

`minor`, `patch` or `none`; a branch that changes only plan files needs none. `scripts/land-main.sh` lands it: it rebases onto main, works out the next version from main's, commits it along with the install lines above, runs `scripts/gates.sh`, moves main and pushes the tag. If another branch lands while the gates run, it starts again with the next number, up to three times. It refuses a branch that edits the version itself or says no kind of change, and a run that stops before main moves leaves the branch as it was, with no version commit on it. One that moved main but could not push the tag says so, and the next landing pushes that tag first.

The repository is public. Main moves forward with a push that is never forced, which adds no commit, so every commit keeps Worktron as its author and committer. A pull request's merge buttons write a new committer, the merging account, for every commit, merge, squash and rebase alike. `test/public.test.ts` fails on any personal email, home folder or name in the files or the history.
