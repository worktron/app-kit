# Backlog

Unclaimed tickets for app-kit, one `## ` section each, in the record's shape:
work someone wrote down and nobody has started, a fork the user named or an idea
a thread noticed on its way. A ticket here is not approved: building one waits
for the user's yes to that ticket, and its worker plans first.
`/spawn <id>` starts one; its landing commit deletes the section.

## web-push · Web Push for an app on the phone's home screen, with the server's sending

Goal: the kit sends notifications to an iPhone app built with Tauri (app-kit/tauri/iphone-notifications) but has nothing for a web app added to the home screen, which practices treat as the usual phone app. argon-watcher built it whole: src/lib/push.ts:15-110 (support check, permission, subscribe and unsubscribe, VAPID key decoding), public/sw.js:1-49 (show the notification; a click focuses an open window or opens one at the address), server/push/send.ts:90-145 (aes128gcm with a TTL; subscriptions answering 404 or 410 removed), server/push/vapid.ts and scripts/gen-vapid.ts (keys from the environment, and making them), and server/api/push.ts:45-58, an upsert with setWhere so nobody can rebind another person's endpoint (c17886c). Its sw.js:5 calls skipWaiting() and clients.claim(), which practices rules/mobile-apps.md:28 forbids: the kit's version must not. Found by the harvest thread, 2026-10-26.

Done when: app-kit/web holds the page half (subscribe, unsubscribe, permission state), the kit ships a service worker file for showing and opening notifications that never calls skipWaiting, a server half sends and reports gone subscriptions, and the README says how an app keeps its subscriptions table so an endpoint cannot be rebound; each held by unit tests, the sending by recorded answers.

## extension-tools · One tool table an extension offers to Claude as an MCP server and as a command line, over its native host

Goal: amazon-connector exposes its extension's abilities to Claude through one table of tools with zod schemas (src/tools.ts:14-25), registered as an MCP server with a <prefix>_status tool backed by hostStatus, turning NotConnected and known problems into isError results in plain words (src/mcp.ts:13-33), and mapped onto command words, with a ZodError a usage error that exits 2 (src/cli.ts:66-109); test/mcp.test.ts:10-16 connects through the SDK's InMemoryTransport. Any extension of ours exposed to Claude needs the status tool, the error wording and the command-line twin. Registering the server with Claude stays in fleet, not the kit. Cost: @modelcontextprotocol/sdk and zod as optional peers. Found by the harvest thread, 2026-10-26.

Done when: app-kit/extension holds a function that turns one tool table into an MCP server (with the status tool) and a command line over the host's socket, with optional peers declared, tests through InMemoryTransport and a command-line run, and the README's extension section shows an extension using it.

## mac-notifications · Notifications in a Mac app onto a hosted site, by polling, since the Mac web view has no Web Push

Goal: argon-watcher's src/lib/desktop.ts:27-51 polls with a cursor that starts at launch, only moves forward and lets one request run at a time, and :62-76 sends one introductory notification at first launch so macOS's permission prompt does not land on, and dismiss, the first real alert. Tauri's notification plugin always answers "granted" on macOS, so an app cannot show a permission state (0b9282f). Background throttling must be off for it to keep running (460b9b4), which the hosted-window crate covers. Found by the harvest thread, 2026-10-26.

Done when: app-kit/tauri holds the page half (poller and first-launch notice) with unit tests on a fake clock, the server's side is a documented route shape, and the README says what macOS's permission answer can and cannot be trusted for.

## offline-start · A Tauri window onto a hosted site opens on a bundled start page that waits for the site

Goal: a window that loads its remote address directly stays blank offline. timescale's desktop/start/index.html:1-136 probes /api/health with no-cors, goes to the hosted app on any answer, otherwise says it cannot reach it with Try again, and retries on online and every 30 seconds (451b522; e2e/mac-app-start.e2e.ts). It holds a copy of the palette that a cargo test checks against palette.ts (main.rs:872-908): the kit's version takes colors and origin as inputs. Found by the harvest thread, 2026-10-26.

Done when: the kit ships the start page (or a generator for it) taking the origin, health path and colors, the hosted-window crate can point the window at it, and a browser test proves the page waits, retries and moves on.

## google-retry · server/google retries what it reads as later, with Retry-After and jitter

Goal: readGoogleResponse says `later` with retryAfterMs and leaves the loop to each app. argon-watcher's server/gmail/client.ts:123-200 parses Retry-After in both forms and retries with jitter (two tries for 5xx and network errors, five with doubling from 2s for rate limits), and never retries a send that is not idempotent (:206-209). A rate-limit 403 once read as dead auth failed whole production runs twice (387b9b1). Found by the harvest thread, 2026-10-26.

Done when: app-kit/server/google exports a retrying call that takes the request and whether it is safe to repeat, held by tests on a fake clock with recorded answers, and the README's Google section shows it.

## claude-answers · server/anthropic reads a Claude API refusal and pulls JSON out of an answer

Goal: argon-watcher's server/anthropic/refusal.ts:16-29 tells a refusal for the whole account (spend limit, credit balance, billing, 401, 402, 403) from a refusal of one prompt; on 2026-10-25 retrying per item wiped every title. json.ts:17-25 pulls the JSON object out of fenced output with trailing words (c80af4f); cache-warm.ts holds later calls of a kind until the first returns so they read the prompt cache (production showed about 17k tokens of cache creation and zero reads); usage.ts adds up token counts. The stack names Claude, so other apps call it too. Check the current Claude API docs for structured output before carrying json.ts over: it may be the better answer. Found by the harvest thread, 2026-10-26.

Done when: app-kit/server/anthropic exports the refusal reading and whatever of the rest the current API still needs, held by tests on recorded answers, with a README section beside the Google one.

## service-worker-builds · Does the kit's new-build line, crash reload and built page hold under a service worker?

Goal: urge-surfer built its own new-build flow on vite-plugin-pwa (src/ui/newBuild.ts:1-89, NewBuildLine.tsx, main.tsx:62-78, vite.config.ts:11-33; fa12e8a, abc4203, 6927232, 1c9bdd0, e5a4780, 85637be) and runs without the kit's ErrorBoundary and reloadOnFailedLoad. Unverified: a precache answering the kit's fetch of / from its cache would leave the new-build line and the crash reload blind to a deploy. Its 6927232 also found unsavedInput blind to state held only in memory, with no way for an app to say a page holds something. An iPhone web view runs a service worker only for app-bound domains. Investigate first; the deliverable is a plan naming what the kit changes (a service-worker-aware new-build piece, a holds-something hook, a serveNewerBuild that covers the worker's own requests, as urge-surfer's ownServer().deploy() at e2e/flows.spec.ts:1125-1166 does). Found by the harvest thread, 2026-10-26.

Done when: a plan in .claude/plans says, from a browser test that installs a precaching service worker over the kit's fixture, whether each kit piece sees a new deploy, and names the tickets that follow.

## mac-sign-in-https · Mac sign-in runs in Apple's sign-in session and hands back to the app's own https address, so neither click is needed

