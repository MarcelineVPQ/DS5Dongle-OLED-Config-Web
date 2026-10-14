// Developer preview (App settings -> Developer, shown with Ctrl+Shift+D):
// pretend another controller model / colorway is connected, to check the
// UI's colors (drawing, title, accent, tint) for every controller without
// owning them. Only changes what the app shows; nothing is sent to the dongle.
import { useEffect, useMemo } from "react";
import type { BridgeIdentity } from "../protocol/bridgeClient";
import { COLORWAYS } from "./live/colorways";
import { readPref, useFlagPref, usePref } from "./storage";

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

// Pretend more controllers are paired (Developer card): slots 1 and 2 hold
// these, slot 3 stays empty. Switching to one makes the app act as if that
// controller connected (drawing, colors, slot); nothing is sent to the dongle.
export const FAKE_SLOTS: Record<number, { model: "dualsense" | "edge"; colorway: string }> = {
  1: { model: "edge", colorway: "01" },
  2: { model: "dualsense", colorway: "04" },
};
const FAKE_SLOT_VALUES = ["", "1", "2"] as const;

export function useFakeSlots() {
  const [onPref, setOn] = useFlagPref("ds5.dev.fakeSlots");
  const on = DEV_TOOLS_BUILT && onPref;
  const [slot, setSlot] = usePref<(typeof FAKE_SLOT_VALUES)[number]>("ds5.dev.fakeSlot", "", FAKE_SLOT_VALUES);
  const active = on && slot !== "" ? Number(slot) : null;
  return {
    on,
    setOn: (next: boolean) => {
      setOn(next);
      if (!next) setSlot("");
    },
    // The fake slot shown as connected, or null (the real controller).
    slot: active,
    switchTo: (s: number | null) => setSlot(s === null ? "" : (String(s) as "1" | "2")),
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
export function simulatedCore1Stage(): number | undefined {
  const v = readPref(SIM_CORE1_KEY);
  return v && (SIM_CORE1_STAGES as readonly string[]).includes(v) ? Number(v) : undefined;
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
  const fake = useFakeSlots().slot;
  // The same object until something changes (effects key on it).
  return useMemo(() => {
    if (!id) return id;
    const slot = fake !== null ? FAKE_SLOTS[fake] : null;
    const base = slot ? { ...id, model: slot.model, colorwayCode: slot.colorway, currentSlot: fake! } : id;
    return !active ? base : { ...base, model: model || base.model, colorwayCode: colorway || base.colorwayCode };
  }, [id, model, colorway, active, fake]);
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
