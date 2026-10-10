#!/usr/bin/env bash
# Release the desktop app.
#   ./tools/publish.sh 0.2.0
#
# Gates (any failure aborts before anything leaves this machine):
#   - version format, clean tree, on master
#   - CHANGELOG.md has a "## [0.2.0]" section
#   - npm run check is green (typecheck, lint, format, security gates, tests)
# Then: set the version, commit, tag v0.2.0, push. The tag triggers
# .github/workflows/release.yml (build every OS, upload), which then refreshes
# latest.json from the published assets. The manifest is never written before
# the files it points at exist.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

VERSION="${1:-}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: $0 <x.y.z>"
  exit 1
fi
TAG="v$VERSION"

if [[ "$(git rev-parse --abbrev-ref HEAD)" != "master" ]]; then
  echo "ERROR: releases are cut from master."
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: working tree is not clean."
  exit 1
fi
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "ERROR: tag $TAG already exists."
  exit 1
fi
if ! grep -q "^## \[$VERSION\]" CHANGELOG.md; then
  echo "ERROR: CHANGELOG.md has no \"## [$VERSION]\" section. Move the [Unreleased] notes under it first."
  exit 1
fi

echo "[1/4] Full check (typecheck, lint, format, gates, tests)…"
npm run check

echo "[2/4] Setting version $VERSION…"
node tools/update_version.mjs "$VERSION"
node tools/update_version.mjs --verify

echo "[3/4] Commit and tag…"
git add package.json package-lock.json
git commit -m "chore(release): $TAG"
git tag -a "$TAG" -m "DS5 Dongle Configurator $TAG"

echo "[4/4] Push (starts the release workflow)…"
git push origin master
git push origin "$TAG"

echo "Done. Watch: gh run watch -R MarcelineVPQ/DS5Dongle-OLED-Config-Web"