Goal: a Mac app's sign-in today takes two clicks, the page's own (v0.17.0, because any app can claim the app's link scheme) and the browser's "Open app?". From macOS 14.4 Apple's sign-in session (ASWebAuthenticationSession) can open the sign-in page in the default browser and hand back to an https address on the app's own domain (`.https(host:path:)`), which only the app named under `webcredentials` in that domain's apple-app-site-association file receives; that leaves one click, Apple's "wants to use … to sign in" prompt. It opens the default browser only if that browser declares CallbackURLMatchingIsSupported, else Safari: Safari, Chrome 156 (its last-used profile) and Firefox 157 do; Arc is unknown. Kit: the window plugin (tauri/window/plugin) starts the session in Rust through the objc2-authentication-services crate instead of Tauri's opener; older macOS keeps the opener and the click. It reuses the iPhone's hand-back over https (README, iPhone sign-in, Sign-in with one tap): the browser page goes to backLink with no click only in an iPhone's or iPad's browser, since a program on a Mac could add back=https and read the code from browser history, so the Mac needs its own proof that the session, not another program, opened the page before the page may skip the click there. No landing page was built: a browser records the address before any script on it runs. Each app: a Developer ID provisioning profile with Associated Domains embedded through bundle.macOS.files as embedded.provisionprofile, a `webcredentials:<domain>` entry in bundle.macOS.entitlements, the association file on its site, and a new signed build. Unknowns, settled first by one signed test build on the owner's Mac before any kit change: whether the session works from an app outside the sandbox, whether the Mac needs the same webcredentials entry, and what Arc does. Research by the sign-in-ticket thread, 2026-10-27.

Done when: on the owner's Mac on macOS 14.4 or later with Safari, Chrome or Firefox as the default browser, argon-watcher's sign-in shows Apple's prompt and then signs in with no other click; the result for Arc is written in the README; older macOS keeps today's clicks; the Rust session start is held by the window plugin's tests and the README's tauri section lists the profile, entitlement and association file.

## self-reload-folder · Self-reload works for an extension loaded from a folder with no .git and no build, and waits a look before a missing file counts as deleted

Goal: extension/worker/self-reload.js spots new code by reading .git at the extension's root, or a build's version_name in a built folder. An extension loaded unpacked from a subfolder of its repository with no build step (Beeline's extension/, next to its Xcode app) has neither, so the kit's copy would never reload it. Beeline's own extension/lib/self-reload.js (beeline main 873623f) covers that case by taking a SHA-256 fingerprint over the files Chrome loads (SOURCE_FILES, kept equal to the folder by test/files.test.js) and reloading when the fingerprint on disk changes. As a side effect, a commit that touches none of the extension's files causes no reload. It also counts a missing file as deleted only when the next look misses it too, so a checkout caught mid-write is not reloaded on (a landing on 2026-10-07 deleted two listed files and old copies ran for a week before that rule). The kit reloads on the first look that misses a loaded file. Beeline additionally exposes loadedCode() and filesOnDisk(), the first twelve characters of each fingerprint, which its native host logs beside each answer, so the log shows which build answered and a copy that failed to reload stands out. Practices' rules/extensions.md says the manifest sits at the repository's root, which is the case the kit handles today; Beeline is the exception, and this ticket either covers it or the rule gets an explicit exception. Found by the beeline-review thread, 2026-10-28.

Done when: the kit's self-reload reloads an extension loaded from a folder with no .git and no build when a file it loads changes, without reloading on a commit that changes none of them; a loaded file missing at one look and present at the next causes no reload, and missing at two looks does; the loaded and on-disk build identities can be read by a status command; each held by a unit test against the chrome stand-in, and the copied fixture updated.

## mac-off-screen-run · Start a copy of a Mac app for a test that can never take a real link or reach the screen

Goal: the rule that checks run off the owner's screen has one worked answer for a whole Mac app, Beeline's scripts/e2e-cold-launch.sh (main 873623f). It copies a Debug build into a temporary folder (:36-38,68-71), gives the copy its own bundle identifier and deletes CFBundleURLTypes with PlistBuddy so macOS never sends it a real http, https or app link (:72-74), signs it ad hoc (:75-76), and starts it with `open -g -a` and BEELINE_OFF_SCREEN=1, under which the app makes no menu bar item, orders no panel front and activates nothing (AppDelegate.swift:17,49,190,280-283), saving pictures of what it would have shown instead (:21-22,286-309). After each step it fails the run if the app is frontmost (lsappinfo) or owns a window on screen (scripts/chrome-harness/windows.swift, CGWindowListCopyWindowInfo with optionOnScreenOnly). Its check samples at those points only, so a window that opens and closes between them goes unseen; a shared version should watch continuously. App-kit's menu bar theme has staysOffScreen for its panel (swift/menu-bar/Sources/MenuBarTheme/Panel.swift:11) but nothing for a whole app. Found by the beeline-review thread, 2026-10-28.

Done when: `app-kit mac off-screen-run <app> [args]` (or a library the gates import) makes the renamed, scheme-free copy, starts it with an off-screen variable the app reads, watches the whole run for the app coming to the front or a window of its on screen, and stops only the process it started; held by a test against a tiny fixture app that the gates build, including one fixture that does show a window and must fail; the README says what an app's code checks for the variable; and practices' testing rule names it as the example.

## plain-look · A second look beside the console one, for apps used by people who never open a terminal: one tokens file, read by an MUI theme, an extension stylesheet and SwiftUI, with its own controls

Goal: the kit's only look is the console look (swift/menu-bar: JetBrains Mono, near-black), and it covers only the panel under a menu bar icon. Apps for people who never use an agent, Beeline first, need Mac windows and extension pages in a plain look. Plain Look Studies (https://share.worktron.com/fVdlJMmrWcFOI118), C everywhere, Settings included, chosen 2026-10-28: a system typeface on warm paper (#f6f5f2, text #2a2c30, secondary #5c5f65, muted #8e9197, hairline #e2e0da; dark #1d1e20 with #e6e4df text), one accent per app, the console look's shape (hairline rows, no boxes or cards, status in words, actions as accent words, the build in a footer), and the kit's own controls, since the owner does not want macOS's or Chrome's default styles: a switch, a menu that reads as text, a text field in a hairline box, and removal in the error color only. Beeline's popup (extension/popup.html at beeline main 873623f) already has the structure and moves onto it when it takes the kit. Spacing on a 4px grid, as the page's revision 3 draws it: 20px sides in a popup and 24px in a window, 24px between sections, 8px from a label to its content, rows of 44px at least. The look reaches three kinds of surface, each drawn differently: web apps and Tauri windows are React and MUI, extension pages are plain HTML with no build step, and Swift apps are SwiftUI. Extension pages stay plain CSS, not MUI, chosen 2026-10-28: MUI would need a build step in extensions that update from their checkout by git alone, and React with MUI on a popup that loads fresh on every click. One TypeScript tokens file owns the colors, sizes and spacing, so no surface keeps its own copy. Found by the beeline-review thread, 2026-10-28.

Done when: one tokens file (light and dark, with the accent as the one input an app sets) is the only owner of the look's values; app-kit/web ships an MUI theme built from it, which an app passes to createTheme with its accent, drawn in the web fixture's hidden Chromium; the extension side ships a stylesheet whose CSS variables come from the same file (light and dark by prefers-color-scheme) with the section label, row, row with action, status words, controls and build footer, copied by `app-kit extension copy` and drawn light and dark in the extension harness's hidden Chromium; the Swift side ships the same colors and sizes as a package beside swift/menu-bar, held equal to the tokens file by a test, with SwiftUI views for the same pieces and the four controls, drawn through the menu bar theme's snapshot path with nothing on screen; an app sets only its accent; the README's web, extension and swift sections show each in use; and the Studies page's C mockups and the shipped pieces are compared side by side in pictures before landing.

Since, 2026-10-29: the menu bar panel draws in the plain look on its own branch (style), one look per app with plain the default, chosen by the owner: swift/menu-bar's `Look.app` and `Palette.plain(accent:)` now hold the plain values, ok in light a shade darker (#2a774b) so it reads 4.5 on a selected line. So the Swift side goes in that package, not a new one, and the tokens file must equal `Palette.plain`. What that branch's plan review found for the rest: MUI computes palette, typography and colorSchemes only from createTheme's first argument (node_modules/@mui/material/styles/createThemeNoVars.js deep-merges later ones raw), so the kit builds the theme itself, with `colorSchemes` and `cssVariables: true` rather than a mode argument; a copied stylesheet needs a `/* */` header, since the worker copies' `//` line would drop the `:root` rule after it, and `extension check` must cover the CSS copy; the stylesheet declares `color-scheme: light dark` so Chrome's own controls and scrollbars follow dark; SwiftUI has public custom Toggle and Menu styles but none for Picker or TextField, so the menu and the text field are kit views. And the four apps that copy one MUI color object (ai-buddy, buddy-system, disk-buddy, metamax) are console apps: they need a console MUI theme, not this one.

Also, chosen 2026-10-29 (the workspace-sweep thread's idea, the owner leaving the call to the style thread): the same theme builder makes the console MUI theme, so a web app picks its look as a menu bar app does. The tokens file holds the console values beside the plain ones (swift/menu-bar's `Palette` already holds both, which the equality test reads), and the builder takes the look and, in plain, the accent; page width and row height stay the app's own options, since they are all the four copies differ in. Evidence: client/src/theme.ts in ai-buddy (77 lines), disk-buddy (100), buddy-system (101) and metamax (119), at each project's main on 2026-10-29: ai-buddy's and disk-buddy's differ only in an `a` override and formatting, buddy-system's and metamax's only in pageMaxWidth (1200 and 1720), metamax's rowHeight 44 and formatting, and all four are #d4d4d4 on #050505 in JetBrains Mono at 13 with the same palette roles. Done when, added to the above: the web fixture draws the console theme too, and once it lands each of the four apps gets a ticket to drop its copy for it.

## host-helper-types · `app-kit/extension/testing/host` typechecks in an app that imports it

Goal: an app's `tsc --noEmit` fails as soon as one of its tests imports `startHostAsChrome`. extension/testing/host.ts:11 imports `noAnswer` from `../worker/port.js`, which has no `.d.ts` beside it, and an app's TypeScript reads no JavaScript under node_modules, so it stops with TS7016 "Could not find a declaration file for module '../worker/port.js'" (amazon-connector on v0.23.0, TypeScript 7, `allowJs`, `skipLibCheck`; `--maxNodeModuleJsDepth 1` does not help). The kit's own typecheck passes because it compiles the worker files itself with `checkJs`. Found moving amazon-connector to v0.23.0, 2026-10-29, which kept its own host test start-up for now. A `.d.ts` for the worker file a TypeScript module imports (as the Playwright steps have), or the refusal's words in a TypeScript module both import, would fix it.
Done when: a test in the kit typechecks a scratch app that installs the kit and imports `app-kit/extension/testing/host`, `app-kit/extension/copy` and `app-kit/extension/harness` under a plain strict tsconfig with no `checkJs`, and passes; the README's host test example compiles in such an app.
Do not touch: the worker files' behavior.
Needs: nothing.
Touches: extension/testing/host.ts, extension/worker/, test/.

## not-found-tap-size · The not-found page's home link is a 44-pixel tap target on a phone

Goal: web/NotFound.tsx:25-27 (v0.23.0) draws "Go to the home page" inline, one text line tall, and practices rules/interfaces.md asks for tap targets of at least 44px on a touch screen. sightline keeps its own not-found page until this lands (its link is 44px, client/src/Pages.tsx:910). Found by sightline's app-kit-adoption thread, 2026-10-29.
Done when: the kit's NotFound home link is at least 44px tall and wide on a touch screen, held by a browser test on a phone viewport in the web fixture.

## drawn-for-visitors · A screen's drawn signal reaches a placeholder the app holds for signed-out visitors

Goal: SignInGate's `signedOut` tree gets the default AppDrawnContext, a no-op (web/sign-in/SignInGate.tsx:44,221 at v0.23.0), so a kit screen that calls useAppDrawn, NotFound included, cannot lift a placeholder an app holds for visitors. sightline reads every screen to visitors and holds its wordmark over them until the screen draws (client/src/SignIn.tsx Visitor, client/src/access.ts useScreenDrawn); with the kit's NotFound bare, a visitor at an unknown address would see the wordmark forever. Either the gate's waitForFirstDraw covers the signed-out tree too, or an app can hand the gate its own drawn function for it. Found by sightline's app-kit-adoption thread, 2026-10-29.
Done when: a kit screen drawn for a signed-out visitor lifts the placeholder the app shows them, held by a test in the web fixture with a signed-out visitor at an unknown address.

## built-page-dot-folders · serveBuiltPage answers 404 for Vite's own folder

Goal: with `build: { manifest: true }`, which serveBuiltPage asks for, Vite writes `.vite/manifest.json` into the built folder, and serveBuiltPage serves any file there (web/server.ts:63-72 at v0.23.0), so the record of source paths is public at `/.vite/manifest.json`. It holds no secrets, but nothing a page needs is under `.vite/`. Found by sightline's app-kit-adoption review (researcher), 2026-10-29.
Done when: serveBuiltPage answers 404 for any address under `/.vite/` (and still reads the manifest itself), held by test/web-server.test.ts.

## request-without-gate · `request` takes its token from an app that runs its own sign-in, not only from SignInGate

Goal: app-kit's `request` (web/fetch.ts, `tokenFor`) reads the session only from `currentSession()`, which only `SignInGate` sets (web/sign-in/SignInGate.tsx:148), and `setCurrentSession` is not exported from `app-kit/web` (web/index.ts). An app that draws its own sign-in under Clerk's own `ClerkProvider` therefore cannot use `request`: every call would go out with no token and get a 401. argon-watcher is that app: its own fetch wrapper (src/lib/api.ts:37-83, a 401 reload latched for 15 seconds, the status read before the body) stays because of this, and threads `auth` through some forty calls. Found moving argon-watcher onto the kit, 2026-10-29 (argon-watcher's app-kit-adoption).
Done when: an app without the gate hands `request` its session (a token getter, a "now" token for keepalive, and what a refused session does) through one exported call or hook, documented in the README's web section beside `request`, held by unit tests of a 401's retry and refusal through it; argon-watcher's follow-up then deletes its wrapper.
Do not touch: SignInGate's own behavior.

## pull-crossing · PullToRefresh tells the app when a pull crosses its line, and shows that it is armed

Goal: argon-watcher's iPhone app ticks the phone (a light haptic impact) once as a pull to reload passes its line, and fills the mark solid once letting go would reload; its owner approved the tick on 2026-10-26 (argon-watcher .claude/plans/mobile.md, haptic-tick). app-kit's `PullToRefresh` (web/PullToRefresh.tsx:37-58) takes only `onPull`, `top` and `ignoreWhile`, and its mark only changes its border color, so argon-watcher keeps its own src/PullToReload.tsx rather than lose the tick. A callback on crossing (with the re-arm only some pixels back under the line, so a thumb resting on it fires once, as argon's lineTick does in src/lib/haptics.ts) lets each app give its own feedback; a solid armed mark is the kit's look to decide. Found moving argon-watcher onto the kit, 2026-10-29 (argon-watcher's app-kit-adoption).
Done when: PullToRefresh calls an `onArmed`-style callback once per crossing of its line, and its mark shows armed, each held by the kit's tests; argon-watcher's follow-up then deletes its own component.
Do not touch: how a pull starts and what it reloads.

## crash-check-past-service-worker · A crash's look for a newer build gets past the app's service worker

Goal: ErrorBoundary's look for a newer build (`servedEntry`, web/new-build.ts:38) is `fetch('/', { cache: 'no-store' })`, and in an app with a Workbox precache service worker that fetch is answered from the precache: workbox-precaching 7.4.1's PrecacheRoute matches on the URL alone, with no check of the request's mode or cache setting, and generateURLVariations turns `/` into the precached `/index.html` (directoryIndex). So the crash check always reads "the server serves this build" and never reloads onto a deploy; the new-deploy line's look (`lookForNewBuild`) asks the same way. Found moving urge-surfer onto ErrorBoundary (urge-surfer app-kit-adoption, landed 2026-10-29 as e8267ad; its vite-plugin-pwa generateSW precaches index.html). A likely fix: ask for `/?build` (any query), which misses the precache's `/index.html` match and is no navigation, so it reaches the server, where serveBuiltPage answers it with the index page and no-cache.
Done when: a browser test with a precache service worker controlling the page (serviceWorkers allowed, the page reloaded once so it is controlled) serves a newer build and finds the crash check reading it, and the same test without the fix fails.
Do not touch: the apps; each takes the fix with its next upgrade.
Needs: nothing.
Touches: web/new-build.ts, web/e2e, README.md.

## not-found-safe-area · The not-found page's heading sits below a phone's status bar in an app that draws under it

Goal: web/NotFound.tsx (v0.23.0) pads its top by 48px (`py: 6`), and an app whose page sets `viewport-fit=cover`, as every Tauri iPhone window onto a hosted site does, draws under the status bar, which is about 59px on a Dynamic Island iPhone, so the heading would sit under the clock. getter wraps the kit's page in a Box with `pt: 'env(safe-area-inset-top)'` (client/src/main.tsx, app-kit-adoption landing) until the kit does it itself. Found by getter's app-kit-adoption thread, 2026-10-29.
Done when: the kit's NotFound adds `env(safe-area-inset-top)` above its own padding (and the bottom inset below), a test holds the padding, and getter's wrapper can go.

## health-check-takes-app-check · appServer's health route takes the app's own check, so a database that does not answer is a 503

Goal: server/start's `appServer` (v0.25.0) registers `GET /api/health` before the app's routes and always answers 200 `{ ok: true, service, commit }`, so an app cannot keep its own check on top. getter's health route answers 503 `{ ok: false, database: false }` when its database does not answer (server/app.ts:50-53, held by server/app.test.ts), and Railway's deploy check reads it (railway.json `healthcheckPath`), so a deploy whose database is unreachable never goes live. Taking appServer as it is would lose that. An option such as `appServer({ service, check: () => Promise<Record<string, boolean>> })`, answering 503 when any value is false and adding the values to the body, lets getter (and any app on a database) move onto it. Found by getter's app-kit-adoption thread, 2026-10-29.
Done when: appServer takes the app's check, a test through app.request holds a failing check's 503 with its fields and a passing one's 200 with commit and service, and the README's server section shows it with openDb.

## server-start-headers · appServer sends the baseline security headers on every answer, the health route's included

Goal: an app on `appServer` that adds Hono's `secureHeaders()` (nosniff, frame denial, referrer policy) gets them on every answer but `GET /api/health`, since the kit registers the health route before the app's own middleware can run, and Hono answers it first. argon-watcher found this on 2026-10-29 moving onto v0.25.1 (its review: the health answer lacks X-Content-Type-Options, X-Frame-Options and Referrer-Policy, while every other answer has them); argon's comment now names the gap. Every app would want the same headers, so the kit can send them itself, or take the app's middleware before its routes.
Done when: an app on appServer gets the baseline security headers on the health answer and every other, held by a test in test/server-start.test.ts, and the README's whole server says whether the app still adds `secureHeaders()` itself.
Needs: nothing.
Touches: server/start/index.ts, test/server-start.test.ts, README.md.

## opendb-idle-timeout · openDb can close idle Postgres connections before Railway's proxy drops them

Goal: lifeform could not take `app-kit/server/postgres`'s `openDb`, because it opens postgres-js with no options (server/postgres/index.ts, `postgres(location, { onnotice })`), and lifeform needs `idle_timeout: 20` and `connect_timeout: 10`: Railway's proxy silently drops a connection idle for long enough, and the first query after a long pause (a 40-second narration generation) wrote to a dead socket and failed with CONNECTION_CLOSED (lifeform server/db/index.ts). Found while moving lifeform onto app-kit (lifeform thread onto-app-kit, 2026-11-02). Either open Postgres with those as the kit's defaults, since every app on Railway's Postgres meets the same proxy, or take them as an option.
Done when: openDb's Postgres connections close themselves after an idle period shorter than Railway's proxy's, with a test, and the README says so.
Do not touch: the PGlite path.
Needs: nothing.
Touches: server/postgres/index.ts, its test, README.

## iphone-run-prints-page-address · `app-kit iphone run sim` says which page the build loads

Goal: an agent or person sees from the run's own output which page address the iPhone build loads. An address that does not answer still builds, exits 0 and prints "running in the Simulator", and the app is blank. In a trial on Getter, an agent lost one whole build to this, because Vite answered on `localhost` and refused `127.0.0.1`. An app whose page is a hosted site also loads the deployed site when given no address, so a page changed on a branch never shows, and nothing printed says so. `TAURI_PAGE_ADDRESS` is read by each app's shell at compile time, so the run can see it in its environment but not an app's own default or another variable, such as Argon's `TAURI_ARGON_URL`. Work out what can be said truthfully for each.

Done when: a Simulator run prints one `[iphone]` line naming the address it was given, or saying it was given none and that the app then loads its compiled-in default, and a test holds it.

## iphone-apps-to-testing-section · the iPhone apps move to a kit whose run names the testing section

Goal: `bun run iphone` in each iPhone app names the README section "Testing the iPhone app yourself", which needs app-kit v0.33.3 or later. On 2026-11-02 Argon Watcher, Getter, Past the Break and Timescale were on 0.25 and Metamax's iPhone app on 0.33.1. The always-loaded rule already points agents at the section on GitHub, so nothing is broken meanwhile; this makes the pointer show in the run itself, and puts the section in each app's own `node_modules`. Each move is that app's own work, in a thread there, since 0.25 to 0.33 may ask something of the app.

Done when: each of those apps pins app-kit v0.33.3 or later on its main, with its gates passing.

## vite-env-example · the README's sign-in example compiles under Vite 8

Goal: the README's "An app built on it" example calls `signInFromEnvironment(import.meta.env)`, which fails an app's typecheck under Vite 8 with TS2559 ("Type 'ImportMetaEnv' has no properties in common with type 'PageSignInSettings'"): both settings are optional, so TypeScript treats the type as weak, and Vite's ImportMetaEnv declares neither. assay worked around it with a client/src/vite-env.d.ts declaring VITE_CLERK_PUBLISHABLE_KEY and VITE_SIGN_IN. Either the README shows that declaration beside the example, or the kit ships one an app references, so the example compiles as written.
Done when: an app that copies the README's example and runs its typecheck under Vite 8 gets no error, held by a typecheck of a fixture that uses it.
Found by: assay/onto-app-kit, 2026-11-02, moving assay onto v0.33.4.

## actool-hang · The icons test's Xcode compile hangs past its limit when the machine is busy

Goal: test/icons.test.ts "the icon sets it fills compile in Xcode for the Mac and the iPhone" runs `xcrun actool --compile` on the icon sets it draws, with a 120 second limit. In the first landing of testflight-icon-check (2026-11-02, load average near 100) the Mac compile ran the whole 120 seconds and was stopped (code -1, nothing printed), so the gates went red and the landing stopped; alone it passes in 4.4 seconds. Why actool hangs is unknown: it may wait on Xcode's shared asset catalog service, which several builds at once contend for. Found by the testflight-icon-check thread.

Done when: the cause is known from a reproduction (actool under a load like the gates' or beside a second actool), and the test either no longer hangs under that load or stops for a reason it names, with no longer limit as the fix.

## postgres-tests-do-less-work · test/postgres.test.ts stops timing out on a busy machine because it does less work

Goal: the database tests build real embedded Postgres databases under a fixed time limit, and on a busy machine they run out of it, which stops landings that changed none of their files. On 2026-11-02 the file failed all three times it was run alone at load 250 to 310, a different test timing out each run; a clean copy of main failed in it too; and a landing with 686 of 687 tests passing stopped on the `openTestDb` set-up taking 18.9 seconds against its 15 at load above 400. The time taken is all that is measured so far: where it goes is not traced, so trace it first. `server/postgres/index.ts` makes an empty database once per test process, and its comment says PGlite starts from files in about a tenth of the time, so saving those files once per test run is the first idea to try, untested. `test/land.test.ts` and `test/command.test.ts` also time out at load around 300, on clean main too, cause unknown: this ticket does not settle them, and says what it learned about them.
Done when: with no time limit raised, `test/postgres.test.ts` passes five runs in a row beside enough CPU-busy processes to hold the load at twice the machine's cores or more, the same runs on the old code fail, and the plan or the commit says how much time the file's set-up took before and after.
Do not touch: time limits in the tests or bunfig.toml; what `openDb` does for apps.
Needs: nothing.
Touches: server/postgres/index.ts, test/postgres.test.ts.

## plan-landings-check-public · A landing of only plan files still refuses a personal fact

Goal: a landing that changes only `.claude/plans` skips every gate (`scripts/land.ts`, "the gates are skipped"), so nothing checks that the repository, which is public, stays free of personal facts. On 2026-11-02 a plan landed that way with an address `test/public.test.ts` did not allow, which turned that file's two tests red on main for every other thread until another landing allowed the address at 850283f. Running the file as it is would bring its own fault along: its history tests read `git log --all`, so another thread's unlanded local commit (1db5561 on 2026-11-02) stopped a landing that had nothing to do with it. The check on a landing looks at the files and commits that landing adds to main.
Done when: a test in `test/land.test.ts` shows a plan-only landing holding a home folder path stopped before it pushes, and one holding only allowed text landing with the other gates still skipped; and a personal fact in a commit on another local branch stops no landing.
Do not touch: what `test/public.test.ts` counts as a personal fact; the other gates, which plan-only landings keep skipping.
Needs: nothing.
Touches: scripts/land.ts, test/public.test.ts, test/land.test.ts.

## swiftc-build-check-runs · The Swift build's status item check fails when it cannot read the SDK version

Goal: `swift/menu-bar/e2e/swiftc-build.sh` line 18 checks that a theme built with the macOS 27 SDK holds the status item session, and it decides whether to check from `xcrun --show-sdk-version`. In the gates of the landing at 21ef40f on 2026-11-02, `xcrun` said it could not look up the SDK, the version came back empty, and the script printed `[: : integer expected`. A test that errors inside an `if` counts as false, so the check did not run, `set -e` did not stop the script, and the gate passed. A check that can be skipped this way says nothing about the theme. Why `xcrun` could not find the SDK on that run is not known, so find that out too.
Done when: with `xcrun --show-sdk-version` failing or printing nothing, the script exits non-zero and says it could not read the SDK version, shown by a test that runs it with a stand-in `xcrun`; with a real version the check runs as before; and the ticket's landing says why `xcrun` failed in that gate run.
Do not touch: the macOS 26 SDK build further down the script; Sources/MenuBarTheme.
Needs: nothing.
Touches: swift/menu-bar/e2e/swiftc-build.sh, a test in test/.

## owner-recheck · The owner check asks again after a while instead of remembering each answer until restart

Goal: ownerCheckByEmail (authentication/owner/index.ts:15-26 at v0.33.4) keeps each user's yes or no for the life of the process, so an owner who removes or loses their verified address keeps access until the next deploy, and a user who adds the owner address is refused until then. Found while moving reminder-x onto app-kit, 2026-11-02 (a review finding accepted there as the kit's design).
Done when: a kept answer expires after a set time (a few minutes) and the next request asks the provider again, with a failed ask still not kept; a unit test with a fake clock shows a removed address refused after the expiry and allowed before it.
Do not touch: requireOwner's refusals and their wording.
Needs: nothing.
Touches: authentication/owner/index.ts and its test, the README's owner section.

## amazon-orders-status-line · An order's status comes from Amazon's marked delivery line, so "Arriving" lines stop reading as null or cut short

Goal: `readOrders` in `server/amazon-orders/index.ts:120` finds an order's status with a pattern over the whole card's text. `Arriving [a-zA-Z0-9 ]+?(?= [A-Z])` only ends at a following space and capital letter, so "Arriving tomorrow" followed by "and 6 more" reads as null, "Arriving tomorrow by 8 PM" reads as "Arriving tomorrow by 8", and "Arriving Nov 3 - Nov 5" reads as null. "Delivered today" reads as null too. The pattern moved unchanged from the source when the part was made in v0.34.0. The fixtures mark the line with `.delivery-box__primary-text` (`test/fixtures/amazon-orders/orders.html:6` and `:14`), and the reader ignores it. The shapes above come from reading the code and running the pattern on made-up cards, and the exact wording of real "Arriving" cards is not in this repository: check against recorded real pages on the owner's machine, read-only, printing only counts and equality, before changing it.
Done when: a test over a made-up card holding each of those lines reads the whole line as `status`; a card with no marked line still reads "Cancelled" and "Refunded" as now; and over the real recordings the new reader's answers differ from the old one's only where the old one read null or cut the line short, reported as counts.
Do not touch: `Order`'s shape and field names; the other readers.
Needs: nothing.
Touches: server/amazon-orders/index.ts, test/amazon-orders.test.ts, test/fixtures/amazon-orders/.

## amazon-orders-unclosed-tags · A script or style with no closing tag is gone from the parsed page too

Goal: `parse` in `server/amazon-orders/index.ts:24-29` strips scripts and styles with patterns that search only up to the last closing tag, which keeps it linear on a page of unclosed tags. A `<script>` or `<style>` after that point reaches the parser and stays in the page, and a direct check found its trailing text read as `moreItems` from inside a card. The patterns also miss `</script >` and `</style >`, which HTML allows. So the README's "with its scripts and styles dropped" is untrue for such a page. Only a crafted page does this: over the 10 real order recordings the reader matched its source. Removing what is left after the parse, as well as before it, should be enough, since the before-parse strip is there because happy-dom's parser mishandles these tags inside `<svg>` and `<table>`.
Done when: a test holds that a page with an unclosed script inside a card, and one closed with `</script >`, has no `script` or `style` element after `parse` and that card's `moreItems` reads as its real count; the test "a page of unclosed script and style tags reads as none, and at once" still passes at its size; and "reading a page sent to a server fetches nothing it names, runs nothing in it, and leaves the process free to end" still passes.
Do not touch: the template parse, which is what keeps a page from acting on the server.
Needs: nothing.
Touches: server/amazon-orders/index.ts, test/amazon-orders.test.ts.

## amazon-orders-periods-year · The order history's periods follow the year on a server that runs past New Year

Goal: `PERIODS` in `server/amazon-orders/index.ts:85` is worked out once, when the module loads, from `new Date().getFullYear()`, as the README's table says. A server started in December and still running in January keeps asking for last year as "this year" and never asks for the new one, so orders placed in the new year are found only through `last30` and `months-3`. Getter and amazon-connector import `PERIODS` as an array, so a change has to say how they move.
Done when: a test with the clock moved across New Year holds that the periods asked for include the new year and still number 15, with the first two as they are; importers' move is written in the README's section; and the release line says minor if apps have to change.
Do not touch: `ordersPath`, `orderDetailsPath` and the readers.
Needs: nothing.
Touches: server/amazon-orders/index.ts, test/amazon-orders.test.ts, README.md.

## amazon-orders-server-types · The part typechecks in a server or tool compiled without the DOM library

Goal: `parse` returns the global `DocumentFragment` (`server/amazon-orders/index.ts:24`, with a cast at `:28`) and `textOf` takes the global `Element` (`:32`). The README says this part is for a server or a tool, and an app compiled with `lib: ["ESNext"]` should report `Cannot find name 'DocumentFragment'` in the kit's source. Nobody has compiled it that way yet, so first reproduce it. The kit's own `tsconfig.json` includes `DOM` and `DOM.Iterable`, so its gates cannot catch this. happy-dom exports its own types, which would also remove the cast.
Done when: a test typechecks `server/amazon-orders/index.ts` under a config with no DOM library and finds no errors; the kit's own typecheck stays at zero errors; and amazon-connector's and getter's use of `querySelector` and `querySelectorAll` on what `parse` returns still typechecks, shown by the shape the test uses.
Do not touch: what the functions do at run time.
Needs: nothing.
Touches: server/amazon-orders/index.ts, a test in test/.

## menu-bar-plain-copy-line · the menu bar theme's copy line in a plain tone

Goal: `ItemLine` in `swift/menu-bar/Sources/MenuBarTheme/Pieces.swift` always draws its text red, because it was made for problems. Fleet's menu bar app (worktron/fleet, `apps/menubar/Sources/Panel.swift` `LaterLine`) needed the same line in plain text for by-hand installs ("when you have a minute"), and wrote its own, which copies on click but cannot join the arrow keys since `Selectable` is internal. Add a tone to `ItemLine` (default `.error`, as today) so an app can draw a plain or secondary line with the theme's selection and "copy"/"copied".
Done when: `ItemLine(text, copy:, tone: .text)` draws in the given tone with arrow-key selection, its snapshot sample is in the theme's gallery, and a release tag exists; fleet's `LaterLine` can then be replaced by it at that tag (a fleet change, after).
Needs: none.
Touches: `swift/menu-bar/Sources/MenuBarTheme/Pieces.swift`, the snapshot samples.

## filled-button · the menu bar theme has a filled button for the one step a window asks for

Goal: Fleet's per-Mac window (fleet `apps/menubar/Sources/Window.swift`, struct FilledButton) needed a solid button for its one next step ("Set up m3", "Try again") and the menu bar theme (`swift/menu-bar/Sources/MenuBarTheme`) has none, so Fleet drew its own: the theme's text color as the fill, the background color as the label, the body size at semibold, rounded, in both looks. Add one to the theme in its tokens so Fleet, and any app on the theme, uses the theme's instead, with a snapshot in the theme's own tests in dark and light.
Done when: MenuBarTheme exports a filled button drawn in dark and light by the theme's snapshot tests, a release tag carries it, and fleet can replace its own FilledButton with it by moving to that tag.
Touches: `swift/menu-bar/Sources/MenuBarTheme/`, its tests.

## webkit-offline-resume-bug · WebKit is told that resuming an offline audio context in a page that has gone crashes it

Goal: web/playwright-offline-audio.js guards `if (!document.defaultView) return;` because WebKit's `OfflineAudioContext::resumeRendering` has no `isStopped()` check (its `startRendering` and `suspendRendering` have one), so resuming in a torn-down document starts a render that fails `RELEASE_ASSERT(context().isInitialized())` in `OfflineAudioDestinationNode::renderOnAudioThread` and kills the page. The Web Audio spec says `resume()` there should reject with InvalidStateError. No public WebKit bug was found for it on 2026-11-04. web/e2e/offline-audio.e2e.ts "a step the kit runs after its frame is gone never crashes the page, and the page plays again" holds the reproduction: a context in a frame, the frame removed, the kit's held step run.
Done when: a WebKit bug report with a minimal page that reproduces the crash (no kit needed) is filed, and the guard's comment names the bug's address.

## menu-bar-swiftc-sdk · The menu bar theme's bare swiftc build check finds no Mac SDK and goes on quietly

Goal: in the gates, swift/menu-bar/e2e/swiftc-build.sh prints `xcodebuild: error: SDK "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk" cannot be located`, `xcrun: error: unable to lookup item 'SDKVersion'` and `swiftc-build.sh: line 18: [: : integer expected`, then passes (seen in the offline-audio-slow landing's gates, 2026-11-04). What its line 18 compares is empty, so whatever that check guards is not being checked.
Done when: the script finds the SDK the way the rest of the gates do, or fails loudly saying which SDK is missing, and its line 18 compares a real value.

## webkit-copy-launch · The first WebKit launch in each test process takes about 3.7 seconds from the kit's fresh Dock-free copy

Goal: web/e2e/offline-audio.e2e.ts launches WebKit through webkitWithoutDockIcon (web/playwright-webkit.js) into a per-process scratch folder, so every Playwright worker makes its own copy, and its first launch took 3.7 s against about 0.16 s afterwards (timed step by step on 2026-11-04; later launches in the same process are fast). With 9 workers that is paid up to 9 times per gate run, and an app's tests pay it the same way.
Done when: the cause of the slow first launch is known (the copy itself, or macOS checking a newly copied app), and either one copy is shared across test processes or the first launch is no slower than later ones, measured the same way.

## simulator-slimmer · A Simulator app-kit boots runs fewer iOS processes

Goal: on 2026-11-02 three booted Getter Simulators ran about 620 processes between them, and the Mac's load reached about 300. Since v0.36.0 a Simulator `app-kit iphone run sim` boots shuts itself down and at most two run at once, but each one still starts every iOS service a phone runs. Find which services an app check never needs (photo analysis, Siri, search indexing, and the like), turn them off in the Simulator the kit boots, keep the push notification service (apsd) and whatever sign-in and the app itself need, and measure the processes and load of one booted Simulator before and after.
Done when: one Simulator the kit boots runs measurably fewer processes, with the counts before and after in the commit; `app-kit iphone run sim` still installs and opens an app; the iPhone notifications and sign-in checks still work in it.
Needs: nothing.
Touches: tauri/iphone-simulator/, tauri/iphone-run/index.ts.

## simulator-device-cleanup · A deleted worktree's Simulator device is deleted too

Goal: `app-kit iphone run sim` makes one Simulator per linked worktree, named after it, and since v0.36.0 its watcher shuts it down once the worktree is deleted. The device itself stays in simctl's list and on disk (each holds an iOS data folder of its own), so they pile up as worktrees come and go. Delete the device once its worktree is gone, only for a device the kit made for a worktree, never one made by hand or a shared one.
Done when: a test shows the watcher deleting the device it shut down once its checkout is gone, and leaving alone a device the kit did not make; a device made by hand keeps working.
Needs: nothing.
Touches: tauri/iphone-simulator/lifetime.ts, tauri/iphone-run/index.ts.

## simulator-lock-races · The Simulator places and shut-down times have no race left

Goal: two rare races remain from the v0.36.0 Simulator work, both raised by its review. First, the lock in tauri/state.ts takes over a lock whose holder is dead with a plain write, so two runs that both find the same dead holder can both count places at once and boot a third Simulator for a while. Second, `app-kit iphone-simulator keep` writes the new time without the lock, so a watcher or a waiting run that read the old time just before can shut the Simulator down anyway. Make the takeover exclusive, and have keep and every shut-down for a time that has come decide under the same lock, reading the time again there.
Done when: a test holds two takeovers of a dead holder's lock and only one wins, and a test holds keep against a watcher at the same moment and the Simulator stays up with the new time; both fail on the code before.
Needs: nothing.
Touches: tauri/state.ts, tauri/iphone-simulator/lifetime.ts.

## swiftc-build-no-sdk · the bare swiftc build stops when xcrun names no SDK version, instead of skipping its macOS 27 check

Goal: swift/menu-bar/e2e/swiftc-build.sh checks that a theme built with the macOS 27 SDK holds the status item session (`[ "$(xcrun --show-sdk-version | cut -d. -f1)" -ge 27 ]`). On a Mac whose Command Line Tools cannot find their default SDK, xcrun prints "unable to lookup item 'SDKVersion'", the version is empty, `[` fails with "integer expected", the check reads as false, and the gate passes with it skipped. Seen in scripts/gates.sh output on 2026-11-02, twice. The script should stop with a clear line naming the missing SDK, or find the SDK it builds with another way, so the check never passes by not running.

Done when: swiftc-build.sh with an xcrun that answers no SDK version exits non-zero with a line that says so, held by a test, and the gates still pass on a Mac with a working SDK.

## amazon-cart-empty-grocery · readCart's handling of an empty grocery cart is known from a recording, not guessed

Goal: no empty Amazon Fresh or Whole Foods Market cart has ever been recorded, so `app-kit/amazon-cart` does not know whether its page keeps the expanded grocery cart's checkout box naming the store (`#sc-fresh-buy-box` / `#sc-alm-buy-box` with `data-brand-id`). If it does, `readCart` reads it as a cart with no lines; if not, `readCart` throws `NotTheCart` ("The page's grocery cart has no checkout box naming its store"), and Getter would log an error where the person just checked out and emptied the cart. After the owner's next grocery checkout, record the empty cart page read-only with `amazon-connector raw GET '/cart/localmarket?almBrandId=<brand id>' --save cart-fresh-empty` (never by removing anything from a cart), add a scrubbed fixture to `test/fixtures/amazon-cart/` as its README says, and make `readCart` read it as that store's empty cart. A signed-in empty regular Amazon cart is unrecorded too; take one if it happens.

Done when: `test/amazon-cart.test.ts` reads a scrubbed fixture made from a recorded empty grocery cart as that store's cart with no lines (or the recording shows it cannot be told apart, and the README says so), and the README's "An empty grocery cart has never been recorded" paragraph and `test/fixtures/amazon-cart/README.md` say what the recording showed.

## mac-release-requirement · A Mac release whose signature would cost installed copies their permissions is refused

Goal: `app-kit mac release` checks the signing identity only by its name (tauri/mac-release/release.ts:120-125, `security find-identity`, and :179-182, `Authority=` in `codesign -dv`). A self-signed certificate of the same name made on another Mac passes both, but the release it signs has a different designated requirement (`codesign -d -r-`), and macOS ties Full Disk Access and other permissions to that requirement: every installed copy that updates to it loses them, silently. Either refuse a release whose designated requirement differs from the last release's (read from the last release's app, or recorded beside latest.json), or have the README's "Releases and updates" say how to export the one certificate to each Mac that releases, and refuse an identity whose certificate hash is not the recorded one. Found reviewing argon-watcher's Mac updates plan, 2026-11-05.

Done when: a release signed by a same-named but different certificate stops before publishing with a message naming both requirements, held by a unit test with recorded `codesign -d -r-` output, and the README says how a second Mac gets the same certificate.

## update-restart-front · The Mac app comes back in front after an update restart, whatever Tauri does

Goal: the window plugin's Cargo.toml (tauri/window/plugin/Cargo.toml:13-14) takes tauri 2.12.5 because its macOS restart goes through LaunchServices and brings the app back in front. Tauri's pull request 16462 (https://github.com/tauri-apps/tauri/pull/16462, merged 2026-11-05, in no release yet) adds `open -g` to that restart, so after an update (tauri/window/plugin/src/updates.rs) the app would come back behind other windows, and the first release with it is taken by every app's `cargo update`. Either bring the window forward on the first launch after an update restart (a marker the update writes before restarting, read at launch, then `show(app)`), or pin tauri below the release that carries the change, with the reason beside the pin. Found reviewing argon-watcher's Mac updates plan, 2026-11-05.

Done when: the window plugin decides "this launch follows an update restart, bringing the window forward" in its log and a Rust test holds that decision, or Cargo.toml pins tauri below the change with a test that fails if the pin is lifted; either way the README's updates paragraph says the app comes back in front.

## install-without-tarballs · Apps install app-kit without GitHub building a tarball on each install

Goal: every app takes app-kit in as `github:worktron/app-kit#<tag>` (README, "Taking it in"), so each `bun install --frozen-lockfile` (in CI, in Railway's build, in the TestFlight watcher and in `app-kit mac release`) asks `api.github.com/repos/worktron/app-kit/tarball/<commit>`, which GitHub builds on request. On 2026-11-06 that request answered 504 after about 11 seconds again and again: argon-watcher's pull request #189 (a plan-only change) failed CI three times at "install deps" with `error: GET https://api.github.com/repos/worktron/app-kit/tarball/3516c0a - 504` before a fourth attempt passed, and from the Mac the same address by short and full commit and by tag v0.43.0 answered 504 while tag v0.41.0 answered 200, with GitHub's status page reporting all systems operational. Thirteen projects install the kit this way; three have CI (argon-watcher, lifeform, reminder-x), and any Railway deploy can hit the same wait. The proposed fix: each release is also published as a package to a registry that serves stored files, npm being the likely one (whether GitHub's own registry asks for a token even for a public package, which would complicate Railway builds, is to be checked), and apps install `app-kit@<version>` on their next upgrade. Until then, the README's "Taking it in" gives the few lines that keep bun's download cache between CI runs, keyed on `bun.lock`, so a run that does not change the lockfile never asks GitHub. Seen on one day only so far: if it does not recur, the README note alone may be enough, and that is the first thing to decide.
Done when: either a release is installable as `app-kit@<version>` from a registry with no token, the release step publishes it, the README's "Taking it in" says to install it that way, and one app (argon-watcher) builds on CI and on Railway from it; or the owner decides the README note is enough. Either way the README holds the CI cache lines.
Do not touch: how apps upgrade beyond the one install line; the kit's code.
Needs: the owner's choice between publishing to a registry and the README note alone.

## gate-held-placeholder-over-app · The gate's held placeholder covers the app instead of pushing it down

Goal: while `SignInGate` holds its placeholder under `waitForFirstDraw`, it draws the placeholder (`{holding && held[1]}`, web/sign-in/SignInGate.tsx:349 at v0.43.1) before the hidden app, which already lays out (`visibility: hidden`, `display: contents`). An app whose placeholder is a full page, as most are, pushes its hidden screen a screen down, so a scroll made during the hold (an app's own scroll keeper, a link to a row, a test that scrolls to a row) lands a screen off once the placeholder goes. argon-watcher hit it on 2026-11-06 moving onto the gate: its phone test "back by the Topics link also selects the row" failed 2 of 4 runs, and Argon fixed it on its own side by drawing its placeholder `position: fixed` over the page (src/App.tsx `Placeholder`, ticket sign-in-gate). The gate should do that for every app: draw what it holds over the app, so the hidden app lays out where it will draw.
Done when: the kit's web fixture, given a full-height placeholder and `waitForFirstDraw`, scrolls to a row of its hidden screen during the hold and finds the row at the same page offset once the screen is drawn, held by a browser test; the README's "Sign-in gate" says the held placeholder covers the app; argon-watcher can drop its own `position: fixed` in a follow-up.
Do not touch: what the gate shows when, and the `data-sign-in-gate` mark.
Needs: nothing.
Touches: web/sign-in/SignInGate.tsx, web/e2e, README "Sign-in gate".

## google-refusal-wording · A refused Google sign-in says to try Google again, not to send a new code

Goal: the Clerk adapter's `startGoogle` (authentication/clerk/google.ts:34 and :39 at v0.43.1) words a refusal with `messageFor` from email-code.ts, the emailed code's words. When Clerk refuses the start of a Google sign-in for too many requests, the person who tapped Continue with Google reads "Too many tries. Wait a minute, then send a new code." (seen in argon-watcher's browser tests on 2026-11-06, under the development instance's rate limit). Every other refusal there reads "Signing in did not work. Try again." with no word of Google. Google's start gets words of its own, such as "Too many tries. Wait a minute, then continue with Google again.", and the emailed code keeps its own.
Done when: a unit test of `startGoogle` with a stand-in Clerk that answers `too_many_requests` gets the Google wording, and one that answers an emailed-code refusal through `sendEmailCode` still gets "send a new code"; no message reached from Google's start names a code.
Do not touch: the emailed code's words.
Needs: nothing.
Touches: authentication/clerk/google.ts, authentication/clerk/email-code.ts, test/clerk.test.ts.

## signed-out-home-slot · The sign-in gate draws an app's signed-out home page at its front address

Goal: apps on the kit now give signed-out visitors a home page at their front address and keep the plain sign-in card everywhere else. Each one does it with its own few lines over SignInGate's `signedOut`: lifeform's client/src/features/auth/SignedOutHome.tsx (`SignedOut` checks `useLocation().pathname === '/'`, landed 2026-11-06), and the home-page threads for getter, timescale and argon are writing the same check. With a `signedOutHome` prop or similar, the gate would decide the address itself, and every app would get the same tested rule: the home page at `/`, the card elsewhere, and the wordmark alone while the provider loads. Each app's page and words stay its own. Left by lifeform's home-page thread, 2026-11-06.
Done when: an app passes its home page to the gate and drops its own address check; the web fixture's browser test holds that a signed-out visitor at `/` sees the home page, at an inner address sees the sign-in screen, and that a signed-in reload of `/` never shows the home page.

## store-zip · `app-kit extension publish`: the Chrome Web Store zip and upload, once a second extension publishes

Goal: every extension publishes to the Web Store through one script (practices' rules/extensions.md), and Getter wrote its own: its scripts/extension-zip.ts (main eefec52) builds the zip from a clean checkout at origin/main's tip, drops the manifest's `key`, stamps `version` as `1.0.<commit count>`, refuses a version not above the Store's and a Store key that is not the manifest's, and uploads and publishes through chrome-webstore-upload 6.0.1 (Google's v2 API) with the login in `op://agents/Chrome Web Store API`. Moving it into the kit was cut from the marketing plan (.claude/plans/marketing.md, review finding 1) because it would serve only Getter: the next two extensions headed for the Store both have pages Getter's zip never follows. Beeline's manifest has a popup, an options page and a web-accessible page; always-be-closing's has a popup and toolbar icons (`action.default_icon`), and its scripts/strip-dev-permissions.sh drops `nativeMessaging` from the Store's manifest. Start this when always-be-closing publishes.

Shape, from the plan's review: the zip follows the worker's imports (`unlistedImports`), rule files, icons, `action.default_icon`, and each HTML page the manifest names with the scripts and styles it loads; every other manifest field that can name a file is refused by name from an allowlist rather than skipped; the app names development-only permissions to drop; the commit and a clean tree are checked again just before upload (as tauri/mac-release/release.ts does); publish's `warningInfo.warnings` are printed; `app-kit extension listing` runs first and its failure stops the upload; the README says the Google login must come from an Internal consent screen or one In production, since a Testing one's refresh token expires after 7 days. Getter and always-be-closing move onto it in the same work.

Done when: `app-kit extension publish` builds a zip from a fixture extension with a popup, an options page and a toolbar icon that holds exactly the files the manifest leads to, refuses a manifest field it cannot follow by name, and drops a named permission; run on clones of Getter and always-be-closing, each zip's file list and manifest match what their own scripts build apart from the version; both apps' publish scripts call it.

## app-store-listing · The App Store listing kept in the app's repository and sent through App Store Connect, with its checklist

Goal: Getter's iPhone app is on TestFlight (app-kit's tauri/testflight) and moving toward release, published but private if the owner chooses (Apple's Unlisted App Distribution), and its listing would be typed into App Store Connect by hand. Unlike the Chrome Web Store, Apple's App Store Connect API sets the listing: name, subtitle, description, keywords, promotional text and what's new on appStoreVersionLocalizations and appInfoLocalizations, and screenshots through appScreenshotSets and appScreenshots (reserve, upload, commit). The kit already holds the App Store Connect key and calls (tauri/testflight/key.ts, app-store-connect.ts). The same checklist idea as `app-kit extension listing` (v0.45.1) applies: each field's length limit (name and subtitle 30, keywords 100, promotional text 170, description 4000, to be confirmed against Apple's current documentation), the privacy policy and support links answering, the build's version above the live one, and the dashboard-only steps named as the owner's (App Privacy answers, age rating, export compliance, pricing and countries, review notes with a demo sign-in).

Done when: Getter's repository holds its App Store listing as a file; an app-kit command checks it and prints passed, failed or yours as the extension check does, and with a flag sends the text and the screenshots Getter's `bun run store:images` writes with `app-kit web drive` (dist/store/iphone-6.3, iphone-6.9, ipad-13) to App Store Connect for the version being prepared; a unit test with recorded App Store Connect answers holds each call; run on Getter, App Store Connect shows the listing text from the file.

## iphone-duo-sizes · `app-kit web drive` writes App Store images for iPhone Duo's two displays

Goal: Apple's screenshot specifications page (developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications, read 2026-11-06) lists iPhone Duo with an outer display at 1398 by 2034 pixels and an inner display at 2007 by 2853, portrait. It says screenshots for it "will be required for any app using the iOS 27.1 SDK or later" starting in April 2027. `app-kit web drive` (v0.45.5) has App Store sizes for iPhone 6.3-inch, iPhone 6.9-inch and 13-inch iPad only, so an app on that SDK would have no Duo images to upload. Raised by Getter's store-images thread on 2026-11-06.

Shape: two more sizes in web/drive.ts's SIZES (a CSS viewport and scale whose product is each display's pixels exactly, drawn as the iPhone app like the other App Store sizes), confirmed against Apple's page and a Duo Simulator's screen size at the time it is built; Getter adds them to its `store:images`.

Done when: a steps file with each Duo size writes an image of exactly that display's pixels with no alpha channel, held by web/e2e/drive.e2e.ts's store size test, and the README's size table lists both.

## text-size-row-arrow · the Text size menu's arrow never covers its value at large sizes

Goal: in `TextSizeSetting` (web/TextSizeSetting.tsx, v0.45.4), at 200% chosen on a 375-pixel phone the menu's arrow is drawn over the value, so it reads "200%" with the arrow across its last character. The arrow and the select's right padding are sized in pixels while the value grows with the root size (seen in assay's browser test screenshot of its Settings page at 200%, assay e2e/text-size.e2e.ts). Size the arrow's room with the text, or move the arrow clear of the value.
Done when: a kit browser test at 200% and at the largest Text Size finds the arrow's box and the value's text not overlapping, with screenshots looked at in light and dark.
Found by: assay/app-kit-v0-45-4, 2026-11-06.

## iphone-app-extensions · An iPhone app built with Tauri ships an app extension, such as a share sheet entry, signed by the TestFlight upload

Goal: metamax's iPhone app sends a screen recording to the Mac from its New thread screen (metamax main b797eb8, 2026-11-07), and the owner wants the same from the iPhone's share sheet, so a recording goes to metamax from Photos without opening the app. A share sheet entry is an app extension: a second target with its own bundle id inside the app, which Tauri neither makes nor keeps, since it regenerates the Xcode project under gen/apple. tauri/testflight/signing.ts signs one target: it fetches the App Store provisioning profile for the app's own bundle id (bundleIdentifier) and hands it to Tauri as IOS_MOBILE_PROVISION, so an extension inside the app would go to App Store Connect unsigned or with the wrong profile. What the kit would need, all to confirm against Apple's and Tauri's documentation when built: the extension's Swift sources kept in the piece's folder and added to the generated project on every build (as the iPhone plugins are built from node_modules); its App ID and App Store profile made through the App Store Connect calls the kit already holds (tauri/testflight/app-store-connect.ts); an App Group both targets share, so the extension can hand a large file to the app, since an extension's memory is limited (recalled as about 120 MB) and a recording runs to a gigabyte; and the upload signing each target with its own profile. Raised in the app-kit thread screen-recording on 2026-11-07, from the metamax thread share-video, which left the share sheet as a later step for this reason.

Done when: an app on the kit names an extension's folder, and `app-kit testflight upload` builds it into the app, makes or reuses its App ID, App Group and profile, and signs both targets, held by unit tests with recorded App Store Connect answers and a signing build for the iPhone simulator in the gates; and metamax's iPhone app, on a TestFlight build, shows metamax in the share sheet for a video in Photos.

## clerk-google-client-check · A browser test step fails when an app's Clerk development instance is on Clerk's shared Google client or lacks the Google permissions the app asks for

Goal: an app that asks Clerk's Google connection for more than sign-in (Timescale asks for Google Calendar, getter for Gmail) learns from its own sign-in tests, in seconds and by name, when its development instance is on Clerk's shared Google client or its connection's scopes lack what the app asks for, instead of a Connect or Reconnect test timing out with no reason. Found 2026-11-07 in Timescale (clerk-dev-google-client, landed f9092f5): its development instance had no Google client of its own, and since 2026-10-30 Clerk refuses extra permissions on the shared client (400 `oauth_additional_scopes_not_supported_for_shared_credentials`, clerk/clerk-docs 6dbdb3634), so the Mac app's Reconnect test failed on every branch for a day before anyone found why. The check needs no account: `POST <frontend api>/v1/dev_browser` for a token, then `POST /v1/client/sign_ins?__clerk_db_jwt=<token>` with `strategy=oauth_google` and a `redirect_url`, and the answer's `response.first_factor_verification.external_verification_redirect_url` carries Google's `client_id`, `redirect_uri` (on `clerk.shared.lcl.dev` for the shared client) and `scope`. The Frontend API host comes from the publishable key. Timescale's AGENTS.md (Hosting, "One Google approval") describes it. Build it as a kit test step that each app calls with the permissions it needs, then have Timescale and getter call it.
Done when: a kit test step, given an app's publishable key and the Google permissions it needs, fails naming the cause against an instance on Clerk's shared Google client or missing a permission, and passes against Timescale's development instance as it is now; Timescale's sign-in tests call it.

## label-secondary · The plain look's section label in secondary gray on the web and in an extension, as in the menu bar theme

Goal: since v0.47.0 a plain section label draws in secondary gray in the menu bar theme's panel and windows (swift/menu-bar's LabelText), because muted (#8e9197) measures 2.9 to 1 on the plain paper #f6f5f2, under 4.5 to 1. The web theme's label (web/theme.ts, the overline variant, `text-disabled`, which is muted) and the extension stylesheet's `.label` (extension/look.css, `color: var(--muted)`) still draw it in muted, so the plain look's one label is two colors and fails contrast on the web and in an extension. Move both to secondary, make PLAIN_SIZES' label comment in look/index.ts and the Swift copy say secondary everywhere, and rewrite README's "The plain look's pieces in MUI" line, which says muted. Left out of the menu-sections work (v0.47.0) by the owner's choice, 2026-11-07, as beyond that brief.

Done when: a plain web page's section label and an extension page's `.label` draw in the plain secondary color in light and dark, a test holds each (test/theme.test.ts for the overline, a look.css test for `.label`), the extension fixture's copy matches (`bun bin/app-kit.ts extension copy extension/test/fixture/kit`), and the README says secondary.

## persona-timeline · `app-kit web drive` waits with no taps and writes a timeline, and Sightline drives with it

Goal: `app-kit web drive` (v0.46.1) drives an app's seeded server headless from a steps file, with goto, click, fill, waitFor, signIn, clockAt, advance, read and shot, cookies, a time zone, a locale and an app's own init script, and Getter makes its store screenshots with it. What the `persona-driver` ticket asked for and it still lacks: a step that waits a set time with no taps (for a persona who sits through a whole call, as urge-surfer's experience plan needs), and a timeline file per run (each step, its screenshot, the time on the page's clock) with flags for a screen that waits forever, a stretch where nothing on screen changes, and the same line shown twice. Sightline still runs its own `scripts/persona-look.ts`; the kit's driver was shown to give the same screens on Sightline's main 59d9b14 (identical trees and image bytes), but Sightline is on app-kit v0.23.0 and was not moved.

Shape: a `wait` step and a timeline written beside the images, in web/drive.ts, held by web/e2e/drive.e2e.ts. Sightline upgrades to the kit, points its walk-through at `app-kit web drive`, and deletes its own driver and its test.

Done when: a steps file with a wait writes a timeline whose flags each fire on a test page made to show them, held by app-kit's tests; Sightline's walk-through runs on app-kit's driver and its scripts/persona-look.ts is gone.
Do not touch: the persona files and serve commands, which stay each project's own.

## test-git-identity · The Mac release, apps and TestFlight upload tests give git an identity and git itself, as the watcher's do

Goal: since 72e5fd1 the TestFlight watcher's tests hand the git they run an identity (`GIT_IDENTITY_ENV` in test/testflight-stand-in.ts) and git itself first on the path (`pathWithGitItself`, Xcode's developer folder from xcode-select, as Homebrew finds it). Without an identity, a git that writes a ref under an empty home folder makes up an email from the machine's network name, and that lookup through mDNS waited out 5 seconds in stretches on a busy Mac (stack samples of a stalled clone, checkout and fetch all sat in `files_log_ref_write > ident_default_email > getaddrinfo > mdns`); Xcode's /usr/bin/git also runs its license check for every new home folder. Other tests give programs an empty home folder the same way: test/mac-release.test.ts:46 (tauri/mac-release/release.ts:91 runs a fetch, which writes a ref), test/apps.test.ts (the apple-messages thread saw its clones blocked past 5 s on 2026-11-07), and test/testflight-upload.test.ts:53 and :108 (read-only git only, so they pay just the shim). Those tests pin PATH on purpose (`/usr/bin:/bin`), so each takes its own look before git itself goes first on it. Found by the testflight-watch-slow thread, 2026-11-07.

Done when: each of these files runs git with an identity in its environment, held by a test like the watcher's "the watcher's git in these tests has an identity, so writing a ref never looks up the machine's name", and each passes several runs in a row at load above 20 with every test under 15 s.

## gate-refused-account · The sign-in gate shows a signed-in stranger that their account is not allowed

Goal: `requireOwner` and `requireInvited` from `app-kit/authentication/owner` answer a signed-in person who is not the owner, or not invited, `403 {"error":"This account is not allowed to use <appName>"}`, but the web kit acts only on a 401 (`web/fetch.ts`: a 401 is retried with a fresh token, then the gate shows the sign-in screen saying the session ended). A 403 is thrown as an ApiError that the gate never sees, so that person sits in front of an app whose every request fails. Timescale kept its own owner check, answering 401, for this reason when it moved to v0.47.1 (2026-11-07, timescale pull request #98). The gate should take a 403 with the refused-account answer and show the sign-in screen saying this account is not allowed in, with Sign out and the other way in, in the app's own words, as getter, argon-watcher or any app using requireOwner would want.
Done when: in the kit's browser tests, a signed-in stand-in user the server refuses with that 403 sees the sign-in screen saying the account is not allowed, can sign out and sign in as the owner, and the app's screen never draws for them; and the README's "Owner only" section says what the person sees.

## claude-web-research · One shared helper for asking Claude with web search, used by getter and finances

Goal: getter's product research (`getter/server/research.ts`, `claudeResearcher`) and finances' Tally (`finances/server/tally.ts`, `claudeLookUp`) each carry the same loop for asking Claude with the web search tool: resend the turn when the search pauses (`pause_turn`), collect every URL the searches returned and drop any source the answer names that no search returned, refuse on `refusal`, read the structured answer, and log each turn's searches and tokens. Finances copied it on 2026-11-07 with the owner's approval rather than wait on this. Move the loop into app-kit (for example `app-kit/server/claude-research`), taking the client, model, system prompt, tools, output schema and a log prefix, and switch both apps to it; getter keeps its fallback option and Amazon link checks on top.
Done when: both apps call the one helper, each app's existing tests pass unchanged, and neither keeps its own copy of the pause loop or the source check.

## postgres-template-step-cheaper · A new migrations folder's test template costs less, so the failed-migration test stops timing out under load

Goal: since postgres-tests-do-less-work, the first test database in a process loads PGlite's ready-made empty database, and the set-up no longer times out. What times out next in `test/postgres.test.ts` under load is "a migration that failed is tried again once it is fixed, in the same test process", held to Bun's 5 seconds: it makes a migrated template for a fresh migrations folder twice (load the empty database, migrate, save the files, load them again), about 0.32 seconds unloaded on the Mac mini, the same on the old code and the new. On 2026-11-07, beside 80 busy processes on the mini's 8 cores (load 33 to 115), it timed out in 3 of 3 runs on the old code (5.7 to 5.9 s) and 5 of 5 on the new (6.5 to 7.4 s, before the ready-made files were unzipped once, which brought it back to the old cost). On the 18-core Mac it never ran before, since the set-up failed first. Every app's first test database per migrations folder pays the same template step, so making it cheaper helps apps too; trace where its time goes before choosing how.
Done when: with no time limit raised, `test/postgres.test.ts` passes five runs in a row on a machine other sessions are not using (the Mac mini over Tailscale, after the user's yes to it and how long), beside enough lowest-priority busy processes that the old code fails, and the commit says the template step's time before and after.
Do not touch: time limits in the tests or bunfig.toml; what `openDb` does for apps; the ready-made empty database start-up.
Needs: nothing.
Touches: server/postgres/index.ts, test/postgres.test.ts.

## console-app-bar-light · The console look's app bar draws its title in the theme's text color in light

Goal: `lookTheme({ name: 'console' })` leaves MUI's AppBar in its default `color="primary"`, so the bar's title and icons take primary's contrast text, white, while the console look paints the bar in `surface` (#f0f0f0 in light). In light the title is white on light grey and cannot be read; in dark it happens to read. The plain look already sets `MuiAppBar: { defaultProps: { elevation: 0, color: 'inherit' } }` (web/theme.ts:106); the console look's MuiAppBar (web/theme.ts:218) sets only styleOverrides. Found by buddy-system's move to v0.47.1 (2026-11-07, pull request 15), which works around it with `<AppBar color="inherit">` in client/src/features/BuddySystemApp.tsx; every console app that takes light mode hits the same.
Done when: the console look's MuiAppBar has `defaultProps: { elevation: 0, color: 'inherit' }`, the look's e2e draws a console app bar in light and holds its title's color to CONSOLE.light.text, and CHANGES.md tells console apps they may drop their own `color="inherit"`.
Do not touch: the plain look.

## steady-frames-first-blank · The web fixture's steady-frames test never sees a blank first frame on a busy Mac

Goal: web/e2e/steps.e2e.ts "frames are noted from the first, and a page drawn in one background throughout is steady" stopped the extension-jobs landing on 2026-11-07 (94 of 95 web tests passing, all 1047 unit tests passing), at a machine load around 100: `expectSteady` in web/playwright.js found one frame with nothing drawn (`{ background: "rgb(244, 239, 230)", drawn: false, text: "" }`). Run alone the same evening at load 64, it passed 10 of 10 (`bash scripts/e2e.sh steps.e2e.ts -g "frames are noted from the first" --repeat-each 10`). The branch it stopped touched nothing under web/. The likely cause, untested, is a race between `watchFrames` noting its first frame and the page's first paint, which only a loaded machine widens; whether the fault is in `watchFrames`, in the fixture's first paint, or in what the test calls steady is to be found first, per practices' tests rule (no longer limit, no rerun as the fix).

Done when: the cause is named with evidence (a held first paint or a slowed clock reproduces the blank frame), fixed where it lives, and the reproduction lands as a test that fails on the old code; the test then passes in several parallel runs on a loaded machine.

Do not touch: what `expectSteady` counts as steady for a page that really does draw a blank frame, which apps' tests rely on.

Touches: web/playwright.js, web/e2e/steps.e2e.ts, web/e2e/fixture/.
