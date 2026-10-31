// The app's board table is the firmware repo's boards.json (DESIGN_FIRMWARE_IDENTITY
// §5, step 8): same rows, order and values for every field the app reads. The
// firmware file is read only when DS5_FIRMWARE_REPO names its checkout (a
// checkout next to this one may be on any branch; tools/doc_gates.mjs's rule).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOARDS, boardIdentity, FW_BOARD_TYPES, IMAGE_NEEDS, PICO2_W_IMAGE } from "../../src/update/boardIdentity";
import { boardSpecs } from "../../src/desktop/dongle/boardSpecs";

const fwFile = process.env.DS5_FIRMWARE_REPO ? join(process.env.DS5_FIRMWARE_REPO, "boards.json") : null;

describe("the board table", () => {
  it.skipIf(!fwFile || !existsSync(fwFile))("matches the firmware repo's boards.json", () => {
    const rows = (JSON.parse(readFileSync(fwFile!, "utf8")) as { boards: Record<string, unknown>[] }).boards;
    const fields = Object.keys(BOARDS[0]);
    expect(BOARDS).toEqual(rows.map((r) => Object.fromEntries(fields.map((f) => [f, r[f]]))));
  });

  it("every table derived from it names the same boards", () => {
    const ids = BOARDS.map((b) => b.id);
    expect(Object.values(FW_BOARD_TYPES)).toEqual(ids);
    expect(Object.keys(IMAGE_NEEDS)).toEqual(ids);
    expect(PICO2_W_IMAGE).toEqual({ board: "pico2_w", chip: "rp2350a", flash_min: 4 * 1024 * 1024, personas: ["ds5"], displays: ["none", "pico_oled_1_3"] });
    for (const b of BOARDS) {
      expect(boardIdentity({ boardName: b.name, protoMinor: 20 })?.board).toBe(b.id);
      expect(boardSpecs(b.name)?.flashMb).toBe(b.flash_bytes / (1024 * 1024));
    }
  });
});
