// Game artwork for the Games library: ds5-art://art/<game key>/<kind>. The
// page only ever names a game and a kind of picture; the file comes from the
// last scan (GamesService.artPath, which also checks Games consent), never
// from a path in the URL.
import { GameKeySchema } from "../../../src/desktop/games/library";
import type { ArtKind } from "../../../src/desktop/games/types";

const ART_KINDS: readonly ArtKind[] = ["hero", "logo", "cover", "header", "icon"];

// The game and kind a ds5-art URL asks for, or null for anything malformed.
export function artRequestTarget(url: string): { key: string; kind: ArtKind } | null {
  let parts: string[];
  try {
    const u = new URL(url);
    if (u.protocol !== "ds5-art:") return null;
    parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    // error: NOT-WORTH — a malformed art URL answers 404: the tile keeps its placeholder
    return null; // bad URL or bad percent-encoding
  }
  if (parts.length !== 2) return null;
  const [key, kind] = parts;
  // error: NOT-WORTH — a key that isn't a game key answers 404 (the page only asks for keys from the scan)
  if (!GameKeySchema.safeParse(key).success || !(ART_KINDS as readonly string[]).includes(kind)) return null;
  return { key, kind: kind as ArtKind };
}
