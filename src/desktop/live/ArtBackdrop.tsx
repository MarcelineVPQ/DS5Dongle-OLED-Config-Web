// The Controller page's background: game artwork, blurred and dimmed, slowly
// panning and zooming (Ken Burns), behind the controller and its data.
//
// Which art: the running game's banner, else the recently played games in
// turn (a crossfade every 20 s); without any (Games scanning off, Windows /
// macOS), soft blobs in the controller's colors. Cheap on purpose: each
// image is drawn once into a 48 px canvas and stretched up, which blurs it
// for free, so only a slow CSS transform animates (fine with software
// rendering). Still with "reduce motion". Toggle: App settings.
import { useEffect, useRef, useState } from "react";
import type { ColorwayColors } from "./colorways";
import { useFlagPref } from "../storage";

export const BACKDROP_KEY = "ds5.artBackdropOff";
const CYCLE_MS = 20_000;
const SMALL_W = 48;

const artUrl = (key: string) => `ds5-art://art/${encodeURIComponent(key)}/hero`;

// Hero art of the running game, else of the most recently played games.
function useBackdropKeys(): string[] {
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
  return running && keys.includes(running) ? [running] : keys;
}

// One image, drawn small (= blurred) into a canvas.
function BlurredArt({ src, visible }: { src: string; visible: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const c = ref.current;
      const ctx = c?.getContext("2d");
      if (!c || !ctx) return;
      c.width = SMALL_W;
      c.height = Math.max(1, Math.round((SMALL_W * img.naturalHeight) / img.naturalWidth));
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, c.width, c.height);
      setReady(true);
    };
    img.src = src;
  }, [src]);
  return <canvas ref={ref} className={`art-bd-layer${visible && ready ? " on" : ""}`} aria-hidden="true" />;
}

export default function ArtBackdrop({ colors }: { colors: ColorwayColors | null }) {
  const [off] = useFlagPref(BACKDROP_KEY);
  const keys = useBackdropKeys();
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setIndex(0);
    if (keys.length < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % keys.length), CYCLE_MS);
    return () => clearInterval(id);
  }, [keys]);
  if (off) return null;
  const body = colors?.body ?? "#334155";
  return (
    <div className="art-bd" aria-hidden="true">
      {keys.length > 0 ? (
        keys.map((key, i) => <BlurredArt key={key} src={artUrl(key)} visible={i === index} />)
      ) : (
        <div className="art-bd-blobs" style={{ ["--bd-a" as string]: body, ["--bd-b" as string]: colors?.line ?? body }} />
      )}
      <div className="art-bd-dim" />
    </div>
  );
}
