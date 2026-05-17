// OLED emulator panel. Renders a pixel-perfect emulation of the firmware's
// 10 OLED screens onto a 128x64 framebuffer, scaled 4x onto a canvas.
//
// Modes:
//   - No controller connected: auto-cycle through screens every 4s with
//     mock data. Banner reads "Live demo — connect a controller for real
//     values."
//   - Controller connected: live data via WebHID input reports + the
//     feature reports added in firmware commit 8bef1d2 (0xFA slots,
//     0xFB diagnostics).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ChevronLeft, Pause, Play } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { Ds5BridgeHidClient } from "../protocol/ds5BridgeHid";
import { FB_W, FB_H, flush, newFramebuffer } from "../oled/canvas";
import PicoBoardFrame from "./PicoBoardFrame";
import { decodeInputReport, emptyInputReport } from "../oled/inputReport";
import {
  mockDiag,
  mockInputReport,
  mockRssi,
  mockSlots,
  newMockState,
} from "../oled/mock";
import { SCREEN_RENDERERS } from "../oled/screens";
import { EmulatorState, SCREEN_NAMES, formatBdAddr, key1Action, newEmulatorState, nextScreen } from "../oled/state";

const AUTO_CYCLE_MS = 4000;
const FEATURE_POLL_MS = 200;
const CANVAS_SCALE = 3;

export interface OledEmulatorProps {
  client: Ds5BridgeHidClient | null;
}

