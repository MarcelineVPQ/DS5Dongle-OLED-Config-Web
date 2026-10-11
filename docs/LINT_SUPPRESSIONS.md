# Lint Suppressions

Every rule that is weakened or suppressed, and why. Mirrors AVNetworkMonitor's `PYLINT_SUPPRESSIONS.md`. CI allows at most 1 warning (`--max-warnings=1`): lower the number when a warning is fixed, never raise it without adding a line here.

| Rule                              | Level | Where                               | Why                                                                                                                                                                                         |
| --------------------------------- | ----- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react-hooks/refs`                | warn  | (none today)                        | React Compiler advisory, kept at warn so a new case is reviewed rather than blocking; there are none now                                                                                  |
| `react-hooks/set-state-in-effect` | warn  | `useDs5Bridge.ts`                   | The auto-connect effect sets "connecting" synchronously before it awaits the device. Behavior is correct; restructuring is tracked, not urgent                                         |
| `react-hooks/purity`              | warn  | (none today)                        | React Compiler advisory, kept at warn like `refs`                                                                                                                                          |

Files excluded from linting and formatting entirely: `src/flash/picoflash/` (vendored PICOBOOT library, its own license and style).
