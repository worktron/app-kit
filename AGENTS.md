# app-kit

The app baseline as one public package, which apps install from GitHub at a tag. Its top folders are the kinds of app (`web/`, `extension/`, `tauri/`, `swift/`) and four for what several kinds share (`authentication/`, `server/`, `icons/`, `testing/`), and import names follow the folders: `app-kit/web`, `app-kit/extension/...`, `app-kit/tauri/sign-in`, `app-kit/tauri/iphone-notifications`, `app-kit/tauri/iphone-sign-in`, `app-kit/tauri/window`, `app-kit/authentication/...`, `app-kit/server/google`, `app-kit/server/postgres`, `app-kit/server/start`, `app-kit/testing/start-up`. README.md says what each piece is and how an app takes it in, one section per folder; practices' rules files say why each exists.

## Layout

```
web/             web apps (app-kit/web): fetch wrapper, connection, new build, preload reload, error boundary and its reload after a crash, saved copies, row links,
                 the phone's Text Size, fields that never zoom, pull to refresh, the font wait, the sign-in gate and the
                 provider interface it takes (sign-in/provider.ts); first-paint.js, the Vite plugin for the first frame (app-kit/web/first-paint);
                 server.ts, the server's sending of the built page (app-kit/web/server), which the fixture's server (e2e/serve.ts) uses;
                 playwright-webkit.js, Playwright's WebKit run from a copy macOS keeps out of the Dock (app-kit/web/playwright-webkit);
                 playwright-offline-audio.js, a test page's Web Audio on the browser's offline engine, so no speaker opens,
                 and Playwright's test with it on every context (app-kit/web/playwright-offline-audio);
                 playwright.js, the browser test steps every app shares (app-kit/web/playwright);
                 web/e2e/fixture, a small app built on the kit, run built in a hidden Chromium; web/e2e/audio-output.swift, the
                 record of which processes have an output device open, for offline-audio.e2e.ts
extension/       browser extensions: worker/ (plain JavaScript Chrome loads, copied into each extension), host/ (the Mac side),
                 harness/ (hidden Chromium), testing/ (a chrome stand-in, and a native host run as Chrome runs it),
                 copy.ts, and its own test/ and e2e/
tauri/           Mac and iPhone apps built with Tauri: window/, a window onto the hosted site: plugin/, the Tauri plugin
                 an app's shell builds, with desktop sign-in's shell half, and the page half (index.ts) and the names
                 both share (names.ts); sign-in/, desktop sign-in through the browser (app-kit/tauri/sign-in),
                 and its server routes (server.ts, app-kit/tauri/sign-in/server); iphone-notifications/, notifications through
                 Apple's push service: the page half (index.ts), the sending (server.ts), the names both share with the
                 plugin (names.ts), and plugin/, the Tauri plugin's Rust and Swift that an app's shell builds;
                 iphone-sign-in/, Google sign-in in Apple's sign-in sheet: the page half (index.ts), the names it shares
                 with the plugin (names.ts), and plugin/;
                 iphone-run/, `app-kit iphone run sim|phone`, which builds an app and starts it on a Simulator or a paired iPhone;
                 iphone-simulator/, the step `app-kit iphone-simulator quiet` runs, which sends a simulator's sound to BlackHole;
                 testflight/, `app-kit testflight upload` (upload.ts) and `app-kit testflight watch` (watch.ts), with the
                 App Store Connect calls, the key read from 1Password, and the runner every outside program goes through;
                 apple-token.ts, the ES256 token Apple's push service and App Store Connect both take;
                 build-env.ts, the environment every iPhone build runs in, with no FORCE_COLOR;
                 playwright.js, the Tauri bridge faked for apps' browser tests, with desktop sign-in's steps (app-kit/tauri/playwright)
swift/           Mac apps built in Swift: menu-bar/, the menu bar theme, a Swift package an app builds from the kit bun
                 installed: Sources/MenuBarTheme (the two looks, plain and console, and their tokens, the bundled JetBrains
                 Mono in Fonts/ for the console look, the pieces, the panel and the snapshot), Sources/menu-bar-snapshots
                 (the Studies screens drawn in either look, and compared in the console look), Tests/, and
                 e2e/ (the mockups, the comparison with a headless Chromium, and the bare swiftc build)
                 mac-app/, what every Swift Mac app writes for itself, a Swift package built the same way: Sources/MacApp
                 (the log, launch at login, the Dock icon while a window is open and opening Settings, the native
                 messaging host, the build's version and commit, the refresh on a clock and after wake, and a program
                 run with a time limit), Tests/, and e2e/ (the bare swiftc build)
authentication/  who is calling: clerk/ (the Clerk adapter, index.tsx, and the Clerk readers for the server checks, server.ts;
                 the steps for browser tests against a development instance, playwright.js; a stand-in for Clerk's Backend API
                 for server tests, testing.ts),
                 stand-in/ (the stand-in sign-in provider, the code it takes, code.js, and the Playwright steps for apps' browser tests, playwright.js),
                 agent-keys/ (the server check that lets a person's key read the GET routes an app lists, its API reference, openapi.ts,
                 and the check of every route for server tests, testing.ts),
                 owner/ (the server check that lets in only the one person an app serves),
                 server-sign-in/ (whether a server requires sign-in, from its environment: refused hosted without it, open on this machine only)
server/          server-only pieces no kind of app owns: google/ (what a refusal from Google means, with no React),
                 postgres/ (the database opener on Drizzle: Postgres from a postgres:// URL, PGlite otherwise, and the
                 migrated in-memory databases for tests; test/fixtures/postgres holds the tests' schema and migration),
                 start/ (the Hono app every server starts from, with its health route, request log and JSON errors, and
                 listen, which serves it and stops it cleanly; web/e2e/serve.ts runs on it)
icons/           `app-kit icons render` (render.ts), every icon an app ships drawn from its drawings with sharp: Xcode
                 icon sets, a Tauri app's icons, the menu bar image, the extension's and the web's; test/fixtures/icons
                 holds the tests' drawings and the icon sets' Contents.json
testing/         what every kind's tests share: start-up.ts (app-kit/testing/start-up), the test start-up file a project
                 names in bunfig.toml's preload, which the kit's own bunfig.toml names too
bin/             the app-kit command
scripts/         the gates (gates.sh), and the landing (land-main.sh, which runs land.ts), which sets the version and tags it
test/            every unit test, in a simulated page (happy-dom); test/fixtures holds Clerk's recorded answers, ids replaced,
                 and what each browser answered for the phone's Text Size
```

