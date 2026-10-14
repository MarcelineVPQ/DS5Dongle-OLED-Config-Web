// Game artwork for the Games library: ds5-art://art/<game key>/<kind>, and
// optionally ?w=<width> for a copy scaled down to that width (artThumbs.ts).
// The page only ever names a game, a kind of picture and a width from a
// fixed list; the file comes from the last scan (GamesService.artPath, which
// also checks Games consent), never from a path in the URL.
import { GameKeySchema } from "../../../src/desktop/games/library";
import { ART_WIDTHS, type ArtKind, type ArtWidth } from "../../../src/desktop/games/types";

const ART_KINDS: readonly ArtKind[] = ["hero", "logo", "cover", "header", "icon"];

export interface ArtTarget {
  key: string;
  kind: ArtKind;
  width: ArtWidth | null; // null: the file as it is
}

// The game, kind and width a ds5-art URL asks for, or null for anything
// malformed: the only query allowed is one ?w= from ART_WIDTHS, no fragment.
export function artRequestTarget(url: string): ArtTarget | null {
  let parts: string[];
  let width: ArtWidth | null = null;
  try {
    const u = new URL(url);
    if (u.protocol !== "ds5-art:" || u.hash) return null;
    if (u.search) {
      const m = /^\?w=([1-9]\d{1,3})$/.exec(u.search);
      const w = m ? Number(m[1]) : NaN;
      if (!(ART_WIDTHS as readonly number[]).includes(w)) return null;
      width = w as ArtWidth;
    }
    parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    // error: NOT-WORTH — a malformed art URL answers 404: the tile keeps its placeholder
    return null; // bad URL or bad percent-encoding
  }
  if (parts.length !== 2) return null;
  const [key, kind] = parts;
  // error: NOT-WORTH — a key that isn't a game key answers 404 (the page only asks for keys from the scan)
  if (!GameKeySchema.safeParse(key).success || !(ART_KINDS as readonly string[]).includes(kind)) return null;
  return { key, kind: kind as ArtKind, width };
}
