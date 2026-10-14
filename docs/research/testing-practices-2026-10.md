# Testing practices: what we do, and what professional teams also do

*2026-10-14. Marcy's reference list. Her picks to start with, in order:
**2 sanitizers → 1 fuzzing → 4 performance budgets → 5 accessibility**.*

## Already in place

- Unit and integration tests (app, Vitest); firmware host tests.
- CI on Linux, Windows and macOS.
- Typecheck and lint.
- Security gates (Electron security, DOM sinks).
- Theme-colour, duplicate and identical-file gates.
- The UI checker (screenshots, gated to releases).
- Translation fit; the firmware RAM-residency and XIP checks.
- The **loop pass** (`tools/list_loops.*`), **cache pass** (`tools/list_caches.mjs`) and **lifetime pass** (`tools/list_lifetimes.*`), each with a CI gate, plus the leak test.

## Not yet: most valuable for this project first

1. **Fuzzing protocol parsers.** Millions of random or broken inputs into everything that reads bytes: the board's command handler (0xF7 and friends), HID input and output reports, the config body, and the app's VDF/JSON/YAML parsers. Finds crashes and memory errors before a strange controller or game does.
2. **Sanitizers + static analysis for the firmware host tests.** AddressSanitizer and UndefinedBehaviorSanitizer catch buffer overflows and undefined behaviour at test time; add clang-tidy or cppcheck. Cheap and very effective.
3. **Hardware-in-the-loop.** A second Pico 2 W on a small test machine: CI flashes it and checks protocol, identity, audio counters and connect behaviour. Catches what no simulator can, like the 6.7 % too-fast voice reports.
4. **Performance budgets in CI.** Measure startup time, memory, CPU on the controller page and frame time, and fail CI when one gets worse by more than X %.
5. **Automated accessibility checks** (axe-core): contrast, labels, keyboard navigation and screen-reader names on every page, in every theme.
6. **Coverage, then mutation testing.** First which code no test touches; then mutation testing (e.g. Stryker) plants small bugs to check that the tests notice.
7. **Visual regression.** Per-page, per-theme screenshots compared pixel by pixel with the last approved ones.
8. **Soak tests.** App and board running for hours with reconnects, sleep and game starts, measuring memory growth and audio dropouts.
9. **Upgrade tests.** Old settings, old firmware, old profiles and old configs loaded into the new version, both ways.
10. **Install tests per OS.** CI installs and launches the finished AppImage, exe and dmg.
