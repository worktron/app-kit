# Changes

What an app does when it moves to each version, newest first, written by the landing from each change's Urgency and Apps lines. A version not listed asks nothing of an app. Urgency says how soon apps take it: now (app-kit's apps round starts the upgrades that day), next round (the Monday round) or rides along (the app's next upgrade).

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
