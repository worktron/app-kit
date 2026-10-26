# Backlog

Unclaimed tickets for app-kit, one `## ` section each, in the record's shape:
work someone wrote down and nobody has started, a fork the user named or an idea
a thread noticed on its way. A ticket here is not approved: building one waits
for the user's yes to that ticket, and its worker plans first.
`/spawn <id>` starts one; its landing commit deletes the section.

## extension-install-host · An `app-kit extension install-host` command registers an app's native host with Chrome

Goal: an extension app with a native host registers it with Chrome by hand today. amazon-connector's `scripts/install.sh` writes `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/<name>.json` with a bash heredoc and a hardcoded extension ID, though the kit already has `writeHostManifest` and `chromeHostsDir` in `extension/host/install.ts` and `app-kit extension id` derives the ID from the manifest's `key`. Add `app-kit extension install-host <name> <host executable> [<folder>]` to `bin/app-kit.ts`: it reads the ID from `<folder>/manifest.json`'s key (the folder defaults to `.`), writes the manifest into `chromeHostsDir()` through `writeHostManifest`, and prints the file it wrote. The description is a required flag or a field the app passes, not a fixed string. Done when: a test in `extension/test/` runs the command against a fixture extension folder with a temporary home and asserts the JSON written, `allowed_origins` included; the README's extension section and the command's usage name it; and the release's commit message says apps can replace a hand-written host manifest with it.

## extension-copy-folder · `app-kit extension copy` says where the worker files land and refuses a folder that is not where an extension keeps them

Goal: the usage line reads "write the kit's worker files into the extension's <folder>", so an upgrader naturally passes the extension's folder. amazon-connector keeps its copies in `extension/kit/`, and on its 0.8.0 upgrade (2026-10-25) `app-kit extension copy extension` wrote six stray files beside `worker.js` instead of updating `extension/kit/`, and `check extension` then reported the strays as current. Make the usage say the files are written directly into `<folder>`, the folder the worker imports them from, and have `copy` refuse, with the folder it found, when `<folder>` holds none of the worker files yet but a subfolder of it does. Done when: a test in `extension/test/` runs `copy` on a fixture extension whose copies live in `kit/` and asserts it exits non-zero, names `kit/` and writes nothing; `copy` on a fresh empty folder still writes the files; and the usage text says where the files land.

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
