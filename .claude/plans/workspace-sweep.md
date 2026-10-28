# What the owned projects write for themselves that app-kit should hold

A read of every owned project's main, 2026-10-28: what two or more projects wrote separately for the same job, what one project wrote that a practices rule asks every app of its kind to have, and app-kit pieces a project copied or worked around. Each path below is in that project's repository at its main of that day. The harvest of 2026-10-26 (argon-watcher, timescale, urge-surfer, amazon-connector) and the beeline review of 2026-10-28 already filed fourteen tickets in `backlog.md`; this plan does not repeat them, and adds the new evidence for six of them at the end.

## What was read

Twenty-eight projects, from their origin's main: advanced-direct, ai-buddy, always-be-closing, amazon-connector, argon-watcher, assay, beeline, buddy-system, collider, creative-strategy, dfract, disk-buddy, fleet, getter, hall-pass, lifeform, matter, metamax, mosquito, move-buddy, perf-buddy, practices, reminder-x, sightline, timescale, urge-surfer, worktron, xplnr. collider (GraphQL and Prisma) and creative-strategy (Next.js) are on an older stack and were read for ideas only. Checkouts of other organizations were not read for this plan.

Eight projects take app-kit, at tags from v0.8.0 (amazon-connector) to v0.19.0 (beeline, perf-buddy's menu bar app); main is at v0.21.0. Twelve web clients take nothing from it: ai-buddy, assay, buddy-system, disk-buddy, lifeform, matter, metamax, mosquito, move-buddy, perf-buddy, reminder-x, worktron. That decides most of what follows: a piece only helps an app that takes the kit, and fleet, practices, metamax and the command-line tools do not, so a piece whose users are mostly those projects is better as a ticket in each of them, copying the example the practices rule already names.

## Ranked

| Rank | What | Where it goes | Serves |
| --- | --- | --- | --- |
| 1 | The defects the sweep found: a sign-in code in a server's log, a token compared by timing, a token file anyone can read, unknown addresses sent home | a ticket in each project, filed on approval | lifeform, reminder-x, dfract, argon-watcher, metamax, worktron |
| 2 | Adoption: each project's own copies of pieces the kit already has | a ticket in each project, filed on approval | 12 projects |
| 3 | screen-basics: a page title hook and a not-found page | app-kit, built here | 17 web clients, 3 of them on the kit and lacking it today |
| 4 | request-log: a request log that never prints a query | app-kit, built here | every Hono server; argon-watcher's is the source |
| 5 | focus-tab: a link shown in a tab already open on it | app-kit, built here | Beeline, and every extension the rule covers |
| 6 | window-menu: the standard Mac menu in the window plugin | app-kit backlog | 5 Tauri apps |
| 7 | chrome-stand-in: why three extensions wrote their own | app-kit backlog, an investigation | 3 extensions |
| 8 | temporary-folder-template: the kit's own test preload matches the setup skill's | app-kit backlog | app-kit |

Found, and better as each project's own ticket than as kit code, with why, under "Found, and left to each project" below: the command-line basics, a runner for outside programs, the words for how long ago, a repeating job's overlap guard, the per-process test folder, and the full server start.

## screen-basics · A page title hook and a not-found page in app-kit/web

Goal: practices' rules/web-apps.md asks that each screen sets the page title and that an unknown address shows a not-found page rather than sending the person home. Every app writes both inline: titles in assay client/src/App.tsx:1235,1615, getter client/src/App.tsx:61 and NotFound.tsx:12, metamax client/src/features/code/CodeViewPages.tsx:131-134,154-157 (restoring the previous title), sightline client/src/parts.tsx:14-16, worktron src/Doc.tsx:8-11, three of them as "Screen · App", and timescale's client sets none; not-found pages in getter client/src/NotFound.tsx:8-24, urge-surfer src/pages/NotFound.tsx:5-16, sightline client/src/Pages.tsx:887-902 and matter src/client/components/ErrorBoundary.tsx:43-59, while argon-watcher src/App.tsx:184 shows the inbox for an unknown address, and metamax client/src/App.tsx:53 and worktron src/main.tsx:16 send it home, which the rule forbids. app-kit/web takes the app's name once, `useTitle(words)` writes "words · App" and puts the last title back when the screen goes, and `NotFound` is a page with the address that was asked for and a link home, drawn in the app's theme, which calls `useAppDrawn()` as getter's does (NotFound.tsx:9-10), since the gate holds its placeholder until a screen says it has drawn.
Done when: app-kit/web exports `useTitle` and `NotFound`, the web fixture uses both, a unit test holds the title's form and its restoring, the fixture's browser test (which runs with waitForFirstDraw) opens an unknown address and finds the not-found page at that address with the page title set, and the README's web table lists both.
Do not touch: the apps' own titles and pages; each project moves in its own thread.
Needs: nothing.
Touches: web/, web/e2e/fixture, test/, README.md.

## request-log · A request log for a Hono server that never prints a query

Goal: hono/logger prints each request's path with its query (hono 4.13's middleware/logger takes `url.slice(url.indexOf("/", 8))`), and on an OAuth callback the query is a live sign-in code. argon-watcher server/log.ts:1-20 replaces every query with `?[redacted]` (its audit item F-7); lifeform server/index.ts:27 runs `logger()` bare over /api/spotify/callback, which reads `code` from the query (server/routes/spotify.ts:75-76), so each Spotify connection writes its code into Railway's log; ten servers use the bare logger. No route of the kit's own takes a code in its query today. app-kit/server/request-log exports `requestLog()`, the middleware with argon-watcher's redaction, so a server starts from the safe one rather than finding the leak in an audit.
Done when: `requestLog` is exported with hono as an optional peer, a server test through app.request logs a callback line with a code and state and finds neither, a path with no query unchanged, and the README's server section shows it; practices' rules/web-apps.md or the setup skill names it for every server (a practices thread).
Do not touch: argon-watcher's and lifeform's servers (lifeform's leak is its own ticket below, which it can close with a one-line print function before or after this lands).
Needs: nothing.
Touches: server/request-log/, test/, package.json exports and peers, README.md.

## focus-tab · The extension worker shows a link in a tab already open on it before it opens one

Goal: practices' rules/extensions.md asks that a link focus a tab already showing its address, raising its window, before it opens a new tab. Beeline's extension/lib/show.js:15-58 does it: a minimized window brought back, a profile with no window given one, and an answer saying which happened. It also skips its own check tabs (isCheckTab) and lets the link through its hold (openUnheld), which only Beeline has; perf-buddy apps/chrome-extension/src/background/index.js:175-222 focuses a tab its daemon names but never opens a link; always-be-closing popup.js:9-19 opens its own pages, which Beeline's http and https check would refuse. extension/worker/show.js takes Beeline's, accepts the extension's own pages beside http and https, and takes two options, a test for tabs to skip and a wrapper around the open, so Beeline can take it in without losing either. Chrome fills in a tab's address only for an extension with the `tabs` permission or host access to that page, and ignores tabs.query's `url` filter without them (https://developer.chrome.com/docs/extensions/reference/api/tabs, read 2026-10-28), so the piece needs one of the two, compares each tab's address itself as Beeline's does (show.js:40-41) rather than filtering by address, and when it can read no tab's address it says so in its answer and logs it once. Beeline and perf-buddy hold `tabs` and broad host access; an extension without them names the new permission to the owner before it takes the piece in, as the rule asks, host access to its own site being the narrower choice when its links go only there.
Done when: extension/worker/show.js exports `showLink(url, { skip, open })`, unit tests against the kit's chrome stand-in (which gains tabs and windows, and leaves a tab's address out unless the manifest grants the access) hold each answer (existing tab, new tab, new window, the extension's own page, refused address, no access to addresses) and each option, the fixture extension's manifest gains `tabs` and its copy is updated with `app-kit extension copy`, the harness opens a link twice in a hidden Chromium and finds one tab, and the README's extension section lists it with the permission it needs; practices' rule names the kit (a practices thread).
Do not touch: Beeline's and perf-buddy's copies; the permissions of any extension but the fixture.
Needs: nothing.
Touches: extension/worker/, extension/testing/chrome.ts, extension/test/, extension/test/fixture, README.md.

## window-menu · The window plugin builds the standard Mac menu an app's rules ask for

Goal: practices' rules/desktop-apps.md asks for a menu bar with About, Settings… (⌘,), Check for Updates…, Sign Out when the app signs in, Hide and Quit, an Edit menu and View with Reload, because a Tauri app that sets its own menu without Edit loses ⌘C and ⌘V. timescale desktop/src-tauri/src/main.rs:519-583 builds it by hand, metamax src-tauri lib.rs:386-442 builds a different one, and argon-watcher, getter and urge-surfer set none. The window plugin (tauri/window/plugin) offers only View's zoom items (lib.rs:188-195). It builds the whole menu from Tauri's own default (Menu::default in tauri 2.12, which already holds About, Services, Hide, Quit, File's Close Window ⌘W, the Edit menu, and Window's Minimize ⌘M, Maximize and Close, as timescale's main.rs:556,580 keeps), adding Settings…, Check for Updates…, Sign Out, View's Reload and zoom, with the app naming which optional items it has and handling Settings and Sign Out through events to its page. About is the standard panel, its version the app's and its short version the commit the build was made from (muda's AboutMetadata `version` and `short_version`).
Done when: the plugin exports the menu builder, its Rust tests hold the items and their shortcuts, ⌘W and ⌘M among them, for an app with and without sign-in and settings, practices' rules/desktop-apps.md gains Close Window and the Window menu (a practices thread), the README's window section shows it, and getter (already on the plugin) takes it in its own thread.
Do not touch: the apps' shells; Check for Updates stays absent until mac-release lands.
Needs: nothing to start; mac-release for its Check for Updates item.
Touches: tauri/window/plugin/src, its permissions, README.md.

## chrome-stand-in · Find out why three extensions wrote their own chrome stand-in, and give the kit's what they needed

Goal: the kit's extension/testing/chrome.ts is used only by amazon-connector test/worker.test.ts:2. always-be-closing test/chrome-shim.js (504 lines, network refused unless a handler is set at :50), Beeline extension/test/chrome-shim.js (282 lines, also answers Google's userinfo at :247) and perf-buddy apps/chrome-extension/test/chrome-shim.js (63 lines) each wrote their own. Investigate first: which APIs each covers that the kit's does not. The deliverable is a plan naming what the kit's stand-in adds.
Done when: a plan in .claude/plans lists, for each of the three, what its stand-in covers that the kit's does not, and names the tickets that follow.
Do not touch: the three stand-ins.
Needs: nothing.
Touches: .claude/plans only.

