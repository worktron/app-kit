#!/usr/bin/env bash
# The gates a landing runs: typecheck, lint, the unit tests, the web fixture app in a hidden Chromium, `app-kit web
# drive` against a page of its own test, the kit's
# WebKit kept out of the Dock and test pages' Web Audio opening no output device (web/e2e), the extension
# fixture loaded in a hidden Chromium through the extension harness, and the Rust and Swift of the iPhone notifications
# and iPhone sign-in plugins built for the iPhone simulator, the Apple Messages plugin's Rust tests, which read made-up
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
bash scripts/e2e.sh
# The Clerk browser test against the App Kit development instance, only for a change to the Clerk steps or to a Clerk
# package's version: it needs the network and a 1Password read, which no other landing should wait on.
base=$(git merge-base HEAD origin/main)
if [ -n "$(git diff --name-only "$base" HEAD -- authentication/clerk)" ] || git diff "$base" HEAD -- package.json | grep -q '^[-+].*"@clerk/'; then
  bash scripts/e2e-clerk.sh
fi
bun test ./extension/e2e/harness.e2e.ts
bun test ./web/e2e/drive.e2e.ts

# The menu bar theme: built and tested as the Swift package an Xcode app adds (Swift 6), then the bare swiftc way, as its
# own module beside an app with a Row of its own (Swift 5). Each checkout keeps its own .build.
(cd swift/menu-bar && swift build -Xswiftc -warnings-as-errors && swift test -Xswiftc -warnings-as-errors)
bash swift/menu-bar/e2e/swiftc-build.sh
# The Mac app package the same two ways: its log, launch at login, Dock icon, native host, build, refresh and runner.
(cd swift/mac-app && swift build -Xswiftc -warnings-as-errors && swift test -Xswiftc -warnings-as-errors)
bash swift/mac-app/e2e/swiftc-build.sh

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
(cd tauri/apple-messages/plugin \
  && cargo clippy --locked --quiet --all-targets -- -D warnings \
  && cargo clippy --locked --quiet --target aarch64-apple-ios-sim -- -D warnings \
  && cargo test --locked --quiet)
(cd tauri/window/plugin \
  && cargo clippy --locked --quiet --all-targets -- -D warnings \
  && cargo clippy --locked --quiet --target aarch64-apple-ios-sim -- -D warnings \
  && cargo test --locked --quiet)
