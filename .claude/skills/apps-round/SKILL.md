---
name: apps-round
description: The apps round, weekly and on a release apps take now, that starts an upgrade thread in each app on app-kit with something to take, and follows each to landing.
disable-model-invocation: true
---

# The apps round

App-kit owns each app's move onto its new versions. The round reads every app on the kit, decides which ones have something to take, and starts one upgrade thread in each of those apps' own project. Each thread plans the whole upgrade, lands it through its app's own landing on the owner's answer, and reports back. The round changes no app's files itself: it writes briefs, starts threads, follows them and reports.

An app has something to take when any of these holds:

- it lacks a release whose urgency is `now` or `next round` and whose Apps line concerns it;
- the review finds code it writes for itself that a kit piece does;
- it has an open backlog ticket naming app-kit;
- it lacks a kit feature (scripts/kit-features.ts) that last round's record did not list it as lacking.

A feature gap starts an upgrade once: after that it rides along in the app's next upgrade's brief and stays on the page, so a gap the owner declined never starts a thread again.

Releases marked `rides along` start nothing; an upgrade started for another reason takes them too.

Run it from an app-kit worktree. The round's own thread plans first: its plan lists the apps that get an upgrade thread and why, and the owner's yes to it starts them.

## 1. Read the apps

```sh
MAIN=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
WORKSPACE=$(dirname "$MAIN")
mkdir -p "$MAIN/.apps-round"
bun scripts/apps.ts "$WORKSPACE" > "$TMPDIR/apps.json"
bun "$WORKSPACE/practices/scripts/app-checklist.ts" "$WORKSPACE" > "$TMPDIR/checklist.txt"
```

`scripts/apps.ts` stops with an error when it cannot read the kit's tags or CHANGES.md from GitHub; fix that before going on, since a round on missing data reports apps as up to date. Per app it gives the tags its package.json files name (`installs`), whether each bun.lock installs that tag's commit (`locked.matchesTag`), how many releases it is `behind`, CHANGES.md's entries since its tag (`changes`, each with its `urgency` and lines), the most urgent of them (`urgency`), its open backlog `tickets` naming app-kit, the kit's features it should have and `lacks` (scripts/kit-features.ts, which says what each looks for), those whose answer could not be read (`unknown`, each with why, never read as lacking), and when its origin was `fetched`. The checklist exits 1 when it lists any gap; that is its normal answer. Keep the checklist lines whose project is an app in apps.json.

`$MAIN/.apps-round/last.json` is the last round's apps.json, when there was one. Done when both files are read and each app's checklist lines are matched to it.

## 2. Decide which releases concern each app

For each app, read each `now` and `next round` entry in its `changes` and decide whether it concerns the app, from the entry's lines and the kinds of app it holds (from the checklist). An Apps line often says who is concerned ("only Amazon-reading apps", "an app with no Mac app is not concerned"). A release that offers a new piece concerns an app that writes that piece for itself or has a thread waiting on it, not only apps that already import it. Done when each such entry is marked concerns or not, with the reason for each "not".

## 3. Review the apps against the kit

The review finds code an app writes for itself that a kit piece does: its own "how long ago", its own server start, its own icon script. The kit's pieces are the tables in README.md, one per folder.

- With no `last.json`, review every app against every piece.
- Otherwise review only apps whose tags changed since `last.json`, against every piece, and every app against the pieces named in CHANGES.md entries newer than `last.json`'s `newest`.

Start one `metamax:finder` subagent per app in one message. Give each the app's checkout path, the kinds of app it holds, and the README tables for those kinds, and ask for each hand-written copy with its `path:line` and the kit piece that replaces it. Drop every finding an open ticket in that app's backlog already names. Done when every app reviewed has its findings or "none".

## 4. Plan the round

List the apps that have something to take and, for each, the reason (the releases that concern it with their urgency, the copies, the tickets, the features it newly lacks). List apart the apps whose only reason is a feature gap, so the owner can put them all off with one answer, and name each `unknown` with its reason. Leave out an app that already has an upgrade thread, open or closed but not yet closed by the owner:

