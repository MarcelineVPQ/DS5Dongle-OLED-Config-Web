# Lint Suppressions

Every rule that is weakened or suppressed, and why. Mirrors AVNetworkMonitor's `PYLINT_SUPPRESSIONS.md`. CI allows at most 11 warnings (`--max-warnings=11`): lower the number when a warning is fixed, never raise it without adding a line here.

| Rule                              | Level | Where                               | Why                                                                                                                                                                                         |
| --------------------------------- | ----- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react-hooks/refs`                | warn  | `OledEmulator.tsx`                  | React Compiler advisory; the emulator reads animation refs during render by design. Inherited web component                                                                                |
| `react-hooks/set-state-in-effect` | warn  | `OledEmulator.tsx`, `RemapEditor.tsx`, `useDs5Bridge.ts` | Effects that start device I/O (auto-connect, reading the remap table on attach) set "busy" state synchronously before awaiting. Behavior is correct; restructuring is tracked, not urgent |
| `react-hooks/purity`              | warn  | `OledEmulator.tsx`                  | Reads the clock during render for the mock animation                                                                                                                                       |
| `react-hooks/exhaustive-deps`     | warn  | `OledEmulator.tsx:329`              | Reset-on-disconnect effect intentionally keyed on `client` identity only                                                                                                                   |

Files excluded from linting and formatting entirely: `src/flash/picoflash/` (vendored PICOBOOT library, its own license and style).
