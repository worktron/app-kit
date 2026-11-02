# What the always-loaded instructions should stop carrying

## What I took the request to mean

The request was "assess always-loaded principles", asked in an app-kit thread just after a 165 byte line was said not to fit. I judged placement and cost: for each always-loaded line, does every session in every project need it, and if not, where does it load instead? I did not judge whether each rule is right or whether agents obey it. That would be a different investigation, read from transcripts, so the landing ask puts this reading to the user.

The reading in the brief, that detail for one kind of app could move into app-kit, turned out to be almost empty. About 550 of the principles' bytes are about one kind of app or one kind of work, and they belong in path-scoped rules files, since nothing in app-kit loads for an agent unless something points at it. But reading from app-kit found a fault in the other direction: the kit's own instructions load into apps' sessions.

## What the reading found

All practices figures are by the test's own regular expression, on practices at `54f3db8`.

**The reported shortage was a miscount, and the real one has arrived anyway.** The 13,961 bytes that started this counted the three-line maintainers' comment at the top of the principles, which both Claude Code and the test strip. The true figure then was 13,606, with 394 free, and the iPhone pointer landed in the principles as a 67 byte clause. The new-project rule then added 634 to the ways, so the shared limit is now the tight one:

| Text | Now | Limit | Free | Who holds the limit |
| --- | --- | --- | --- | --- |
| Principles | 13,673 | 14,000 | 327 | practices' test |
| Principles and ways | 16,288 | 16,500 | 212 | practices' test |
| Codex's one file (all three parts and an index of rules files) | 23,325 | 24,576 | 1,251 | fleet's apply, which stops |

The last three rules added to the principles before the pointer cost 170, 148 and 358 bytes, and the new-project rule cost 634. So 212 bytes is at most one more small rule.

**The limits cover about a fifth of what a session reads.** A thread in app-kit starts with the principles and ways (16,288), the machine facts (5,343), metamax's thread rules (7,987), the project's instructions (14,242) and the skill listing (29,654 characters in this thread): about 74 KB. Claude Code's documentation says longer instruction files "consume more context and reduce adherence" and to target under 200 lines per file, which the principles meet at 90 lines. It gives no byte figure, so 14,000 is the owner's own number.

**Four clauses in the principles are held elsewhere or needed by one kind of work.** Fleet's guard hook already refuses, with the reason, a bare push to main, a piped `git rebase --continue`, and starting an app by URL scheme or bundle identifier. The rule about replaying a sorting rule against real records concerns one kind of code.

**A sentence in the ways is out of date.** The trailer line says the harness's notice "names a model version and context size; this rule overrides it". The notice no longer names a context size, and now says itself that the user's own instructions about these lines take precedence.

**The kit's maintainer instructions load into apps.** Bun installs a GitHub dependency from an archive of the whole repository, so an app has `node_modules/app-kit/CLAUDE.md` and `AGENTS.md`. Claude Code loads a nested `CLAUDE.md` or `AGENTS.md` when it reads a file in that folder, and `node_modules` is not exempt. Proved with headless runs on a scratch folder: reading only a package's README brought a marker word from its nested instructions into the session, through the `@AGENTS.md` import too. So an agent that follows `app-kit iphone run`'s own pointer to `node_modules/app-kit/README.md` also takes in up to 14 KB of rules for changing the kit: never edit the version, a `Release:` line on every commit, commits authored as Worktron, run the kit's gates. Those are wrong for an app. No app in this workspace has a commit with a `Release:` line since June, so that rule at least has not been acted on; the others are unknown. Other packages ship the same files (`bun-types`, `extension-kit`), and nine apps are pinned to tags that hold them.

## What it comes to

| Text | Now | After | Free after |
| --- | --- | --- | --- |
| Principles | 13,673 | 13,310 | 690 |
| Principles and ways | 16,288 | 15,776 | 724 |

Computed on a scratch copy of practices' main. That is room for any recent rule, the new-project one included. No rule is dropped: every clause removed is still held by the guard or moves to a file that loads with the work, and the one sentence deleted describes a notice that has changed.

Keep both limits as they are. The principles filled the old 16,000 byte limit by 2026-10-14, and the cleanup that followed cut about 3,000 bytes and lost no rule, which is the better move when room runs out.

## Looked at and left alone

