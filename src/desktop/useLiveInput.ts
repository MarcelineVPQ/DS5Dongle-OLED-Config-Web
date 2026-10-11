// Live controller input for the controller view: polls the dongle's 0xF0
// report about 30 times a second while it's worth it (window visible, a
// controller connected, firmware with the live-input feature) and renders at
// most once per animation frame. Stops completely otherwise, so a hidden or
// tray-minimized app costs nothing.
import { useEffect, useState } from "react";
import { IDENTITY_FEATURES, type BridgeIdentity, type Ds5BridgeClient } from "../protocol/bridgeClient";
import type { InputReport } from "../oled/inputReport";

const POLL_MS = 33;

export function supportsLiveInput(identity: BridgeIdentity | null | undefined): boolean {
  return !!identity && (identity.features & IDENTITY_FEATURES.liveInput) !== 0;
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

export function useLiveInput(client: Ds5BridgeClient | null, enabled: boolean): InputReport | null {
  const visible = useDocumentVisible();
  const [input, setInput] = useState<InputReport | null>(null);
  const active = !!client && enabled && visible;

  useEffect(() => {
    if (!active || !client) return;
    let live = true;
    let latest: InputReport | null = null;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const paint = () => {
      frame = 0;
      if (live && latest) setInput(latest);
    };
    const poll = async () => {
      try {
        latest = await client.readInput();
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
