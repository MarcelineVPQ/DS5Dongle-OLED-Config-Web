// Developer preview (App settings -> Developer, shown with Ctrl+Shift+D):
// pretend another controller model / colorway is connected, to check the
// UI's colors (drawing, title, accent, tint) for every controller without
// owning them. Only changes what the app shows; nothing is sent to the dongle.
import { useEffect } from "react";
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

export function useDevPreview() {
  const [model, setModel] = usePref<DevModel>("ds5.dev.model", "", DEV_MODELS);
  const [colorway, setColorway] = usePref<string>("ds5.dev.colorway", "", COLORWAY_CODES);
  return { model, setModel, colorway, setColorway, active: model !== "" || colorway !== "" };
}

// The identity as the UI should see it: the real one, with the preview's
// model / colorway in place while the developer preview is set.
export function useShownIdentity<T extends BridgeIdentity | null | undefined>(id: T): T {
  const { model, colorway, active } = useDevPreview();
  if (!id || !active) return id;
  return { ...id, model: model || id.model, colorwayCode: colorway || id.colorwayCode };
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
