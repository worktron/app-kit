# app-kit

The app baseline as one public package, which apps install from GitHub at a tag. Its top folders are the kinds of app (`web/`, `extension/`, `tauri/`) and two for what several kinds share (`authentication/`, `server/`), and import names follow the folders: `app-kit/web`, `app-kit/extension/...`, `app-kit/tauri/sign-in`, `app-kit/tauri/iphone-notifications`, `app-kit/tauri/iphone-sign-in`, `app-kit/authentication/...`, `app-kit/server/google`, `app-kit/server/postgres`. README.md says what each piece is and how an app takes it in, one section per folder; practices' rules files say why each exists.

## Layout

```
web/             web apps (app-kit/web): fetch wrapper, connection, new build, preload reload, error boundary and its reload after a crash, saved copies, row links,
                 the phone's Text Size, the sign-in gate and the provider interface it takes (sign-in/provider.ts);
                 playwright-webkit.js, Playwright's WebKit run from a copy macOS keeps out of the Dock (app-kit/web/playwright-webkit);
                 web/e2e/fixture, a small app built on the kit, run built in a hidden Chromium
extension/       browser extensions: worker/ (plain JavaScript Chrome loads, copied into each extension), host/ (the Mac side),
                 harness/ (hidden Chromium), testing/ (a chrome stand-in), copy.ts, and its own test/ and e2e/
tauri/           Mac and iPhone apps built with Tauri: sign-in/, desktop sign-in through the browser (app-kit/tauri/sign-in),
                 and its server routes (server.ts, app-kit/tauri/sign-in/server); iphone-notifications/, notifications through
                 Apple's push service: the page half (index.ts), the sending (server.ts), the names both share with the
                 plugin (names.ts), and plugin/, the Tauri plugin's Rust and Swift that an app's shell builds;
                 iphone-sign-in/, Google sign-in in Apple's sign-in sheet: the page half (index.ts), the names it shares
                 with the plugin (names.ts), and plugin/;
                 iphone-simulator/, the step `app-kit iphone-simulator quiet` runs, which sends a simulator's sound to BlackHole;
                 testflight/, `app-kit testflight upload` (upload.ts) and `app-kit testflight watch` (watch.ts), with the
                 App Store Connect calls, the key read from 1Password, and the runner every outside program goes through;
                 apple-token.ts, the ES256 token Apple's push service and App Store Connect both take
authentication/  who is calling: clerk/ (the Clerk adapter, index.tsx, and the Clerk readers for the server checks, server.ts),
                 stand-in/ (the stand-in sign-in provider, and the Playwright steps for apps' browser tests, playwright.js),
                 agent-keys/ (the server check that lets a person's key read the GET routes an app lists, and its API reference, openapi.ts),
                 owner/ (the server check that lets in only the one person an app serves)
server/          server-only pieces no kind of app owns: google/ (what a refusal from Google means, with no React),
                 postgres/ (the database opener on Drizzle: Postgres from a postgres:// URL, PGlite otherwise, and the
                 migrated in-memory databases for tests; test/fixtures/postgres holds the tests' schema and migration)
bin/             the app-kit command
scripts/         the gates (gates.sh), and the landing (land-main.sh, which runs land.ts), which sets the version and tags it
test/            every unit test, in a simulated page (happy-dom); test/fixtures holds Clerk's recorded answers, ids replaced,
                 and what each browser answered for the phone's Text Size
```

## Rules for agents working here

- A new piece goes in the folder of the kind of app that uses it. A piece with a browser half keeps its server half beside it (`tauri/sign-in/server.ts`); a piece that is server only goes in `server/`. No vendor names a top folder, and nothing moves because of which apps use it. Unit tests stay in `test/` (the extension's in `extension/test/`), and `test/exports.test.ts` holds every export name to a file that exists.
- Nothing outside `authentication/clerk/` imports Clerk, which `test/clerk-imports.test.ts` holds; the kit's tests of the adapter in `test/` may. What the gate needs from a provider goes through `web/sign-in/provider.ts`, and a new need is added there, to the Clerk adapter and to the stand-in together.
- The kit ships TypeScript sources: no build step, no generated files. Apps compile it under their own settings, so it stays clean under `strict`. Two exceptions, for the same reason: `authentication/stand-in/playwright.js` and `web/playwright-webkit.js` are plain JavaScript typed by the `.d.ts` beside each, since Playwright's test runner leaves files under `node_modules` to Node, which refuses TypeScript there; `test/playwright-steps.test.ts` and `test/playwright-webkit.test.ts` hold them.
- A branch never edits `package.json`'s version, and never plans a version number: threads landing at the same time would take the same one. Each branch says what kind of change it is with a `Release: minor`, `Release: patch` or `Release: none` line beside Co-Authored-By, minor for a change apps may have to change for, patch for one they notice and need not, none for one they never notice. `scripts/land-main.sh`, which `/metamax:land` runs, works out the version from main as it lands, commits it with the README's install lines, and tags `v<version>` on main. A branch made before it must rebase onto main first, or `/metamax:land` takes the pull-request route.
- The repository is public: nothing here names a machine, a person, a personal email or a path into a home folder, and `test/public.test.ts` holds that for the files and the history. Test addresses are on example.com. Commits are authored and committed as Worktron. A change lands only through `scripts/land-main.sh`, which moves main forward with a push that is never forced and so adds no commit, never with a pull request's merge button, since every way that button merges commits as the merging account.
- A Tauri plugin lives in the folder of the piece that uses it, as `plugin/`, and an app's shell builds it from the kit bun installed, by a Cargo path into `node_modules`, so `package.json` stays the one place that names the kit's version. Its `Cargo.lock` is committed, so the gates build pinned crates; what its build writes (`.tauri/`, `permissions/autogenerated/`, `permissions/schemas/`, Swift's build state) is ignored and made again by every build. A name its Rust, Swift and page share lives in the piece's `names.ts`, held by a test that reads the sources, since nothing here links the plugin into an app.
- A copied plugin keeps its license files as they are, including its author's copyright notice, which the license requires: the only names of people the repository holds.
- `extension/worker/` loads in Chrome with no build step: plain JavaScript modules, relative imports among themselves only, no packages. After any change to it, run `bun bin/app-kit.ts extension copy extension/test/fixture/kit`; a test fails until the fixture's copy matches.
- Before landing: `scripts/gates.sh` (typecheck, lint, unit tests, the web fixture and the extension harness in a hidden Chromium, and the iPhone notifications and iPhone sign-in plugins built for the iPhone simulator).
