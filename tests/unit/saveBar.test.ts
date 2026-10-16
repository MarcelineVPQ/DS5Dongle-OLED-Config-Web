// The bottom save bar shows only where its Save applies (page rule 4): the
// Controller and Pico 2 W pages (the controller view). App settings saves as
// you change it, Games and About save nothing to the board.
import { describe, expect, it } from "vitest";
import { showsSaveBar } from "../../src/desktop/saveBar";

describe("the save bar", () => {
  it("shows on the controller view (the Controller and Pico 2 W pages) only", () => {
    expect(showsSaveBar("controller")).toBe(true);
    expect(showsSaveBar("app")).toBe(false);
    expect(showsSaveBar("games")).toBe(false);
    expect(showsSaveBar("about")).toBe(false);
  });
});
