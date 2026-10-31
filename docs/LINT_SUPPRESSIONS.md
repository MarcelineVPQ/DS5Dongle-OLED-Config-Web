# Lint Suppressions

Every rule that is weakened or suppressed, and why. Mirrors AVNetworkMonitor's `PYLINT_SUPPRESSIONS.md`. CI allows no warning (`--max-warnings=0`); the rules below stay at warn so a new case shows up as a review item, and CI fails on it until it is fixed or listed here with the number raised (an owner decision).

| Rule                              | Level | Where                               | Why                                                                                                                                                                                         |
| --------------------------------- | ----- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react-hooks/refs`                | warn  | (none today)                        | React Compiler advisory, kept at warn so a new case is reviewed rather than blocking; there are none now                                                                                  |
| `react-hooks/set-state-in-effect` | warn  | (none today)                        | React Compiler advisory, kept at warn like `refs`; the auto-connect case it once flagged in `useDs5Bridge.ts` is gone |
| `react-hooks/purity`              | warn  | (none today)                        | React Compiler advisory, kept at warn like `refs`                                                                                                                                          |

## Inline disables

Every `eslint-disable` comment in the code, one row per rule and file. `tests/unit/lintSuppressions.test.ts` checks this table against the code both ways (a new disable needs a row here; a row whose disable is gone must go), and ESLint fails on a disable that no longer suppresses anything (`reportUnusedDisableDirectives: "error"`). Every disable names its rule.

| Rule | File | Why |
| --- | --- | --- |
| `@typescript-eslint/no-explicit-any` | `src/desktop/live/HdrGlow.tsx` | The few WebGPU calls the HDR glow makes, typed loosely instead of adding a `@webgpu/types` dependency |
| `@typescript-eslint/no-explicit-any` | `src/desktop/dev/HdrTest.tsx` | Same WebGPU shim, for the Developer HDR test page |
| `@typescript-eslint/no-require-imports` | `electron/main/games/lutris.ts` | `node:sqlite` is loaded lazily with `require`, so tests and other platforms never load it |
| `@typescript-eslint/no-require-imports` | `electron/main/games/details.ts` | Same lazy `node:sqlite` load, for Lutris game details |
| `react-hooks/exhaustive-deps` | `src/desktop/dongle/DongleConsole.tsx` | The console log effect reacts to the polled fields only; depending on the whole status object would log on every poll |

Files excluded from linting and formatting entirely: `src/flash/picoflash/` (vendored PICOBOOT library, its own license and style).
