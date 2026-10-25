# app-kit

The app baseline as one public package, which apps install from GitHub at a tag. Its top folders are the kinds of app (`web/`, `extension/`, `tauri/`) and two for what several kinds share (`authentication/`, `server/`), and import names follow the folders: `app-kit/web`, `app-kit/extension/...`, `app-kit/tauri/sign-in`, `app-kit/authentication/...`, `app-kit/server/google`. README.md says what each piece is and how an app takes it in, one section per folder; practices' rules files say why each exists.

## Layout

```
web/             web apps (app-kit/web): fetch wrapper, connection, new build, preload reload, error boundary, row links,
                 the phone's Text Size, the sign-in gate and the provider interface it takes (sign-in/provider.ts);
                 web/e2e/fixture, a small app built on the kit, run built in a hidden Chromium
extension/       browser extensions: worker/ (plain JavaScript Chrome loads, copied into each extension), host/ (the Mac side),
                 harness/ (hidden Chromium), testing/ (a chrome stand-in), copy.ts, and its own test/ and e2e/
tauri/           Mac and iPhone apps built with Tauri: sign-in/, desktop sign-in through the browser (app-kit/tauri/sign-in),
                 and its server routes (server.ts, app-kit/tauri/sign-in/server)
authentication/  who is calling: clerk/ (the Clerk adapter, index.tsx, and the Clerk reader for the key check, server.ts),
                 stand-in/ (the stand-in sign-in provider, and the Playwright steps for apps' browser tests, playwright.js),
                 agent-keys/ (the server check that lets a person's key read the GET routes an app lists, and its API reference, openapi.ts)
server/          server-only pieces no kind of app owns: google/ (what a refusal from Google means, with no React)
bin/             the app-kit command
scripts/         the gates (gates.sh), and the landing (land-main.sh, which runs land.ts), which sets the version and tags it
test/            every unit test, in a simulated page (happy-dom); test/fixtures holds Clerk's recorded answers, ids replaced,
                 and what each browser answered for the phone's Text Size
```

## Rules for agents working here

- A new piece goes in the folder of the kind of app that uses it. A piece with a browser half keeps its server half beside it (`tauri/sign-in/server.ts`); a piece that is server only goes in `server/`. No vendor names a top folder, and nothing moves because of which apps use it. Unit tests stay in `test/` (the extension's in `extension/test/`), and `test/exports.test.ts` holds every export name to a file that exists.
- Nothing outside `authentication/clerk/` imports Clerk, which `test/clerk-imports.test.ts` holds; the kit's tests of the adapter in `test/` may. What the gate needs from a provider goes through `web/sign-in/provider.ts`, and a new need is added there, to the Clerk adapter and to the stand-in together.
- The kit ships TypeScript sources: no build step, no generated files. Apps compile it under their own settings, so it stays clean under `strict`. One exception: `authentication/stand-in/playwright.js` is plain JavaScript typed by `authentication/stand-in/playwright.d.ts`, since Playwright's test runner leaves files under `node_modules` to Node, which refuses TypeScript there; `test/playwright-steps.test.ts` holds it.
- A branch never edits `package.json`'s version, and never plans a version number: threads landing at the same time would take the same one. Each branch says what kind of change it is with a `Release: minor`, `Release: patch` or `Release: none` line beside Co-Authored-By, minor for a change apps may have to change for, patch for one they notice and need not, none for one they never notice. `scripts/land-main.sh`, which `/metamax:land` runs, works out the version from main as it lands, commits it with the README's install lines, and tags `v<version>` on main. A branch made before it must rebase onto main first, or `/metamax:land` takes the pull-request route.
- The repository is public: nothing here names a machine, a person, a personal email or a path into a home folder, and `test/public.test.ts` holds that for the files and the history. Test addresses are on example.com. Commits are authored and committed as Worktron. A change lands only through `scripts/land-main.sh`, which moves main forward with a push that is never forced and so adds no commit, never with a pull request's merge button, since every way that button merges commits as the merging account.
- `extension/worker/` loads in Chrome with no build step: plain JavaScript modules, relative imports among themselves only, no packages. After any change to it, run `bun bin/app-kit.ts extension copy extension/test/fixture/kit`; a test fails until the fixture's copy matches.
- Before landing: `scripts/gates.sh` (typecheck, lint, unit tests, the web fixture and the extension harness in a hidden Chromium).
