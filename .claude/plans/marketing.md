# Publishing an app: what app-kit owns

Approved by the owner on 2026-11-06 with "build and land", as reviewed below. The first piece is the Chrome Web Store listing check; the zip and upload, screenshots, the App Store listing and a guiding skill in practices are tickets to come, and explainer videos come from the xplnr project.

## app-kit checks an extension's Chrome Web Store listing against its manifest, with Getter as the first app on it

### Why

Google can pull an extension whose Store answers disagree with what it does, and it rejects an item that leaves out required answers. Today nothing notices when they drift apart. Add a permission to the manifest without writing its reason, let the summary grow past the Store's 132 characters, or leave out the remote-code answer, and you only find out when Google's review refuses it, days later. Getter is about to send its extension to family and friends through the Store, and its listing file was already corrected once on the day it landed.

### The change

`app-kit extension listing` reads an extension's `store-listing.md` beside its manifest and prints a checklist. It shows what passed, what failed and why, and what only you can do in the Store's dashboard. It exits with an error when anything fails, so a release script stops before uploading. Getter's own release command runs it first.

### Decisions

- **Only the checklist moves into app-kit for now. Getter keeps its own zip-and-upload script.** The reviewers found that the next two extensions headed for the Store, Beeline and always-be-closing, both have popup pages. always-be-closing also drops a development-only permission from its Store zip. A kit zip built from Getter's script would refuse both, so it would serve only Getter, which already has one. The zip moves into the kit when always-be-closing publishes, filed as a ticket with what that version must handle. Alternative: build the general zip now, with popup pages followed and development permissions dropped. That is code nobody uses until always-be-closing ships.
- **The listing file sits beside the manifest as `store-listing.md`, in the headings Getter's file already uses.** Getter moves its file up from `extension/`. Alternative: a flag naming the file, which every app would have to pass.
- **The checks compare files, not the dashboard.** Google's API can't read or set listing text, privacy answers, screenshots or visibility. So the checklist holds the file to the manifest, and lists "the dashboard says what this file says" as yours to confirm.
- **It lives in app-kit, not in practices' app checklist script.** That script lists which baseline features each app is missing. Checking a listing needs the manifest and the listing file read together, which is the kit's to do. The practices rule for extensions gets this command named as its example, proposed after landing.
- **Release: patch.** No app has to change because of it.

### Risk

- **The checklist passes and Google still refuses.** The checks are about whether the file is complete and matches the manifest. They can't tell whether a sentence is true, which is what Getter's own correction was about. The command says this at the end of its output, and the README says so too.

### Left alone

- **The zip and the upload.** These stay in Getter's script. A ticket records what the kit's version must handle, from the review:
  - popup and options pages, and each file they load;
  - dropping development-only permissions;
  - an allowlist of the manifest fields it can follow;
  - checking the commit again just before upload;
  - Google's warnings on publish.
- **Screenshots, which you asked for.** The Store takes them only in the dashboard. Making them, 1280 by 800 from the app driven in a hidden Chromium, is a ticket of its own, together with the App Store's sizes.
- **App Store listing text** for Getter's iPhone app, through App Store Connect. That gets a ticket.
- **The guiding skill** for logo options as a Studies page and a drafted description. It goes in practices, as a ticket.
- **Videos.** These come from xplnr, noted in the guiding skill's ticket.

### Done when

`app-kit extension listing` run on a scratch clone of Getter's main, with the listing file moved beside the manifest, prints every check passing plus your dashboard items. A listing with a permission missing its reason, a reason for a permission the manifest lacks, a summary that differs from the manifest's description, or no remote-code answer fails with that reason named. Proven by unit tests on fixture listings, plus that run on Getter's clone.

### After yes

I bring this branch up to date with main (the extension-layout work landed as v0.45.0), build it here, run the gates, and come back with the evidence and the review block to ask for your go to land it. After it lands, I'll ask whether to start a thread in Getter that moves its listing file, runs the check before each upload, and fixes the notes below. I'll also ask whether to land the four tickets.

### Details

