#!/usr/bin/env bash
# The bare swiftc route an app without Xcode or a Swift package takes (README.md, "Mac app"): the package built as a
# static module of its own, in Swift 5 mode as swiftc builds by default, then an app that imports it and has a Program
# of its own, run in a folder of the build's. Then the module again against a macOS 26 SDK at its macOS 14 floor, as a
# Mac that has not moved to macOS 27 builds it. Fails on any error or warning, when the app finds anything wrong, or
# when no macOS 26 SDK is there to build against.
set -euo pipefail
cd "$(dirname "$0")/.."
out=.build/swiftc
rm -rf "$out"
mkdir -p "$out/run"
log="$out/swiftc.log"
swiftc -parse-as-library -emit-library -static -emit-module -module-name MacApp \
  -emit-module-path "$out/MacApp.swiftmodule" -o "$out/libMacApp.a" Sources/MacApp/*.swift 2>"$log" \
  || { cat "$log" >&2; exit 1; }
swiftc -I "$out" -L "$out" -lMacApp e2e/swiftc-app.swift -o "$out/app" 2>>"$log" || { cat "$log" >&2; exit 1; }
# The Command Line Tools keep earlier SDKs beside the current one; the newest of the 26 ones stands for an older Mac's.
older=$(ls -d /Library/Developer/CommandLineTools/SDKs/MacOSX26.*.sdk 2>/dev/null | sort -V | tail -1 || true)
[ -n "$older" ] || { echo "swiftc-build: no macOS 26 SDK in /Library/Developer/CommandLineTools/SDKs; install the Command Line Tools (xcode-select --install)" >&2; exit 1; }
swiftc -sdk "$older" -target "$(uname -m)-apple-macosx14.0" -parse-as-library -emit-library -static -module-name MacApp \
  -o "$out/libMacApp-older-sdk.a" Sources/MacApp/*.swift 2>>"$log" \
  || { echo "swiftc-build: the package does not build against $older" >&2; cat "$log" >&2; exit 1; }
if grep -q 'warning:' "$log"; then cat "$log" >&2; exit 1; fi
"$out/app" "$out/run"
