# extension-health

An investigation's plan, from the thread extension-health on 2026-11-07. Each ticket below is built in its own work, after the owner's go to it.

## What this is for

Every extension of ours gets the utilities and the guidance that keep two failures from ever going unseen again: an extension that has lost the key its server gave it, and a worker that has stopped doing its work. The kit gives each extension a log of what it decided, a record of each job on a clock, one health answer every reader gets, a status command that needs no native host, and a way for a keyless extension to be given a key again. Practices' extensions rule says each of them is required.

## What happened in Getter

Getter's extension keeps the key Getter gave it in `chrome.storage.local`, which Chrome keeps per extension ID. On 2026-11-06 Getter's PR #68 changed the manifest's `key` to the Chrome Web Store's, so the ID changed (`ofmfnffa…` to `jlbpobhn…`) and every profile's copy woke with empty storage. Getter's own test held the page's ID equal to the manifest's, so the page found the new extension; nothing said the extension had nothing to sign in with. Amazon reading and Add to cart stopped for about 36 hours without a word. Getter's PR #79 (ae84e4c, 2026-11-07) made any signed-in Getter page give a keyless extension a key, which is app code for one app.

After that, the extension answered the page's hello with `connected: true`, and production still saw no request from it from 2026-11-06 19:17 UTC to 2026-11-07 19:18 UTC. It began asking within a minute of the person opening Getter's Settings, whose hello reaches the worker through `onMessageExternal`. An Add to cart tapped at 13:12 UTC sat waiting the whole time. Why the one-minute alarm produced no request is unknown, and nothing could have said: the worker keeps its errors, but Getter hears them only inside a run's `/start`, which never ran; `app-kit extension status` needs a native host, which Getter has none of; and the server knows only the last time the extension asked.

## What exists today

