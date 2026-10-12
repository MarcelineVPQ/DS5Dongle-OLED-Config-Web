// The dongle's console: its OLED screen mirrored pixel for pixel (protocol
// 1.4, 0xEF: the image the firmware last sent to the panel, so it always
// matches, whatever screen it's on) and a log of what the dongle did. Dark in
// every theme, like any console. Works without the OLED add-on too: the
// firmware draws the same frames whether or not a panel is fitted.
import { useEffect, useRef, useState } from "react";
import { hardwareName } from "../hardwareName";
import { useTranslation } from "react-i18next";
import { FEATURES2, type BridgeIdentity, type Ds5BridgeClient, type OledFrame, supportsFeature2 } from "../../protocol/bridgeClient";
import { SCREEN_NAMES } from "../../oled/screenNames";

const FB_W = 128;
const FB_H = 64;
const FRAME_MS = 100; // the firmware redraws every 100 ms
const RETRY_MS = 2000;
// Waveshare's whitish pixels on near-black, as on the panel.
const ON: [number, number, number] = [220, 230, 255];
const OFF: [number, number, number] = [6, 8, 14];

export const supportsOledMirror = (identity: BridgeIdentity | null) => supportsFeature2(identity, 4, FEATURES2.oledMirror);

type Pane = "screen" | "log";
interface LogLine {
  id: number; // increasing, so "unread" still works once the log is full
  at: number;
  text: string;
}

// `identity` is the page's own 1 Hz poll and `frame` its mirror poll
// (useOledFrame, shared with the dashboard), so the console adds no USB
// traffic of its own.
export default function DongleConsole({ client, identity, controllerOn, frame }: { client: Ds5BridgeClient | null; identity: BridgeIdentity | null; controllerOn: boolean; frame: OledFrameState }) {
  const { t } = useTranslation();
  const [pane, setPane] = useState<Pane>("screen");
  const capable = supportsOledMirror(identity);
  const log = useDongleLog(client, identity, controllerOn);
  const [unread, setUnread] = useState(false);
  const seen = useRef(0);
  const newest = log.at(-1)?.id ?? 0;
  useEffect(() => {
    if (pane === "log") seen.current = newest;
    else if (newest > seen.current) setUnread(true);
  }, [newest, pane]);

  const screenName = frame.frame ? (SCREEN_NAMES[frame.frame.screen] ?? `#${frame.frame.screen}`) : null;
  const status = !client
    ? t("desktop.dongleConsole.noDongle")
    : !capable
      ? t("desktop.dongleConsole.needsFirmware")
      : frame.error
        ? t("desktop.dongleConsole.unavailable")
        : frame.frame
          ? frame.frame.power === "off"
            ? t("desktop.dongleConsole.off")
            : frame.frame.power === "dim"
              ? t("desktop.dongleConsole.dim")
              : t("desktop.dongleConsole.live")
          : t("desktop.dongleConsole.connecting");

  return (
    <section className="dcon" aria-label={t("desktop.dongleConsole.title", { device: hardwareName(identity, t) })}>
      <header className="dcon-head">
        <span className="dcon-title">{t("desktop.dongleConsole.title", { device: hardwareName(identity, t) })}</span>
        <div className="dcon-tabs" role="tablist">
          {(["screen", "log"] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={pane === p}
              className={`dcon-tab${pane === p ? " on" : ""}`}
              data-unread={p === "log" && unread && pane !== "log" ? "1" : undefined}
              onClick={() => {
                setPane(p);
                if (p === "log") setUnread(false);
              }}
            >
              {t(`desktop.dongleConsole.pane.${p}`)}
            </button>
          ))}
        </div>
        <span className="dcon-spacer" />
        <span className="dcon-status">{status}</span>
      </header>
      {pane === "screen" ? (
        <div className="dcon-pane dcon-screen">
          <OledCanvas frame={capable ? frame.frame : null} />
          <div className="dcon-line">
            {frame.frame && capable ? (
              <>
                <span>
                  {t("desktop.dongleConsole.screenN", { n: frame.frame.screen + 1, total: SCREEN_NAMES.length })} · {screenName}
                </span>
                <span>{t("desktop.dongleConsole.brightness", { pct: Math.round((frame.frame.contrast / 255) * 100) })}</span>
                <span>{t("desktop.dongleConsole.frame", { n: frame.frame.seq })}</span>
              </>
            ) : (
              <span>{status}</span>
            )}
          </div>
          <p className="dcon-hint">{t("desktop.dongleConsole.hint")}</p>
        </div>
      ) : (
        <div className="dcon-pane dcon-log" role="log" aria-live="polite">
          {log.map((l) => (
            <div key={l.id} className="dcon-row">
              <span className="dcon-time">{new Date(l.at).toLocaleTimeString()}</span> {l.text}
            </div>
          ))}
          {log.length === 0 && <div className="dcon-row dcon-muted">{t("desktop.dongleConsole.logEmpty")}</div>}
        </div>
      )}
    </section>
  );
}

