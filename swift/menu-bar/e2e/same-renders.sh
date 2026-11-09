#!/usr/bin/env bash
# Renders every sample screen of the menu bar theme on <base> (from git archive, so no worktree is made) and on the
# checkout it is run from, in dark and light and in both looks, and compares the PNGs of the screens <base> has, byte
# for byte. Usage: bash swift/menu-bar/e2e/same-renders.sh <base>, run from the checkout's root, after a change that must leave the existing screens as they were. Exits 1 when any differs.
set -euo pipefail
base=$1
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git archive "$base" swift/menu-bar | tar -x -C "$work"
render() {
  for a in dark light; do for l in plain console; do
    (cd "$1/swift/menu-bar" && swift run -q menu-bar-snapshots render "$2/$a-$l" "$a" "$l" >/dev/null)
  done; done
}
render "$work" "$work/before"
render "$PWD" "$work/after"
same=0; differs=0
for f in "$work"/before/*/*.png; do
  rel=${f#"$work/before/"}
  if cmp -s "$f" "$work/after/$rel"; then same=$((same + 1)); else differs=$((differs + 1)); echo "differs: $rel"; fi
done
echo "$same of $((same + differs)) existing sample renders identical to $base"
[ "$differs" -eq 0 ]
