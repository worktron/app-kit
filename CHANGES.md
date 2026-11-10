# Changes

What an app does when it moves to each version, newest first, written by the landing from each change's Urgency and Apps lines. A version not listed asks nothing of an app. Urgency says how soon apps take it: now (app-kit's apps round starts the upgrades that day), next round (the Monday round) or rides along (the app's next upgrade).

## v0.60.0

Urgency: now

- An app on Railway moves every setting in railway.json or railway.toml into Railway before 2026-12-01, when Railway stops reading them, with Railway's command line 5.71.0 or later: railway config migrate --apply writes .railway/railway.ts, the draining time goes in the service's env as RAILWAY_DEPLOYMENT_DRAINING_SECONDS, railway config migrate cutover then railway config plan and apply on the owner's yes, then push the old file's deletion and check a deploy (README, "Railway's settings").

## v0.59.0

Urgency: next round

- on the sign-in screen, mark the email field autocomplete="username" (keeping type="email") and the code field autocomplete="one-time-code" with inputMode="numeric"; signInByCode fails until both are set, and an app whose tests sign in through a step of their own checks the two markers there. The README's Password managers section has the icon request to send 1Password.

## v0.58.2

Urgency: rides along

- a menu bar app's panel stops playing the alert sound for keys it does not use once the app takes this version.

## v0.58.0

Urgency: next round

- an app run from a phone's Home Screen can take Web Push (see the README's "Notifications on the Home Screen"); Lighthouse is the first, and argon-watcher can move from its own copy

## v0.57.0

Urgency: rides along

- a Mac app with one window and a side column may draw it from AppWindow, SideColumn, SideRow and WindowButton, with SectionLabel's and WindowRow's new tones; Fleet and Buddy System are the two

## v0.56.2

Urgency: next round

- An app whose own tests start Playwright's full Chromium (launchPersistentContext with the chromium channel, as extension tests do) spreads withoutDockIcon(chromium) from app-kit/testing/playwright-dock into its launch options; apps on the extension harness or openInBrowser change nothing.

## v0.56.1

Urgency: rides along

- a work's title and reading text can take bookTitle and readingText from app-kit/web, in the book face FONTS.book from app-kit/look

## v0.56.0

Urgency: rides along

- an app on catchUp drops its `now` argument and sets `readFrom` from the person's choice (HOW_FAR_BACK, readFromFor); FIRST_READ_DAYS is gone

## v0.55.2

Urgency: rides along

- a menu bar app may give a CompactRow an icon on the left with RowIcon, and a dot and a ⌘ key on the right, and place RowIcon and RowDot in its own rows; nothing to change

## v0.55.0

Urgency: rides along

- An extension's first Web Store release goes Unlisted: on an item never published, app-kit extension dashboard fill now stops before saving anything unless store-listing.md's Visibility line says Unlisted; make it "- Visibility: Unlisted, to invited testers."
- An extension's first Web Store release goes Unlisted: on an item never published, app-kit extension dashboard fill now stops before saving anything unless store-listing.md's Visibility line says Unlisted; make it "- Visibility: Unlisted, to invited testers."

## v0.54.0

Urgency: rides along

- an app with a demo Google account for its verification video can use app-kit google demo-reset

## v0.53.0

Urgency: next round

- an app on the plain look may set its own paper and highlight together, light and dark, beside its accent: Look.plain(accent:background:) on the Mac (Accent is now LightDark, the default accent Look.defaultAccent), lookTheme({ name: 'plain', accent, background }) on the web, and for an extension a look.json beside its manifest, which takes the place of a page's --accent-light and --accent-dark (Getter moves its accent there, then runs app-kit extension copy); the kit refuses colors whose text reads under 4.5 to 1; plainColors takes { accent, background }; a side page takes its own width with MenuBarPanel(width:sideWidth:) and snapshot(width:sideWidth:) (Beeline sets 380 beside its 480 list); in the plain look a row's arrow shows only when it is selected and a side page's groups sit under a hairline.

## v0.52.4