// Polls the mirror while visible; after a failed read it waits before trying
// again and keeps the last good frame (shown as "not available").
export interface OledFrameState {
  frame: OledFrame | null;
  error: boolean;
}
export function useOledFrame(client: Ds5BridgeClient | null, enabled: boolean): OledFrameState {
  const [frame, setFrame] = useState<OledFrame | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!client || !enabled) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let wait = FRAME_MS;
      try {
        const f = await client.readOledFrame();
        if (!live) return;
        if (f) {
          setFrame(f);
          setError(false);
        } else {
          setError(true);
          wait = RETRY_MS;
        }
      } catch {
        if (!live) return;
        setError(true);
        wait = RETRY_MS;
      }
      timer = setTimeout(() => void tick(), wait);
    };
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, enabled]);
  return { frame: client ? frame : null, error };
}

function OledCanvas({ frame }: { frame: OledFrame | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(FB_W, FB_H);
    // The panel's contrast as brightness, never fully black when lit (the
    // lowest steps are still readable on the real panel).
    const level = frame ? 0.35 + 0.65 * (frame.contrast / 255) : 0;
    const on = ON.map((c) => Math.round(OFF[0] + (c - OFF[0]) * level));
    for (let y = 0; y < FB_H; y++) {
      for (let x = 0; x < FB_W; x++) {
        const lit = !!frame && frame.power !== "off" && (frame.pixels[y * 16 + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
        const c = lit ? on : OFF;
        const i = (y * FB_W + x) * 4;
        img.data[i] = c[0];
        img.data[i + 1] = c[1];
        img.data[i + 2] = c[2];
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [frame]);
  // Whole-number scaling only, so every panel pixel is the same square.
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(4);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.max(1, Math.min(6, Math.floor(el.clientWidth / FB_W))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="dcon-oled-box">
      <canvas ref={ref} className="dcon-oled" width={FB_W} height={FB_H} style={{ width: FB_W * scale, height: FB_H * scale }} role="img" aria-label="OLED" />
    </div>
  );
}

// What the dongle did while the app watched: connects, controller, slot,
// battery, saves. Kept for this session only.
function useDongleLog(client: Ds5BridgeClient | null, identity: BridgeIdentity | null, controllerOn: boolean): LogLine[] {
  const { t } = useTranslation();
  const [lines, setLines] = useState<LogLine[]>([]);
  const nextId = useRef(1);
  const add = (text: string) => {
    const id = nextId.current++;
    setLines((l) => [...l.slice(-199), { id, at: Date.now(), text }]);
  };
  const prev = useRef<{ client: boolean; on: boolean; slot: number | null; battery: number | null; unsaved: boolean | null; charging: boolean } | null>(null);
  const status = identity;
  useEffect(() => {
    const now = { client: !!client, on: controllerOn, slot: status?.currentSlot ?? null, battery: status?.battery ?? null, unsaved: status?.unsaved ?? null, charging: status?.charging ?? false };
    const p = prev.current;
    prev.current = now;
    if (!p) {
      if (now.client) add(t("desktop.dongleConsole.log.online", { device: hardwareName(identity, t), version: identity ? `${identity.protoMajor}.${identity.protoMinor}` : "?" }));
      if (now.on) add(t("desktop.dongleConsole.log.controller", { slot: now.slot ?? 0 }));
      return;
    }
    if (now.client !== p.client)
      add(
        t(now.client ? "desktop.dongleConsole.log.online" : "desktop.dongleConsole.log.offline", {
          device: hardwareName(identity, t),
          version: identity ? `${identity.protoMajor}.${identity.protoMinor}` : "?",
        }),
      );
    if (now.on !== p.on) add(now.on ? t("desktop.dongleConsole.log.controller", { slot: now.slot ?? 0 }) : t("desktop.dongleConsole.log.controllerGone"));
    else if (now.on && now.slot !== p.slot && now.slot !== null) add(t("desktop.dongleConsole.log.slot", { slot: now.slot }));
    if (now.charging !== p.charging && now.on) add(t(now.charging ? "desktop.dongleConsole.log.charging" : "desktop.dongleConsole.log.notCharging"));
    if (now.battery !== null && p.battery !== null && now.battery !== p.battery) add(t("desktop.dongleConsole.log.battery", { pct: now.battery }));
    if (now.unsaved === false && p.unsaved === true) add(t("desktop.dongleConsole.log.saved"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to the polled state only
  }, [client, controllerOn, status?.currentSlot, status?.battery, status?.unsaved, status?.charging]);
  return lines;
}