- New `extension/listing.ts`, exporting `listingChecklist(folder)`, which returns items of the form `{ result: 'passed' | 'failed' | 'yours', line, reason? }`. It reads `<folder>/manifest.json` and `<folder>/store-listing.md`. A missing manifest is reported through `layoutProblems` from `extension/layout.ts` (landed in 819b77e). The checks:
  - `## Store listing`, Summary: equals the manifest's `description` and is at most 132 characters. When the description is a `__MSG_…__` placeholder, it is reported as not read yet (none of the extensions is localized), instead of being measured.
  - Description, Single purpose, Remote code and Privacy policy bullets are present.
  - `## Privacy practices`: every entry of `permissions`, `optional_permissions` and `host_permissions` has a bullet with a reason, and no bullet names one the manifest lacks.
  - `icons.128` exists and is a 128 by 128 PNG, read from its header.
  - Yours (printed every run):
    - the store icon (the same file as `icons.128`) and at least one 1280 by 800 screenshot, required; promo tiles are optional;
    - the data-use answers and the three certifications;
    - the dashboard matching this file;
    - visibility and testers;
    - the first release, and the first after any visibility change made in the dashboard, submitted in the dashboard (Google's API docs, updated 2026-11-05).
- The privacy link answering is checked only by the command, with a 5-second fetch, and never in unit tests.
- `bin/app-kit.ts`: `extension listing [<folder>]`. It exits 1 when any check fails and prints one line per item.
- README, extension section: "The Store listing", with the template taken from Getter's file, names replaced with example.com.
- Tests: `extension/test/listing.test.ts`, on fixture folders under `extension/test/fixture/listing/`: a passing listing; a missing reason; an extra reason; a summary that differs; one over 132 characters; no remote-code answer; a missing 128 icon; a localized description.
- Evidence: a `git clone` of Getter's origin into the scratchpad, with `extension/store-listing.md` moved to the root, then `bun bin/app-kit.ts extension listing <clone>` and its output.
- Tickets, after the landing, each only on your yes:
  - app-kit `store-zip`, with the review's list above;
  - app-kit `store-screenshots`;
  - app-kit `app-store-listing`;
  - practices `publish-guide`;
  - getter `kit-listing`, which moves the file, runs the check in `extension:publish`, and carries these notes: reword its Distribution note to the visibility rule above; print `warningInfo` from publish; and check whether `op://agents/Chrome Web Store API` was made under an External consent screen in Testing, whose login Google expires after 7 days.

### Review

Verdict: trimmed. The worth-it reviewer's words, and I agree. Its evidence checked out: Beeline's manifest has a popup, an options page and a web-accessible page, and always-be-closing's has a popup and a script that strips `nativeMessaging` from its Store zip. The plan is now its trimmed version: the checklist alone, with the zip and upload left in Getter.

15 findings: 9 agreed, 0 known limits, 6 disagreed.

1. Agreed (worth-it): the zip serves only Getter. Cut to the checklist, and the zip became a ticket.
2. Agreed (worth-it): screenshots, which you asked for, are not covered. Said so plainly, and filed as their own ticket.
3. Agreed (worth-it): the checks catch missing or mismatched lines, not untrue sentences. The Why, the Risk and the command's output say so.
4. Agreed (worth-it): practices already has an app checklist script. Said why this lives in the kit, and proposed naming it in the practices rule.
5. Agreed (worth-it): the extension-layout work touched the same README and package files. It has landed, so this branch updates first and uses its manifest check.
6. Agreed (Codex): the Getter run can't pass with its listing file in `extension/`. The run moves the file in the clone, and the Getter thread moves it for real.
7. Agreed (Codex): a passing check says nothing about the dashboard. It is named local, with the dashboard match listed as yours, and the summary is held equal to the manifest's description.
8. Disagreed (Codex): pin the commit before upload. The upload stays in Getter. The point is recorded in the store-zip ticket.
9. Disagreed (Codex): the refused-field list is incomplete. There is no zip in this plan; recorded in the store-zip ticket.
10. Agreed (researcher): Submit for review is needed after any visibility change in the dashboard, not only for the first private release. The checklist and the Getter note say so.
11. Disagreed for this plan (researcher): the Store login may expire after 7 days if made under an External consent screen in Testing. It is real for Getter's existing script, not this command, so it goes in the Getter ticket.
12. Agreed (researcher): the store icon is a required dashboard upload and promo tiles are optional. The checklist says so.
13. Disagreed (researcher): use an allowlist of manifest fields for the zip. Recorded in the store-zip ticket. A localized description is still handled here.
14. Disagreed for this plan (researcher): Google's publish warnings are dropped. That is Getter's script, so it goes in the Getter ticket.
15. Agreed (researcher): a missing remote-code answer gets an item rejected. It is a required line, with a test.

The researcher also confirmed four things. The upload library 6.0.1 is current and calls Google's v2 API. The 132-character summary limit is real. Nothing outside checks a listing against a manifest. And the API can't set listing text.

## Second piece: one headless driver, approved 2026-11-06 with "build and land"


### Why

Two kinds of work need an app driven in a hidden browser, and only one project can do it today.

- **Persona walk-throughs stall.** Practices' persona walk-through skill needs each project to supply a driver, and only Sightline has one: 130 lines in its own scripts. urge-surfer's walk-through stopped on 2026-10-28 for want of one.
- **Getter's store images are made by hand.** Its three Chrome Web Store screenshots were made by hand on 2026-11-06 and sit in its ignored `dist/store` folder. Its iPhone app runs on iPhone and iPad, so the App Store will need images at Apple's required iPhone size and the 13-inch iPad size, and none exist yet. Every hand-made image goes stale as soon as its screen changes.

### The change

`app-kit web drive` runs a steps file against an app's seeded server in a fresh hidden Chromium that ends with the run. The steps:
- go to a page, click, fill and wait;
- sign in through the kit's stand-in;
- start the page's clock at a set date and jump it forward;
- `read`, which prints the screen's accessibility tree and saves a screenshot, for a persona agent;
- `shot`, which saves an image at exactly a store's size.

Requests to anywhere but the seeded server are refused and printed. The page's sound never reaches the Mac's speakers. At the iPhone and iPad sizes, the page is told it's inside the iPhone app, so it draws the app's screens, not the website's.

A Getter subthread then adds a seeded server command and steps files, and writes Getter's Chrome Web Store, iPhone and iPad images. They go into the folder the [store-dashboard](metamax://thread/app-kit/store-dashboard) thread uploads from.

### Decisions

- **Adopt nothing, but name what was looked at.** Playwright now ships a command line for agents, `playwright-cli`, which the kit already installs. It keeps a browser running between commands, for an hour by default, and its `kill-all` ends every session on the machine, other threads' included. It also has no refusal of outside requests and no clock steps. The kit's one-shot driver ends its browser with the run. LLM persona harnesses run their own model loop, which the walk-through skill already does with the agent itself.
- **One command for both jobs.** A store screenshot is the same steps at a fixed size, with a picture taken. Alternative: a separate `store screenshots` command, which would be a second entry point with nothing of its own.
- **No timeline file and no "bad moment" flags, which cuts part of the ticket.** Each step already prints its screen and saves its picture. urge-surfer's reviewed plan reads things this file wouldn't hold: the friend's lines, phone taps, sound and locking. It defines its moments in its own code, so the kit's file would have no reader. Alternative: build the ticket's timeline and flags now, a format the kit must keep stable for a reader that may never use it. "Waits a set time with no taps" is covered by the clock jump.
- **The clock starts at the steps file's date and keeps running; `advance` jumps it.** A paused clock stops the page's frames and timers, which hangs every step after it; both reviewers reproduced that. Running `advance` through every timer one by one took 57 seconds of real time for 60 seconds of page time. A jump fires each due timer once, as a phone does after its screen sleeps.
- **iPhone and iPad images come from Chromium, with the kit's stand-in for the iPhone app.** That stand-in is `fakeTauri` with the iPhone user agent, so Getter draws its in-app screens. The images start at the content with no iOS status bar, which Apple's rules allow. Alternative: capture the windowless Simulator. It draws iOS's own status bar, but boots a Simulator for each run, and Getter's in-app page is the same page either way.
- **The required iPhone size is uncertain, so Getter writes both.** Apple's specifications page now names "iPhone with Dynamic Island (medium display)" as required, at 1206 by 2622. It also still accepts the 6.9-inch 1320 by 2868 and says it scales down, and the page contradicts itself. So the kit offers `iphone-6.3` and `iphone-6.9`, and Getter writes both, plus `ipad-13`.
- **Store images aren't committed.** Getter writes them to `dist/store/<size>/`, which is ignored, where its hand-made ones are and where store-dashboard reads. A command makes them again in seconds, so git holds the steps, not the pictures. Alternative: commit them so a change shows in review. Every run that moved a pixel would then put a new binary into Getter's history.
- **Sightline isn't moved in this work, which cuts part of the ticket (yours to decide).** Sightline is on app-kit v0.23.0, 22 releases behind, so moving it means a large upgrade first. Instead, the proof that nothing Sightline relied on changed is to run Sightline's persona steps with the kit's driver against Sightline's own seeded server, and compare the trees and pictures with Sightline's driver's. Sightline moves when it next upgrades the kit, kept as the `persona-driver` ticket's remaining part. Alternative: a Sightline subthread now, starting with the 22-release upgrade.
- **Release: patch.** No app has to change for it.

### Risk

- **A browser left running after a run.** Prevention: it closes on every way out. With `APP_KIT_DRIVE_STOP_WHEN_PARENT_ENDS=on`, which a serve script sets, it also closes when its parent ends. A test kills the parent and checks that no Chromium is left. The watch is off by default because an agent's shell has no input attached, and watching would end every run at once.
- **The [store-dashboard](metamax://thread/app-kit/store-dashboard) thread** is building the upload of these images, and both branches edit `bin/app-kit.ts`. The edit conflict is small and resolves at rebase. The folder is agreed with that thread before Getter's part starts.
- **An image the App Store refuses.** Prevention: a test checks each size's pixels and that the PNG has no alpha channel.

### Left alone

- Each project's persona files and serve command.
- **Practices' persona walk-through skill.** Naming the kit's driver there is a practices change I'll propose after landing.
- **Uploading images to either store.** The Chrome Web Store side is store-dashboard's; App Store Connect is the `app-store-listing` ticket.
- **urge-surfer's harness.** Its thread is told the driver exists.
- **Getter's iPad support,** which stays as it is.

### Done when

`app-kit web drive` runs a steps file on the kit's web fixture through every step kind. That includes the clock starting at a past date and an `advance`, with a `read` after it that completes. The run refuses an outside request, opens no audio output, and leaves no browser behind. A `shot` at each size writes an RGB PNG of the exact pixels:
- `chrome-store`: 1280 by 800;
- `iphone-6.3`: 1206 by 2622;
- `iphone-6.9`: 1320 by 2868;
- `ipad-13`: 2064 by 2752.

Sightline's persona steps give the same trees on both drivers. Getter writes its Chrome Web Store, iPhone and iPad images from its seeded server, with no window opened, and the same bytes on a second run. Proven by app-kit's fixture tests, the Sightline comparison run, and the Getter subthread's evidence.

### After yes

I build the driver here, run the gates and the Sightline comparison, and come back with the review and evidence to ask your go to land it, unless you answer `build and land`. After it lands, I agree the image folder with store-dashboard, then start the Getter subthread. It posts its plan in its own pane for your yes, and its landing waits for your go there. The `store-screenshots` ticket leaves the backlog when Getter's part lands. The `persona-driver` ticket stays, reworded to Sightline's move.

### Details

- New `web/drive.ts`, generalized from Sightline's `scripts/persona-look.ts` (origin/main):
  - `playwright` is loaded inside the run, as `icons/render.ts` loads sharp, so `app-kit`'s other commands work in an app without Playwright; a test checks this.
  - `context.route` refuses every origin but the address's own; outside images get a plain stand-in or the steps file's `outsideImage`.
  - `offlineAudio(context)` from `web/playwright-offline-audio.js`.
  - The fetch-counting init script, and `settle()`: no request in flight, two frames, none still; plus `settledWhenGone` when given.
  - New tabs are closed.
- Steps:
  - `goto`, `click`, `fill`, `waitFor`;
  - `read`: prints the tree and saves a full-page PNG;
  - `shot`: a viewport PNG with `animations: 'disabled'` and `caret: 'hide'`;
  - `signIn: { email }`, through `signInByCode`;
  - `clockAt: "<iso>"`: `page.clock.install({ time })`, refused after the first `goto`;
  - `advance: <ms>`: `page.clock.fastForward`.
- Steps file options: `size` (`phone`, `desktop`, `chrome-store`, `iphone-6.3`, `iphone-6.9`, `ipad-13`), `outsideImage`, `settledWhenGone`. Sizes:
  - `chrome-store`: 1280 by 800 at scale 1;
  - `iphone-6.3`: 402 by 874 at scale 3;
  - `iphone-6.9`: 440 by 956 at scale 3;
  - `ipad-13`: 1032 by 1376 at scale 2.
  The three Apple sizes are touch, with `fakeTauri` and `IPHONE_USER_AGENT` from `tauri/playwright.js`. `phone` is 390 by 844 touch, `desktop` 1280 by 900.
- `bin/app-kit.ts`: `web drive <address> <steps.json> <out folder>`. Exit codes: 0 done; 1 a step failed, printing the page's tree at the failure; 2 wrong usage.
- README, `web/` section, "Driving the app headless":
  - the steps format and the sizes;
  - that images have no status bar and start at the content;
  - how a project adds persona files and a serve command that prints `ready <address>`.
- Tests:
  - `web/e2e/drive.e2e.ts` against the web fixture (`web/e2e/fixture`, `web/e2e/serve.ts`), in the gates' hidden-Chromium step:
    - each step kind;
    - `clockAt` at a past date, then `advance`, then `read`;
    - an outside fetch refused;
    - no audio output opened, by `web/e2e/audio-output.swift` as `offline-audio.e2e.ts` checks it;
    - each size's pixels and RGB color type;
    - a killed parent with the watch on leaving no Chromium;
    - a run with no input attached finishing its steps.
  - `test/drive.test.ts`: the steps file's validation, and the command module loading without Playwright.
- Sightline comparison: from a scratch clone of Sightline's main, start `scripts/persona-app.ts`. Run one steps file through both Sightline's `scripts/persona-look.ts` and the kit's driver (with `signIn` naming `owner@example.com`, `outsideImage: e2e/poster.svg`, `settledWhenGone: "^Loading "`), and compare the printed trees.
- Getter subthread (`--sub` into getter, plan first):
  - `scripts/store-app.ts`: the seeded server printing `ready <address>`, wrapping `scripts/e2e-server.ts`;
  - made-up seed data on example.com, with fixed dates;
  - `design/store/*.json` steps files, each with `clockAt`;
  - a `store:images` script writing `dist/store/{chrome-store,iphone-6.3,iphone-6.9,ipad-13}/`;
  - a test that two runs write the same bytes;
  - the hand-made `dist/store/*.jpg` images removed;
  - an upgrade to the kit version this lands as.

### Review

Verdict: trimmed (the plan minus the timeline file, with findings 1 to 4 and 6 changed in the plan before building). The worth-it reviewer's words; I agree, and the plan above is that version. I also cut Sightline's move, which the review raised separately.

23 findings across three reviewers, merged to 19: 15 agreed, 1 known limit, 3 disagreed.

1. Agreed (worth-it, researcher): a paused clock hangs every step after it. The clock now starts at the date and runs on.
2. Agreed (researcher): pausing at a past date throws. Fixed by the same change, with a past-date test.
3. Agreed (researcher): `runFor` takes real time. `advance` jumps the clock instead.
4. Agreed (Codex, worth-it): an input watch on by default ends every run in an agent's shell. It is off unless asked for, with a test.
5. Agreed (worth-it): iPhone images would show the website. The Apple sizes now draw as the iPhone app does.
6. Disagreed (Codex): capture iPhone images in the Simulator. Getter's in-app page is the same page, now drawn as the app; the Simulator stays the alternative under Decisions.
7. Agreed (worth-it): sound would play on the Mac's speakers. Offline audio is added, with a test.
8. Agreed (worth-it): the timeline has no reader. Cut.
9. Disagreed (Codex): put the wait step and the flags in the kit, as the ticket says. The clock jump is the wait; the flags are urge-surfer's own definitions. This cuts part of the ticket, named under Decisions.
10. Agreed (worth-it): Getter's hand-made images and the store-dashboard thread already exist. Getter writes where that thread reads, and the hand-made images go.
11. Agreed (researcher): Apple's page names a different required iPhone size. Both iPhone sizes are written.
12. Agreed (researcher, worth-it): Getter runs on iPad. It writes 13-inch iPad images.
13. Agreed (Codex, worth-it, researcher): the rerun check was dropped. It is back, as a Getter test, with animations and the caret off.
14. Agreed (Codex): don't delete the tickets before the subthreads finish.
15. Agreed (worth-it): Release minor was wrong. Patch.
16. Agreed (worth-it): a top-level Playwright import would break other commands. It loads on use, with a test.
17. Agreed (researcher): name what exists. `playwright-cli` and persona harnesses are under Decisions.
18. Agreed (researcher): a PNG with alpha is refused by Apple. The test checks the color type.
19. Known limit (researcher): Chromium has no safe-area insets, so iPhone images start at the content with no status-bar space. Accepted, and the README says so.

Disagreed with nothing else. Sightline (worth-it 8; researcher's note on its 22-release gap): agreed, and Sightline's move is cut from this work, under Decisions for your call.
