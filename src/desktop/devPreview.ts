// Developer preview (App settings -> Developer, shown with Ctrl+Shift+D):
// pretend another controller model / colorway is connected, to check the
// UI's colors (drawing, title, accent, tint) for every controller without
// owning them. Only changes what the app shows; nothing is sent to the dongle.
import { useEffect, useMemo } from "react";
import type { BridgeIdentity } from "../protocol/bridgeClient";
import { COLORWAYS } from "./live/colorways";
import { useFlagPref, usePref } from "./storage";

export const DEV_TOOLS_KEY = "ds5.devTools";
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
  const [on, setOn] = useFlagPref("ds5.dev.fakeSlots");
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

export function useDevPreview() {
  const [model, setModel] = usePref<DevModel>("ds5.dev.model", "", DEV_MODELS);
  const [colorway, setColorway] = usePref<string>("ds5.dev.colorway", "", COLORWAY_CODES);
  return { model, setModel, colorway, setColorway, active: model !== "" || colorway !== "" };
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

// Ctrl+Shift+D shows / hides the Developer card.
export function useDevToolsShortcut(): void {
  const [on, setOn] = useFlagPref(DEV_TOOLS_KEY);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setOn(!on);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on, setOn]);
}
