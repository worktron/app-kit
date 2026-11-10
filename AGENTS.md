# app-kit

The app baseline as one public package, which apps install from GitHub at a tag. Its top folders are the kinds of app (`web/`, `extension/`, `tauri/`, `swift/`, `command-line/`) and five for what several kinds share (`authentication/`, `server/`, `icons/`, `look/`, `testing/`), and import names follow the folders: `app-kit/web`, `app-kit/command-line`, `app-kit/extension/...`, `app-kit/tauri/sign-in`, `app-kit/tauri/iphone-notifications`, `app-kit/tauri/iphone-sign-in`, `app-kit/tauri/window`, `app-kit/authentication/...`, `app-kit/server/google`, `app-kit/server/google/demo`, `app-kit/server/postgres`, `app-kit/server/start`, `app-kit/server/every`, `app-kit/server/process-usage`, `app-kit/look`, `app-kit/testing/start-up`, `app-kit/command-line/signed-in-chrome`, `app-kit/command-line/window-recording`, and two that name no folder, `app-kit/amazon-orders` and `app-kit/amazon-cart`, which live in `server/amazon-orders/` and `server/amazon-cart/`. README.md says what each piece is and how an app takes it in, one section per folder; practices' rules files say why each exists.

## Layout

```
web/             web apps (app-kit/web): the MUI theme for each look (theme.ts, lookTheme), fetch wrapper, connection, new build, preload reload, error boundary and its reload after a crash, saved copies, row links,
                 how long ago (age.ts, with no React, also app-kit/web/age, and now.ts, useNow),
                 hover intent (hover-intent.ts), when the pointer may light, select or focus, with the menu bar theme's
                 PointerIntent.swift held to its numbers by test/hover-intent-swift.test.ts,
                 the phone's Text Size, fields that never zoom, pull to refresh, the font wait, the sign-in gate and the
                 provider interface it takes (sign-in/provider.ts), and the iPhone sign-in it takes (sign-in/iphone-sign-in.ts),
                 which tauri/iphone-sign-in makes, so nothing under web/ imports Tauri; first-paint.js, the Vite plugin for the first frame (app-kit/web/first-paint);
                 push/, notifications for a web app on a phone's Home Screen: the page half (page.ts, in app-kit/web),
                 the notification worker (worker.js, a classic script checked by its own tsconfig.json under the
                 service worker's types), the Vite plugin that serves it (vite.js, app-kit/web/push/vite), the server's
                 sending (server.ts, app-kit/web/push/server), and the names they share (names.ts);
                 server.ts, the server's sending of the built page (app-kit/web/server), which the fixture's server (e2e/serve.ts) uses,
                 with an app's public pages, which public-pages.tsx writes at build as finished HTML (app-kit/web/public-pages);
                 playwright-webkit.js, Playwright's WebKit run from a copy macOS keeps out of the Dock (app-kit/web/playwright-webkit);
                 playwright-offline-audio.js, a test page's Web Audio on the browser's offline engine, so no speaker opens,
                 and Playwright's test with it on every context (app-kit/web/playwright-offline-audio);
                 playwright.js, the browser test steps every app shares (app-kit/web/playwright);
                 drive.ts, `app-kit web drive`, the app driven headless from a steps file for persona walk-throughs
                 and store screenshots, run against a page of its own by web/e2e/drive.e2e.ts;
                 web/e2e/fixture, a small app built on the kit, run built in a hidden Chromium; web/e2e/audio-output.swift, the
                 record of which processes have an output device open, for offline-audio.e2e.ts
extension/       browser extensions: worker/ (plain JavaScript Chrome loads, copied into each extension, with
                 amazon-never-sent.js, the Amazon requests no extension sends), look.css (the plain
                 look's rules for an extension's pages, copied beside the worker files with its variables written from
                 look/ and the extension's look.json beside its manifest), host/ (the Mac side),
                 harness/ (hidden Chromium), testing/ (a chrome stand-in, and a native host run as Chrome runs it),
                 copy.ts, layout.ts (the check that an extension's manifest is at its checkout's root, which
                 install-host makes too), listing.ts (`app-kit extension listing`, the Chrome Web Store
                 listing, store-listing.md, held to the manifest), dashboard/ (`app-kit extension dashboard`, which
                 types store-listing.md into the Store's developer dashboard in a Google Chrome profile of its own and
                 reads it back, never pressing Submit for review, and skill/, the chrome-web-store skill that offers it),
                 and its own test/ and e2e/
tauri/           Mac and iPhone apps built with Tauri: window/, a window onto the hosted site: plugin/, the Tauri plugin
                 an app's shell builds, with desktop sign-in's shell half, the Mac menu bar (src/menu.rs) and updates from
                 the app's releases (src/updates.rs), and the page half (index.ts), with the update line (lines.tsx),
                 and the names both share (names.ts);
                 mac-release/, `app-kit mac release` (release.ts), which publishes a Mac release the installed app
                 updates itself to, notarized when a Developer ID signs it, `app-kit mac key` (key.ts), which makes the key that signs it, and what both read
                 from the app (app.ts); sign-in/, desktop sign-in through the browser (app-kit/tauri/sign-in),
                 and its server routes (server.ts, app-kit/tauri/sign-in/server); iphone-notifications/, notifications through
                 Apple's push service: the page half (index.ts), the sending (server.ts), the names both share with the
                 plugin (names.ts), and plugin/, the Tauri plugin's Rust and Swift that an app's shell builds;
                 apple-messages/, reading Apple Messages on the Mac: plugin/, the Tauri plugin's Rust that reads the Messages
                 and Contacts databases under Full Disk Access (its tests read made-up ones), the page half (index.ts) with
                 the catch-up and Messages Service's connect link, the names and upload limits the plugin, the page, an
                 app's server and Messages Service share (names.ts), the server's routes the service connects and pushes
                 texts to (server.ts), and in the plugin the service's installer (src/service.rs);
                 iphone-sign-in/, Google sign-in in Apple's sign-in sheet: the page half (index.ts), the names it shares
                 with the plugin (names.ts), and plugin/;
                 iphone-run/, `app-kit iphone run sim|phone`, which builds an app and starts it on a Simulator or a paired iPhone, and points an agent at the README's section on tapping and looking at it;
                 iphone-simulator/, the step `app-kit iphone-simulator quiet` runs, which sends a simulator's sound to BlackHole (index.ts),
                 and how long a Simulator `iphone run sim` boots stays up and how many run at once, with its watcher and
                 `app-kit iphone-simulator keep`, and the idle check `app-kit iphone-simulator shut-down-idle`, which shuts
                 down a Simulator booted any other way once nothing uses it (lifetime.ts);
                 testflight/, `app-kit testflight upload` (upload.ts) and `app-kit testflight watch` (watch.ts), with the
                 App Store Connect calls, the key and the distribution certificate read from 1Password (key.ts, whose
                 item readers the Mac release uses too), the signing
                 with them and what Tauri leaves that is put back (signing.ts);
                 apple-token.ts, the ES256 token Apple's push service and App Store Connect both take;
                 build-env.ts, the environment every iPhone build and the Mac release's build run in, with no FORCE_COLOR;
                 state.ts, the folder under ~/.local/state/app-kit each part keeps its state in, with its lock and log,
                 which the TestFlight watcher and the Simulators' shut-down times share, and whose lock the TestFlight
                 upload's one signing build at a time takes too;
                 playwright.js, the Tauri bridge faked for apps' browser tests, with desktop sign-in's steps (app-kit/tauri/playwright)
swift/           Mac apps built in Swift: menu-bar/, the menu bar theme, a Swift package an app builds from the kit bun
                 installed: Sources/MenuBarTheme (the two looks, plain and console, and their tokens, the bundled JetBrains
                 Mono in Fonts/ for the console look, the pieces, the panel and the snapshot, and in the plain look a
                 window's pieces, Window.swift, the switch, the menu and the field, Controls.swift, and one window with a
                 side column, SideWindow.swift: the window that remembers its place, the column's rows and a row's button),
                 Sources/menu-bar-snapshots (the Studies screens drawn in either look, and compared in the console look, and
                 WindowCheck.swift, the real window made off screen in each case a saved place can leave it), Tests/, and
                 e2e/ (the mockups, the comparison with a headless Chromium, the bare swiftc build, and
                 same-renders.sh, the check that every sample draws byte for byte as on a given commit)
                 window-recording/, the program that makes a display nobody sees and records one window on it
                 (ScreenCaptureKit), built by Swift's package manager only, by command-line/window-recording.ts;
                 mac-app/, what every Swift Mac app writes for itself, a Swift package built the same way: Sources/MacApp
                 (the log, launch at login, the Dock icon while a window is open and opening Settings, the native
                 messaging host, the build's version and commit, the refresh on a clock and after wake, and a program
                 run with a time limit), Tests/, and e2e/ (the bare swiftc build)
command-line/    command-line tools (app-kit/command-line): the version line, help and wrong usage, color, opening the
                 browser, the worktree warning and the 1Password read (index.ts), and run.ts, the runner every outside
                 program goes through, which the TestFlight part, `iphone run` and `icons render` use;
                 signed-in-chrome.ts, Google Chrome in a profile of its own the owner signs in to once, driven headless
                 or with one window placed where the caller says (the Store dashboard and demo videos use it);
                 window-recording.ts, which builds and drives swift/window-recording
authentication/  who is calling: clerk/ (the Clerk adapter, index.tsx, and the Clerk readers for the server checks, server.ts,
                 a user's verified addresses and the allowlist among them; the steps for browser tests against a development instance, playwright.js, with one user signed in per worker,
                 and their test against the kit's own instance, e2e/, run by scripts/e2e-clerk.sh; a stand-in for Clerk's Backend API
                 for server tests, testing.ts),
                 stand-in/ (the stand-in sign-in provider, the code it takes, code.js, and the Playwright steps for apps' browser tests, playwright.js),
                 agent-keys/ (the server check that lets a person's key read the GET routes an app lists, its API reference, openapi.ts,
                 and the check of every route for server tests, testing.ts),
                 owner/ (the server checks that let in only the one person an app serves, or only the people on an invited list),
                 server-sign-in/ (whether a server requires sign-in, from its environment: refused hosted without it, open on this machine only)
server/          server-only pieces no kind of app owns: google/ (what a refusal from Google means, with no React, and
                 demo.ts with demo-command.ts, `app-kit google demo-reset` and `demo-grant`, a demo account's inbox and
                 calendar set for an app's verification and demo videos),
                 postgres/ (the database opener on Drizzle: Postgres from a postgres:// URL, PGlite otherwise, and the
                 migrated in-memory databases for tests; test/fixtures/postgres holds the tests' schema and migration),
                 start/ (the Hono app every server starts from, with its health route, request log, JSON errors and refusal of
                 writes other websites send, and listen, which serves it and stops it cleanly; web/e2e/serve.ts runs on it),
                 every/ (a job on a clock that never runs twice at once, with no imports, app-kit/server/every),
                 process-usage/ (one reading of a macOS process's CPU time, memory and disk, finished child processes
                 included, through bun:ffi opened only at the first reading, and in window.ts `ps`'s parser and the
                 cores each process used between two readings of the machine, app-kit/server/process-usage),
                 amazon-orders/ (reading Amazon's order pages from their HTML, on happy-dom, the only file that imports it,
                 app-kit/amazon-orders; test/fixtures/amazon-orders holds the tests' made-up pages),
                 amazon-cart/ (reading one store's Amazon cart page, which throws on a page that is not that store's cart,
                 and a product's page into the request that adds one to a cart, which throws on a page that is not that
                 product's, through amazon-orders' parse, app-kit/amazon-cart; test/fixtures/amazon-cart holds the tests'
                 made-up pages, and its README what marks each store's cart and a product's page, and what is not yet known)
look/            the two looks' colors and sizes (app-kit/look), the only owner of them: web/theme.ts, the copied look.css
                 and swift/menu-bar's Tokens.swift take their values from it, the Swift copy held equal by
                 test/look-swift.test.ts; in plain an app may give its accent, and its paper with its highlight, the
                 lines mixed from the paper, and colors whose text reads under 4.5 to 1 refused (test/look.test.ts)
icons/           `app-kit icons render` (render.ts), every icon an app ships drawn from its drawings with sharp: Xcode
                 icon sets, a Tauri app's icons, the menu bar image, the extension's and the web's; test/fixtures/icons
                 holds the tests' drawings and the icon sets' Contents.json
testing/         what every kind's tests share: start-up.ts (app-kit/testing/start-up), the test start-up file a project
                 names in bunfig.toml's preload, which the kit's own bunfig.toml names too; playwright-dock.js
                 (app-kit/testing/playwright-dock), a Playwright browser run from a copy macOS keeps out of the Dock,
                 which web/playwright-webkit.js and the extension harness use; test/applications.ts watches macOS's
                 application list for the Dock tests, web/e2e/dock.e2e.ts and extension/e2e/dock.e2e.ts
bin/             the app-kit command
scripts/         the gates (gates.sh), and the landing (land-main.sh, which runs land.ts), which sets the version, writes
                 each change's Urgency and Apps lines into CHANGES.md, tags it, and asks metamax for the same-day apps
                 round on a release apps take now; apps.ts, which reads every app on the kit for the apps round
                 (.claude/skills/apps-round, the round that starts an upgrade thread in each app with something to take),
                 and kit-features.ts, the kit's features an app should have once it takes their piece, which apps.ts
                 reads to say which of them each app lacks
CHANGES.md       what an app does when it moves to each version, newest first, written only by the landing
test/            every unit test, in a simulated page (happy-dom); test/fixtures holds Clerk's recorded answers, ids replaced, the push services' recorded answers (web-push/),
                 Apple's answers for a site's association file (apple-app-site-association/), and what each browser answered for the phone's Text Size
```

