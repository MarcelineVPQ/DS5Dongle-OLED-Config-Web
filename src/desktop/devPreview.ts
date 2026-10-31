// Developer preview (App settings -> Developer, shown with Ctrl+Shift+D):
// pretend another controller model / colorway is connected, to check the
// UI's colors (drawing, title, accent, tint) for every controller without
// owning them. Only changes what the app shows; nothing is sent to the dongle.
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { BridgeIdentity } from "../protocol/bridgeClient";
import { DEFAULT_SIM_BOARD_ID, SIM_BOARD_FAULTS, SIM_FLASH_SPEEDS, SimulatedBoard, type SimBoardFault, type SimBoardState, type SimFlashSpeed } from "../protocol/simulatedBoard";
import { SimulatedDongle } from "../protocol/simulatedDongle";
import { COLORWAYS } from "./live/colorways";
import { readPref, useFlagPref, usePref, writePref } from "./storage";

export const DEV_TOOLS_KEY = "ds5.devTools";
// Built into dev builds only (electron.vite.config.ts). Without it every
// preview below is inert, so settings left over from a dev build can never
// change what a stable release shows.
export const DEV_TOOLS_BUILT = import.meta.env.VITE_DEV_TOOLS === "1";
export const DEV_MODELS = ["", "dualsense", "edge"] as const;
export type DevModel = (typeof DEV_MODELS)[number];
// The DualSense Edge comes in White and Midnight Black; the DualSense in all.
export const MODEL_COLORWAYS: Record<"dualsense" | "edge", string[]> = {
  dualsense: Object.keys(COLORWAYS),
  edge: ["00", "01"],
};
const COLORWAY_CODES = ["", ...Object.keys(COLORWAYS)];

// Pretend more controllers are paired (Developer card): these, in this order,
// fill the board's first empty slots (by slot number); with fewer empty slots
// only as many show as fit, and they move when the real slots change.
// Switching to one makes the app act as if that controller connected
// (drawing, colors, slot); nothing is sent to the dongle.
export const FAKE_CONTROLLERS = [
  { id: "edge-01", model: "edge", colorway: "01" },
  { id: "dualsense-04", model: "dualsense", colorway: "04" },
] as const;
export type FakeController = (typeof FAKE_CONTROLLERS)[number];
// The selected fake by its id ("" = the real controller). Older builds stored
// a slot number ("1"/"2"): not in this list, so it reads as "" (the real one).
const FAKE_PICK_VALUES = ["", ...FAKE_CONTROLLERS.map((f) => f.id)] as readonly ("" | FakeController["id"])[];

// Which fake each slot shows (undefined = none): the fakes in order into the
// empty slots in slot order. The one placement rule: the Pairing slots
// table, the shown identity's slot and switching all read it.
export function placeFakes(occupied: readonly boolean[] | null): (FakeController | undefined)[] {
  // loop: HOT-PATH-OK — N = 4 slots; once per slot-occupancy change (memoized by useFakeSlots)
  const placed: (FakeController | undefined)[] = (occupied ?? []).map(() => undefined);
  let next = 0;
  // loop: HOT-PATH-OK — N = 4 slots; once per slot-occupancy change (memoized by useFakeSlots)
  occupied?.forEach((taken, slot) => {
    if (!taken && next < FAKE_CONTROLLERS.length) placed[slot] = FAKE_CONTROLLERS[next++];
  });
  return placed;
}

// The board's real slot occupancy, as Pairing slots last read it (null until
// read): where the fakes go. Only kept in dev builds.
// cache: OK — key=none (the board's slot occupancy); invalidated=replaced on every Pairing slots poll that differs; bound=1 entry (4 flags)
let slotOccupancy: readonly boolean[] | null = null;
const occupancyListeners = new Set<() => void>();
export function noteSlotOccupancy(occupied: readonly boolean[]): void {
  if (!DEV_TOOLS_BUILT) return;
  // loop: HOT-PATH-OK — N = 4 slots; per 1.5 s slot poll
  if (slotOccupancy && slotOccupancy.length === occupied.length && slotOccupancy.every((v, i) => v === occupied[i])) return;
  slotOccupancy = [...occupied];
  occupancyListeners.forEach((l) => l());
}
const onOccupancy = (l: () => void) => {
  occupancyListeners.add(l);
  return () => occupancyListeners.delete(l);
};

