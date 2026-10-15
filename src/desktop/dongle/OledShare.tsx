// Share your OLED: a Share button on the OLED mirror (OledHero's header) that
// opens a small bar: the size (1x / 4x / 8x, whole-number nearest-neighbour,
// so every OLED pixel stays a crisp square), the board frame as the mirror
// draws it, Save PNG…, Copy (a PNG on the clipboard, for Discord) and Record
// GIF (up to 10 s, a frame each time the picture changes, then the save
// dialog). Works with the simulated board too.
// Lean: it takes the mirror's own frames (the `frame` prop, from the page's
// one poll; no reads of its own) and keeps them only while recording;
// encoding runs only on demand, in a worker (shareEncode.ts); nothing else
// runs while it's closed. While recording, a 1 s counter for the indicator.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Share2 } from "lucide-react";
import type { OledFrame } from "../../protocol/bridgeClient";
import { GIF_MAX_FRAMES, GIF_MAX_MS, SHARE_SCALES, ShareTooBig, samePicture, shareSize, type GifFrame, type ShareRequest, type ShareScale } from "../../oled/oledShare";
import { causeText } from "../shownError";
import { encodeOffThread } from "./shareEncode";

const LAST_FRAME_MIN_MS = 500; // a picture held when Stop is pressed still shows for a moment

interface Recording {
  start: number;
  frames: Array<{ frame: OledFrame; at: number }>;
}
type Status = { tone: "good" | "bad"; text: string } | null;

