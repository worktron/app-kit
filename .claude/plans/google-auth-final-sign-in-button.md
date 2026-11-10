# google-auth-final-sign-in-button

Approved by the owner on 2026-11-10 ("build and land").

## kit-features · app-kit checks which of its features each app lacks, and the apps round brings them in

### Why

The owner keeps finding, by using an app, that it lacks something app-kit already does: today Argon on the iPhone still asks for an extra "Sign Argon in as …" tap after Google, while Getter and Timescale go straight from Apple's prompt into the app.

Nothing in app-kit could have caught it:

1. One-tap sign-in shipped in app-kit v0.18.1 on 2026-10-27, ten days before app-kit started writing CHANGES.md (v0.19.0, 2026-11-06). The apps round tells apps only about releases in CHANGES.md, so no app heard of it. About 130 commits shipped before then.
2. Even for releases after that, the round tells an app once, when it is behind. An app that took the version but not the option, as Argon did, is never asked again. The round's review looks for code an app writes for itself that a kit piece does, not for options on pieces it already uses.
3. Argon's own thread filed the fix as ticket iphone-one-tap, but in a plan file the round never reads, and the step it waits on, Associated Domains in Apple's developer portal, was never asked of anyone.
4. Practices' iPhone rule names Argon as the example to copy for sign-in, the one iPhone app without one-tap.

### The change

app-kit keeps one list of its features that apps should have, each saying which apps it is for and what in an app's code shows it is there. The apps round reads every app against that list, and an app lacking an entry for the first time gets an upgrade with the gap in its brief. One-tap sign-in is the first entry; a one-time sweep of the kit's history proposes the rest, for you to pick.

### Decisions

- Most entries apply by what an app already takes from the kit: an app that takes iPhone sign-in should turn on one-tap. That needs no guess at what kind of app it is. An entry for an app that should take a piece it does not use yet (an iPhone app offering Google should take iPhone sign-in) is allowed when its code shows it.
- A gap starts an upgrade only the first round it reaches a brief. After that it rides along in the app's next upgrade's brief and stays on the round's page, so a gap you decline never starts a thread again. The round already keeps last round's record of every app, so comparing against it needs no new state: an app the round skips because its upgrade thread is still open keeps last round's gaps in that record, so a gap found meanwhile still counts as new next round. The alternative, a saved list of declined gaps per app, is one more record to keep.
- In the round's plan, apps whose only reason is a feature gap are listed apart, so you can put them all off with one answer.
- The sweep's findings come to you as one list with my recommendation per item. Each you accept becomes an entry, in a second change on this branch. The alternative is entries straight from the sweep: one round sooner, but checks you never chose would start upgrades.
- The practices side shrinks to one ticket: its iPhone sign-in rule names Getter as the example and says to turn on one-tap, pointing to app-kit's README. Practices' checklist checks that name kit pieces (the reload after a failed load, Text Size, the icon renderer, Google's account list) move to app-kit's list in a later ticket, after practices' logo-and-checklist thread lands, so the two never check the same thing. The alternative is to move them now, which would collide with that thread's plan in the same file.
- Argon's one-tap fix: start a thread in argon-watcher for its iphone-one-tap ticket now. It first tries to turn on Associated Domains for Argon's identifier itself, through App Store Connect's API with the key app-kit's TestFlight upload already reads, and asks you for the portal step only if that fails, quoting why. Recommended because you hit it today; the case for waiting is that the round would reach it through the new entry, as one thread instead of two.

### Risk

- The entry checks the app's code and Apple's own copy of the site's file: the iPhone build's entitlement names a site, and Apple's copy of that site's file names this app. It cannot see whether a given phone has fetched the file, when iOS still falls back to the extra tap, so it is named "one-tap sign-in configured", and Argon's thread is done only when your sign-in on the installed build is Apple's prompt alone. When Apple's copy cannot be read, the app's line says unknown, never lacking.
- An entry matched by text can call an app lacking when it does the thing another way. Each entry says what it looks for, has a made-up app on each side in its test, and a false gap is fixed in the list, never in the app.
- An entry whose kit name is later renamed would quietly find every app lacking or none. A test holds that every name an entry looks for still exists in the kit's own code, so a rename fails the kit's tests.
- The first round after this may start more upgrades than usual. The round's waves of three or four, your yes to its plan, and gap-only apps listed apart keep that in your hands.

### Left alone

- Practices' app checklist stays as it is for now; the round still reads it and shows its lines.
- The round still reads tickets only from an app's backlog, not its other plan files, which keep landed work and would bring back finished tickets.
- No backfilled CHANGES.md entries for versions before v0.19.0: every app is past v0.19.0, so they would reach nobody.
- No app's code changes here. Each app's gaps are fixed by its own upgrade thread, on your yes in its pane.
- The app-clients thread planned a checklist line for the upgrade brief. This branch adds the brief's line for the kit's own list and practices' checklist together, so app-clients can drop that item.

### Done when

`bun scripts/apps.ts` over your projects folder shows Argon lacking "one-tap sign-in configured", and Getter and Timescale not lacking it; Urge Surfer and Metamax, which take no iPhone sign-in, have no such line. The round's instructions start an upgrade for a new gap and carry every gap into the brief. You have the sweep's list with a recommendation per item, and Argon's one-tap thread is started. Proof: the list's tests with made-up apps shaped like Argon, Getter, Timescale and Urge Surfer, and the script's output over the real projects.

### After yes

Here, I build the list with its first entry, its tests and the round's changes, and start the sweep as a read-only subagent. I land the practices rule ticket and the later move ticket through the ticket command. If you agree, I start Argon's one-tap thread now. I bring you the sweep's list for your picks, then build the entries you accept as a second change. Each change is `Release: none`, since apps never notice it; `build and land` lands each once review and gates pass, `build it` comes back to ask before landing.