## temporary-folder-template · The kit's test start-up file is the setup skill's, word for word

Goal: the setup skill holds the test start-up file every new project starts from (its section "Test start-up file"), and practices' test holds its own copy to that text. app-kit's test/temporary-folder.ts is a different version: other error words, no shared-folder switch, and a different sweep under `--parallel`. Two versions of one rule drift; the kit takes the skill's.
Done when: test/temporary-folder.ts is the setup skill's text with the kit's folder name, the unit tests pass under it, and a line in the README's develop section says where it comes from.
Do not touch: the setup skill.
Needs: nothing.
Touches: test/temporary-folder.ts, bunfig.toml if its name changes, README.md.

## Tickets in other projects, filed on approval

Filed in each project's own backlog (`.claude/plans/backlog.md` on its main, through metamax's ticket-land) once this plan is approved. A ticket for a kit piece not built yet waits for that piece to land; a defect waits for nothing.

Defects:

| Project | Ticket |
| --- | --- |
| lifeform | server/index.ts:27 logs /api/spotify/callback with its `code` (server/routes/spotify.ts:75-76) into Railway's log: pass a print function that replaces the query, with a test on a callback line |
| reminder-x | server/routes/notices.ts:73 compares the bearer token with `!==`, which leaks it by timing: compare in constant time, as always-be-closing server/src/app.ts:92-96 does |
| dfract | src/auth.ts:108 writes the Google token with no file mode, where rules/command-line.md asks for 0600; src/msauth.ts:60-62 opens the browser under DFRACT_NO_OPEN |
| argon-watcher | src/App.tsx:184 shows the inbox for an unknown address: a not-found page (screen-basics, or its own until then) |
| metamax | client/src/App.tsx:53 sends an unknown address home: a not-found route |
| worktron | src/main.tsx:16 draws the home page for any address: a not-found route |

