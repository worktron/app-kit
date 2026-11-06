---
name: apps-round
description: The weekly round that tells every app on app-kit what changed and what it lacks.
disable-model-invocation: true
---

# The apps round

The kit tells its apps three things: what each release asks of them (CHANGES.md), what practices' checklist says they lack, and which of their own code a kit piece now does (the review). The round gathers all three for every app, publishes one page the owner reads, and leaves each app that needs it one standing ticket, `app-kit-update`, in its backlog. An app's own thread does the upgrade; the round changes no app's code.

Run it from an app-kit worktree. Every step reads; the only writes are the page, the round's record in the main checkout, and ticket landings, which wait for the owner's go.

## 1. Read the apps

```sh
MAIN=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
WORKSPACE=$(dirname "$MAIN")
mkdir -p "$MAIN/.apps-round"
bun scripts/apps.ts "$WORKSPACE" > "$TMPDIR/apps.json"
bun "$WORKSPACE/practices/scripts/app-checklist.ts" "$WORKSPACE" > "$TMPDIR/checklist.txt"
```

`scripts/apps.ts` prints the newest version and, per app, the tags its package.json files name, whether bun.lock installs that tag's commit, releases behind, CHANGES.md's entries since its tag, its open backlog tickets naming app-kit, and whether `app-kit-update` is open. The checklist exits 1 when it lists any gap; that is its normal answer. Keep the checklist lines whose project is an app in apps.json.

`$MAIN/.apps-round/last.json` is the last round's apps.json, when there was one. Done when both files are read and each app's checklist lines are matched to it.

## 2. Review the apps against the kit

The review finds code an app writes for itself that a kit piece does: its own "how long ago", its own server start, its own icon script. The kit's pieces are the tables in README.md, one per folder.

- With no `last.json`, review every app against every piece.
- Otherwise review only apps whose tags changed since `last.json`, against every piece, and every app against the pieces named in CHANGES.md entries newer than `last.json`'s `newest`.

Start one `metamax:finder` subagent per app in one message. Give each the app's checkout path, the kinds of app it holds (from the checklist), and the README tables for those kinds, and ask for each hand-written copy with its `path:line` and the kit piece that replaces it. Drop every finding an open ticket in that app's backlog already names (apps.json's `tickets`, read the section when the title is unclear). Done when every app reviewed has its findings or "none".

## 3. Publish the page

Publish one page with the `share-page` skill, slug `app-kit-apps`, dated with this round. One row per app, in one shape: the app, its tag and the newest, releases behind, a lock that does not match its tag, what CHANGES.md asks of it since its tag (one line per entry), what the checklist says it lacks, the review's findings, its open app-kit tickets by id and title, and its `app-kit-update` ticket: open, to land, or not needed. An app whose fetch failed says so in its row. Done when the page's address answers with this round's date.

## 4. Draft the tickets

An app gets a ticket when `app-kit-update` is not open and it is behind, lacks something on the checklist, or has a review finding. Write each as its own file in `$TMPDIR`:

```markdown
## app-kit-update · Bring <app> up to the newest app-kit

Goal: move <app> to app-kit's newest tag, with `bun add github:worktron/app-kit#<newest tag when taken>` in each folder that installs it, and do what app-kit's CHANGES.md (https://github.com/worktron/app-kit/blob/main/CHANGES.md) asks from <app>'s tag forward. Then run practices' app checklist for <app>, take in the kit piece for each gap it names, and replace the hand-written copies below with the kit's. Left by app-kit's apps round, <date>; the owner's page of every app is https://share.worktron.com/app-kit-apps.
Found on <date>, to confirm (each may have moved):
- <checklist gap, "the checklist says ...">
- <review finding, path:line, and the kit piece>
Done when: every package.json names the newest tag and bun.lock installs it, the app's tests pass, and each item above is done or recorded in this ticket's landing as not applying.
```

A ticket names no home folder, machine or person: projects' tests hold their plan files to that. Done when every app that needs one has its file.

## 5. Land the tickets on the owner's go

Ask the owner once, with the page's address and the list of apps that get a ticket, and wait for their go. Then land each:

```sh
bun "$METAMAX_HOME/scripts/ticket-land.ts" <project> backlog.md --section-file "$TMPDIR/<project>.md"
```

After each landing, read that project's checks on its main (`gh run list --branch main --limit 1` in its checkout, or its `scripts/land-main.sh` output), and fix a red one before landing the next. A refusal or a failed landing goes on the page against that app, to try again next round. Done when every ticket is on its project's main with its checks green, or its row says why not.

## 6. Keep the record

Copy `$TMPDIR/apps.json` to `$MAIN/.apps-round/last.json`, republish the page with each ticket's state, declare the outcome (`finished`, with how many apps are behind and how many tickets landed), and end with the closing recap.
