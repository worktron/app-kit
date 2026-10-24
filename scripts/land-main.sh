#!/usr/bin/env bash
# Lands this branch on main and releases it (scripts/land.ts says how); /metamax:land runs this file.
exec bun "$(dirname "$0")/land.ts" "$@"
