Approved by the owner 2026-11-02 ("build and land").

# Apps follow the phone's light or dark and its Text Size, with a text size people can set by hand

## Why

metamax, ai-buddy and buddy-system stay near-black on a phone set to Light. Each builds its own fixed dark theme and uses its fixed colors in hundreds of places (about 1,000 in metamax). The kit gives them nothing that follows light and dark: its console web theme is dark only, though the console look already has light colors that the Mac menu bar panel uses. On text size, the kit follows the phone's Text Size on an iPhone, but an app has no size of its own to offer, and on a Mac or a desktop browser there's nothing short of the browser's zoom. Most apps don't take the kit's pieces yet, so nothing the kit adds reaches a phone until each app moves onto it.

## The change

The kit's console theme follows the system's light or dark, as the plain one already does. The kit also gives apps a set of colors, one per role, that switch with it, so an app can swap its fixed colors in one file. Apps can offer a "Text size" setting: "Same as the phone" by default, or a fixed size from 85% to 200% that this device remembers and that replaces the phone's size. The kit ships it as a ready row in the plain look. Each app then gets a ticket that says what moving onto these takes, metamax's at its real size. Apps change only through those tickets.

## Decisions

- **Apps move onto the kit through a ticket in each app's backlog, worked in that app's own thread.** The alternative is that I start a thread in each app myself once the kit lands. I recommend the tickets, so you choose which apps and when. metamax's move is days of work across about 70 files, not a theme swap. I'll offer to start any of them after the landing.
- **Console apps turn light on a light phone or Mac once they adopt.** The alternative is keeping console dark only. (You agreed.)
- **A manual size replaces the phone's size rather than multiplying it.** (You agreed.)
- **The sizes are 85, 100, 115, 125, 150, 175 and 200 percent,** taken from the Mac window's zoom steps in that range. (You agreed.) A comment records where they came from; no test ties the two lists, since the menus are never seen together.
- **The choice is remembered per device, not on the account.** The alternative is saving it on the account, so it follows the person to a new phone. Picked because text size is about one screen and one pair of eyes, and the kit has no account storage.
- **The row shows in the iPhone app too.** The iPhone already has its own per-app Text Size, in Control Center and in Settings. The alternative is hiding the row there. I'd show it: one setting in the same place on every device is easier to find than Apple's, and "Same as the phone" still respects Apple's control.
- **No manual light/dark switch.** (You agreed.)
- **The row's design is shown first as lettered options on a Studies page.** The rest is built while you look.
- **Released as a minor version,** since the console theme's type changes and there are new exports.

## Risk