Urgency: next round

- nothing to change; a worktree's iPhone Simulator made from this version on is deleted once the worktree is gone.

## v0.52.3

Urgency: next round

- An app whose Xcode project embeds an app extension, such as metamax's share extension, uploads it signed, after assigning its App Group on Apple's developer site as the upload's stop line says; others change nothing.

## v0.52.2

Urgency: next round

- An app that passes signUp to SignInGate takes this so a new address gets an emailed code instead of "There is no account"; others need nothing.

## v0.52.1

Urgency: rides along

- Nothing to change; app-kit/command-line also exports runByThread(env) for any command whose purpose is a window for the owner.

## v0.52.0

Urgency: next round

- an app that builds Order values by hand adds inStore and deliveredOn; one that reads an order's page can take readOrderPage for counts, weights, prices and substitutions.

## v0.51.0

Urgency: rides along

- nothing to change; an app that works out CPU between two readings can call coresBetween, parsePs and psArguments from app-kit/server/process-usage, as the README's Cores per process between two readings section shows

## v0.50.0

Urgency: next round

- An extension headed for the Chrome Web Store can run `app-kit extension dashboard fill` to type store-listing.md into its dashboard item and read it back; a store-listing.md whose Data collected names a data use the dashboard has no box for (such as "Web browsing activity" for "Web history") now fails `app-kit extension listing`.

## v0.49.0

Urgency: next round

- copy the kit's worker files again (bun run app-kit extension copy), pass each job's signal to every fetch it makes through within(signal), drop the job's own one-run-at-a-time flag, and have the extension's unit test hold that every request in shim.networkRequests carried a signal, as the README's Jobs on a clock section shows

## v0.48.0

Urgency: now

- add @electric-sql/pglite-prepopulatedfs as a dev dependency at exactly your @electric-sql/pglite version, and move the two together, so test databases stop timing out on a busy Mac; without it tests run as before and print one line saying so.

## v0.47.2

Urgency: rides along

- Messages Service moves to this tag for its first release; an app signed with a Developer ID certificate now notarizes on release and may name the certificate by its fingerprint.
- Messages Service moves to this tag for its first release; an app signed with a Developer ID certificate now notarizes on release and may name the certificate by its fingerprint.

## v0.47.1

Urgency: next round

- an app whose tsconfig sets noUncheckedIndexedAccess, or leaves out allowImportingTsExtensions, can now import app-kit/command-line, app-kit/extension/host and the other exports without errors inside the kit

## v0.47.0

Urgency: rides along

- a menu bar app in the plain look can draw its panel in sections with PanelSectionLabel, ProblemRow, CompactRow and CompactList, and Footer(lineAbove:), as the README's menu bar theme section shows; on upgrade every plain app's selected fill is darker and its ok and warn words a shade darker in light, a Swift window's section labels are secondary gray, and a plain panel's header title is 15 points, with nothing to change

## v0.46.1

Urgency: rides along

- a steps file's outsideImage path is read from the steps file's folder, no longer the folder the command ran in
- a steps file for store images sets timeZone and locale, and names clockAt's offset

## v0.46.0

Urgency: rides along

- an app that lets in a list of people can use requireInvited with invitedCheckByEmail and clerkAllowlist, and an app whose index.html draws a wordmark before its code loads can pass firstPaint a font, as the README says

## v0.45.6

Urgency: next round

- an app that mounts messagesServiceRoutes passes `account` (how the person knows their own account, such as their email), and a page calls openConnectLink(teamId, link)
- an app that wants texts from Messages Service mounts messagesServiceRoutes from app-kit/tauri/apple-messages/server (README "Reading Apple Messages"); nothing changes for one that does not

## v0.45.4

Urgency: rides along

- CHANGES.md gives each version's urgency (now, next round or rides along); app-kit's apps round now starts each app's upgrade thread itself, so an app's own threads need do nothing

## v0.45.3

Urgency: next round

- an app that reads Apple Messages on the Mac can take app-kit/tauri/apple-messages (README "Reading Apple Messages"); nothing changes for one that does not