Adoption:

| Project | Replaces with what the kit has today | Waits for |
| --- | --- | --- |
| timescale | its shell's sign-in hand-off, restart link, full screen and zoom (desktop/src-tauri/src/main.rs:43-106,157-174,422-443,468-511) with the window plugin; its PGlite opener (server/src/db/index.ts, which the kit's copied) with openDb; server/src/app.ts:65-67 with serveBuiltPage; the steps in e2e/sign-in.e2e.ts:39-111, e2e/finger.ts and e2e/test.ts:11 with app-kit/web/playwright; components/horizons/PullToRefresh.tsx and the font wait at client/src/main.tsx:35-43; v0.10.0 to the latest | screen-basics, window-menu |
| argon-watcher | src-tauri/src/lib.rs:276-313 with the window plugin; src/lib/api.ts:37-83 with request; src/ErrorBoundary.tsx; src/PullToReload.tsx; e2e/clerk-backoff.ts and its own Tauri bridge and user agent in e2e/*.spec.ts with the kit's steps; scripts/iphone.sh with `app-kit iphone run`; the reload after a failed screen load; server/log.ts with request-log; v0.9.0 to the latest | screen-basics, request-log |
| urge-surfer | the window plugin for its shell; server.ts:20-37 with serveBuiltPage; scripts/iphone.sh with `app-kit iphone run`; the rem and field size in src/ui/theme.ts:4-10 with rem and fieldsNeverZoom; expectFits in e2e/flows.spec.ts:81; ErrorBoundary and the reload after a failed screen load | screen-basics |
| amazon-connector | v0.8.0 to the latest, and its copied worker files again | nothing |
| always-be-closing | lib/self-reload.js, lib/worker-errors.js, lib/build-identity.js and lib/bridge.js (copied from Beeline) with the kit's worker; the framing in helper/status-helper.js:203-216 and scripts/install-helper.js with the kit's native host and install-host; a key in manifest.json (the checklist's one gap) | chrome-stand-in |
| perf-buddy | its extension's self-reload, native connect loop and alarms, and apps/native-host's framing, with the kit's worker and host; its localhost port, apps/chrome-extension/src/background/index.js:9,368, which the extensions rule forbids; its client onto app-kit/web | swift-app |
| sightline | v0.11.0 to the latest; server/app.ts:137-139 with serveBuiltPage | screen-basics |
| getter | v0.18.1 to the latest | screen-basics, window-menu |
| ai-buddy, buddy-system, disk-buddy | the ErrorBoundary they share (client/src/shared/components/ErrorBoundary.tsx) with the kit's; their useApi (shared/hooks/useApi.ts) with request, its callers adapted; the reload after a failed screen load and the first frame; their theme providers stay until plain-look gives them one | screen-basics |
| lifeform, reminder-x, assay | their Clerk gates (lifeform client/src/App.tsx:72-75, reminder-x client/src/App.tsx:38-41, assay client/src/AuthGate.tsx:37-66) with SignInGate; the Clerk session checks on the server with app-kit/authentication/clerk/server; ErrorBoundary; serveBuiltPage | screen-basics, request-log |
| matter, mosquito, move-buddy | ErrorBoundary (each has its own), the reload after a failed screen load, serveBuiltPage, the first frame; mosquito: whether its 60-second schedule tick (server/modules/schedule.ts:746) can overlap itself and run an entry twice | screen-basics |
| metamax | its newBuild.ts and connection.ts against the kit's new-build and connection lines; ErrorBoundary; the reload after a failed screen load | screen-basics |
| fleet, practices, hall-pass, dfract, xplnr, assay, perf-buddy's collector | the command-line rule's items each lacks (below), copied from the tool the rule names | nothing |

## Found, and left to each project

Each of these is real duplication, and each is better copied per project than shared, because the projects that hold the copies do not take the kit, or the copies do different jobs.

- Command-line basics. `--version` is written eight times in fleet bin/ (testflight-watch.ts:135-138, playwright-webkit.ts:234-237, nightly-backup.ts:392-395 alike; join.ts:56, deploy-keys.ts:167, fleet-server.ts:254, menubar.ts:215-216, download.ts:119-120 each different) and is missing in dfract, hall-pass, xplnr, assay, practices and perf-buddy's collector; usage and exit codes are hand-written in each (dfract src/cli.ts:1334-1336 and nine xplnr cli/ files exit 1 for wrong usage; perf-buddy packages/collector/src/cli.ts:31-60 ignores unknown flags); `op read` is the same function in hall-pass src/jev-label.ts:79-84 and argon-watcher evals/noise-gate/jev.ts:91-96; the browser's off switch has two names (DFRACT_NO_OPEN, BEELINE_NO_BROWSER). Of these tools only amazon-connector takes the kit, and it already follows the rule (src/cli.ts:18-63,111-114). rules/command-line.md already says to copy from the tool it names, so each tool's ticket copies amazon-connector's version line and hall-pass's usage.
- A runner for outside programs with a time limit: disk-buddy server/scanners/exec.ts:5-24, buddy-system packages/mac-scan/exec.ts:7-23 (copied from disk-buddy, as its header says) and ai-buddy server/scanners/exec.ts:1-17 are one copy; move-buddy, metamax, practices and perf-buddy have more. None of them takes the kit, which keeps its own in tauri/testflight/run.ts.
- How long ago, in words: seventeen copies in eleven projects, but they do different jobs (argon-watcher src/lib/time.ts is day-sized on purpose, urge-surfer src/ui/format.ts:23-42 writes "Last night" and "Thursday afternoon", sightline's are server text), only getter client/src/App.tsx:38-43 matches among apps on the kit, and the words would be a taste call no rule makes.
- A repeating job's overlap guard: argon-watcher server/scheduler.ts:60-90 and reminder-x server/services/scheduler.ts:120-145 each have one, lifeform's runs once a day, and only argon-watcher takes the kit. mosquito's is a question for its own ticket, above.
- The per-process temporary folder for tests: practices, sightline, metamax, fleet, urge-surfer and mosquito each carry one, and the setup skill's "Test start-up file" is the template they come from; the setup skill owns it, and the kit matches it (temporary-folder-template).
- A whole server start (health route with the commit, JSON errors, a clean stop): nineteen servers do it nineteen ways (health at /api/health, /health and /healthz; only lifeform and move-buddy stop on SIGTERM), but the only part that fixes a live problem is the request log, and each server's Bun options differ (metamax's websocket, matter's upload limit and loopback address).

## More evidence for tickets already in the backlog

The backlog is changed only on main, and ticket-land refuses an id it already holds, so this is written here for each ticket's worker to read.

- icon-render: eight more projects render their own icons. sightline scripts/icons.ts, timescale scripts/brand-icons.ts and urge-surfer scripts/make-icons.ts each start Playwright's Chromium to draw an SVG to PNGs, the same shape; getter scripts/make-icons.ts squares favicon.svg; metamax scripts/icons.ts and perf-buddy scripts/icons.ts draw more; fleet apps/menubar/scripts/render-icons.sh and amazon-connector scripts/render-icons.sh follow Beeline's; always-be-closing generate-icons.js. rules/mobile-apps.md also asks for the web icons (favicon, Apple touch icon, the manifest's 192 and 512), so the command should write those too. sharp's prebuilt binaries read SVG with neither Homebrew nor a browser (https://sharp.pixelplumbing.com/install, read 2026-10-28), and @vite-pwa/assets-generator's preset lists the web set from one SVG (favicon, 64, 192 and 512 manifest icons, a maskable 512, a 180 Apple touch icon): the first candidates, ahead of rsvg-convert (Homebrew) or Chromium, kept only for a drawing whose text librsvg or sharp draws differently.
- swift-app: fleet apps/menubar/Sources/main.swift and perf-buddy apps/menubar/Sources/main.swift repeat four of its five pieces: the Dock icon shown while Settings is open (fleet :142,269-274; perf-buddy :563-570; Beeline StatusMenu.swift:92-125), About with version and commit (fleet :240-243 and Beeline StatusMenu.swift:75-85, near-identical), a log (fleet :30-47), launch at login (fleet :247, perf-buddy Supervisor.swift:41). Two more belong in the package: refreshing on wake (fleet :173; perf-buddy :648-650 with a five-second delay), which rules/desktop-apps.md asks of every app that works on a clock, and running a program with a time limit (fleet :52-63; perf-buddy :430-460; Beeline ChromeLauncher.swift). All three take the kit's menu bar theme already, so this package has users.
- self-reload-folder: perf-buddy's extension is a second one loaded from a subfolder; its src/background/self-reload.js also reloads on a fingerprint of the files (key "loadedFingerprint" at :23), in a different design from Beeline's.
- claude-answers: more servers read Claude's refusals and pull JSON from answers: getter server's research.ts:73-79 (refusal and pause_turn) and matching.ts:31; lifeform server/lib/insights-gen.ts:249-252 (refusal and max_tokens); perf-buddy apps/server/src/analyze.ts:333 and apps/cloud/src/routes/analysis.ts:113 (the same greedy regular expression); ai-buddy server/routes/actions.ts:74. Half the projects call Claude through the Vercel AI SDK (perf-buddy, assay, metamax, move-buddy) and half through Anthropic's SDK, so the piece says which it serves. Of these, getter takes the kit.
- google-retry: the retry is not Google's alone. lifeform server/routes/spotify.ts:306-312 retries once on 429 with Retry-After and no cap, server/scripts/rematch-music-covers.ts:32-40,107-118 backs off six times, and move-buddy server/routes/execute.ts:85-101 retries once after three seconds. The retrying call can live in server/ with Google's reading as one input, so other services take it.
- service-worker-builds: metamax client/src/shared/newBuild.ts:150-203 is a third new-build line written apart from the kit's.

## Not recommended

- A shared lint config or tsconfig base: six .oxlintrc.json files share one core, but the setup skill holds the template every new project starts from, which already solves it.
- The MUI theme copies (ai-buddy, buddy-system, disk-buddy and metamax share one color object): plain-look's tokens and theme cover it, and those apps move onto that.
- A snackbar: metamax and disk-buddy share one file byte for byte, and lifeform has another, but practices' interfaces rules ask that work happen in place.
- The landing and gate scripts (ship-gates.sh in ten repositories, deep-ship.sh in eleven, getter's and sightline's byte-identical): metamax's landing owns that convention.
- A scratch Postgres database per test file (getter server/testing/database.ts, sightline test/scratch-db.ts, matter src/server/test-db.ts, argon-watcher server/int): four different mechanisms, each for a reason PGlite does not cover.
- Live updates (metamax client/src/shared/context/LiveContext.tsx, perf-buddy apps/client/src/useSSE.ts): two copies, different needs.
- A once-a-day warning when a tool's checkout is behind main (rules/command-line.md): no tool has one to copy, and the tools that would use it do not take the kit.

## Noticed

- practices' app-checklist reads neither the not-found page nor the menu; once screen-basics and window-menu land, it can check for them (a practices ticket).