- Moving a console app onto the kit's colors is where light mode can go wrong: any fixed color the app keeps shows up on light paper. The kit can't see app code. Each console ticket lists what must change (the colors object, colors made see-through by adding hex digits, JavaScript reads of `theme.palette`, and metamax's terminal, which takes plain hex values) and says to check every screen in light.
- At 200% on a small phone, a layout can run past the screen. The settings row gets a phone-width test at 200% and at the phone's largest Text Size. Each app's own screens are checked in its own ticket.
- The Mac window's View > Zoom and the text size multiply. 150% text at 125% zoom draws at about 188%. Each is the person's own choice.

## Left alone

- The Mac window's View > Zoom.
- Swift menu bar apps. They already follow the Mac's light or dark. The Mac's own Text size setting reaches only apps built to read it, and a web view can't read it until WebKit ships its text-scale tag.
- Extension pages. Their stylesheet already follows light or dark, and a desktop browser has its own text size.
- Each app's own code. Apps take the new pieces through their tickets.

## Done when

In the kit's web fixture, run in a hidden Chromium:
- A console page draws in the console look's light colors when the system is light, and in its dark colors when dark.
- The kit's role colors switch with it.
- Choosing 150% in the Text size row makes the page's text 1.5 times larger at once, and it stays after a reload.
- "Same as the phone" goes back to following the phone.
- The row fits a phone's width at 200%.

On a windowless iPhone Simulator, I'll check whether Apple's per-app Text Size reaches the kit's reading. Proved by the fixture's browser tests, unit tests that replay the recorded iPhone readings, and the Simulator run, all inside the kit's full pre-landing checks.

## After yes

I'll publish the Studies page for the Text size row and stop for your pick. The console theme, the role colors and the text size choice get built meanwhile. Then I'll bring the reviewed branch, with the full checks' results, for your go to land it. After it lands, I'll file one ticket in each app's backlog, naming the new kit version, and offer to start any of them.

## Details

Base: main at f28f3ba15374c79d7f486972ba521da2fbf4ef8b (this branch's head). Release: minor.

**Console theme follows light or dark** (`web/theme.ts`, `consoleOptions`)
- Built as `plainOptions` is: `cssVariables: true` and `colorSchemes: { light, dark }` from `CONSOLE.light` and `CONSOLE.dark`, so MUI's selector defaults to `media` (`node_modules/@mui/material/styles/createThemeWithVars.js:126`). Every literal color in the overrides becomes `var(--mui-palette-…)`.
- The outlined button's `${colors.info}50` and `${colors.info}15` (about 31% and 8%) become `rgba(var(--mui-palette-primary-mainChannel) / 0.31)` and `/ 0.08`, held by an assertion in `test/theme.test.ts`.
- `lookTheme`'s console overload returns `Theme & Pick<CssVarsTheme, 'colorSchemes'>` as plain's does.
- `look/index.ts`: CONSOLE's comment drops "Its web apps draw only in dark".

**Role colors that switch** (`web/theme.ts`, exported from `web/index.ts`)
- Both themes put every role of their look's `Colors` under one custom palette key, `look`, in each scheme, so MUI writes `--mui-palette-look-<role>` for both (confirmed against MUI 9.5.0 by the prior-art reviewer's script).
- `colorVariables: Record<Role, string>`, each `var(--mui-palette-look-<role>)`, derived from the `Role` list in `look/index.ts`, so look/ stays the only owner. A unit test builds each theme and holds every entry to a variable the theme generates, in light and in dark, with the tokens' values.
- README names the key and says: a see-through tint is `rgba(var(--mui-palette-look-<role>Channel) / a)` (or `theme.alpha`), never hex digits on the end; JavaScript that needs a plain value (a terminal, a canvas) takes `CONSOLE[scheme]` or `plainColors()[scheme]` with the scheme from MUI's `useColorScheme()`; and `theme.palette` holds only the light values under CSS variables, so JavaScript reads go through `theme.vars.palette`.

**The text size choice** (`web/text-size.ts`)
- `TEXT_SIZES = [0.85, 1, 1.15, 1.25, 1.5, 1.75, 2]`, exported, with a comment naming `tauri/window/plugin/src/mac.rs`'s `ZOOM_LEVELS` as its source.
- One localStorage value, key `app-kit:text-size`, through `web/storage.ts`'s `read`/`write`. Blocked storage, or a value not in `TEXT_SIZES`, reads as "Same as the phone".
- `read()` computes `next = chosen() ?? readScale()`, so the root size, `--text-scale` and `useTextScale()` all carry the effective scale, from one place. Another tab picks up a change when it comes back in front, through the existing `onPageReturn`; no new listener.
- New exports: `textSizeChoice(): number | null`, `chooseTextSize(size: number | null)` (writes, re-reads, notifies), `useTextSizeChoice()`, and `phoneTextScale()` for the row's wording if the Studies pick wants it.
- Tests in `test/text-size.test.ts`: a stored 1.5 on each recorded place sets the root to 1.5 times the app's root and `--text-scale` to 1.5; null goes back to the place's reading; a value outside the steps and blocked storage read as null; `useTextScale` re-renders on `chooseTextSize`.

**Apple's per-app Text Size** (WebKit hands the app's own size category to `-apple-system-body`: `Source/WebKit/UIProcess/API/ios/WKWebViewIOS.mm:3799-3812`, per the prior-art reviewer)
- On a windowless Simulator (`app-kit iphone run sim`, tapped with axe as the README's testing section says), set the per-app size for the fixture's app and read `--text-scale`: does it change, and on coming back from Settings or only after a reload? If Control Center's slider changes it with no page event, add a re-read on the event that does fire, found the same way. The README's "changing the setting means leaving the app" changes to what the run shows.
- README: don't add `<meta name="text-scale">` to an app that calls `followTextSize`; the browser and the kit would scale twice.

**The settings row** (new `web/TextSizeSetting.tsx`, exported as `TextSizeSetting`)
- A `ListItem` with "Text size" and a `<Select variant="standard">` of "Same as the phone" and the seven percentages. Wording, whether it shows the phone's own percentage, and how it reads off a phone come from the Studies pick (design-studies skill, plain look tokens, share.worktron.com).
- `web/e2e/fixture/look.tsx` calls `followTextSize()` and draws the row. Tests in `web/e2e/look.e2e.ts`: pick 150%, root font size 24px at once and after `page.reload()`, then "Same as the phone" back to 16px; and at a 375-wide viewport, at 200% and at `largestTextSize(page)`, `expectFits` holds the row inside the screen.
- `test/exports.test.ts` gains the new names.

**README** (`README.md`): "The phone's Text Size" gains the choice, the row, the steps, Apple's per-app size and the meta tag line; the theme section says console follows light or dark and documents `colorVariables`; the web table names the new exports.

**Tickets, after landing**, through `bun "$METAMAX_HOME/scripts/ticket-land.ts" <project> backlog.md --section-file <file>`, one per app that draws a web page on the kit: ai-buddy, argon-watcher, assay, buddy-system, getter, lifeform, metamax, timescale, urge-surfer. Each: take `lookTheme` (or follow light and dark in its own theme), call `followTextSize()`, put `<TextSizeSetting />` on its settings page, give `firstPaint` both schemes, replace `theme.palette.*` reads in JavaScript with `theme.vars.palette.*`, and check every screen in light. The console three add: swap the `colors` object for `colorVariables`, turn each hex-suffix tint into the channel form (38 places across the three), and give metamax's terminal its colors from `CONSOLE[scheme]`. metamax's ticket gives its size: about 1,000 uses across about 70 files.

**Checks:** `scripts/gates.sh` in full before the landing ask, plus the review and verify scripts the thread rules name.

## Review

Worth-it: `Verdict: too small`. Partly agreed. The kit change alone turns no phone light, because no app uses the kit's theme, and the console apps had no kit colors to swap theirs for. The plan now adds those colors, says plainly that apps change only through their tickets, and sizes metamax's ticket honestly. Moving the apps themselves stays out of this branch: each is its own project, and the first decision offers to start their threads.

12 findings (after merging one duplicate): 10 agreed, 2 disagreed.

1. Agreed (worth-it and prior art). The plan said console apps change color with no code change; no app calls `lookTheme`. The Why, the change, the release line and the tickets are rewritten.
2. Agreed (worth-it). Apps had no kit form of the console colors that follows light and dark. Added `colorVariables` and a test holding it to the theme's variables.
3. Agreed (worth-it). The new other-tab listener repeated the existing re-read on coming back in front. Cut.
4. Agreed (worth-it). The test tying text steps to the Mac zoom's Rust source tied two independent menus. Cut to a comment.
5. Agreed (prior art). The outlined button's hex tints are about 31% and 8%, unpinned in the plan. Now the channel form at 0.31 and 0.08, held by a test.
6. Agreed (prior art). The Mac does have a Text size setting. Left alone now says a web view can't read it yet.
7. Agreed (prior art). The iPhone has a per-app Text Size that the web view most likely sees. Added a Simulator check, a fix if the reading lags, a decision on showing the row there, and a corrected Why.
8. Agreed (prior art). The standard `<meta name="text-scale">` would scale twice beside `followTextSize`. Added a README line; no code.
9. Agreed (prior art). Under CSS variables, `theme.palette` holds only light values. Added to the README and the tickets.
10. Agreed (Codex). The 312% checks never touched the new row. Added phone-width fit tests at 200% and the largest Text Size.
11. Disagreed (Codex). The Text size menu at 13px would zoom on focus. MUI's menu takes focus on a `div` (`node_modules/@mui/material/Select/SelectInput.js:720`), and its `input` is `aria-hidden`, so the iPhone's field zoom never applies.
12. Disagreed (Codex). The fixture's first frame is cream or brown, not console colors. That's the fixture's own config for every page and already true today. Real apps set their own `firstPaint`, which each ticket covers.
