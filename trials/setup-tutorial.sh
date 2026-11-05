#!/usr/bin/env bash
# Adds the trial files to ../playwright-tutorial, and installs a packed build.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
tutorial="${TUTORIAL:-$repo/../playwright-tutorial}"

cp -R "$repo/trials/tutorial/." "$tutorial/"
(cd "$repo/playwright-intent" && pnpm build && pnpm pack --pack-destination "$tutorial")

cd "$tutorial"
rm -rf node_modules/playwright-intent
pnpm add -D ./playwright-intent-0.0.1.tgz ai@^7.0.163
