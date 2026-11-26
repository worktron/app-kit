#!/usr/bin/env bash
# The gates a landing runs: typecheck, lint, the unit tests, the web fixture app in a hidden Chromium, `app-kit web
# drive` against a page of its own test, the kit's
# WebKit kept out of the Dock and test pages' Web Audio opening no output device (web/e2e), the extension
# fixture loaded in a hidden Chromium through the extension harness, its toolbar icon against Chrome's own Light, Dark and
# Device setting, that Chromium kept out of the Dock, and the Rust and Swift of the iPhone notifications
# and iPhone sign-in plugins built for the iPhone simulator, and the iPhone dictation and iPhone Health plugins' for the
# simulator and a phone, with their Swift rules run on the Mac, the Apple Messages plugin's Rust tests, which read made-up
# Messages and Contacts databases, and its lint, for the Mac, and the iPhone simulator it builds nothing for, with no
# warnings, and the window plugin's Rust tests and its lint, for the Mac
# and the iPhone simulator, with no warnings, since its warnings would show in every app's build, and the Swift
# packages' tests and their bare swiftc builds, the menu bar theme's and the Mac app package's, with no warnings either.
set -euo pipefail
cd "$(dirname "$0")/.."
bun install --frozen-lockfile >/dev/null
bun run typecheck
bun run lint
bun test
# Playwright's browser builds live in one folder every checkout on the Mac shares, and any project's `playwright install`
# deletes each build no checkout still on disk has registered, which only an install does. So the gates install the
# Chromium and WebKit this Playwright needs: a no-op when they are there, a download when another project's install took
# them, and this checkout registered, so no other install takes them while the browser tests run. --no-remove keeps this
# install from deleting another project's builds the same way.
echo "gates: installing any of Playwright's Chromium and WebKit that another project's install removed from the shared cache"
bunx playwright install --no-remove chromium webkit
bash scripts/e2e.sh
# The Clerk browser test against the App Kit development instance, only for a change to the Clerk steps or to a Clerk
# package's version: it needs the network and a 1Password read, which no other landing should wait on.
base=$(git merge-base HEAD origin/main)
if [ -n "$(git diff --name-only "$base" HEAD -- authentication/clerk)" ] || git diff "$base" HEAD -- package.json | grep -q '^[-+].*"@clerk/'; then
  bash scripts/e2e-clerk.sh
fi
bun test ./extension/e2e/harness.e2e.ts
bun test ./extension/e2e/toolbar-icon.e2e.ts
bun test ./extension/e2e/dock.e2e.ts
bun test ./web/e2e/drive.e2e.ts

# The menu bar theme: built and tested as the Swift package an Xcode app adds (Swift 6), then the bare swiftc way, as its
# own module beside an app with a Row of its own (Swift 5). Each checkout keeps its own .build.
(cd swift/menu-bar && swift build -Xswiftc -warnings-as-errors && swift test -Xswiftc -warnings-as-errors)
bash swift/menu-bar/e2e/swiftc-build.sh
# The Mac app package the same two ways: its log, launch at login, Dock icon, native host, build, refresh and runner.
(cd swift/mac-app && swift build -Xswiftc -warnings-as-errors && swift test -Xswiftc -warnings-as-errors)
bash swift/mac-app/e2e/swiftc-build.sh
# The window recording program, a Swift package built only by Swift's package manager, as command-line/window-recording.ts
# builds it. Its tests make no display and record nothing, so they need no Screen Recording permission.
(cd swift/window-recording && swift build -Xswiftc -warnings-as-errors && swift test -Xswiftc -warnings-as-errors)

# The iPhone notifications plugin's removal rules and its record of each keep list, apart from iOS, built the bare swiftc
# way and run on the Mac.
rules_test="$(mktemp -d)"
swiftc -warnings-as-errors tauri/iphone-notifications/plugin/ios/Sources/HandledNotifications.swift tauri/iphone-notifications/plugin/ios/Sources/KeepRecord.swift tauri/iphone-notifications/plugin/ios/Tests/main.swift -o "$rules_test/rules"
"$rules_test/rules"
rm -rf "$rules_test"
# The iPhone dictation plugin's rules for settling words and for each start's token, the same way.
dictation_test="$(mktemp -d)"
swiftc -warnings-as-errors tauri/iphone-dictation/plugin/ios/Sources/DictationRules.swift tauri/iphone-dictation/plugin/ios/Tests/main.swift -o "$dictation_test/rules"
"$dictation_test/rules"
rm -rf "$dictation_test"
# The iPhone Health plugin's rules for when to send, what to keep and how every wake is answered, the same way.
health_test="$(mktemp -d)"
swiftc -warnings-as-errors tauri/iphone-health/plugin/ios/Sources/HealthSync.swift tauri/iphone-health/plugin/ios/Tests/main.swift -o "$health_test/rules"
"$health_test/rules"
rm -rf "$health_test"

# The plugins' Rust and Swift. rustup puts cargo in ~/.cargo/bin, which a plain bash, as a landing runs this, has not
# read into PATH. One build folder serves every app-kit checkout, so only the first landing builds all of Tauri; cargo
# locks it, so two landings at once take turns.
# The build for the simulator compiles the Swift too: the plugin's build script hands ios/ to swift-rs, which runs
# Xcode's Swift build and fails the cargo build on a Swift error.
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
command -v cargo >/dev/null || { echo "gates: cargo not found; install Rust from https://rustup.rs" >&2; exit 1; }
rustup target list --installed | grep -qx aarch64-apple-ios-sim || { echo "gates: no iPhone simulator target; run: rustup target add aarch64-apple-ios-sim" >&2; exit 1; }
export CARGO_TARGET_DIR="$HOME/Library/Caches/app-kit/cargo-target"
for plugin in tauri/iphone-notifications/plugin tauri/iphone-sign-in/plugin; do
  (cd "$plugin" && cargo build --locked --quiet --target aarch64-apple-ios-sim && cargo check --locked --quiet)
done
# The dictation plugin's Swift is one thing on a phone, Apple's recognizer, and another on the Simulator, its stand-in,
# and the Health plugin's has the Simulator's made-up nights, so each is built for both, and linted for both and the
# Mac, with no warnings.
rustup target list --installed | grep -qx aarch64-apple-ios || { echo "gates: no iPhone target; run: rustup target add aarch64-apple-ios" >&2; exit 1; }
for plugin in tauri/iphone-dictation/plugin tauri/iphone-health/plugin; do
  (cd "$plugin" \
    && cargo build --locked --quiet --target aarch64-apple-ios-sim \
    && cargo build --locked --quiet --target aarch64-apple-ios \
    && cargo clippy --locked --quiet --all-targets -- -D warnings \
    && cargo clippy --locked --quiet --target aarch64-apple-ios -- -D warnings \
    && cargo clippy --locked --quiet --target aarch64-apple-ios-sim -- -D warnings)
done
(cd tauri/apple-messages/plugin \
  && cargo clippy --locked --quiet --all-targets -- -D warnings \
  && cargo clippy --locked --quiet --target aarch64-apple-ios-sim -- -D warnings \
  && cargo test --locked --quiet)
(cd tauri/window/plugin \
  && cargo clippy --locked --quiet --all-targets -- -D warnings \
  && cargo clippy --locked --quiet --target aarch64-apple-ios-sim -- -D warnings \
  && cargo test --locked --quiet)
