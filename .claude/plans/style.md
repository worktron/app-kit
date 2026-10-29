# style

## plain-panel · The menu bar panel draws in a plain look, the default, or the console look an app chooses

Approved 2026-10-29 ("build it and land").

### Why

The kit's menu bar panel draws only in the monospace look: JetBrains Mono on near-black, built for agent tools like Fleet. Every app that takes the panel gets that look, suited or not. Beeline, which is for people who never open a terminal, draws its panel this way today. The plain look you picked on the Plain Look Studies page (option C, 2026-10-28) exists only as a ticket, and that ticket doesn't cover the panel at all.

### The change

The panel can draw in either of two looks. Plain is the system typeface on warm off-white paper, light and dark, with one accent color per app. Monospace is the panel as it is today. Each app picks one look, set once at launch, and every panel it opens follows. Plain is the default, so an app that wants monospace has to say so.

### Decisions

- **Panel only, now.** The Mac window pieces, the web MUI theme and the extension stylesheet stay in the plain-look ticket, with what the reviewers learned about each added to it. No app would use them yet: Beeline's Settings and popup move onto the kit in Beeline's own thread, and the four MUI apps that copy a theme between them are monospace apps. The case for building everything now: one landing, and Beeline's later move finds every piece ready. But that builds three surfaces nobody can try yet.
- **Plain is the default; monospace is opt-in per app.** (You chose this.)
- **Which look Fleet and perf-buddy get is your call, at each app's next upgrade.** My recommendation is monospace for both. They're agent and monitoring tools whose web parts already use the monospace colors. Until they upgrade they keep the version they pin and nothing changes.
- **The pieces are written once and draw in either look.** The row, header, footer and the rest stay one set of views. The look supplies their colors, typeface and side padding. A second set of plain pieces would double the code and let the two drift apart.
- **An app sets its accent as a light and dark pair,** defaulting to Beeline's blue: #2f5fa7 in light and #8fb0e6 in dark. Working the dark one out from the light one would be a guess; the Studies page drew both by hand.

### Risk

- **An app upgrades without choosing, and goes plain without anyone asking.** That's the point of plain as the default, but for Fleet or perf-buddy it would be a surprise. Prevented by the minor release line and a README upgrade note that names every place the line goes. That includes a snapshot command or test that runs before the app's launch code, which Fleet's `--snapshot` and perf-buddy's panel tests both do.
- **The plain panel has no mockup.** The Studies page drew the popup, setup window and Settings, not a menu bar panel. I'll draw the panel's screens in plain, light and dark, off screen, and publish them beside the monospace ones for you to look at before I ask to land.
- **The monospace panel changes by accident.** Before landing, I'll draw every monospace screen from main and from the branch and check they're identical pixel for pixel, and rerun the existing comparison of the monospace panel with its mockups.

### Left alone

- The monospace look's colors, sizes and mockups.
- Fleet, perf-buddy and Beeline. Each takes the new version on its own schedule.
- Mac windows, web apps and extension pages. They stay in the plain-look ticket.
- The workspace-sweep thread's branch. Its plan says the four monospace MUI apps move onto "plain-look's theme", which would turn them plain. I'll tell that thread so it plans a monospace MUI theme instead.

### Done when

You'll see, on a published page: the panel's screens in plain, light and dark, beside the same screens in monospace, unchanged.

Proof: `scripts/gates.sh` passes with the new Swift tests, the one-off pixel check finds no difference in any monospace screen, and the existing mockup comparison is still within its limits.

### After yes

I'll add this plan to this worktree's plan file, add the reviewers' notes on the deferred pieces to the plain-look ticket on main, send the workspace-sweep thread its note, and build on branch `style`. When it's built you get the published pictures, the review and verification results, and the question whether to land. A `build and land` answer skips that last question only if the review is clean and you've seen nothing in the pictures you'd change. Since the plain panel is new UI with no mockup, I'd rather you look first.

### Details

All in `swift/menu-bar/Sources/MenuBarTheme`:
- `Look.swift`: `public enum Look { case console, plain(accent: Accent) }`, with `Accent(light:dark:)` and `Accent.default`. `Look.app` is `nonisolated(unsafe) public static var`, documented as set once at launch before the first draw (Swift 6 mode requires the annotation; `Typeface.problem` already uses it). It's the one owner: no SwiftUI environment value.
- `Tokens.swift`: the console palette stays as it is. The plain values sit beside it with the same roles: text #2a2c30/#e6e4df, secondary #5c5f65/#a3a6ab, muted #8e9197/#74777d, ok #2e7d4f/#7cc49a, warn #9a5b00/#e0b46a, error #b3261e/#f2a39c, info as the accent, bg and surface #f6f5f2/#1d1e20 (no boxes), border #e2e0da/#323438, a panel outline one step darker, and hover #ecebe6/#2a2c2f. These are the Studies page's `.look.c` values. `Palette.nsColor`'s dynamic provider reads `Look.app` and then the appearance. `Metrics.inset` reads the look: 14 for monospace, 20 for plain. Every height stays.
- `Typeface.swift`: the text modifier draws the system font under plain and JetBrains Mono under monospace. `CodeBox` text stays monospaced under plain (SF Mono), since it holds a command to copy. The modifier keeps its name, `console`, so nothing an app wrote breaks. A rename can wait for the day a third look exists.
- `Snapshot.swift`: `snapshot(..., look:)` defaults to `Look.app`, sets it for the draw and restores it, all inside one synchronous main-actor call. The bundled-font check runs only for monospace.
- `menu-bar-snapshots render <folder> [dark|light] [console|plain]`. `e2e/compare-mockups.ts` asks for console explicitly.
- Tests: the existing snapshot tests in `Tests/MenuBarThemeTests/PiecesTests.swift` and `PanelTests.swift` ask for `.console` explicitly, since they hold console colors. New tests: the default look is plain; a plain snapshot draws the plain colors, at their roles, in the system font, light and dark; a custom accent draws the copy word in it; and the side padding follows the look.
- The README's menu bar section covers both looks, `Look.app`, the accent, and the upgrade note with where the line goes. AGENTS.md's layout line for `swift/` mentions the two looks.
- The pixel check is a one-off run before landing (render all screens in console from main and from the branch, compare), reported in the landing ask. It isn't committed, since it reads images the repository doesn't hold.
- Ticket additions for plain-look, landed on main with `ticket-land.ts`:
  - MUI applies palette and typography only from `createTheme`'s first argument, so the kit's function should build the theme itself and use `colorSchemes` with `cssVariables`.
  - CSS copies need a `/* */` header, because a `//` line drops the `:root` rule.
  - The stylesheet declares `color-scheme: light dark`.
  - SwiftUI allows custom Toggle and Menu styles, but not Picker or TextField styles, so those two are kit views.
  - The four monospace MUI apps need a monospace theme, not the plain one.
