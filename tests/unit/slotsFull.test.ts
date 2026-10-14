// Pairing slots says when every slot is taken (the board then won't pair a
// new controller): from the board's real occupancy only, never the
// Developer card's pretend controllers.
import { describe, expect, it } from "vitest";
import { allSlotsTaken } from "../../src/protocol/bridgeClient";
import { placeFakes } from "../../src/desktop/devPreview";

const slots = (occupied: boolean[]) => ({ occupied, addrs: occupied.map(() => new Uint8Array(6)) });

describe("allSlotsTaken", () => {
  it("is true when every slot holds a controller", () => {
    expect(allSlotsTaken(slots([true, true, true, true]))).toBe(true);
  });
  it("is false with one slot free", () => {
    expect(allSlotsTaken(slots([true, true, false, true]))).toBe(false);
  });
  it("ignores the pretend controllers filling the free slots", () => {
    const occupied = [true, false, true, false];
    // The fakes take both free slots in the table...
    expect(placeFakes(occupied).filter(Boolean)).toHaveLength(2);
    // ...but the board still has room.
    expect(allSlotsTaken(slots(occupied))).toBe(false);
  });
});
