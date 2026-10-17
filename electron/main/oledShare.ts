// Share your OLED, the main process's half: save the PNG or GIF the page made
// (src/oled/oledShare.ts) where the user picks in the system save dialog, or
// put the PNG on the clipboard. The page sends only the kind and the bytes,
// never a path or a name: the path comes from the dialog alone, its extension
// is forced to the kind's (when that names a file that is already there, the
// dialog opens again on that name, so the system asks before replacing it),
// and the bytes must start with that format's signature and fit its size cap.
// Nothing is uploaded anywhere.
import { basename, extname, join } from "node:path";
import { z } from "zod";
import { GIF_MAX_BYTES, PNG_MAX_BYTES, hasMagic } from "../../src/oled/oledShare";
import type { SaveOledResult } from "../../src/desktop/api";

export const OledImageSchema = z
  .strictObject({
    kind: z.enum(["png", "gif"]),
    bytes: z.instanceof(Uint8Array),
  })
  .refine((r) => r.bytes.length <= (r.kind === "png" ? PNG_MAX_BYTES : GIF_MAX_BYTES), "over the size cap")
  .refine((r) => hasMagic(r.bytes, r.kind), "not a file of that kind");
export type OledImage = z.infer<typeof OledImageSchema>;
export type { SaveOledResult };

/** Copy takes a PNG only. */
export const OledPngSchema = z
  .instanceof(Uint8Array)
  .refine((b) => b.length <= PNG_MAX_BYTES, "over the size cap")
  .refine((b) => hasMagic(b, "png"), "not a PNG");

export interface SaveDeps {
  // The system save dialog (modal on the app's window); null: cancelled.
  ask: (options: { defaultPath: string; filters: Array<{ name: string; extensions: string[] }> }) => Promise<string | null>;
  write: (path: string, data: Buffer) => void;
  exists: (path: string) => boolean;
  pictures: () => string; // the user's Pictures folder (or home)
  now?: () => Date;
}

/** A default name like ds5-oled-2026-10-14-213005.png (local time). */
export function defaultName(kind: "png" | "gif", now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `ds5-oled-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.${kind}`;
}

/** The chosen path with the kind's extension (added when it's missing or another one). */
export function withExtension(path: string, kind: "png" | "gif"): string {
  return extname(path).toLowerCase() === `.${kind}` ? path : `${path}.${kind}`;
}

export async function saveOledImage(deps: SaveDeps, image: OledImage): Promise<SaveOledResult> {
  const now = deps.now?.() ?? new Date();
  const filters = [{ name: image.kind === "png" ? "PNG" : "GIF", extensions: [image.kind] }];
  let defaultPath = join(deps.pictures(), defaultName(image.kind, now));
  let path: string;
  // The dialog approved the name it was given. With the extension added it
  // can name another file, one that's already there: ask again on that name
  // (the system's dialog then asks whether to replace it), never overwrite unasked.
  // loop: SERIAL-REQUIRED — data dependency: each round waits for the user's answer in the save dialog
  for (;;) {
    const chosen = await deps.ask({ defaultPath, filters });
    if (!chosen) return { saved: false };
    path = withExtension(chosen, image.kind);
    if (path === chosen || !deps.exists(path)) break;
    defaultPath = path;
  }
  // error: PASSES-ON — a write failure rejects the IPC call; the page shows desktop.oledShare.errors.save with the reason
  deps.write(path, Buffer.from(image.bytes));
  return { saved: true, name: basename(path) };
}

export interface CopyDeps {
  decodes: (png: Buffer) => boolean; // the system can read it as a picture
  write: (png: Buffer) => Promise<void>; // onto the clipboard, as image/png
}

export async function copyOledImage(deps: CopyDeps, png: Uint8Array): Promise<void> {
  const buf = Buffer.from(png);
  // error: PASSES-ON — rejects the IPC call; the page shows desktop.oledShare.errors.copy
  if (!deps.decodes(buf)) throw new Error("The picture couldn't be read for the clipboard");
  await deps.write(buf);
}
