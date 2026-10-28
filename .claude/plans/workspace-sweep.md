# What the owned projects write for themselves that app-kit should hold

A read of every owned project's main, 2026-10-28: what two or more projects wrote separately for the same job, what one project wrote that a practices rule asks every app of its kind to have, and app-kit pieces a project copied or worked around. Each path below is in that project's repository at its main of that day. The harvest of 2026-10-26 (argon-watcher, timescale, urge-surfer, amazon-connector) and the beeline review of 2026-10-28 already filed fourteen tickets in `backlog.md`; this plan does not repeat them, and adds the new evidence for six of them at the end.

## What was read

Twenty-eight projects, from their origin's main: advanced-direct, ai-buddy, always-be-closing, amazon-connector, argon-watcher, assay, beeline, buddy-system, collider, creative-strategy, dfract, disk-buddy, fleet, getter, hall-pass, lifeform, matter, metamax, mosquito, move-buddy, perf-buddy, practices, reminder-x, sightline, timescale, urge-surfer, worktron, xplnr. collider (GraphQL and Prisma) and creative-strategy (Next.js) are on an older stack and were read for ideas only. Checkouts of other organizations were not read for this plan.

Eight projects take app-kit, at tags from v0.8.0 (amazon-connector) to v0.19.0 (beeline, perf-buddy's menu bar app); main is at v0.21.0. Twelve web clients take nothing from it: ai-buddy, assay, buddy-system, disk-buddy, lifeform, matter, metamax, mosquito, move-buddy, perf-buddy, reminder-x, worktron.

## Ranked

Ranked by how many apps a piece serves against what it costs. The first seven are TypeScript or JavaScript with no new dependency and are built in this thread once approved; the last three wait in the backlog.

| Rank | Ticket | Serves | Cost |
| --- | --- | --- | --- |
| 1 | screen-basics | 17 web clients | a hook and a page |
| 2 | command-line | 10 command-line tools, 6 servers' runners | a module, and the runner moved |
| 3 | ages | 11 projects, 17 copies | one function |
| 4 | server-start | 19 servers | a module, with Hono as an optional peer |
| 5 | test-temporary-folder | 7 repositories | a preload, exported |
| 6 | repeating-jobs | 5 servers | one function |
| 7 | focus-tab | 3 extensions | one worker file |
| 8 | window-menu | 5 Tauri apps | Rust in the window plugin |
| 9 | chrome-stand-in | 3 extensions | an investigation first |
| 10 | command-line-behind | 10 command-line tools | a check with a daily stamp; no app has one to copy |

Bigger than any of these is adoption: twelve web clients carry their own copies of pieces the kit already has (eight error boundaries, nine fetch wrappers, ten servers sending their built page their own way, no client with the reload after a failed screen load). That is each project's own work, filed as a ticket in its own backlog; the table is under Adoption, below.

## screen-basics · A page title hook and a not-found page in app-kit/web

Goal: practices' rules/web-apps.md asks that each screen sets the page title and that an unknown address shows a not-found page rather than sending the person home. Every app writes both inline: titles in assay client/src/App.tsx:1235,1615, getter client/src/App.tsx:61 and NotFound.tsx:12, metamax client/src/features/code/CodeViewPages.tsx:131-134,154-157 (restoring the previous title), sightline client/src/parts.tsx:14-16, worktron src/Doc.tsx:8-11, three of them as "Screen · App"; not-found pages in getter client/src/NotFound.tsx:8-24, urge-surfer src/pages/NotFound.tsx:5-16, sightline client/src/Pages.tsx:887-902 and matter src/client/components/ErrorBoundary.tsx:43-59, while metamax client/src/App.tsx:53 and worktron src/main.tsx:16 send an unknown address home, which the rule forbids. app-kit/web takes the app's name once, `useTitle(words)` writes "words · App" and puts the last title back when the screen goes, and `NotFound` is a page with the address that was asked for and a link home, drawn in the app's theme.
Done when: app-kit/web exports `useTitle` and `NotFound`, the web fixture uses both, a unit test holds the title's form and its restoring, the fixture's browser test opens an unknown address and finds the not-found page at that address with the page title set, and the README's web table lists both.
Do not touch: the apps' own titles and pages; each project moves in its own thread.
Needs: nothing.
Touches: web/, web/e2e/fixture, test/, README.md.

## command-line · app-kit/command-line: the version line, usage and exit codes, color, opening the browser, the worktree warning, and the runner for outside programs

Goal: practices' rules/command-line.md lists what every tool ships and names no shared code, so each tool writes it again. `--version`: fleet has eight separate ones in bin/ (testflight-watch.ts:135-138, playwright-webkit.ts:234-237 and nightly-backup.ts:392-395 alike; join.ts:56, deploy-keys.ts:167, fleet-server.ts:254, menubar.ts:215-216 and download.ts:119-120 each different), amazon-connector src/cli.ts:53,111-114 prints "version (commit)", and dfract, hall-pass, xplnr, assay, practices and perf-buddy's collector have none (practices' app-checklist reports six). Usage and exit codes are hand-written in each: amazon-connector src/cli.ts:18-63,171-172 and hall-pass src/cli.ts:24-52 follow the rule, dfract src/cli.ts:1334-1336 and nine of xplnr's cli/ files exit 1 for wrong usage, and perf-buddy packages/collector/src/cli.ts:31-60 ignores unknown flags. Color on a terminal only and without NO_COLOR: fleet bin/status.ts:492 and bin/apply.ts:739, no other tool. Opening the browser with an off switch: dfract src/cli.ts:1021-1022 (DFRACT_NO_OPEN, which its sign-in at src/msauth.ts:60-62 ignores) and beeline's BEELINE_NO_BROWSER, two names for one job. The warning when installed from a worktree: only amazon-connector scripts/install.sh:18-20. `op read`: hall-pass src/jev-label.ts:79-84 and argon-watcher evals/noise-gate/jev.ts:91-96 are the same function, fleet bin/keys.ts:82-88 a third. A runner with a time limit that returns the exit code and output: the kit's own tauri/testflight/run.ts; disk-buddy server/scanners/exec.ts:5-24, buddy-system packages/mac-scan/exec.ts:7-23 (whose header says it was copied from disk-buddy) and ai-buddy server/scanners/exec.ts:1-17 are one copy; move-buddy server/scanners/exec.ts, metamax server/scanners/exec.ts:42, practices tools/dev/lib.ts:611-617 and eleven helpers in perf-buddy apps/server are more. app-kit/command-line holds `versionLine(packageJson, checkout)`, a `usage` helper that prints to stdout and exits 0 for --help, -h, help and no arguments and to stderr with exit 2 for wrong usage, `useColor()`, `openInBrowser(url, { offSwitch })` that prints the full address either way, `warnIfWorktree()`, `opRead(reference)`, and the runner, moved here from tauri/testflight/run.ts with testflight importing it. bin/app-kit.ts uses all of it.
Done when: app-kit/command-line exports each piece, unit tests hold every exit code, the version line in a checkout and outside one, color under NO_COLOR and off a terminal, the browser's off switch (never opening in a test), the worktree warning in a temporary worktree and the runner's time limit with a stand-in program; testflight and bin/app-kit.ts use them and their tests still pass; the README has a command-line section; and practices' rules/command-line.md names app-kit as the example for each item it holds (a practices thread).
Do not touch: the tools themselves; each moves in its own thread. fleet, practices and metamax do not install app-kit today, and whether they do is their call.
Needs: nothing.
Touches: command-line/ (a new top folder, for the command-line kind of app), tauri/testflight/run.ts, bin/app-kit.ts, test/, test/exports.test.ts, package.json exports, README.md, AGENTS.md's layout.

## ages · One function for how long ago something happened, in the words the menu bar theme uses

Goal: seventeen copies in eleven projects say how long ago something was, each with its own thresholds and words: ai-buddy client/src/features/sync/MachineCard.tsx:18-26, getter client/src/App.tsx:38-43, metamax client/src/features/code/status.ts:58-65 and overview.ts:67-75, mosquito client/src/components/LaundrySettings.tsx:30-36, NodeFaults.tsx:26-33 and RoomControls.tsx:22-27 (90 minutes and 36 hours in one, 48 hours in another), move-buddy client/src/features/migration/move/InsuranceCard.tsx:35-46 and MoveView.tsx:20-27, perf-buddy apps/client/src/pages/Dashboard.tsx:16-22, sightline src/views.ts:72-78 ("N min ago") and src/report.ts:149, argon-watcher src/lib/time.ts:4-21 ("yesterday", "N weeks ago"), urge-surfer src/ui/format.ts:23-42, and matter's own pair in two client files. The menu bar theme's samples already write ages as "2m ago" and "2h ago" (swift/menu-bar/Sources/menu-bar-snapshots/Samples.swift:43-74). app-kit/web exports `age(when, now)`: "just now" under a minute, "Nm ago" under an hour, "Nh ago" under a day, "yesterday", "Nd ago" under a week, then the date in the reader's locale, and a `useNow` that ticks once a minute while the page is in view (urge-surfer src/ui/useNow.ts:11-13 is the model), so ages move without each screen keeping a timer.
Done when: `age` and `useNow` are exported from app-kit/web, a unit test holds every threshold on a fixed clock including the boundaries and a time in the future, `useNow` stops ticking while the page is hidden under happy-dom, and the README's web table lists them with the words they write.
Do not touch: the apps' copies; the menu bar theme, which takes ages as words from its app.
Needs: nothing.
Touches: web/, test/, README.md.

## server-start · app-kit/server/start: a Hono app with the health route, a request log that never prints a query, JSON errors and a clean stop

Goal: nineteen servers start the same way and each differs. Health is /api/health in eleven, /health in five and /healthz in always-be-closing server/src/app.ts:45, while the kit's README example probes /api/health and five of seven railway.json files check it. Ten servers print hono/logger's lines as they are, path and query together; argon-watcher server/log.ts:1-20 is the only one that redacts the query, because on an OAuth callback it is a live sign-in code in Railway's log (its audit item F-7). No server sets app.onError; error bodies are written inline everywhere, and lifeform answers validation failures in a second shape (server/routes/discover.ts:667,695). Only lifeform server/index.ts:108-109 and move-buddy server/index.ts:465-466,516-517 stop on SIGTERM. A development CORS setup is copied between ai-buddy server/index.ts:19-24 and buddy-system server/index.ts:11-16, and between disk-buddy server/index.ts:25-31 and metamax server/index.ts:83-88. app-kit/server/start gives `appServer()`: a Hono app with GET /api/health, the request log with every query replaced by `?[redacted]`, an onError that logs the error with its stack and answers 500 `{ error }` (and an HTTPException's own status and words), a JSON 404 under /api/; and `listen(app, { port, onStop })`, which reads PORT, logs the address once, and on SIGTERM or SIGINT stops taking requests, runs onStop (a database's close(), a repeating job's stop) and exits. serveBuiltPage mounts on it as it does on any Hono app.
Done when: app-kit/server/start exports both, with hono as an optional peer; server tests through app.request hold the health route, a logged OAuth callback line carrying no code, the error and 404 shapes, and a test starts a real server on port 0 in a child process, sends it SIGTERM and finds onStop run and the process gone; the web fixture's server (web/e2e/serve.ts) is built on it; and the README's server section shows a whole server with openDb, serveBuiltPage and agent keys.
Do not touch: the servers; each moves in its own thread.
Needs: nothing.
Touches: server/start/, web/e2e/serve.ts, test/, package.json exports and peers, README.md.

## test-temporary-folder · The per-process temporary folder for tests, exported as a preload any project names in bunfig.toml

Goal: the kit wrote test/temporary-folder.ts for itself (a folder /tmp/<name>-tests/<pid> made TMPDIR, refused unless this user owns it and nobody else can write to it, and the folders of ended processes removed). Six repositories carry their own copy: practices tests/preload.ts and sightline scripts/test-preload.ts are one file with a different root; metamax scripts/test-preload.ts:33 with server/lib/process-test-dir.ts:22-30 and fleet bin/test-setup.ts with bin/test-temp.ts:12 match practices' check line for line; urge-surfer scripts/test-tmp.ts and mosquito server/test-setup.ts differ in the mode they refuse (0o077 against 0o022). Exported, each project's bunfig.toml names `app-kit/testing/temporary-folder` and the folder takes its name from the project's package.json, or from the folder's name when it has none.
Done when: the preload is exported, the kit's own bunfig.toml loads it by its export name, a test runs `bun test` in a scratch project that preloads it and finds TMPDIR under /tmp/<that name>-tests/<pid>, a folder another user could write to is refused with its reason, and the README says what a project adds to bunfig.toml.
Do not touch: the six copies; each moves in its own thread.
Needs: nothing.
Touches: testing/ (a new top folder for what every kind's tests share), test/temporary-folder.ts, bunfig.toml, test/exports.test.ts, package.json exports, README.md, AGENTS.md's layout.

## repeating-jobs · A job on a clock that never overlaps itself, logs what it skipped and failed, and stops with the server

Goal: argon-watcher server/scheduler.ts:60-90 and reminder-x server/services/scheduler.ts:120-145 each wrote the same guard against setInterval starting a tick while the last one runs (one double-sent alarms, the other mutated mailboxes twice), with their own log words; lifeform server/index.ts:100-105 and mosquito server/modules/schedule.ts:746 run theirs bare, and metamax wrote an `every` helper three times (server/lib/watch-folder.ts:42, server/live/recap.ts:106, server/live/freeze-watch.ts:116). app-kit/server gives `every(name, intervalMs, job, { runAtStart })`: a run still going when the next is due is skipped with a log line naming the job, a throw is logged with the job's name and the next run still happens, and it returns stop(), which waits for a run in progress and is what server-start's onStop calls.
Done when: `every` is exported from app-kit/server (beside start, or its own folder), tests on a fake clock hold the skipped run and its log line, a throwing job followed by a good run, runAtStart, and stop() waiting for a run in progress; and the README shows it with server-start.
Do not touch: the servers; a lock for several instances, which no app runs today (argon-watcher server/triage/matter-store.ts:111 takes an advisory lock inside one job, which stays the app's).
Needs: server-start, for the stop on shutdown.
Touches: server/, test/, README.md.

## focus-tab · The extension worker shows a link in a tab already open on it before it opens one

Goal: practices' rules/extensions.md asks that a link focus a tab already showing its address, raising its window, before it opens a new tab, and names perf-buddy. Beeline's extension/lib/show.js:15-50 is the fuller copy: only http and https, a minimized window brought back, a profile with no window given one, and an answer saying which happened. perf-buddy apps/chrome-extension/src/background/index.js:175-220 and src/popup/popup.js:211 do the same by tab id or address. The kit's worker has none. extension/worker/show.js takes Beeline's, with the chrome stand-in covering what it calls.
Done when: extension/worker/show.js exports `showLink(url)`, unit tests against the kit's chrome stand-in hold each answer (existing tab, new tab, new window, refused address), the fixture extension's copy is updated with `app-kit extension copy`, the harness opens a link twice in a hidden Chromium and finds one tab, and the README's extension section lists it; practices' rule names the kit (a practices thread).
Do not touch: Beeline's and perf-buddy's copies.
Needs: nothing.
Touches: extension/worker/, extension/testing/chrome.ts, extension/test/, extension/test/fixture/kit, README.md.

## window-menu · The window plugin builds the standard Mac menu an app's rules ask for

Goal: practices' rules/desktop-apps.md asks for a menu bar with About, Settings… (⌘,), Check for Updates…, Sign Out when the app signs in, Hide and Quit, an Edit menu and View with Reload, because a Tauri app that sets its own menu without Edit loses ⌘C and ⌘V. timescale desktop/src-tauri/src/main.rs:519-583 builds it by hand, metamax src-tauri lib.rs:386-442 builds a different one, and argon-watcher, getter and urge-surfer set none. The window plugin (tauri/window/plugin) offers only View's zoom items (lib.rs:188-195). It builds the whole menu, with the app naming which optional items it has and handling Settings and Sign Out through events to its page, and About showing the version and the commit the build was made from.
Done when: the plugin exports the menu builder, its Rust tests hold the items and their shortcuts for an app with and without sign-in and settings, the README's window section shows it, and getter (already on the plugin) takes it in its own thread.
Do not touch: the apps' shells; Check for Updates stays absent until mac-release lands.
Needs: nothing to start; mac-release for its Check for Updates item.
Touches: tauri/window/plugin/src, its permissions, README.md.

## chrome-stand-in · Find out why three extensions wrote their own chrome stand-in, and give the kit's what they needed

Goal: the kit's extension/testing/chrome.ts is used only by amazon-connector test/worker.test.ts:2. always-be-closing test/chrome-shim.js (504 lines, network refused unless a handler is set at :50), Beeline extension/test/chrome-shim.js (282 lines, also answers Google's userinfo at :247) and perf-buddy apps/chrome-extension/test/chrome-shim.js (63 lines) each wrote their own. Investigate first: which APIs each covers that the kit's does not. The deliverable is a plan naming what the kit's stand-in adds.
Done when: a plan in .claude/plans lists, for each of the three, what its stand-in covers that the kit's does not, and names the tickets that follow.
Do not touch: the three stand-ins.
Needs: nothing.
Touches: .claude/plans only.

## command-line-behind · A command-line tool warns once a day when its checkout is behind main

Goal: practices' rules/command-line.md asks each tool to keep itself current or warn at most once a day, on stderr, when the installed copy is behind its origin, with the command that updates it. No tool does: the only follow-main mechanisms are whole loops (beeline scripts/follow-main.sh, fleet bin/sync.ts, metamax server/live/auto-pull.ts). app-kit/command-line gains `warnIfBehind({ checkout, stampFile, updateCommand })`, which fetches at most once a day, in the background of the run, and prints one line when main is ahead.
Done when: tests on a scratch repository with a fake clock hold once a day, the line's words, a fetch that fails saying nothing, and a run with no network never waiting; and the README's command-line section shows it.
Do not touch: the tools.
Needs: command-line.
Touches: command-line/, test/, README.md.

## Adoption: each project's own ticket

Filed in each project's own backlog (`.claude/plans/backlog.md` on its main, through metamax's ticket-land) once this plan is approved, one ticket per project naming the kit pieces and the files they replace. A ticket for a piece not built yet waits for that piece to land.

| Project | Replaces with what the kit has today | Waits for |
| --- | --- | --- |
| timescale | its shell's sign-in hand-off, restart link, full screen and zoom (desktop/src-tauri/src/main.rs:43-106,157-174,422-443,468-511) with the window plugin; its PGlite opener (server/src/db/index.ts, which the kit's copied) with openDb; server/src/app.ts:65-67 with serveBuiltPage; the steps in e2e/sign-in.e2e.ts:39-111, e2e/finger.ts and e2e/test.ts:11 with app-kit/web/playwright; components/horizons/PullToRefresh.tsx and the font wait at client/src/main.tsx:35-43; v0.10.0 to the latest | window-menu |
| argon-watcher | src-tauri/src/lib.rs:276-313 with the window plugin; src/lib/api.ts:37-83 with request; src/ErrorBoundary.tsx; src/PullToReload.tsx; e2e/clerk-backoff.ts and its own Tauri bridge and user agent in e2e/*.spec.ts with the kit's steps; scripts/iphone.sh with `app-kit iphone run`; the reload after a failed screen load; v0.9.0 to the latest | server-start (its log.ts becomes the kit's) |
| urge-surfer | the window plugin for its shell; server.ts:20-37 with serveBuiltPage; scripts/iphone.sh with `app-kit iphone run`; the rem and field size in src/ui/theme.ts:4-10 with rem and fieldsNeverZoom; expectFits in e2e/flows.spec.ts:81; ErrorBoundary and the reload after a failed screen load | test-temporary-folder, ages |
| amazon-connector | v0.8.0 to the latest, and its copied worker files again | command-line |
| always-be-closing | lib/self-reload.js, lib/worker-errors.js, lib/build-identity.js and lib/bridge.js (copied from Beeline) with the kit's worker; the framing in helper/status-helper.js:203-216 and scripts/install-helper.js with the kit's native host and install-host; a key in manifest.json (the checklist's one gap) | chrome-stand-in |
| perf-buddy | its extension's self-reload, native connect loop and alarms, and apps/native-host's framing, with the kit's worker and host; its localhost port, apps/chrome-extension/src/background/index.js:9,368, which the extensions rule forbids; its client onto app-kit/web | focus-tab, swift-app |
| sightline | v0.11.0 to the latest; server/app.ts:137-139 with serveBuiltPage; scripts/test-preload.ts | test-temporary-folder, server-start |
| getter | its e2e/server and playwright config are sightline's, a candidate for the kit once a third app matches | window-menu, screen-basics |
| ai-buddy, buddy-system, disk-buddy | the one ErrorBoundary, useApi and ThemeContext they share (client/src/shared/components/ErrorBoundary.tsx, shared/hooks/useApi.ts, shared/context/ThemeContext.tsx, byte-identical between buddy-system and disk-buddy) with the kit's; the exec.ts they share | command-line, server-start |
| lifeform, reminder-x, assay | their Clerk gates (lifeform client/src/App.tsx:72-75, reminder-x client/src/App.tsx:38-41, assay client/src/AuthGate.tsx:37-66) with SignInGate; the Clerk session checks on the server with app-kit/authentication/clerk/server; ErrorBoundary; serveBuiltPage | server-start, repeating-jobs |
| matter, metamax, mosquito, move-buddy, worktron | ErrorBoundary (each has its own), the reload after a failed screen load, serveBuiltPage, the first frame; metamax's newBuild.ts and connection.ts against the kit's new-build and connection lines | screen-basics, server-start |
| fleet, practices, hall-pass, dfract, xplnr | their version lines, usage and exit codes, and runners | command-line |

## More evidence for tickets already in the backlog

The backlog is changed only on main, and ticket-land refuses an id it already holds, so this is written here for each ticket's worker to read.

- icon-render: eight more projects render their own icons. sightline scripts/icons.ts, timescale scripts/brand-icons.ts and urge-surfer scripts/make-icons.ts each start Playwright's Chromium to draw an SVG to PNGs, the same shape; getter scripts/make-icons.ts squares favicon.svg; metamax scripts/icons.ts and perf-buddy scripts/icons.ts draw more; fleet apps/menubar/scripts/render-icons.sh and amazon-connector scripts/render-icons.sh follow Beeline's; always-be-closing generate-icons.js. rules/mobile-apps.md also asks for the web icons (favicon, Apple touch icon, the manifest's 192 and 512), so the command should write those too. Chromium, which every project's tests install, may serve better than rsvg-convert, which needs Homebrew: the worker decides.
- swift-app: fleet apps/menubar/Sources/main.swift and perf-buddy apps/menubar/Sources/main.swift repeat four of its five pieces: the Dock icon shown while Settings is open (fleet :142,269-274; perf-buddy :563-570; Beeline StatusMenu.swift:92-125), About with version and commit (fleet :240-243 and Beeline StatusMenu.swift:75-85, near-identical), a log (fleet :30-47), launch at login (fleet :247, perf-buddy Supervisor.swift:41). Two more belong in the package: refreshing on wake (fleet :173; perf-buddy :648-650 with a five-second delay), which rules/desktop-apps.md asks of every app that works on a clock, and running a program with a time limit (fleet :52-63; perf-buddy :430-460; Beeline ChromeLauncher.swift).
- self-reload-folder: perf-buddy's extension is a second one loaded from a subfolder; its src/background/self-reload.js also reloads on a fingerprint of the files (key "loadedFingerprint" at :23), in a different design from Beeline's.
- claude-answers: more servers read Claude's refusals and pull JSON from answers: getter server's research.ts:73-79 (refusal and pause_turn) and matching.ts:31; lifeform server/lib/insights-gen.ts:249-252 (refusal and max_tokens); perf-buddy apps/server/src/analyze.ts:333 and apps/cloud/src/routes/analysis.ts:113 (the same greedy regular expression); ai-buddy server/routes/actions.ts:74. Half the projects call Claude through the Vercel AI SDK (perf-buddy, assay, metamax, move-buddy) and half through Anthropic's SDK, so the piece says which it serves.
- google-retry: the retry is not Google's alone. lifeform server/routes/spotify.ts:306-312 retries once on 429 with Retry-After and no cap, server/scripts/rematch-music-covers.ts:32-40,107-118 backs off six times, and move-buddy server/routes/execute.ts:85-101 retries once after three seconds. The retrying call can live in server/ with Google's reading as one input, so other services take it.
- service-worker-builds: metamax client/src/shared/newBuild.ts:150-203 is a third new-build line written apart from the kit's.

## Not recommended

- A shared lint config or tsconfig base: six .oxlintrc.json files share one core, but the setup skill holds the template every new project starts from, which already solves it.
- The MUI theme copies (ai-buddy, buddy-system, disk-buddy and metamax share one color object): plain-look's tokens and theme cover it, and those apps move onto that.
- A snackbar: metamax and disk-buddy share one file byte for byte, and lifeform has another, but practices' interfaces rules ask that work happen in place, and two copies of one file are an adoption question, not a kit piece.
- The landing and gate scripts (ship-gates.sh in ten repositories, deep-ship.sh in eleven, getter's and sightline's byte-identical): metamax's landing owns that convention.
- A scratch Postgres database per test file (getter server/testing/database.ts, sightline test/scratch-db.ts, matter src/server/test-db.ts, argon-watcher server/int): four different mechanisms, each for a reason PGlite does not cover; wait until one of them is wanted by a second app.
- Live updates (metamax client/src/shared/context/LiveContext.tsx, perf-buddy apps/client/src/useSSE.ts): two copies, different needs.

## Noticed, not this plan's

- reminder-x server/routes/notices.ts:73 compares a bearer token with `!==`, which leaks its length and prefix by timing; always-be-closing and worktron compare in constant time, and the kit's agent keys do too. For reminder-x's thread.
- dfract src/auth.ts:108 writes its Google token with no file mode, where the command-line rule asks for 0600, and its Microsoft sign-in opens the browser even under DFRACT_NO_OPEN. For dfract's thread.
- practices' app-checklist reads neither the not-found page nor the menu; once screen-basics and window-menu land, it can check for them.
