// The Controller page's background: game artwork, blurred and dimmed, slowly
// panning and zooming (Ken Burns), behind the controller and its data.
//
// Which art: the running game's banner, else the recently played games in
// turn (a 4 s crossfade every 20 s); without any (Games scanning off, Windows /
// macOS), slow swirls in the controller's colors (SwirlField). Cheap on purpose: each
// image is drawn once into a small canvas (24-320 px wide, the Background blur knob) and stretched up, which blurs it
// for free, so only a slow transform moves it and the crossfade steps with it
// (backdropPan.ts: 10 steps a second, none while the window isn't focused).
// Still with "reduce motion" (games switch without a fade). Toggle: App settings.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { knob, useKnob } from "../lookKnobs";
import type { ColorwayColors } from "./colorways";
import { readPref, usePref } from "../storage";
import { artUrl } from "../games/types";
import { gamesSupported } from "../games/platform";
import SwirlField from "./SwirlField";
import { useWindowFocused, useWindowShown } from "../useWindowShown";
import { useReducedMotion } from "../motion";
import { fadeProgress, panClock, panTransform } from "./backdropPan";
import { atNextTick, onFrameTick } from "../frameTick";
import { logged } from "../../errorText";

// The background: "default" (the swirl field, what a new install shows),
// "art" (game artwork when there is some, else the swirls) or "off".
export const BACKGROUND_KEY = "ds5.background";
export const BACKGROUNDS = ["default", "art", "off"] as const;
export type Background = (typeof BACKGROUNDS)[number];
// The older on/off switch: someone who turned it off keeps "off".
const OLD_OFF_KEY = "ds5.artBackdropOff";

export function useBackground(): [Background, (value: Background) => void] {
  return usePref<Background>(BACKGROUND_KEY, readPref(OLD_OFF_KEY) === "1" ? "off" : "default", BACKGROUNDS);
}
const CYCLE_MS = 20_000;
// The canvas is at most this many pixels wide (the sharpest blur setting),
// whatever the screen's pixel ratio, so the art is asked for at that width.
const BACKDROP_PX = 320;

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
  // lifetime: OK — cleanup: stops the retry timer, drops late reads, unsubscribes the running game
  useEffect(() => {
    // No Games where it isn't supported (macOS): no art to ask for, colors only
    // (asking threw in the main process at every start: macOS smoke test).
    if (!desktop || !gamesSupported()) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The first scan runs in the background at start: until it's done the
    // details are empty, so ask again for a minute (no consent: colors only).
    const load = (tries: number): void =>
      void desktop
        .gamesDetails()
        .then((d) => {
          if (!live) return;
          const recent = Object.entries(d)
            .filter(([, info]) => info.art.includes("hero") && info.lastPlayed)
            .sort(([, a], [, b]) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
            .slice(0, 8)
            .map(([key]) => key);
          if (recent.length > 0) setKeys(recent);
          // lifetime: OK — cleared in the effect cleanup (unmount)
          else if (tries > 0) timer = setTimeout(() => load(tries - 1), 3000);
        })
        .catch(logged("game art for the backdrop (the colors-only backdrop stays)"));
    load(20);
    void desktop.gamesRunning().then(setRunning, logged("the running game for the backdrop (onRunningGame updates it)"));
    // lifetime: OK — off() in the effect cleanup
    const off = desktop.onRunningGame(setRunning);
    return () => {
      live = false;
      clearTimeout(timer);
      off();
    };
  }, [desktop]);
  if (pin) {
    // loop: HOT-PATH-OK — N ≤ 8 recent games with art, on render
    const pinned = keys.find((k) => k.endsWith(`:${pin}`));
    if (pinned) return [pinned];
  }
  if (page) return [page];
  return running && keys.includes(running) ? [running] : keys;
}

