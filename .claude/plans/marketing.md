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
