import { describe, expect, it } from "vitest";
import { previewUpdates } from "../../src/desktop/updatePreview";
import type { FirmwareUpdate } from "../../src/desktop/useUpdates";

const fw = {
  latest: null,
  problem: null,
  available: false,
  backToStable: false,
  state: { phase: "idle" },
  start: async () => undefined,
  refreshLatest: async () => ({ latest: null, problem: null }),
  dismiss: () => undefined,
} as FirmwareUpdate;

describe("previewUpdates", () => {
  it("changes nothing when off", () => {
    const app = { phase: "idle" } as const;
    const [a, f] = previewUpdates("", app, fw);
    expect(a).toBe(app);
    expect(f).toBe(fw);
  });
  it("shows each state without being able to flash", async () => {
    expect(previewUpdates("available", { phase: "idle" }, fw)[1].available).toBe(true);
    expect(previewUpdates("progress", { phase: "idle" }, fw)[1].state.phase).toBe("running");
    expect(previewUpdates("ready", { phase: "idle" }, fw)[0].phase).toBe("ready");
    const [, offered] = previewUpdates("available", { phase: "idle" }, { ...fw, start: async () => Promise.reject(new Error("must not run")) });
    await expect(offered.start()).resolves.toBeUndefined();
  });
});