export default function OledEmulator({ client }: OledEmulatorProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<EmulatorState>(newEmulatorState());
  const mockRef = useRef(newMockState());
  const fbRef = useRef<Uint8Array>(newFramebuffer());
  const [, setRenderTick] = useState(0);
  const [autoCycle, setAutoCycle] = useState(true);
  const lastAutoCycleRef = useRef<number>(performance.now());

  const isConnected = !!client?.device.opened;

  // Keep stateRef.isConnected / isDemoMode in sync with the React-side flag.
  useEffect(() => {
    stateRef.current.isConnected = isConnected;
    stateRef.current.isDemoMode = !isConnected;
    if (isConnected) {
      setAutoCycle(false);
    }
  }, [isConnected]);

  // Subscribe to input reports when a client is available.
  useEffect(() => {
    if (!client) return;
    const unsub = client.onInputReport((data, reportId) => {
      // DS5 standard input report is 0x01 on USB.
      if (reportId !== 0x01 && reportId !== 0x31) return;
      stateRef.current.input = decodeInputReport(data);
    });
    return unsub;
  }, [client]);

  // Poll feature reports for data not in the input stream.
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const [config, slots, diag, rssi] = await Promise.all([
          client.readConfig(),
          client.readSlotsRaw().catch(() => null),
          client.readDiagRaw().catch(() => null),
          client.readRssi().catch(() => 0),
        ]);
        if (cancelled) return;
        const s = stateRef.current;
        s.config = config;
        s.rssi = rssi;
        if (slots) {
          s.slots = {
            addrs: slots.addrs.map((a) => Array.from(a)),
            occupied: slots.occupied,
          };
          // Populate BD addr from active slot.
          if (slots.occupied[config.currentSlot]) {
            s.bdAddr = formatBdAddr(Array.from(slots.addrs[config.currentSlot]));
          }
        }
        if (diag) {
          const prev = s.diag;
          const now = performance.now();
          let usbRate = prev.usbRate ?? 0;
          let btRate  = prev.btRate  ?? 0;
          if (prev.prevSampleMs !== undefined) {
            const dtS = (now - prev.prevSampleMs) / 1000;
            if (dtS > 0) {
              usbRate = Math.round((diag.usbFrames - (prev.prevUsbFrames ?? 0)) / dtS);
              btRate  = Math.round((diag.btPackets - (prev.prevBtPackets ?? 0)) / dtS);
            }
          }
          s.diag = {
            ...diag,
            prevUsbFrames: diag.usbFrames,
            prevBtPackets: diag.btPackets,
            prevSampleMs: now,
            usbRate, btRate,
          };
        }
      } catch {
        // ignore transient feature-report failures
      }
    };
    void tick();
    const id = window.setInterval(tick, FEATURE_POLL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [client]);

  // Render loop at ~30 Hz.
  useEffect(() => {
    let rafId = 0;
    let lastRender = 0;
    const tick = (now: number) => {
      rafId = requestAnimationFrame(tick);
      if (now - lastRender < 33) return;
      lastRender = now;
      const s = stateRef.current;

      // In demo / no-connection mode, fabricate inputs/feature data.
      if (!isConnected) {
        s.input = mockInputReport(mockRef.current);
        const ms = mockSlots(mockRef.current);
        s.slots = { addrs: ms.addrs.map((a) => [...a]), occupied: ms.occupied };
        const md = mockDiag(mockRef.current);
        s.diag = {
          ...md,
          usbRate: 48000,
          btRate: 50,
          prevSampleMs: now,
          prevUsbFrames: md.usbFrames,
          prevBtPackets: md.btPackets,
        };
        s.rssi = mockRssi(mockRef.current);
      }

      // Auto-cycle screens.
      if (autoCycle && now - lastAutoCycleRef.current >= AUTO_CYCLE_MS) {
        lastAutoCycleRef.current = now;
        nextScreen(s);
      }

      // Render.
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d")!;
        const renderer = SCREEN_RENDERERS[s.currentScreen];
        renderer(fbRef.current, s);
        flush(ctx, fbRef.current);
      }
      // Force React subtree (button labels) to refresh every ~10 frames.
      setRenderTick((t) => (t + 1) & 0xff);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isConnected, autoCycle]);

  // Reset feature-report state when client disconnects so demo mode is clean.
  useEffect(() => {
    if (!client) {
      stateRef.current.input = emptyInputReport();
      mockRef.current = newMockState();
    }
  }, [client]);

  const handleKey0 = useCallback(() => {
    nextScreen(stateRef.current);
    setAutoCycle(false);
    lastAutoCycleRef.current = performance.now();
  }, []);

  const handleKey1 = useCallback(() => {
    key1Action(stateRef.current);
    setAutoCycle(false);
    lastAutoCycleRef.current = performance.now();
  }, []);

  const currentScreenName = useMemo(
    () => SCREEN_NAMES[stateRef.current.currentScreen],
    // depend on render tick so name updates with state
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stateRef.current.currentScreen],
  );

  return (
    <div className="oled-emulator">
      {!isConnected && (
        <div className="oled-banner oled-banner-top" aria-live="polite">
          {t("preview.liveDemoBanner")}
        </div>
      )}

      <PicoBoardFrame connected={isConnected}>
        <canvas
          ref={canvasRef}
          width={FB_W * CANVAS_SCALE}
          height={FB_H * CANVAS_SCALE}
          className="oled-canvas"
        />
      </PicoBoardFrame>

      <div className="oled-controls">
        <button
          type="button"
          className="oled-key"
          onClick={handleKey1}
          title={t("preview.key1Title")}
        >
          <ChevronLeft size={18} /> {t("preview.key1")}
        </button>
        <div className="oled-screen-name">
          <Trans
            i18nKey="preview.screenIndicator"
            values={{
              n: stateRef.current.currentScreen + 1,
              total: SCREEN_NAMES.length,
              name: currentScreenName,
            }}
            components={{ strong: <strong /> }}
          />
        </div>
        <button
          type="button"
          className="oled-key"
          onClick={handleKey0}
          title={t("preview.key0Title")}
        >
          {t("preview.key0")} <ChevronRight size={18} />
        </button>
      </div>

      <div className="oled-toolbar">
        <button
          type="button"
          className="button ghost"
          onClick={() => setAutoCycle((v) => !v)}
          title={autoCycle ? t("preview.autoCycleOnTitle") : t("preview.autoCycleOffTitle")}
        >
          {autoCycle ? <Pause size={15} /> : <Play size={15} />}
          {autoCycle ? t("preview.autoCycleOn") : t("preview.autoCycleOff")}
        </button>
      </div>
    </div>
  );
}
