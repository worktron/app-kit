---
name: apps-round
description: The apps report, run when the owner asks: reads every app on app-kit, publishes the apps page of where each stands, and starts an upgrade thread only in an app the owner names. The kit starts no upgrades of its own.
disable-model-invocation: true
---

# The apps report

Each app on the kit keeps itself current: when its own thread plans work, it reads CHANGES.md from the oldest version it installs and takes in what that work needs (the owner's instructions say so in every project). The kit starts no upgrades. An urgent release (`Urgency: now`) is no exception: its landing names the apps on an older version to the owner, who decides which to fix.

This report is for the owner's view, run when they ask: it reads every app on the kit and publishes one page of where each stands. It changes no app's files and starts no thread, except an upgrade thread in an app the owner names (step 4).

Run it from an app-kit worktree.

## 1. Read the apps

```sh
MAIN=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
WORKSPACE=$(dirname "$MAIN")
mkdir -p "$MAIN/.apps-round"
bun scripts/apps.ts "$WORKSPACE" > "$TMPDIR/apps.json"
bun "$WORKSPACE/practices/scripts/app-checklist.ts" "$WORKSPACE" > "$TMPDIR/checklist.txt"
```

`scripts/apps.ts` stops with an error when it cannot read the kit's tags or CHANGES.md from GitHub; fix that before going on, since a report on missing data shows apps as up to date. Per app it gives the tags its package.json files name (`installs`), whether each bun.lock installs that tag's commit (`locked.matchesTag`), how many releases it is `behind`, CHANGES.md's entries since its tag (`changes`, each with its `urgency` and lines), the most urgent of them (`urgency`), its open backlog `tickets` naming app-kit, the kit's features it should have and `lacks` (scripts/kit-features.ts, which says what each looks for), those whose answer could not be read (`unknown`, each with why, never read as lacking), and when its origin was `fetched`. The checklist exits 1 when it lists any gap; that is its normal answer. Keep the checklist lines whose project is an app in apps.json.

A checkout whose landed tree could not be read is in the output's unread list with why; name each on the page, never as an app with no kit.

`$MAIN/.apps-round/last.json` is the last report's apps.json, when there was one. Done when both files are read and each app's checklist lines are matched to it.

## 2. Review the apps against the kit, when the owner asks

Only when the owner asks for it: the review finds code an app writes for itself that a kit piece does, its own "how long ago", its own server start, its own icon script. The kit's pieces are the tables in README.md, one per folder.

- With no `last.json`, review every app against every piece.
- Otherwise review only apps whose tags changed since `last.json`, against every piece, and every app against the pieces named in CHANGES.md entries newer than `last.json`'s `newest`.

Start one `metamax:finder` subagent per app in one message. Give each the app's checkout path, the kinds of app it holds, and the README tables for those kinds, and ask for each hand-written copy with its `path:line` and the kit piece that replaces it. Drop every finding an open ticket in that app's backlog already names. Done when every app reviewed has its findings or "none".

## 3. Publish the page and keep the record

Publish one page with the `share-page` skill, slug `app-kit-apps`, dated with this report, and give the owner the address `publish.ts` prints. One row per app, in one shape: the app, its tag and the newest, releases behind with their urgency, a lock that does not match its tag, what CHANGES.md asks of it since its tag, the kit features it lacks and those unknown with why, what the checklist says it lacks, the review's findings when one ran, its open app-kit tickets with any security fix marked, and any upgrade thread it has open, with its state. An app whose fetch failed says so in its row.

Copy `$TMPDIR/apps.json` to `$MAIN/.apps-round/last.json`, which the next review reads. Done when the page is published and the record copied. With no upgrade asked for, declare the outcome (`finished`, with how many apps were read and how many are behind), and end with the closing recap.

## 4. Upgrade an app the owner names

Only for an app the owner names. First look for an upgrade thread it already has, open or not yet closed by the owner: a task named `app-kit-v*` in `bun "$METAMAX_HOME/scripts/threads.ts" --project <project> --asleep`; a lookup that fails stops here for that app, said to the owner, never read as none. Then write its brief to `$TMPDIR/<project>-brief.md`:

```markdown
# Bring <app> up to app-kit <target tag>

The owner asked app-kit's apps report to start this thread. Move <app> from <its tags> to <target tag>, and take in everything app-kit has left in it, in one plan for the owner's yes in this pane.

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

The target tag is the newest when the thread starts. A brief names no home folder, machine or person. Then start it, plan first:

```sh
bun "$METAMAX_HOME/scripts/spawn.ts" <project> app-kit-<target tag, dots as dashes> --brief-file "$TMPDIR/<project>-brief.md" --sub --wait
```

Wait on it as the spawn skill says. Done when the thread has landed, or the owner set it aside; then declare the outcome and end with the closing recap.
