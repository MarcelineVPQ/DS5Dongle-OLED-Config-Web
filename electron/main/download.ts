// Streamed, verified download: refuses anything bigger than declared and
// deletes the file unless both size and SHA-256 match. Shared by the app
// updater and the Proton installer.
import { createHash } from "node:crypto";
import { createWriteStream, rmSync } from "node:fs";
import { net } from "electron";
import type { Download } from "../../src/update/manifest";

export async function downloadVerified(download: Download, path: string, progress: (got: number, total: number) => void, signal?: AbortSignal): Promise<void> {
  rmSync(path, { force: true });
  const response = await net.fetch(download.url, { signal });
  if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status}).`);
  const hash = createHash("sha256");
  const file = createWriteStream(path);
  let got = 0;
  let lastReport = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.byteLength;
      if (got > download.size) throw new Error("The download is larger than the manifest says.");
      hash.update(value);
      if (!file.write(value)) await new Promise<void>((r) => file.once("drain", () => r()));
      if (Date.now() - lastReport > 150) {
        lastReport = Date.now();
        progress(got, download.size);
      }
    }
    await new Promise<void>((resolve, reject) => file.end((err?: Error | null) => (err ? reject(err) : resolve())));
  } catch (cause) {
    file.destroy();
    rmSync(path, { force: true });
    throw cause;
  }
  progress(got, download.size);
  if (got !== download.size || hash.digest("hex") !== download.sha256) {
    rmSync(path, { force: true });
    throw new Error("The download is corrupt (size or checksum mismatch).");
  }
}