// One image, drawn small (= blurred) into a canvas.
// `role`: "on" fades in (or is shown), "leaving" fades out, with --bd-fade.
function BlurredArt({ src, role, blurKnob }: { src: string; role: "on" | "leaving" | null; blurKnob: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  // lifetime: OK — cleanup: drops the image's onload and src
  useEffect(() => {
    let live = true;
    const img = new Image();
    // lifetime: OK — set to null in the effect cleanup (new image or unmount)
    img.onload = () => {
      const c = ref.current;
      if (!live) return; // a newer image or blur setting took over
      const ctx = c?.getContext("2d");
      if (!c || !ctx) return;
      // Background blur knob: 0 = sharpest (BACKDROP_PX), 100 = softest (24 px).
      const w = Math.round(BACKDROP_PX - (blurKnob / 100) * (BACKDROP_PX - 24));
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
  return <canvas ref={ref} className={`art-bd-layer${role && ready ? ` ${role}` : ""}`} aria-hidden="true" />;
}

export default function ArtBackdrop({ colors }: { colors: ColorwayColors | null }) {
  const [background] = useBackground();
  const [blur] = useKnob(knob("backdropBlur"));
  const keys = useBackdropKeys();
  // The cycle position belongs to one set of games; a new set starts at 0
  // (prev: the game fading out, -1 for none).
  const sig = keys.join("|");
  const [pos, setPos] = useState({ sig, i: 0, prev: -1 });
  const index = pos.sig === sig ? pos.i : 0;
  const prev = pos.sig === sig ? pos.prev : -1;
  // The art moves and cycles only while the window is on screen and focused
  // (behind another window or a game it holds still: frames nobody watches).
  const shown = useWindowShown();
  const focused = useWindowFocused();
  const still = useReducedMotion();
  const hold = !focused;
  const moving = shown && !hold && !still;
  const art = background === "art" && keys.length > 0;
  const root = useRef<HTMLDivElement>(null);
  // When the crossfade started (performance.now()); it starts at mount too,
  // so the first game fades in.
  // cache: OK — key=none (the current crossfade's start); invalidated=reset on every game change; bound=1 number
  const fadeAt = useRef(0); // set before the first paint (the layout effect below)
  // A new game: its fade starts at 0 before the frame is drawn (no flash of
  // the new game at full strength); no fade with Reduce motion.
  // lifetime: OK — acquires nothing (resets the crossfade before paint)
  useLayoutEffect(() => {
    fadeAt.current = performance.now();
    root.current?.style.setProperty("--bd-fade", still ? "1" : "0");
  }, [index, sig, still]);
  // The art's pan and crossfade (the swirls pan with their own frames,
  // SwirlField): a step every 100 ms while moving; holding, a fade underway
  // finishes at once and the picture stays where it is.
  // lifetime: OK — cleanup: clears the pan timer; none unless shown, focused and moving
  useEffect(() => {
    const el = root.current;
    if (!el || !art) return;
    if (still) el.style.removeProperty("--bd-pan");
    if (!moving) {
      el.style.setProperty("--bd-fade", "1");
      return;
    }
    const now = panClock();
    let fade = "";
    const step = () => {
      el.style.setProperty("--bd-pan", panTransform(now()));
      const f = fadeProgress(performance.now() - fadeAt.current);
      if (f !== fade) el.style.setProperty("--bd-fade", (fade = f));
    };
    step();
    // On the shared frame clock (frameTick.ts, every PAN_MS), so a readout
    // that changes goes to the screen in the same frame as the next step.
    // lifetime: OK — unsubscribed in the effect cleanup; runs only while shown, focused and moving
    return onFrameTick(step);
  }, [art, still, moving]);
  // lifetime: OK — cleanup: clears the cycle timer; none while hidden, holding or with one game
  useEffect(() => {
    if (keys.length < 2 || !shown || hold) return;
    let cancel = () => undefined as unknown;
    // The next game starts on a frame tick, with the pan's step (one frame for both).
    const next = () => (cancel = atNextTick(() => setPos((p) => ({ sig, prev: p.sig === sig ? p.i : -1, i: ((p.sig === sig ? p.i : 0) + 1) % keys.length }))));
    // lifetime: OK — cleared in the effect cleanup (with a switch still waiting for its tick); runs only while shown and focused with 2+ games
    const id = setInterval(next, CYCLE_MS);
    return () => {
      clearInterval(id);
      cancel();
    };
  }, [sig, keys.length, shown, hold]);
  if (background === "off") return null;
  return (
    <div ref={root} className={`art-bd${art ? "" : " blobs"}`} aria-hidden="true">
      {art ? (
        // loop: HOT-PATH-OK — N ≤ 8 backdrop images; renders on a 20 s cycle tick
        keys.map((key, i) => <BlurredArt key={key} src={artUrl(key, "hero", BACKDROP_PX, 1)} role={i === index ? "on" : i === prev ? "leaving" : null} blurKnob={blur} />)
      ) : (
        <SwirlField colors={colors} hold={hold} />
      )}
      <div className="art-bd-dim" />
    </div>
  );
}
