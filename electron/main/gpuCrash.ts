// When a GPU crash turns hardware acceleration off (bug hunt A4, 0.9.5: one
// crash turned it off for good, without a word). Chromium restarts a crashed
// GPU process, and a single crash (a driver update, a suspend) says little;
// a second one in the same run means hardware rendering isn't safe on this
// PC. No electron import, so the rule is tested (tests/unit/gpuCrash.test.ts).

// The crashes in one run that turn it off.
export const GPU_CRASHES_TO_TURN_OFF = 2;

export interface ProcessGone {
  type: string;
  // error: NOT-WORTH — Electron's child-process-gone reason, read to tell a crash from a clean exit; not a failure this code returns
  reason: string;
}

// Called for every child-process-gone; `turnOff` runs on the second real GPU
// crash of this run while `on()` (hardware acceleration still on).
export function gpuCrashWatcher(on: () => boolean, turnOff: () => void): (details: ProcessGone) => void {
  let crashes = 0;
  return (details) => {
    if (details.type !== "GPU" || details.reason === "clean-exit" || details.reason === "killed") return;
    if (!on()) return;
    crashes++;
    if (crashes < GPU_CRASHES_TO_TURN_OFF) {
      console.warn(`[gpu] GPU process gone (${details.reason}); Chromium restarts it (a second crash in this run turns hardware acceleration off)`);
      return;
    }
    console.warn(`[gpu] GPU process gone again (${details.reason}); software rendering from the next start`);
    turnOff();
  };
}
