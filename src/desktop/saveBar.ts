// Where the bottom save bar shows (page rule 4, CLAUDE.md "Page rules"):
// only on the pages whose settings it saves, the Controller page and the
// Pico 2 W page (both are the controller view). App settings (this PC's
// settings, saved as you change them), Games and About save nothing to the
// board, so they have no bar.
export type MainView = "controller" | "games" | "app" | "about";

export const showsSaveBar = (main: MainView): boolean => main === "controller";
