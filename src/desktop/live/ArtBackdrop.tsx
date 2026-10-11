// The Controller page's background: game artwork, blurred and dimmed, slowly
// panning and zooming (Ken Burns), behind the controller and its data.
//
// Which art: the running game's banner, else the recently played games in
// turn (a crossfade every 20 s); without any (Games scanning off, Windows /
// macOS), soft blobs in the controller's colors. Cheap on purpose: each
// image is drawn once into a small canvas (24-320 px wide, the Background blur knob) and stretched up, which blurs it
// for free, so only a slow CSS transform animates (fine with software
// rendering). Still with "reduce motion". Toggle: App settings.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { knob, useKnob } from "../lookKnobs";
import type { ColorwayColors } from "./colorways";
import { useFlagPref, readPref } from "../storage";
import { artUrl } from "../games/types";

export const BACKDROP_KEY = "ds5.artBackdropOff";
const CYCLE_MS = 20_000;

// A game page puts its own game behind the window while it's open.
let pageGame: string | null = null;
const pageListeners = new Set<() => void>();
export function setBackdropGame(key: string | null): void {
  pageGame = key;
  pageListeners.forEach((l) => l());
}
const subscribePage = (l: () => void) => {
  pageListeners.add(l);
  return () => pageListeners.delete(l);
};

// Screenshots only (tools/screenshot_env.mjs): one game's art everywhere,
// named by launcher and id ("steam:4078430"), so every shot matches.
const PIN_KEY = "ds5.dev.backdropGame";

// The open game page's art, else the running game's, else the most recently
// played games in turn.
function useBackdropKeys(): string[] {
  const pin = readPref(PIN_KEY);
  const page = useSyncExternalStore(subscribePage, () => pageGame);
  const desktop = window.desktop;
  const [keys, setKeys] = useState<string[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  useEffect(() => {
    if (!desktop) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The first scan runs in the background at start: until it's done the
    // details are empty, so ask again for a minute (no consent / not Linux:
    // colors only).
    const load = (tries: number) =>
      desktop
        .gamesDetails()
        .then((d) => {
          if (!live) return;
          const recent = Object.entries(d)
            .filter(([, info]) => info.art.includes("hero") && info.lastPlayed)
            .sort(([, a], [, b]) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
            .slice(0, 8)
            .map(([key]) => key);
          if (recent.length > 0) setKeys(recent);
          else if (tries > 0) timer = setTimeout(() => void load(tries - 1), 3000);
        })
        .catch(() => undefined);
    void load(20);
    void desktop.gamesRunning().then(setRunning, () => undefined);
    const off = desktop.onRunningGame(setRunning);
    return () => {
      live = false;
      clearTimeout(timer);
      off();
    };
  }, [desktop]);
  if (pin) {
    const pinned = keys.find((k) => k.endsWith(`:${pin}`));
    if (pinned) return [pinned];
  }
  if (page) return [page];
  return running && keys.includes(running) ? [running] : keys;
}

// One image, drawn small (= blurred) into a canvas.
function BlurredArt({ src, visible, blurKnob }: { src: string; visible: boolean; blurKnob: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    const img = new Image();
    img.onload = () => {
      const c = ref.current;
      if (!live) return; // a newer image or blur setting took over
      const ctx = c?.getContext("2d");
      if (!c || !ctx) return;
      // Background blur knob: 0 = sharpest (320 px), 100 = softest (24 px).
      const w = Math.round(320 - (blurKnob / 100) * (320 - 24));
      c.width = w;
      c.height = Math.max(1, Math.round((w * img.naturalHeight) / img.naturalWidth));
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, c.width, c.height);
      setReady(true);
    };
    img.src = src;
    return () => {
      live = false;
      img.onload = null;
      img.src = "";
    };
  }, [src, blurKnob]);
  return <canvas ref={ref} className={`art-bd-layer${visible && ready ? " on" : ""}`} aria-hidden="true" />;
}

export default function ArtBackdrop({ colors }: { colors: ColorwayColors | null }) {
  const [off] = useFlagPref(BACKDROP_KEY);
  const [blur] = useKnob(knob("backdropBlur"));
  const keys = useBackdropKeys();
  // The cycle position belongs to one set of games; a new set starts at 0.
  const sig = keys.join("|");
  const [pos, setPos] = useState({ sig, i: 0 });
  const index = pos.sig === sig ? pos.i : 0;
  useEffect(() => {
    if (keys.length < 2) return;
    const id = setInterval(() => setPos((p) => ({ sig, i: ((p.sig === sig ? p.i : 0) + 1) % keys.length })), CYCLE_MS);
    return () => clearInterval(id);
  }, [sig, keys.length]);
  if (off) return null;
  const body = colors?.body ?? "var(--bg-elevated)";
  return (
    <div className="art-bd" aria-hidden="true">
      {keys.length > 0 ? (
        keys.map((key, i) => <BlurredArt key={key} src={artUrl(key, "hero")} visible={i === index} blurKnob={blur} />)
      ) : (
        <div className="art-bd-blobs" style={{ ["--bd-a" as string]: body, ["--bd-b" as string]: colors?.line ?? body }} />
      )}
      <div className="art-bd-dim" />
    </div>
  );
}
