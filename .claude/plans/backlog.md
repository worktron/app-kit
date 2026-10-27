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

## mac-release · `app-kit mac release` publishes a signed Mac build that the app updates itself to

Goal: the Mac counterpart of `app-kit testflight`. timescale's desktop/scripts/release.sh:1-45 refuses unlanded code, numbers the release one past the last GitHub release, signs with the updater key read from 1Password, writes latest.json and publishes to a public releases repository; desktop/scripts/make-update-key.sh:1-35 makes the minisign key and stores it in 1Password through a template on stdin, so no secret is on a command line. Its shell checks at most hourly on focus, never while installing, and tells the page the state on each load (desktop/src-tauri/src/main.rs:216-407; client/src/auth/macAppUpdate.ts; commits 925e97a, dd2ae6f, 986d010, 041aa48). Every desktop app here ships outside the App Store, so each needs it. Builds on the hosted-window crate the tauri-window subthread is building. Found by the harvest thread, 2026-10-26.

Done when: bin/app-kit.ts has a release command and a key command, run through the testflight runner and tested with stand-in programs, the hosted-window crate offers the update check with its page half, and the README's tauri section says how an app releases and updates.

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