- **A short index in place of the principles.** No vendor recommends a bare index: they recommend a short always-loaded file holding the rules that apply every time, with pointers for the rest (Cursor: "Put anything that must always be in context directly in the rule body"). Most principles must apply before any file is touched, and the 90 lines are within Claude Code's 200. In [McMillan's 1,650 sessions](https://arxiv.org/abs/2605.10039v1) file length had no detectable effect on compliance, though only for one trivial rule. On-demand content that the model chooses to open often goes unread, as in [Yang's 12 of 347 runs](https://arxiv.org/html/2607.26819v1), though no pointer was given there. No study compares a behavior rule inline with the same rule behind an index, so this is inference. An index would save at most about 17% of what a session reads at start. Rules files that Claude Code loads by path are different, since the model makes no choice, and they stay as they are. Codex's index of those rules files is the model-chosen kind and is untested here.
- **The Clerk account line (1,093 bytes) and the default domain and GoDaddy line (963 bytes) in the machine facts.** They are the two longest always-loaded lines, they matter only when setting up an app's accounts, and the principles say detail for one tool lives in that tool's skill. I proposed moving them to a skill, and the reviewers argued me out of it. No limit is short of that room (the saving is about 2% of what a session reads), the Clerk line exists because an agent once changed the wrong account, and doing it safely needs an always-loaded pointer, nine references changed in the setup skill, routing to Codex threads, and a proof that performs a Clerk task. That is the user's call; the landing ask recommends leaving them.
- **The interface half of the naming rule (290 bytes).** It would fit in `rules/interfaces.md`, but it went into the principles hours before this reading, and that file does not load for `.rs` or `.ts` files, where menu labels and popup wording are also written. It is the next candidate when room runs out.
- **"`drizzle-kit push`, an `rm` of a database" (44 bytes).** The guard matches the word `drizzle-kit` on the command line, and an app's documented `bun run db:push` has no such word, so the guard does not fire in the same conditions.
- **Claude Code's `attribution.commit` setting.** It would set the commit trailer, but in practices, fleet, app-kit and metamax no commit since 2026-10-15 carries a model-named trailer, so it fixes nothing that goes wrong.
- **Printing the sizes in test names.** Bun prints no test names when `CLAUDECODE` is set, so agents, who are the ones who measured wrong, would still see no number.
- **The rest of the 74 KB.** Metamax's thread rules, projects' own instructions (fleet and another project are at 29.6 KB, app-kit's Layout section is 7,940 bytes) and the skill listing are larger than anything these tickets touch, and each has its own owner. The request was about the principles, so a session still reads about 73 KB afterwards: these tickets make room for rules, and barely change what a session costs.

## kit-instructions-stay-home · The kit's maintainer instructions stay out of what an app installs

Goal: an app's agent that reads a file under `node_modules/app-kit` does not load the rules for changing the kit, whoever installed it. A new `.gitattributes` marks `AGENTS.md`, `CLAUDE.md` and `.claude` as `export-ignore`, unanchored, so the archive GitHub serves leaves them out at every depth; `.claude` too, because the kit's folder of plans ships today and a rules file added there would load the same way. GitHub's archive honors this and Bun's download is that archive (Bun's source; `laravel/laravel`'s tarball). Apps pinned to older tags get this when they next update the kit; `node-modules-instructions-excluded` covers them until then. The README's section on developing the kit stays, under a heading that says what it is for.

Done when: a test lists `git archive HEAD` and finds no `AGENTS.md`, `CLAUDE.md` or `.claude`; `bun add github:worktron/app-kit#<the tag it lands in>` in a scratch folder leaves none of the three in `node_modules/app-kit`, while `README.md`, `tauri/` and `bin/` are there; `scripts/gates.sh` passes.

Do not touch: the text of `AGENTS.md` or the README.

Needs: the user's yes. `Release: patch`, since an app notices nothing.

Touches: `.gitattributes` and a test beside `test/public.test.ts` in app-kit.

## node-modules-instructions-excluded · No package's own instructions load into a session on this machine

Goal: the same fault, fixed now and for every package: pinned apps keep the kit's files until they update, and other packages ship their own. Fleet's Claude Code settings gain `claudeMdExcludes` with `**/node_modules/**/CLAUDE.md` and `**/node_modules/**/AGENTS.md`. Proved with a headless run: with the setting a marker word in either file under `node_modules` did not load, and with no setting both did.

Done when: fleet's `providers/claude/settings.json` holds the key, apply renders it, fleet's `bun test` passes, and a headless `claude -p` run under the rendered settings in a real app that reads `node_modules/app-kit/README.md` reports no kit maintainer rules in its instructions. The check asks about the file's own marker text or its Layout section, since the README itself mentions `Release:`.

Do not touch: any other settings key. Codex needs nothing: it reads `AGENTS.md` only from the project's root down to where it was started.

Needs: the user's yes, since adding a key to fleet's fragment adopts it on every box. Keep it in fleet's backlog.

Touches: `providers/claude/settings.json` in fleet.

## principles-keep-what-every-session-needs · Four clauses and two sentences leave the principles and ways

Goal: the principles and ways hold what every session needs, with room for the next rule. Against practices at `54f3db8`:

- "never starts a Mac app by URL scheme or bundle identifier: macOS hands those to whichever build registered last, often a stale one in another worktree" (153 bytes) moves to `rules/desktop-apps.md`. The general rule that remains, a check never opens a window, still covers it, and the guard refuses it with the same reason.
- "A rule that sorts the user's own things is replayed read-only against their real records before it lands." (106) moves to `rules/tests.md`.
- "Never type a bare `git push` to main or staging" (53) goes: the sentence before it already says main is reached only through the landing path, and the guard refuses the push.
- "`git rebase --continue` bare (never piped)" (51) goes: the guard refuses it with the reason.
- From the ways, "The `setup` skill holds the same for a new project." (52) goes: the skill's listing says it.
- From the ways, "The harness's attribution notice names a model version and context size; this rule overrides it." (97) goes: the notice now says the user's instructions take precedence.

The dated story comments stay on the rules they explain, and a moved clause's comment moves with it. Someone who copies the principles without fleet loses the guard's half of two clauses; the push rule's meaning stays in the sentence before it.

Done when: `bun test` and `bun run typecheck` pass in practices; the principles fall by 363 bytes and the ways by 149 against the pinned base, by the test's own measure; each moved clause is found word for word in its new file; fleet's `hooks/guard.test.ts`, which already has them, still refuses the three commands the removed clauses name; and the first commit on this machine after apply carries exactly `Co-Authored-By: Claude <noreply@anthropic.com>`, else that sentence goes back.

Do not touch: any other rule, the principles' reasons, or the limits.

Needs: the user's yes on each clause, since these are the principles. Keep it in practices' backlog.

Touches: `principles.md`, `ways.md`, `rules/desktop-apps.md`, `rules/tests.md` in practices.
