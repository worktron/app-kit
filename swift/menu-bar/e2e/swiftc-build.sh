#!/usr/bin/env bash
# The bare swiftc route an app without Xcode or a Swift package takes (README.md, "Menu bar theme"): the theme built as a
# static module of its own, in Swift 5 mode as swiftc builds by default, then an app that imports it and has a Row of
# its own, run with the fonts copied beside it. Fails on any error or warning, or when the fonts do not load.
set -euo pipefail
cd "$(dirname "$0")/.."
out=.build/swiftc
rm -rf "$out"
mkdir -p "$out/Fonts"
log="$out/swiftc.log"
swiftc -parse-as-library -emit-library -static -emit-module -module-name MenuBarTheme \
  -emit-module-path "$out/MenuBarTheme.swiftmodule" -o "$out/libMenuBarTheme.a" Sources/MenuBarTheme/*.swift 2>"$log"
swiftc -I "$out" -L "$out" -lMenuBarTheme e2e/swiftc-app.swift -o "$out/app" 2>>"$log"
if grep -q 'warning:' "$log"; then cat "$log" >&2; exit 1; fi
cp Sources/MenuBarTheme/Fonts/*.ttf "$out/Fonts/"
"$out/app" "$out/screen.png"