## Rules for agents working here

- A new piece goes in the folder of the kind of app that uses it. A piece with a browser half keeps its server half beside it (`tauri/sign-in/server.ts`); a piece that is server only goes in `server/`. No vendor names a top folder, and nothing moves because of which apps use it. Unit tests stay in `test/` (the extension's in `extension/test/`, each Swift package's in its own `Tests/`), and `test/exports.test.ts` holds every export name to a file that exists.
- Nothing outside `authentication/clerk/` imports Clerk, which `test/clerk-imports.test.ts` holds; the kit's tests of the adapter in `test/` may. What the gate needs from a provider goes through `web/sign-in/provider.ts`, and a new need is added there, to the Clerk adapter and to the stand-in together.
- The kit ships TypeScript sources: no build step, no generated files. Apps compile it under their own settings, so it stays clean under `strict`. The exceptions, all for the same reason, are plain JavaScript typed by the `.d.ts` beside each, since Playwright's test runner, and Vite loading an app's config, leave files under `node_modules` to Node, which refuses TypeScript there: the Playwright steps, `authentication/stand-in/playwright.js` with `code.js`, `authentication/clerk/playwright.js`, `web/playwright.js`, `web/playwright-webkit.js`, `web/playwright-offline-audio.js` and `tauri/playwright.js`, and `web/first-paint.js`. `test/playwright-steps.test.ts` loads each steps file by its import name under Node, `test/playwright-webkit.test.ts` holds the WebKit copy, `test/playwright-offline-audio.test.ts` holds the offline audio, `test/tauri-playwright-names.test.ts` holds the names `tauri/playwright.js` copies, and `test/first-paint.test.ts` holds `web/first-paint.js`. A steps file a unit test imports, as `test/clerk-playwright.test.ts` imports the Clerk one, loads `@playwright/test` only inside the step that needs it: beside the unit tests' simulated page it fails to load.
- A branch never edits `package.json`'s version, and never plans a version number: threads landing at the same time would take the same one. Each branch says what kind of change it is with a `Release: minor`, `Release: patch` or `Release: none` line beside Co-Authored-By, minor for a change apps may have to change for, patch for one they notice and need not, none for one they never notice. `scripts/land-main.sh`, which `/metamax:land` runs, works out the version from main as it lands, commits it with the README's install lines, and tags `v<version>` on main. A branch made before it must rebase onto main first, or `/metamax:land` takes the pull-request route.
- The repository is public: nothing here names a machine, a person, a personal email or a path into a home folder, and `test/public.test.ts` holds that for the files and the history. Test addresses are on example.com. Commits are authored and committed as Worktron. A change lands only through `scripts/land-main.sh`, which moves main forward with a push that is never forced and so adds no commit, never with a pull request's merge button, since every way that button merges commits as the merging account.
- A Tauri plugin lives in the folder of the piece that uses it, as `plugin/`, and an app's shell builds it from the kit bun installed, by a Cargo path into `node_modules`, so `package.json` stays the one place that names the kit's version. Its `Cargo.lock` is committed, so the gates build pinned crates; what its build writes (`.tauri/`, `permissions/autogenerated/`, `permissions/schemas/`, Swift's build state) is ignored and made again by every build. A name its Rust, Swift and page share lives in the piece's `names.ts`, held by a test that reads the sources, since nothing here links the plugin into an app.
- A Swift piece is a Swift package in its own folder (`swift/menu-bar/`, `swift/mac-app/`), which an Xcode app adds as a local package from the kit bun installed and a bare swiftc build compiles as a module of its own, so `package.json` stays the one place that names the kit's version. Its tests are Swift tests in its own `Tests/`, since Swift's package manager reaches no file outside the package, and its build state (`.build/`) is ignored. Nothing it draws or tests opens on the screen: the theme's tests set `MenuBarPanel.staysOffScreen` and draw through `snapshot`, and the Mac app package's pass stand-ins for the login item, the Dock and every folder, which `StaysOffTheMachineTests` holds.
- A copied plugin keeps its license files as they are, including its author's copyright notice, which the license requires, and a bundled font keeps its own credits inside its files: the only names of people the repository holds.
- `extension/worker/` loads in Chrome with no build step: plain JavaScript modules, relative imports among themselves only, no packages. After any change to it, run `bun bin/app-kit.ts extension copy extension/test/fixture/kit`; a test fails until the fixture's copy matches.
- Before landing: `scripts/gates.sh` (typecheck, lint, unit tests, the web fixture and the extension harness in a hidden Chromium, the iPhone notifications and iPhone sign-in plugins built for the iPhone simulator, and the window plugin's Rust tests, with its lint for the Mac and the iPhone simulator at no warnings, and the Swift packages' tests and bare swiftc builds at no warnings).