export function useFakeSlots() {
  const [onPref, setOn] = useFlagPref("ds5.dev.fakeSlots");
  const on = DEV_TOOLS_BUILT && onPref;
  const [pick, setPick] = usePref("ds5.dev.fakeSlot", "", FAKE_PICK_VALUES);
  const occupied = useSyncExternalStore(onOccupancy, () => slotOccupancy);
  const placed = useMemo(() => (on ? placeFakes(occupied) : []), [on, occupied]);
  // The selected fake's slot (null = not selected, or no empty slot for it).
  // loop: HOT-PATH-OK — N = 4 slots; per render of the few views that read the fakes
  const at = pick === "" ? -1 : placed.findIndex((f) => f?.id === pick);
  return {
    on,
    setOn: (next: boolean) => {
      setOn(next);
      if (!next) setPick("");
    },
    // Which fake each slot shows (indexed by slot; undefined = none).
    placed,
    // The fake shown as connected and its slot, or null (the real controller).
    shown: at >= 0 ? { fake: placed[at]!, slot: at } : null,
    switchTo: (fake: FakeController | null) => setPick(fake ? fake.id : ""),
  };
}

// Dev builds: the app talks to a simulated dongle instead of USB (Developer
// card). For the Windows VM, so it needs no real dongle passed through.
export const SIMULATED_KEY = "ds5.dev.simulated";
export const simulatedDongleOn = (): boolean => DEV_TOOLS_BUILT && readPref(SIMULATED_KEY) === "1";
// The simulated dongle's core1 stuck at a start-up stage ("" = runs normally;
// "0".."8", firmware audio.cpp), to see the dashboard's "Core1 stopped" notice.
export const SIM_CORE1_KEY = "ds5.dev.simCore1Stage";
export const SIM_CORE1_STAGES = ["", "0", "1", "2", "3", "4", "5", "6", "7", "8"] as const;
// The simulated controller put down (see SimulatedDongleOptions.rest):
// "still" or "noise"; anything else moves on its own. Set by hand or by a
// measuring script (no Developer card control).
export const SIM_REST_KEY = "ds5.dev.simRest";
export function simulatedRest(): "still" | "noise" | undefined {
  const v = readPref(SIM_REST_KEY);
  return v === "still" || v === "noise" ? v : undefined;
}
export function simulatedCore1Stage(): number | undefined {
  const v = readPref(SIM_CORE1_KEY);
  return v && (SIM_CORE1_STAGES as readonly string[]).includes(v) ? Number(v) : undefined;
}

// The simulated board's USB side (protocol/simulatedBoard.ts): running the
// firmware, in BOOTSEL, a blank Pico, or off USB; the firmware version it
// runs, kept across its restarts and the app's (like the other simulated
// state); and the Developer card's failure and speed for firmware updates.
export const SIM_BOARD_KEY = "ds5.dev.simBoard";
export const SIM_VERSION_KEY = "ds5.dev.simVersion"; // "" = nothing in flash (a blank Pico)
export const SIM_FAULT_KEY = "ds5.dev.simFault";
export const SIM_SPEED_KEY = "ds5.dev.simSpeed";
const SIM_STATES: readonly SimBoardState[] = ["dongle", "bootsel", "away"];
const SIM_SPEEDS = Object.keys(SIM_FLASH_SPEEDS) as SimFlashSpeed[];
const pick = <T extends string>(key: string, allowed: readonly T[]): T | undefined => {
  const v = readPref(key);
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
};
// cache: OK — key=none (one simulated board per page load); invalidated=never (the Developer card's switch reloads the page); bound=1 board
let simBoard: SimulatedBoard | null = null;
// The simulated board, in dev builds with "Simulate the board" on; else null.
export function simulatedBoard(): SimulatedBoard | null {
  if (!simulatedDongleOn()) return null;
  if (simBoard) return simBoard;
  const version = readPref(SIM_VERSION_KEY);
  const board = new SimulatedBoard({
    state: pick(SIM_BOARD_KEY, SIM_STATES),
    version: version === "" ? null : (version ?? undefined),
    fault: pick(SIM_FAULT_KEY, SIM_BOARD_FAULTS),
    speed: pick(SIM_SPEED_KEY, SIM_SPEEDS),
    dongle: { live: true, protoMinor: 21, boardId: DEFAULT_SIM_BOARD_ID, core1StuckStage: simulatedCore1Stage(), rest: simulatedRest() },
  });
  // lifetime: NOT-WORTH — one listener on the one board per page load: keeps its state across restarts
  board.onChange(() => {
    writePref(SIM_BOARD_KEY, board.state);
    writePref(SIM_VERSION_KEY, board.version ?? "");
  });
  simBoard = board;
  return board;
}

