#!/usr/bin/env bash
# The gates a landing runs: typecheck, lint, the unit tests, the web fixture app in a hidden Chromium, the extension
# fixture loaded in a hidden Chromium through the extension harness, and the iPhone notifications plugin's Rust and Swift
# built for the iPhone simulator.
set -euo pipefail
cd "$(dirname "$0")/.."
bun install --frozen-lockfile >/dev/null
bun run typecheck
bun run lint
bun test
bash scripts/e2e.sh
bun test ./extension/e2e/harness.e2e.ts

# The plugin's Rust and Swift. rustup puts cargo in ~/.cargo/bin, which a plain bash, as a landing runs this, has not
# read into PATH. One build folder serves every app-kit checkout, so only the first landing builds all of Tauri; cargo
# locks it, so two landings at once take turns.
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
command -v cargo >/dev/null || { echo "gates: cargo not found; install Rust from https://rustup.rs" >&2; exit 1; }
rustup target list --installed | grep -qx aarch64-apple-ios-sim || { echo "gates: no iPhone simulator target; run: rustup target add aarch64-apple-ios-sim" >&2; exit 1; }
export CARGO_TARGET_DIR="$HOME/Library/Caches/app-kit/cargo-target"
(cd tauri/iphone-notifications/plugin && cargo build --locked --quiet --target aarch64-apple-ios-sim && cargo check --locked --quiet)