- `extension/worker/errors.js`: uncaught errors and unhandled rejections, the newest 20, kept in `storage.local` with time and build. Nothing records what the worker decided, only what threw.
- `extension/worker/alarms.js` `every(name, minutes, run)`: an alarm, made only when missing. It records nothing about runs, does not catch a run that fails or never ends, and leaves "one run at a time" to each app (Getter's is a module-level `reading` flag in `extension/reading.js`, reset only in a `finally`).
- `extension/worker/port.js`: the worker's `state` answer (build, commit, errors) reaches `app-kit extension status <socket>` only through a native host.
- `extension/host/diagnose.ts`: says why no host answers. With no host at all there is no status.
- Getter's page asks the extension `hello` through `externally_connectable`; the answer is the app's own shape. Getter's server stamps `extension_asked_at` on each `/work` and, after two minutes without one, shows a waiting add as "Chrome on your Mac isn't answering" (`server/purchases/cart-adds.ts:233-238`), and after 36 hours without a read shows a quiet line on the Amazon row (`server/purchases/amazon.ts:258-263`). So the server can say the extension is quiet; nothing can say why. The build and errors it gets at `/start` are logged, never stored (`server/routes/purchases.ts:88-93`).

The owner's other four extensions, read 2026-11-07:

| Extension | Key it holds | Errors | Status | Time limit on `fetch` |
| --- | --- | --- | --- | --- |
| amazon-connector | none (the profile's Amazon sign-in) | kit's `errors.js`, in the host's `state` | `amazon-connector status` and an MCP status tool, through its native host; no last-seen | none |
| Beeline | none from a server (Google's token per call) | copies the kit's `errors.js` and `port.js` but uses neither, so none are kept | popup and options page show the build; the Beeline app keeps a last-heard time | its probes only (4 to 8 seconds); not its Google call |
| always-be-closing | a Jev key read from a git-ignored file in the extension | its own `workerErrors`, sent to its helper in each status report | `bun run status`: per profile, the build, how long it has run, a STALE line after 3 minutes without a report, the last day's errors, through its native helper | none |
| perf-buddy | none | console only | the popup; its daemon keeps a last-seen per profile, which no page shows | none |

So: none of the five keeps a log of decisions; only Beeline's probes put a limit on a `fetch`; three have a native host and a status built on it, always-be-closing's being the best (per profile, with a stale line), and none can say anything once the worker or the host is not running; only Getter is given a key by its server.

What Chrome does, from its documentation and Chromium's source (read 2026-11-07):

- Chrome stops a worker after 30 seconds with no extension event or API call, when one event runs past 5 minutes, and when a `fetch` takes more than 30 seconds to answer ([lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)). A one-minute alarm does not keep one worker alive, so a module variable such as Getter's `reading` flag starts fresh at each alarm, and a hung `fetch` costs the worker within about 30 seconds. A stuck flag is an unlikely cause of a day's silence; a time limit under 30 seconds on each `fetch` still matters, since the run is otherwise cut off with no record of where.
- Alarms survive a browser restart, but whether they survive an unpacked reload is unsettled: the documentation says an alarm "persists until the extension updates" ([alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms)), and in Chromium's source an unpacked reload goes through the install path, where `StateStore::OnExtensionWillBeInstalled` deletes the stored alarms ([state_store.cc](https://chromium.googlesource.com/chromium/src/+/main/extensions/browser/state_store.cc), read at main 2026-11-07). The kit's `every` makes a missing alarm at every worker start, so a cleared alarm is lost only if the first worker after the reload does not start or races the clearing. Chrome's own advice is to check at every start that the alarms the extension needs exist, which Bitwarden's extension does (`verifyAlarmsState` in [browser-task-scheduler.service.ts](https://github.com/bitwarden/clients/blob/main/apps/browser/src/platform/services/task-scheduler/browser-task-scheduler.service.ts)).
- A worker that stops answering its alarms after an extension reload or update, until something else starts it, is a known class of Chromium fault: issue [40805401](https://issues.chromium.org/issues/40805401), and a February 2026 chromium-extensions thread where a Chromium engineer says Chrome 142 added retries for worker start failures and some races are still being fixed ([thread](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/psI-719Df8k)). In the source, an install clears the worker's saved event listeners (`ExtensionPrefs::FinishExtensionInfoPrefs`), alarms are delivered only to saved listeners, and an external message starts the worker whatever is saved (`MessageService`). If the first worker after Getter's self-reload did not save its `onAlarm` listener again, every alarm went nowhere until the Settings page's message started the worker, whose top level added the listener again. That fits what production saw and is not proved, and an alarm cleared by the reload fits it as well; `extension-reload-alarms` below sets out to tell the two apart or rule both out.
- A new ID is a new extension with empty storage, and Chrome has no way to carry storage across ([storage](https://developer.chrome.com/docs/extensions/reference/api/storage), [key](https://developer.chrome.com/docs/extensions/reference/manifest/key)).

Proved for this plan: Chrome writes `chrome.storage.local` to `<profile>/Local Extension Settings/<extension ID>/` as LevelDB, and its values are JSON; the newest writes sit in its `.log` file and can be read from a copy of the folder while Chrome runs (a hidden-Chromium run of the kit's fixture extension on 2026-11-07 found a value it had just set and the kit's `buildIdentity` there). This session's sandbox refused to list the real Chrome folder, so whether a command run from the owner's shell reads it without macOS asking is to be checked when built.

## The tickets

In the order they build on each other. `extension-log`, `extension-jobs` and `extension-health-answer` are one change apps take together; the rest stand alone.

## extension-log · The worker keeps a log of what it decided, readable without DevTools

Goal: an extension's worker logs each decision and its reason (a job ran or was skipped and why, a request's answer, a key kept or forgotten), so after a quiet day the log says what the worker did and when it stopped. The worker's console exists only while its DevTools window is open, and errors alone say nothing about a worker that never ran. A new `extension/worker/log.js` gives `log(event, fields)`, which writes to the console and appends `{ at, build, event, ...fields }` to a ring in `storage.local`, kept as up to 20 chunks of 100 lines under their own keys, so a day of a one-minute job fits and each write rewrites only the newest chunk (every `set` rewrites the whole value, and a run of no-change minutes is logged as one line with a count rather than a line each), buffered and written at most once a second, flushed when a job's run ends, never throwing. The log is read outside the browser and parts of it go to pages and servers, so a credential must never reach it, and a list of field names to hide is not enough (a token can sit in an address, a nested object or an error's message). So a field's value is kept only when it is a number, a boolean, or a string of at most 200 characters; anything nested is dropped and named as dropped; an address keeps its origin and path and loses its query and fragment; and a string holding a run of 32 or more letters, digits and `+/_-` (the shape of a key or token), or starting `Bearer `, is written as `[withheld]`. The same scrub runs over each error's message and stack before `errors.js` keeps it, so nothing the health answer sends was kept unscrubbed. `errors.js` adds each kept error to the log too, so the log reads in order.

Done when: a unit test against the Chrome stand-in holds the ring's size, the once-a-second write, the flush, and that a log call made while storage throws neither throws nor loses the next one; a unit test holds the scrub on a field named innocently holding a token, a nested object, an address with a key in its query, and an error whose message holds a token; the kit fixture logs its start and each alarm, and `extension/e2e/harness.e2e.ts` reads those lines back after a self-reload; `extension copy` copies `log.js` and the fixture's copy matches.

Do not touch: `errors.js`'s stored shape (`workerErrors`), which status readers already parse.

Needs: nothing.

Touches: `extension/worker/log.js`, `extension/worker/errors.js`, `extension/copy.ts`, `extension/test/`, `extension/test/fixture/`, `extension/e2e/harness.e2e.ts`, README's extension section.

## extension-reload-alarms · Find out whether an unpacked extension's alarms stop reaching its worker after `chrome.runtime.reload()`, and keep them reaching it

Goal: the likeliest cause of Getter's silent day is a Chromium fault where, after an extension reload, alarms are delivered to no listener until something else starts the worker (see "What Chrome does"). The kit's self-reload calls `chrome.runtime.reload()` on every landing, so every unpacked extension of ours is exposed to it. A diagnostic script, run by hand and never by the gates (200 reloads that each wait for the worker to stop and an alarm to come take hours), has the fixture reload itself by commits, as on a landing, waits after each reload for Chrome to stop the worker, and then for the alarm's run without sending any message, recording after each reload what `chrome.alarms.getAll()` holds and how often the alarm is then missing or present but undelivered; it runs on the Chromium Playwright ships and on Chrome for Testing at the owner's installed Chrome version, with a scratch profile, headless, since Google Chrome's own builds stopped taking `--load-extension` from Chrome 137 ([Chromium announcement](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY/m/S0ET5wPjCAAJ)); if the owner's exact Chrome must be tried, the DevTools protocol's `Extensions.loadUnpacked` with `--enable-unsafe-extension-debugging` loads it there. The gates keep a short check instead: one self-reload, the worker stopped (through the DevTools protocol's service worker stop, if Chromium allows it from Playwright, else by waiting), and one alarm delivered to the stopped worker, under the fifteen seconds a test may take if the stop can be forced, else marked slow and run with the harness. If it reproduces, the kit works around it and the harness holds the work-around (candidates to test, in order: the worker reloaded with `chrome.runtime.reload()` only after its listeners are in place; a second wake that does not depend on saved listeners, such as the page's or the host's message, scheduled by the kit). An alarm the reload cleared is made again by `every`'s check at each start, so that case needs a work-around only if the first worker after the reload does not start; a listener lost while the alarm stays is not helped by making the alarm again. If it does not reproduce in 200 reloads, that is reported with the Chrome versions tried, and the overdue check stays the defence.

Done when: the diagnostic script reports, for 200 self-reloads on the Chromium Playwright ships and on Chrome for Testing at the owner's installed Chrome version, how many left the alarm missing and how many left it present but undelivered for two periods; when any did, the work-around is in the kit and the same script shows none do; the short check is in the harness's tests; the result, either way, is written into the README's self-reload section and into this plan.

Do not touch: Getter's extension; the self-reload's rules for when to reload.

Needs: `extension-jobs`, whose run record is how the test sees a run.

Touches: `extension/worker/self-reload.js`, `extension/e2e/`, `extension/test/fixture/`, README's extension section.

## extension-health-answer · One health answer for every reader: the host's status, a page's hello and the extension's own server

Goal: an extension's state is said one way wherever it is read. `extension/worker/health.js` gives `health(describe)`: the build and commit, when this worker started, each job's last run and whether it is overdue, the kept errors, the newest log lines, and what the app adds through `describe` (for Getter: whether it holds a key, never the key). The native port's `state` answer becomes it. `answerHealth(message, sender, origins)` answers a page's `health` message through `onMessageExternal` from the origins the manifest lets connect, so the app's page can show it and send it on. An extension with a server sends it on each ask (a `report` helper that trims it to a size a request carries), so the server records why the extension says what it says rather than only when it last asked. What the app adds through `describe` is also written to `storage.local` whenever it changes (the same write-on-change `build.js` uses), so a reader with no running worker sees it; the app returns only safe values there (`keyless: true`, never the key), and the scrub of `extension-log` runs over it. The same shape is a type in `extension/host/protocol.ts`, and `app-kit extension status` prints it. It carries what always-be-closing's status report already carries (build, how long this build has run, the time it was sent, recent errors), so that extension's `scripts/status.js` can move onto it rather than the kit inventing a second shape, and its stale line (no report for three minutes) becomes the status command's.

The report carries each job's period, and a pure function beside it for the app's server, `quiet(lastReport, lastHeardAt, now)`, turns the last report and the last time the server heard from the extension into a line the app's page can show while the silence is happening ("expected every minute, last heard 23 hours ago"), since a worker whose alarms reach nothing says nothing itself.

Done when: unit tests hold the answer's shape, the overdue flag from `extension-jobs`, `quiet` on a report heard from on time and one heard from 23 hours late, that an origin the manifest does not list gets nothing, and the trimmed report's size; the harness reads the fixture's health through its host's socket and through a page on an allowed origin served by the test, and both match; `WorkerState` in `extension/host/protocol.ts` is that shape and the status command prints jobs and log lines.

Do not touch: how an app's server stores the report: that is the app's code.

Needs: `extension-jobs`.

Touches: `extension/worker/health.js`, `extension/health.ts` (new, the server's `quiet`), `extension/worker/port.js`, `extension/host/protocol.ts`, `bin/app-kit.ts`, `extension/test/`, `extension/test/fixture/`, `extension/e2e/harness.e2e.ts`, README's extension section.

## status-from-profile · `app-kit extension status` reads every Chrome profile from disk, with no native host and no running worker

Goal: an extension with no native host (Getter) has a status command, and an extension whose worker is not running still says what it last recorded. Given the extension's folder, `app-kit extension status .` takes the ID from the manifest's key, finds each Chrome profile (names from Chrome's `Local State`), says per profile whether the extension is installed there, enabled, unpacked from which folder or from the Web Store, and under which ID (from the profile's `Secure Preferences`, where Chrome on a Mac keeps `extensions.settings`, with `Preferences` read too; a copy loaded under an older ID, as Getter's was after PR #68, is named as such), and reads the kit's own keys from a copy of the profile's `Local Extension Settings/<ID>/` folder: build, job runs (with whether each is overdue, worked out when the command runs), kept errors, log lines, and the record of what the app's `describe` last said (kept by `extension-health-answer`). The copy holds the extension's whole storage, its key included, so it is made in a folder only the owner can read (mode 700, under the system's temporary folder) and deleted when the read ends, even when the read fails. It reads the LevelDB `.log` file, reassembling records split across its 32 KB blocks, and compacted `.ldb` tables (Snappy-compressed blocks, decoded in the kit with no package, since the only JavaScript reader, `leveljs`, calls itself very immature and reads logs only), takes the newest write of each key by sequence number and honours deletions, with Python's `ccl_chromium_reader` as the reference for its edge cases; prints only the kit's keys and the fields the app names, never the rest of storage, and never opens Chrome or changes its files. With a socket as well, it asks the host as today and adds what the running worker says.

Done when: a unit test reads a value over 32 KB split across log blocks, a key overwritten and one deleted; a unit test holds that the copy is made with mode 700 and is gone after a read that succeeds and one that throws; a unit test reads LevelDB folders written by a hidden Chromium run (kept as fixtures, made-up values only), the `.log` and a compacted `.ldb`, and finds the kit's keys and nothing else; the harness writes state in the fixture extension, and the command run on its scratch profile while Chromium is open prints that state; a profile with the extension under another ID is reported by name and ID, read from fixtures of both `Secure Preferences` and `Preferences`; run from the owner's shell on Getter's main checkout, it prints the owner's profiles with Getter's build and record, quoted in the report with the key's field shown as present or missing only.

Do not touch: Chrome's files, which are read from a copy and never written; the socket form's output for an app that already parses it.

Needs: `extension-health-answer`. Whether a command started from the owner's shell may read Chrome's folder without macOS asking for access, checked on the first run. The store-dashboard thread's `chromeHolding` (`extension/dashboard/chrome.ts`), which says whether a Chrome has a profile open, is reused once it lands rather than written again.

Touches: `extension/host/profiles.ts` (new), `extension/host/leveldb.ts` (new), `bin/app-kit.ts`, `extension/test/`, `test/fixtures/`, `extension/e2e/harness.e2e.ts`, README's extension section.

## extension-credential · An extension a server gives a key says when it has none, and a signed-in page gives it one with no click

Goal: what Getter's PR #79 built for itself, for every extension that holds a key from its own server. The worker half, `extension/worker/credential.js`: keeps the key in `storage.local`, forgets it on a 401 and logs why, says `keyless` (and since when) in its health answer, and accepts a key only from an origin the manifest lets connect. The page half, in `app-kit/web`: on a signed-in page, asks the extension's health, and when it is keyless and the person has not signed out in this browser, asks the app's server for a key and hands it over, one tab at a time through a Web Lock. The page half takes the app's own `requestKey()`, so the route that makes the key stays the app's; the README gives the rules Getter worked out for that route (one live key per account and browser, a key another browser is using kept, never after a sign-out in that browser), which a second extension given a key by its server follows. Getter moves onto it in its own thread later; its code stays as it is here.

Done when: unit tests hold each half, including the 401 forget, the origin check, the signed-out browser left alone and two tabs making one key; a browser test in the web fixture's hidden Chromium loads the kit's fixture extension with no key, opens a signed-in page, and sees the extension keyed and asking the stand-in server with no click; the README's extension and web sections show an extension and its app using it.

Do not touch: Getter's `client/src/extensionLink.ts` and its relink route.

Needs: `extension-health-answer`.

Touches: `extension/worker/credential.js`, `web/extension-link.ts` (new), `extension/test/`, `test/`, `web/e2e/`, README.

## toolbar-problem · The toolbar icon says when the extension needs the person

Goal: a person who never opens the app's page still sees that the extension is stuck, for the problems a running worker can see (no key, errors); a worker whose alarms reach nothing cannot set a badge, so an overdue job shows only once something wakes it. From the health answer, the worker sets the toolbar icon's badge and title (`chrome.action`, which needs an `action` in the manifest and no permission): keyless, a job overdue, or an error kept in the last hour, each with one line of what to do ("Open Getter to connect this browser"), and clears it when the state clears. Chrome may keep or drop a badge across a reload, so it is set again from the health record at every worker start. An extension opts in with one call and the app's own words for each problem.

Done when: a unit test holds which state sets which badge and title and that a cleared state clears it; the harness reads the fixture's badge text and title from the worker in each state; switched off in the fixture until the owner has seen it drawn, per the rule for new interface.

Do not touch: any extension's popup.

Needs: `extension-health-answer`; the owner's yes to a badge at all (recommendation below: not now). Until then it stays in this file and is not built.

Touches: `extension/worker/problem.js` (new), `extension/test/`, `extension/test/fixture/`, `extension/e2e/harness.e2e.ts`, README.

## extension-rules · Practices' extensions rule asks for the log, the job record, the health answer, the status from disk and the key handoff

Goal: the guidance half. `rules/extensions.md` in practices gains, each with its why from Getter's two days: the worker logs its decisions with no credential in them (`extension-log`); a job on a clock goes through the kit's `every`, records its runs, has a time limit, and every `fetch` carries a signal (`extension-jobs`); the extension's state is one health answer read the same by the host, the page and the server (`extension-health-answer`); the status command works from the profile on disk (`status-from-profile`); an extension a server gives a key says when it has none and is given one again without a click (`extension-credential`); a changed manifest `key` is a new extension in every profile, with empty storage, so the change says how each profile gets its state back before it lands; and, if the owner says yes to it, the toolbar problem (`toolbar-problem`). Practices' `scripts/app-checklist.ts` checks each where a file shows it.

Done when: the rule's new lines are in practices' main, each naming the kit piece and its why, and the checklist reports the four extensions (amazon-connector, Beeline, always-be-closing, Getter) against them.

Do not touch: the rule's existing items, which stay as written.

Needs: the kit tickets it names landed first, so each line points at code that exists. Kept in practices' backlog; built by a thread there.

Touches: `rules/extensions.md`, `scripts/app-checklist.ts` in practices.

## Decisions for the owner

- **The key handoff's worker and page halves go in the kit; the route that makes the key stays each app's, with Getter's rules for it written in the README.** Only Getter is given a key by its server today (always-be-closing reads its key from a file), and a route is the part most shaped by an app's own accounts. The case for the kit holding the route too: Getter's hardest rules live there (one key per account and browser, never after a sign-out), and a second such extension would work them out again from prose.
- **No toolbar badge for now: `toolbar-problem` stays written but unbuilt.** A badge is set by the worker, so it can never show the silent worker, the failure that cost the most here, and the other case it covers, a lost key, is fixed with no click by the key handoff on the next signed-in page. The case for it: it is the one mark a person sees without opening the app's page, for a key the handoff cannot restore, such as after a sign-out in that browser.
- **The status command reads Chrome's own files rather than asking the running extension.** It is the only way to see a worker that is not running, and it needs nothing installed. The case against: it reads LevelDB, which Chrome does not document as an interface, so a Chrome change could break the reader; the socket form stays for an extension with a host.

## Not in this plan

- Why Getter's worker was silent for a day. The instruments above would have recorded it; once Getter takes them, the next silence is read from its own log. Getter's own code is left alone here.
- Each extension taking these pieces: its own thread, after the kit lands, through the apps round. Beeline's first step there is to call the `errors.js` and `port.js` it already copies.
