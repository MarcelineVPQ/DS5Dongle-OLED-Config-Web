<!-- Thank you! One focused change per pull request. docs/CONTRIBUTING.md has the details. -->

## What this changes

<!-- What it does and why, in a few lines. Link the issue if there is one (Fixes #123). -->

## How it was checked

- [ ] `npm run check` passes (typecheck, lint, format check, gates, tests) and `pre-commit run --all-files` is clean
- [ ] A fix comes with a test that fails without it
- [ ] User-facing strings are in all 7 languages (`src/i18n/locales/`) and use the wording in `docs/GLOSSARY.md` (the board is "your board" / the `{{device}}` variables, never "dongle")
- [ ] User-facing change: a `CHANGELOG.md` entry under `[Unreleased]`
- [ ] Protocol change: the firmware's protocol section and `PICO_PROTO_MINOR` / `MAJOR` follow
- [ ] Security-relevant change (window, session, IPC, CSP, device allowlist, updater): `docs/SECURITY_AUDIT.md` and `tests/security/` updated

## Systems tried

<!-- Linux (distribution, desktop) / Windows / macOS, the board and its firmware version, DualSense or DualSense Edge. -->

By opening this pull request you agree that your contribution is released under this repository's license (LICENSE).