## v0.45.2

Urgency: rides along

- CHANGES.md says what each version asks of an app; read it from your tag forward when you move to a newer one.

## v0.45.1

Urgency: rides along

- An extension can hold its Chrome Web Store listing in store-listing.md and check it against its manifest with `app-kit extension listing`. Nothing changes for an extension that does not.

## v0.45.0

Urgency: next round

- An extension's manifest.json must sit at its checkout's root, its paths pointing into its code folder: `app-kit extension install-host` refuses a manifest in a subfolder, and the kit's self-reload reads the commit from `.git` beside the manifest. Move it there, and call `layoutProblems` from `app-kit/extension/layout` in the extension's own test.

## v0.44.0

Urgency: next round

- Browser tests against a Clerk development instance can sign one user in per test worker with `testSignedInPerWorker` from `app-kit/authentication/clerk/playwright`, which keeps a suite under Clerk's request limit. Switch to it where a suite signs in per test.

## v0.43.1

Urgency: now

- Google sign-in through Clerk: "Continue as" tells Google which account, and a first sign-in comes back with one page load. Take it in by moving to this version; nothing else changes.

## v0.43.0

Urgency: next round

- An iPhone app with Google sign-in in Apple's sheet passes `iphoneSignIn` to the sign-in gate, which then draws the wordmark with one line during the steps, never a form. Drop any in-between screens the app drew itself.

## v0.42.0

Urgency: next round

- `app-kit/amazon-cart` builds the request that adds a product to a cart from its page, and the extension worker's `amazon-never-sent.js` lists the Amazon requests no extension sends. Only Amazon-reading apps are concerned.

## v0.41.0

Urgency: next round

- An app on the Mac window draws one `UpdateLine` from `app-kit/tauri/window` in place of `NewBuildLine` and of 0.40's `AppUpdateLine`, which is gone: `<UpdateLine appName="Argon" scheme="com.example.argon" />`. `appUpdateMessage` became `updateMessage`, with `useUpdate` and `takeUpdate` for an app that draws its own line.

## v0.40.0

Urgency: next round

- A Mac app built with Tauri publishes releases with `app-kit mac release` and updates itself from them through the window plugin; `app-kit mac key` makes the signing key. An app with no Mac app is not concerned.

## v0.39.0

Urgency: next round

- `app-kit/amazon-cart` reads one store's Amazon cart page, and throws on a page that is not that store's cart. Only Amazon-reading apps are concerned.

## v0.38.0

Urgency: next round

