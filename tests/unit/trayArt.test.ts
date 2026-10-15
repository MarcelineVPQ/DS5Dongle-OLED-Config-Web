// @vitest-environment jsdom
// Cache pass batch 3: a failed decode of the tray art isn't kept, so the next
// redraw tries again (it used to leave the tray icon blank for the session).
import { afterEach, describe, expect, it, vi } from "vitest";
import { trayArt } from "../../src/desktop/tray/trayIcon";

afterEach(() => vi.unstubAllGlobals());

describe("the tray art", () => {
  it("is decoded again after a failed decode, then kept", async () => {
    let fail = true;
    const decodes = vi.fn(async () => {
      if (fail) throw new Error("decode failed");
    });
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        decode = decodes;
      },
    );
    const bitmap = {} as ImageBitmap;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => bitmap),
    );
    await expect(trayArt()).rejects.toThrow("decode failed");
    fail = false;
    await expect(trayArt()).resolves.toBe(bitmap);
    await expect(trayArt()).resolves.toBe(bitmap);
    expect(decodes).toHaveBeenCalledTimes(2);
  });
});