export default function OledShare({ frame }: { frame: OledFrame | null }) {
  const { t } = useTranslation();
  const ts = (k: string, o?: Record<string, unknown>) => t(`desktop.oledShare.${k}`, o);
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState<ShareScale>(4);
  const [framed, setFramed] = useState(true);
  const [busy, setBusy] = useState<"png" | "copy" | "gif" | null>(null);
  const [status, setStatus] = useState<Status>(null);
  // The recording: started at, and how many frames so far (the indicator).
  const [recording, setRecording] = useState<{ start: number; count: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // cache: OK — key=none (the frames recorded so far); invalidated=Stop / Cancel / unmount; bound=GIF_MAX_FRAMES frames of 1 KB
  const rec = useRef<Recording | null>(null);
  const desktop = window.desktop;
  const size = shareSize(scale, framed);

  const report = (key: string, cause: unknown) => {
    if (cause instanceof ShareTooBig) setStatus({ tone: "bad", text: ts("errors.tooBig", { mb: Math.round(cause.limit / (1024 * 1024)) }) });
    else setStatus({ tone: "bad", text: ts(key, { reason: causeText(cause).replace(/\.$/, "") }) });
  };

  // Encode (worker), then save (system dialog) or copy (clipboard).
  const share = async (what: "png" | "copy" | "gif", req: ShareRequest) => {
    if (!desktop) return;
    setBusy(what);
    setStatus(null);
    let bytes: Uint8Array;
    try {
      bytes = await encodeOffThread(req);
    } catch (cause) {
      // error: SHOWN — desktop.oledShare.errors.encode / .tooBig (the bar's status line)
      report("errors.encode", cause);
      setBusy(null);
      return;
    }
    try {
      if (what === "copy") {
        await desktop.copyOledImage(bytes);
        setStatus({ tone: "good", text: ts("copied") });
      } else {
        const r = await desktop.saveOledImage({ kind: req.kind, bytes });
        setStatus(r.saved ? { tone: "good", text: ts("saved", { name: r.name }) } : null);
      }
    } catch (cause) {
      // error: SHOWN — desktop.oledShare.errors.copy / .save (the bar's status line; causeText says a refused request plainly)
      report(what === "copy" ? "errors.copy" : "errors.save", cause);
    } finally {
      setBusy(null);
    }
  };
  const run = (what: "png" | "copy" | "gif", req: ShareRequest) => {
    // error: NOT-WORTH — share() catches and shows its own failures; this only starts it
    void share(what, req).catch((cause: unknown) => report("errors.encode", cause));
  };

  const still = () => {
    if (frame) run("png", { kind: "png", frame, scale, framed });
  };
  const copy = () => {
    if (frame) run("copy", { kind: "png", frame, scale, framed });
  };
  const startRecording = () => {
    if (!frame) return;
    const start = Date.now();
    rec.current = { start, frames: [{ frame, at: start }] };
    setElapsed(0);
    setStatus(null);
    setRecording({ start, count: 1 });
  };
  const cancel = () => {
    rec.current = null;
    setRecording(null);
  };
  const stop = () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    setRecording(null);
    const end = Math.min(Date.now(), r.start + GIF_MAX_MS);
    // loop: NOT-WORTH — once per recording, N ≤ GIF_MAX_FRAMES
    const frames: GifFrame[] = r.frames.map((f, i) => {
      const until = r.frames[i + 1]?.at ?? Math.max(end, f.at + LAST_FRAME_MIN_MS);
      return { frame: f.frame, ms: until - f.at };
    });
    run("gif", { kind: "gif", frames, scale, framed });
  };
  // The latest stop() for the timers below.
  const stopRef = useRef(stop);
  // lifetime: OK — acquires nothing (keeps stopRef current)
  useLayoutEffect(() => {
    stopRef.current = stop;
  });

  // A changed mirror frame while recording: kept (an unchanged one never arrives: useOledFrame keeps it).
  // lifetime: OK — acquires nothing (appends to the recording, capped at GIF_MAX_FRAMES)
  useEffect(() => {
    const r = rec.current;
    if (!r || !frame) return;
    const last = r.frames.at(-1);
    if (last && samePicture(last.frame, frame)) return;
    r.frames.push({ frame, at: Date.now() });
    setRecording({ start: r.start, count: r.frames.length });
    if (r.frames.length >= GIF_MAX_FRAMES) stopRef.current();
  }, [frame]);

  // While recording: the indicator's 1 s counter and the 10 s cap.
  const recStart = recording?.start ?? null;
  // lifetime: OK — cleanup clears the counter and the cap's timer (Stop / Cancel / unmount)
  useEffect(() => {
    if (recStart === null) return;
    const left = Math.max(0, recStart + GIF_MAX_MS - Date.now());
    // lifetime: OK — cleared in the effect cleanup
    const cap = setTimeout(() => stopRef.current(), left);
    // lifetime: OK — cleared in the effect cleanup
    const tick = setInterval(() => setElapsed(Math.min(GIF_MAX_MS, Date.now() - recStart)), 1000);
    return () => {
      clearTimeout(cap);
      clearInterval(tick);
    };
  }, [recStart]);

  const working = busy !== null || recording !== null;
  const noPicture = !frame;
  return (
    <>
      <button
        type="button"
        className={`dk-btn oled-share-btn${open ? " on" : ""}`}
        aria-expanded={open}
        aria-controls="oled-share-bar"
        title={ts("title")}
        disabled={recording !== null}
        onClick={() => setOpen((o) => !o)}
      >
        <Share2 size={14} aria-hidden="true" /> {ts("share")}
      </button>
      {open && (
        <div id="oled-share-bar" className="oled-share" role="group" aria-label={ts("bar")}>
          <div className="dk-seg" role="group" aria-label={ts("size")}>
            {/* loop: HOT-PATH-OK — N = 3 sizes */}
            {SHARE_SCALES.map((s) => (
              <button
                type="button"
                key={s}
                className={s === scale ? "on" : ""}
                aria-pressed={s === scale}
                title={ts("sizeTitle", { w: shareSize(s, framed).width, h: shareSize(s, framed).height })}
                disabled={working}
                onClick={() => setScale(s)}
              >
                {s}×
              </button>
            ))}
          </div>
          <label className="oled-share-frame">
            <input type="checkbox" checked={framed} disabled={working} onChange={(e) => setFramed(e.target.checked)} /> {ts("frame")}
          </label>
          {recording ? (
            <>
              <span className="oled-share-rec" role="status">
                <i className="oled-share-dot" aria-hidden="true" />
                {ts("recording", { s: Math.floor(elapsed / 1000), max: GIF_MAX_MS / 1000, n: recording.count })}
              </span>
              <button type="button" className="dk-btn primary" onClick={stop}>
                {ts("stop")}
              </button>
              <button type="button" className="dk-btn" onClick={cancel}>
                {ts("cancel")}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="dk-btn" disabled={working || noPicture || !desktop} aria-busy={busy === "png" || undefined} onClick={still}>
                {ts("savePng")}
              </button>
              <button type="button" className="dk-btn" title={ts("copyTitle")} disabled={working || noPicture || !desktop} aria-busy={busy === "copy" || undefined} onClick={copy}>
                {ts("copy")}
              </button>
              <button
                type="button"
                className="dk-btn"
                title={ts("recordTitle", { s: GIF_MAX_MS / 1000 })}
                disabled={working || noPicture || !desktop}
                aria-busy={busy === "gif" || undefined}
                onClick={startRecording}
              >
                {ts("record")}
              </button>
            </>
          )}
          <span className="oled-share-status" role="status" aria-live="polite">
            {busy ? (
              <span className="oled-share-note">{ts("working")}</span>
            ) : status ? (
              <span className={status.tone === "good" ? "dk-good" : "dk-bad"}>{status.text}</span>
            ) : noPicture ? (
              <span className="oled-share-note">{ts("noPicture")}</span>
            ) : (
              <span className="oled-share-note">
                {size.width} × {size.height}
              </span>
            )}
          </span>
        </div>
      )}
    </>
  );
}
