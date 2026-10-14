// Which of a game's pictures each place shows, and its art color. One lookup
// for the wide header (the game page's and Continue playing's big tile): its
// hero, else the wide capsule (header), else the cover set on the right of
// the art-color gradient ("tall"); with none, the gradient alone ("plain").
// The gradient also sits under every picture, so a file that won't load
// shows it instead of an empty panel.
import { useEffect, useState, type CSSProperties } from "react";
import { artUrl, type ArtKind, type GameInfo } from "../games/types";

// loop: HOT-PATH-OK — N ≤ 3 art kinds per tile, each a lookup in ≤ 5
export const firstArt = (info: GameInfo | undefined, kinds: ArtKind[]): ArtKind | null => kinds.find((k) => info?.art.includes(k)) ?? null;

const HEADER_ART: ArtKind[] = ["hero", "header", "cover"];

export interface HeaderArt {
  kind: ArtKind | null;
  shape: "wide" | "tall" | "plain";
  style: CSSProperties | undefined; // --gp-art, read by .gp-hero (desktop.css)
}

export function headerArt(key: string, info: GameInfo | undefined): HeaderArt {
  const kind = firstArt(info, HEADER_ART);
  if (!kind) return { kind, shape: "plain", style: undefined };
  return { kind, shape: kind === "cover" ? "tall" : "wide", style: { "--gp-art": `url("${artUrl(key, kind)}")` } as CSSProperties };
}

// The game's signature color from its art (the main process votes and
// caches it; null for grey or dark art), fetched while `enabled`.
export function useArtColor(key: string, enabled = true): string | null {
  const [got, setGot] = useState<{ key: string; color: string | null } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void window
      .desktop!.gameArtColor(key)
      .then((color) => live && setGot({ key, color }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [key, enabled]);
  return got?.key === key ? got.color : null;
}