```sh
bun "$METAMAX_HOME/scripts/threads.ts" --project <project> --asleep
```

A task named `app-kit-v*` in its list is an upgrade thread. A lookup that fails stops the round for that app, said in the plan; never read a failed lookup as none.

Order the apps in waves of three or four: first those whose `urgency` is `now` for a release that concerns them, then the rest by fewest releases behind. A thread holds at most eight threads it started until the owner closes them, so a wave starts only when there is room; name the landed upgrade threads that are safe for the owner to close. Name each app's live threads that touch app-kit (from the same list), since its upgrade will meet them.

The plan goes to the owner for a yes. Done when the owner has answered it.

## 5. Start the upgrade threads

For each app in the wave, write its brief to `$TMPDIR/<project>-brief.md`:

```markdown
# Bring <app> up to app-kit <target tag>

app-kit's apps round started this thread, and follows it to its landing. Move <app> from <its tags> to <target tag>, and take in everything app-kit has left in it, in one plan for the owner's yes in this pane.

- Install: `bun add github:worktron/app-kit#<target tag>` in each folder that installs the kit: <installs, with their tags>.
- What each release since its tag asks (https://github.com/worktron/app-kit/blob/main/CHANGES.md), most urgent first: <version, urgency, lines, for each entry that concerns it>.
- Code it writes for itself that a kit piece does: <path:line, what it does, the kit piece and its import name>.
- Its open tickets naming app-kit: <id · title, each>.
- Kit features it lacks (https://github.com/worktron/app-kit/blob/main/scripts/kit-features.ts says what each looks for): <each, with its README section>.
- What practices' app checklist says it lacks: <each line>.
- Its threads that touch app-kit, which this meets: <names, or none>.

Each item is done, planned in the plan, or recorded in the landing as declined with why; a ticket marked as a security fix is declined only on the owner's word. On a conflict in a package.json's kit line or in bun.lock, take the higher tag and install again. Never edit the backlog on the branch, and leave alone a ticket a live thread is working on. After the landing, name the tickets the change completed and, on the owner's yes in this pane, drop them from main with `bun "$METAMAX_HOME/scripts/ticket-triage-act.ts" <project> --drop <id,id>`.

Done when: every package.json names <target tag> and bun.lock installs it, the app's tests and gates pass, it has landed on <app>'s main through its own landing, and each item above is done or recorded as declined.
```

The target tag is the newest when the thread starts; a release after it belongs to the next round. A brief names no home folder, machine or person. Then start it, plan first:

```sh
bun "$METAMAX_HOME/scripts/spawn.ts" <project> app-kit-<target tag, dots as dashes> --brief-file "$TMPDIR/<project>-brief.md" --sub --wait
```

Done when each app in the wave has its thread, or its row in the report says why it could not start.

## 6. Follow and report

Wait on the wave as the spawn skill says, and report once per wave in this thread: which plans wait for the owner, which landed, which stopped and why. A release marked `now` that lands while this round is open (its landing says the same-day round did not start) joins the next wave. Start the next wave when the last one has landed and there is room. Done when every app in the plan has landed, or the owner set it aside.

## 7. Publish the page and keep the record

Publish one page with the `share-page` skill, slug `app-kit-apps`, dated with this round, and give the owner the address `publish.ts` prints. One row per app, in one shape: the app, its tag and the newest, releases behind with their urgency, a lock that does not match its tag, what CHANGES.md asks of it since its tag, the kit features it lacks and those unknown with why, what the checklist says it lacks, the review's findings, its open app-kit tickets with any security fix marked, and its upgrade thread with its state. An app whose fetch failed says so in its row.

Copy `$TMPDIR/apps.json` to `$MAIN/.apps-round/last.json`, with one change: an app the round left out because an upgrade thread was already open keeps the `lacks` `last.json` had for it, so a gap found while that thread was open, which reached no brief, still counts as new next round. Then declare the outcome (`finished`, with how many apps landed their upgrade and how many are left), and end with the closing recap.