- Release: minor.

### Review

Worth-it reviewer: "Verdict: trimmed (the Swift panel look only: drop look/ tokens and its equality test, the MUI theme, the extension stylesheet and copy step, Window.swift and Controls.swift, and the mockup comparison page; drop the `\.look` environment value; make the pixel check a one-off)". I agree. You asked about menu bar panels, and none of the cut pieces would reach an app when this lands. The plan above is the trimmed version.

- Agreed: the plan chose monospace for Fleet and perf-buddy on your behalf. That's now your decision, with my recommendation.
- Agreed: the existing monospace snapshot tests would fail once plain is the default. They now ask for monospace explicitly.
- Agreed: the extension copy check doesn't look at stylesheets. Moot now the stylesheet is cut, and written into the ticket.
- Agreed: the plain web theme has no app that wants it, and the workspace-sweep plan would move four monospace apps onto it. Cut, and that thread gets told.
- Agreed: "one line at launch" misses Fleet's `--snapshot` path (Fleet's `apps/menubar/Sources/main.swift`, which runs before launch) and perf-buddy's panel tests. The upgrade note names those places.
- Agreed: a static setting plus a SwiftUI environment value would give the look two owners, and the color provider can only see one. It's now one static setting.
- Agreed: a committed pixel test against images in the scratchpad would fail anywhere else. It's now a one-off check before landing.
- Known limit: the workspace-sweep branch also edits README.md, so whichever lands second resolves the conflict there. Routine.
- Agreed: `Look.app` needs `nonisolated(unsafe)` under Swift 6. Written in.
- Moved to the ticket (the pieces were cut): MUI's later `createTheme` arguments skip palette and typography (confirmed at `node_modules/@mui/material/styles/createThemeNoVars.js:151`); MUI recommends `colorSchemes` over a mode argument; a `//` header breaks a CSS copy; `color-scheme` is needed for dark native controls; SwiftUI has no public custom Picker or TextField style.

## plain-look · The rest of the plain look: one tokens file, the MUI themes, the extension stylesheet, and SwiftUI window pieces and controls

Asked 2026-10-29 ("Build the plain-look ticket"). The spec is the plain-look ticket on main's backlog, with its "Since" and "Also" paragraphs.

### The change

- `look/index.ts` (import `app-kit/look`), a new shared top folder beside `icons/` and `testing/`, since three kinds read it: the only owner of both looks' colors (every role, light and dark, the accent as the plain look's one input), the plain look's sizes and spacing (title 17 in a window and 15 in a popup, label 12 at 600 in muted, body 13, small 12, sides 20 in a popup and 24 in a window, 24 between sections, 8 from a label to its content, rows of 44 in a popup and 48 in a window), and the console look's sizes. No packages, no React.
- `web/theme.ts` in `app-kit/web`: `lookTheme(look, options)` builds the MUI theme itself, since createTheme computes palette and typography only from its first argument. Plain gives light and dark `colorSchemes` with `cssVariables`, the system typeface, no boxes or shadows, buttons as accent words, a switch, menu and field in the kit's shape. Console gives the four console apps' dark theme, JetBrains Mono at 13. The app's own options merge in before createTheme runs.
- `extension/look.css`: the rules only (body, title, section label, rows, row with action, status words, switch, menu, text field, removal, build footer), reading CSS variables. `app-kit extension copy` writes `look.css` beside the worker copies, with a `/* */` header and the variable blocks written from `look/index.ts` (light, and dark under prefers-color-scheme, with `color-scheme: light dark`). An app sets only `--accent-light` and `--accent-dark`. `extension check` and `workerCopyDiffers` cover it, and copy refuses to overwrite an extension's own `look.css`.
- `swift/menu-bar`: `Window.swift` (a window's page, title, section label, ruled lines, a window row, status words, accent and removal actions, a foot note and the build line, and `windowSnapshot`) and `Controls.swift` (a switch as a ToggleStyle, a menu that reads as text and a text field in a hairline box as kit views). `Metrics` gains the window sizes. A bun test reads Tokens.swift, Look.swift and the metrics as text and holds them equal to `look/index.ts`.
- Fixtures: the web fixture draws a plain page and a console page; the extension fixture gets a `look.html` drawn light and dark in the harness's hidden Chromium; the Swift snapshots tool draws the Settings screens. Every surface's pictures beside the Studies page's C mockups, published.
- README's web, extension and swift sections show each in use. AGENTS.md's layout names `look/`.
- Release: minor.

### Done when

The ticket's Done when holds, the console MUI theme drawn too, `scripts/gates.sh` green, the pictures published, and the landing asked for.
