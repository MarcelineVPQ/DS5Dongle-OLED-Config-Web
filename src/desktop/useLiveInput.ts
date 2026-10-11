// Live controller input (and the lightbar's color) for the controller view: polls the dongle's 0xF0
// report about 30 times a second while it's worth it (window visible, a
// controller connected, firmware with the live-input feature) and renders at
// most once per animation frame. Stops completely otherwise, so a hidden or
// tray-minimized app costs nothing.
import { useEffect, useState } from "react";
import { IDENTITY_FEATURES, type BridgeIdentity, type Ds5BridgeClient } from "../protocol/bridgeClient";
import type { InputReport } from "../oled/inputReport";

const POLL_MS = 33;

// How the live link is doing, for the live data panel: reads per second and
// the round trip of the last one (updated by useLiveInput's loop).
export const liveStats = { hz: 0, ms: 0 };

export function supportsLiveInput(identity: BridgeIdentity | null | undefined): boolean {
  return !!identity && (identity.features & IDENTITY_FEATURES.liveInput) !== 0;
}

// On screen: the page is visible and (desktop) the window isn't hidden in the
// tray or minimized, which Chromium alone doesn't report here.
function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  const [windowShown, setWindowShown] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    const off = window.desktop?.onWindowVisible(setWindowShown);
    return () => {
      document.removeEventListener("visibilitychange", update);
      off?.();
    };
  }, []);
  return visible && windowShown;
}

export function useLiveInput(client: Ds5BridgeClient | null, enabled: boolean): InputReport | null {
  const visible = useDocumentVisible();
  const [input, setInput] = useState<InputReport | null>(null);
  const active = !!client && enabled && visible;

  useEffect(() => {
    if (!active || !client) return;
    let live = true;
    let latest: InputReport | null = null;
    let fresh = false;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const paint = () => {
      frame = 0;
      if (live && fresh) setInput(latest);
      fresh = false;
    };
    let count = 0;
    let since = performance.now();
    const poll = async () => {
      try {
        const t0 = performance.now();
        latest = await client.readInput();
        const t1 = performance.now();
        liveStats.ms = t1 - t0;
        count++;
        if (t1 - since >= 1000) {
          liveStats.hz = (count * 1000) / (t1 - since);
          count = 0;
          since = t1;
        }
        fresh = true;
        if (!frame) frame = requestAnimationFrame(paint);
      } catch {
        // dongle busy or gone: the connection hook handles reconnecting
      }
      if (live) timer = setTimeout(() => void poll(), POLL_MS);
    };
    void poll();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [active, client]);

  return active ? input : null;
}

// The lightbar color as the controller shows it, read at the same rate as the
// live input so animated modes (rainbow, breathing, fade) look smooth instead
// of stepping once a second. Same gating as useLiveInput; re-renders only when
// the color changes.
export function useLiveLightbar(client: Ds5BridgeClient | null, enabled: boolean): [number, number, number] | null {
  const visible = useDocumentVisible();
  const [rgb, setRgb] = useState<[number, number, number] | null>(null);
  const active = !!client && enabled && visible;

  useEffect(() => {
    if (!active || !client) return;
    let live = true;
    let last = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const color = (await client.identity()).lightbar;
        const key = color ? color.join(",") : "";
        if (live && key !== last) {
          last = key;
          setRgb(color ? [color[0], color[1], color[2]] : null);
        }
      } catch {
        // dongle busy or gone: the connection hook handles reconnecting
      }
      if (live) timer = setTimeout(() => void poll(), POLL_MS);
    };
    void poll();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [active, client]);

  return active ? rgb : null;
}