// More simulated boards beside it (Developer card, 0..19), to see the rail's
// board stack with many boards. Each has its own board id; every other one
// has the first board's USB serial, as boards paired to the same DualSense
// do (the serial is the controller's MAC). They run the firmware only (no
// BOOTSEL / update), and show up after the next page load.
export const SIM_EXTRA_KEY = "ds5.dev.simExtraBoards";
export const SIM_EXTRA_COUNTS = Array.from({ length: 20 }, (_, i) => String(i));
export const simBoardId = (n: number): string => `E66141030000${n.toString(16).padStart(4, "0")}`.toUpperCase();
// cache: OK — key=none (the extra simulated boards per page load); invalidated=never (the count applies at the next load); bound=19 boards
let simExtras: SimulatedDongle[] | null = null;
export function extraSimulatedBoards(): readonly SimulatedDongle[] {
  if (!simulatedDongleOn()) return [];
  if (simExtras) return simExtras;
  const n = Number(pick(SIM_EXTRA_KEY, SIM_EXTRA_COUNTS) ?? "0");
  simExtras = Array.from(
    { length: n },
    (_, i) =>
      new SimulatedDongle({ live: true, protoMinor: 21, boardId: simBoardId(i + 1), serial: i % 2 === 0 ? DEFAULT_SIM_BOARD_ID : simBoardId(i + 1), version: "v0.9.5-dev.19-oled-edition+simulated" }),
  );
  return simExtras;
}

// The Developer card's view of the simulated board.
export type SimBoardShown = SimBoardState | "blank";
export function useSimulatedBoard() {
  const board = simulatedBoard();
  // lifetime: OK — useSyncExternalStore calls the returned unsubscribe (unmount)
  const subscribe = useCallback((l: () => void) => board?.onChange(l) ?? (() => undefined), [board]);
  const shown = useSyncExternalStore(subscribe, () => (board ? `${board.state === "bootsel" && board.version === null ? "blank" : board.state}|${board.version ?? ""}` : ""));
  const [fault, setFault] = usePref<SimBoardFault>(SIM_FAULT_KEY, "", SIM_BOARD_FAULTS);
  const [speed, setSpeed] = usePref<SimFlashSpeed>(SIM_SPEED_KEY, "normal", SIM_SPEEDS);
  const [state, version] = shown.split("|");
  return {
    board,
    state: state as SimBoardShown,
    version: version || null,
    set: (next: SimBoardShown) => board?.set(next),
    fault,
    setFault: (next: SimBoardFault) => {
      setFault(next);
      board?.configure({ fault: next });
    },
    speed,
    setSpeed: (next: SimFlashSpeed) => {
      setSpeed(next);
      board?.configure({ speed: next });
    },
  };
}

export function useDevPreview() {
  const [model, setModel] = usePref<DevModel>("ds5.dev.model", "", DEV_MODELS);
  const [colorway, setColorway] = usePref<string>("ds5.dev.colorway", "", COLORWAY_CODES);
  return { model, setModel, colorway, setColorway, active: DEV_TOOLS_BUILT && (model !== "" || colorway !== "") };
}

// The identity as the UI should see it: the real one, with the preview's
// model / colorway in place while the developer preview is set.
export function useShownIdentity<T extends BridgeIdentity | null | undefined>(id: T): T {
  const { model, colorway, active } = useDevPreview();
  const fake = useFakeSlots().shown;
  const fakeSlot = fake?.slot ?? null;
  const fakeCtl = fake?.fake ?? null;
  // The same object until something changes (effects key on it).
  return useMemo(() => {
    if (!id) return id;
    const base = fakeCtl ? { ...id, model: fakeCtl.model, colorwayCode: fakeCtl.colorway, currentSlot: fakeSlot! } : id;
    return !active ? base : { ...base, model: model || base.model, colorwayCode: colorway || base.colorwayCode };
  }, [id, model, colorway, active, fakeCtl, fakeSlot]);
}

// Whether the Developer card shows: on by default in dev builds (Ctrl+Shift+D
// hides it), never in stable releases.
export function useDevToolsShown(): [boolean, (on: boolean) => void] {
  const [value, set] = usePref<"1" | "0">(DEV_TOOLS_KEY, "1", ["1", "0"]);
  return [DEV_TOOLS_BUILT && value === "1", (on: boolean) => set(on ? "1" : "0")];
}

// Ctrl+Shift+D shows / hides the Developer card.
export function useDevToolsShortcut(): void {
  const [on, setOn] = useDevToolsShown();
  // lifetime: OK — cleanup: removes the Ctrl+Shift+D keydown listener
  useEffect(() => {
    if (!DEV_TOOLS_BUILT) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setOn(!on);
      }
    };
    // lifetime: OK — removed in the effect cleanup
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on, setOn]);
}
