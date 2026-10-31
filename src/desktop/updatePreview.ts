// Developer preview of the update states (App settings -> Developer, and
// tools/check_layout.mjs): shows an app update and a firmware update as
// available, in progress or ready, so every banner and button can be seen and
// checked without a real update. Only changes what the app shows: nothing is
// downloaded or flashed, and the firmware Update button does nothing.
import type { UpdateState } from "./api";
import { DEV_TOOLS_BUILT } from "./devPreview";
import { usePref } from "./storage";
import type { FirmwareUpdate } from "./useUpdates";

export const UPDATE_PREVIEW_KEY = "ds5.dev.updates";
export const UPDATE_PREVIEWS = ["", "available", "progress", "ready"] as const;
export type UpdatePreview = (typeof UPDATE_PREVIEWS)[number];

// Long enough to catch layout that only fits short versions.
const APP_VERSION = "10.12.3";
const FW_VERSION = "v10.12.3-dev.12-oled-edition";

export function useUpdatePreview(): [UpdatePreview, (value: UpdatePreview) => void] {
  const [value, set] = usePref<UpdatePreview>(UPDATE_PREVIEW_KEY, "", UPDATE_PREVIEWS);
  return [DEV_TOOLS_BUILT ? value : "", set];
}

export function previewUpdates(preview: UpdatePreview, app: UpdateState, fw: FirmwareUpdate): [UpdateState, FirmwareUpdate] {
  if (!preview) return [app, fw];
  const offered: FirmwareUpdate = { ...fw, latest: { version: FW_VERSION, source: "online", board: "pico2_w" }, problem: null, available: true, backToStable: false, start: async () => undefined };
  if (preview === "available")
    return [
      { phase: "available", version: APP_VERSION, size: 152_000_000 },
      { ...offered, state: { phase: "idle" } },
    ];
  if (preview === "progress")
    return [
      { phase: "downloading", version: APP_VERSION, got: 61_000_000, total: 152_000_000 },
      { ...offered, state: { phase: "running", progress: { step: "flashing", fraction: 0.4 } } },
    ];
  return [
    { phase: "ready", version: APP_VERSION },
    { ...offered, state: { phase: "verifying", version: FW_VERSION, slow: true } },
  ];
}