- A Tauri Mac app can publish a release with one command and update itself from its releases (the window plugin's updates). Adopt it in place of an app's own release script.

## v0.37.1

Urgency: rides along

- `app-kit/server/process-usage` reads a macOS process's CPU time, memory and disk. Nothing changes for an app that does not use it.

## v0.37.0

Urgency: next round

- `lookTheme` always returns a theme with color schemes, light and dark, and gives its colors as CSS variables (`colorVariables`); a console-look app follows the system's light or dark. An app that passed the theme a fixed mode checks its screens in both.
- A web app on a phone can offer `TextSizeSetting`, a size chosen on this device from 85% to 200% over the phone's Text Size.

## v0.36.0

Urgency: rides along

- `app-kit iphone run sim` shuts each Simulator it boots down ten minutes after its app starts, with at most two at once. Nothing to change.

## v0.35.0

Urgency: next round

- `app-kit testflight upload` signs with a distribution certificate read from 1Password, and deletes only the keychain its own build made. An app that uploads to TestFlight adds the certificate's item as the README says.

## v0.34.0

Urgency: next round

- `app-kit/amazon-orders` reads Amazon's order pages from their HTML. Only Amazon-reading apps are concerned.

## v0.33.6

Urgency: next round

- An app's install of the kit no longer carries the kit's own AGENTS.md and CLAUDE.md, so an app's agents stop reading the kit's maintainer rules. Move to it.

## v0.33.4

Urgency: next round

- `AccountMenu`, a quiet button at the right of the app's bar that says who is signed in, the app's own items and Sign out. Replace an app's own account menu with it.

## v0.33.2

Urgency: next round

- The window plugin builds the standard Mac menu bar, with About naming the build's commit. A Tauri Mac app drops its own menu code.

## v0.33.1

Urgency: rides along

- iPhone notifications can be quiet and can set a count on the app's icon.

## v0.33.0

Urgency: next round

- `showLink` in the extension worker brings forward a tab already showing a link before it opens another, and two requests for one link share one answer. An extension that opened its own tabs switches to it.

## v0.32.0

Urgency: next round

- The Chrome stand-in for extension tests covers what extensions' own copies needed (tabs, windows, host permissions) and refuses the network. Delete an extension's own copy of a Chrome stand-in.

## v0.31.2

Urgency: next round

- `app-kit/server/every` runs a job on a clock that never runs twice at once and stops with the server. Replace an app's own setInterval jobs with it.

## v0.31.1

Urgency: next round

- `age` and `useNow` say how long ago something happened in one set of words ("5m ago", "yesterday", "Oct 9"). Replace an app's own "how long ago" with them.

## v0.31.0

Urgency: rides along

- The command-line runner gives back a program's output and its errors apart (`stdout`, `stderr`) as well as together (`out`).

## v0.30.0

Urgency: next round

- `app-kit/command-line`: the `--version` line with its commit, help and wrong usage with their exit codes, color on a terminal only, opening the browser, the worktree warning, a 1Password read, and the runner for outside programs. A command-line tool replaces its own copies with it.

## v0.29.0

Urgency: now

- A server on `appServer` refuses writes other websites send. A site that must call the app with the person's cookies is listed in `appServer({ otherSites })`; check that every legitimate caller still gets through.

## v0.28.0

Urgency: next round

- One tokens file, `app-kit/look`, owns both looks' colors and sizes; the MUI themes, the extension stylesheet and the Swift pieces are built from it. An extension's pages can take the plain look's `look.css`, which `app-kit extension copy` writes. Drop an app's own copies of the colors.

## v0.27.0

Urgency: next round

- The menu bar theme draws in the plain look by default; a Swift app that wants the console look chooses it.

## v0.26.1

Urgency: rides along

- The crash screen and the not-found page draw their message in the theme's grey again.

## v0.26.0

Urgency: next round

- Every project's test start-up file is `app-kit/testing/start-up`: name it in bunfig.toml's preload and delete the project's own copy.

## v0.25.2

Urgency: rides along

- `app-kit testflight upload` works for a Tauri project in a subfolder.

## v0.25.0

Urgency: next round

- `app-kit/server/start`: `appServer({ service })` gives a health route with the commit, a request log that never prints a query, JSON errors, and `listen` stops cleanly on a redeploy. Replace a server's own start with it.

## v0.24.0

Urgency: next round

- The Swift Mac app package (`swift/mac-app`): the log, launch at login, the Dock icon while a window is open, the native messaging host, the build for About and the refresh after wake. A Swift Mac app replaces its own copies with it.

## v0.23.1

Urgency: next round

- `app-kit icons render` draws every icon an app ships (Mac, iPhone, Tauri, menu bar, extension and web) from its drawings. Replace an app's own icon script with it.

## v0.23.0

Urgency: next round

- `nameApp` and `useTitle` give each screen a page title, and `NotFound` draws at an address the app does not know, never a redirect home. Use them in place of an app's own.

## v0.22.0

Urgency: next round

- Signing out forgets the account the gate offers to continue as, and a session the server ends keeps it. Move to it; nothing else changes.

## v0.21.0

Urgency: rides along

- A menu bar row can open its page beside the list, as a menu's submenu does.

## v0.20.0

Urgency: next round

- The menu bar theme draws a light look on a Mac set to Light, and switches while open. Check a menu bar app's own colors in both.

## v0.19.0

Urgency: rides along

- The menu bar panel opens again at its top, takes rows without a name, an on-open hook and one-line header titles.