## Rules for agents working here

- A new piece goes in the folder of the kind of app that uses it. A piece with a browser half keeps its server half beside it (`tauri/sign-in/server.ts`); a piece that is server only goes in `server/`. No vendor names a top folder, and nothing moves because of which apps use it. Unit tests stay in `test/` (the extension's in `extension/test/`, each Swift package's in its own `Tests/`), and `test/exports.test.ts` holds every export name to a file that exists.
- Nothing outside `authentication/clerk/` imports Clerk, which `test/clerk-imports.test.ts` holds; the kit's tests of the adapter in `test/` may. What the gate needs from a provider goes through `web/sign-in/provider.ts`, and a new need is added there, to the Clerk adapter and to the stand-in together.
- The kit ships TypeScript sources: no build step, no generated files. Apps compile it under their own settings, so it stays clean under `strict`. The exceptions, all for the same reason, are plain JavaScript typed by the `.d.ts` beside each, since Playwright's test runner, and Vite loading an app's config, leave files under `node_modules` to Node, which refuses TypeScript there: the Playwright steps, `authentication/stand-in/playwright.js` with `code.js`, `authentication/clerk/playwright.js`, `web/playwright.js`, `web/playwright-webkit.js`, `web/playwright-offline-audio.js` and `tauri/playwright.js`, `testing/playwright-dock.js`, which `web/playwright-webkit.js` imports, `web/first-paint.js` and `web/push/vite.js`. `test/playwright-steps.test.ts` loads each steps file by its import name under Node, `test/playwright-webkit.test.ts` holds the WebKit copy and `test/playwright-dock.test.ts` the Chromium one, `test/playwright-offline-audio.test.ts` holds the offline audio, `test/tauri-playwright-names.test.ts` holds the names `tauri/playwright.js` copies, `test/first-paint.test.ts` holds `web/first-paint.js`, and `test/web-push-names.test.ts` holds `web/push/vite.js`. `web/push/worker.js` is plain JavaScript for another reason, since a browser runs it as a service worker with no build step; its own `tsconfig.json` checks it, and `test/web-push-worker.test.ts` runs it. A steps file a unit test imports, as `test/clerk-playwright.test.ts` imports the Clerk one, loads `@playwright/test` only inside the step that needs it: beside the unit tests' simulated page it fails to load.
- A branch never edits `package.json`'s version, and never plans a version number: threads landing at the same time would take the same one. Each branch says what kind of change it is with a `Release: minor`, `Release: patch` or `Release: none` line beside Co-Authored-By, minor for a change apps may have to change for, patch for one they notice and need not, none for one they never notice. `scripts/land-main.sh`, which `/metamax:land` runs, works out the version from main as it lands, commits it with the README's install lines, and tags `v<version>` on main. A minor change also says what an app does about it, in an `Apps:` line in the same paragraph (a patch may). A minor or patch change also says how soon apps take it, in an `Urgency:` line in the same paragraph: `now` for a security hole, lost data, or something broken people hit, such as sign-in failing (the apps round starts the upgrades that day), `next round` for something an app must change or will want (the Monday round), `rides along` for nothing an app needs to do (the app's next upgrade); `now` and `next round` need an `Apps:` line. The landing writes both under the new version in CHANGES.md, which the apps round reads to start each app's upgrade. A branch made before it must rebase onto main first, or `/metamax:land` takes the pull-request route.
- A change that adds a piece or an option that every app taking some piece should have (as one-tap sign-in is for an app taking iPhone sign-in) adds its entry to `scripts/kit-features.ts` in the same change, with made-up apps that have it and lack it in `test/kit-features-entries.test.ts` (one-tap sign-in, which asks Apple's servers, has its own, `test/kit-features.test.ts`). CHANGES.md tells an app once, while it is behind; the entry is how the apps round finds an app that took the version and never turned the feature on.
- The repository is public: nothing here names a machine, a person, a personal email or a path into a home folder, and `test/public.test.ts` holds that for the files and the history. Test addresses are on example.com. Commits are authored and committed as Worktron. A change lands only through `scripts/land-main.sh`, which moves main forward with a push that is never forced and so adds no commit, never with a pull request's merge button, since every way that button merges commits as the merging account.
- A Tauri plugin lives in the folder of the piece that uses it, as `plugin/`, and an app's shell builds it from the kit bun installed, by a Cargo path into `node_modules`, so `package.json` stays the one place that names the kit's version. Its `Cargo.lock` is committed, so the gates build pinned crates; what its build writes (`.tauri/`, `permissions/autogenerated/`, `permissions/schemas/`, Swift's build state) is ignored and made again by every build. A name its Rust, Swift and page share lives in the piece's `names.ts`, held by a test that reads the sources, since nothing here links the plugin into an app.
- A Swift piece is a Swift package in its own folder (`swift/menu-bar/`, `swift/mac-app/`), which an Xcode app adds as a local package from the kit bun installed and a bare swiftc build compiles as a module of its own, so `package.json` stays the one place that names the kit's version. Its tests are Swift tests in its own `Tests/`, since Swift's package manager reaches no file outside the package, and its build state (`.build/`) is ignored. Nothing it draws or tests opens on the screen: the theme's tests set `MenuBarPanel.staysOffScreen` and draw through `snapshot`, and the Mac app package's pass stand-ins for the login item, the Dock and every folder, which `StaysOffTheMachineTests` holds.
- A copied plugin keeps its license files as they are, including its author's copyright notice, which the license requires, and a bundled font keeps its own credits inside its files, and code ported from another project keeps that project's license beside it (`tauri/apple-messages/plugin/LICENSE-imsg`), and an outside tool's install line keeps the account it installs from (`brew install cameroncooke/axe/axe`): the only names of people the repository holds.
- `extension/worker/` loads in Chrome with no build step: plain JavaScript modules, relative imports among themselves only, no packages. After any change to it, run `bun bin/app-kit.ts extension copy extension/test/fixture/kit`; a test fails until the fixture's copy matches.
- Before landing: `scripts/gates.sh` (typecheck, lint, unit tests, the web fixture and the extension harness in a hidden Chromium kept out of the Dock, the Clerk test against the kit's development instance when a change touches the Clerk steps or a Clerk package, the iPhone notifications and iPhone sign-in plugins built for the iPhone simulator, the Apple Messages plugin's Rust tests and its lint at no warnings, and the window plugin's Rust tests, with its lint for the Mac and the iPhone simulator at no warnings, and the Swift packages' tests and bare swiftc builds at no warnings).
