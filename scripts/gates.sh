#!/usr/bin/env bash
# The gates a landing runs: typecheck, lint, the unit tests, the web fixture app in a hidden Chromium, the kit's
# WebKit kept out of the Dock and test pages' Web Audio opening no output device (web/e2e), the extension
# fixture loaded in a hidden Chromium through the extension harness, and the Rust and Swift of the iPhone notifications
# and iPhone sign-in plugins built for the iPhone simulator, and the window plugin's Rust tests and its lint, for the Mac
# and the iPhone simulator, with no warnings, since its warnings would show in every app's build.
set -euo pipefail
cd "$(dirname "$0")/.."
bun install --frozen-lockfile >/dev/null
bun run typecheck
bun run lint
bun test
bash scripts/e2e.sh
bun test ./extension/e2e/harness.e2e.ts

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
(cd tauri/window/plugin \
  && cargo clippy --locked --quiet --all-targets -- -D warnings \
  && cargo clippy --locked --quiet --target aarch64-apple-ios-sim -- -D warnings \
  && cargo test --locked --quiet)
