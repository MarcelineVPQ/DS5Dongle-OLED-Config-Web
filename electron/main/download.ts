// Verified downloads, shared by the app updater, the firmware updater and the
// Proton installer: anything bigger than declared is refused, and nothing is
// kept unless both size and SHA-256 match. A write error (disk full, I/O)
// rejects cleanly instead of crashing the main process. A server that doesn't
// answer, or a download that stops sending data, fails instead of hanging
// (which would also hold the Games queue and the updater's busy flag).
import { createHash } from "node:crypto";
import { createWriteStream, rmSync } from "node:fs";
import { net } from "electron";
import type { Download } from "../../src/update/manifest";

const corrupt = () => new Error("The download is corrupt (size or checksum mismatch).");
const CONNECT_TIMEOUT_MS = 20_000;
const STALL_TIMEOUT_MS = 60_000;
const stalled = () => new Error("The download stopped (no data for a minute). Check the connection and try again.");

export function verifyBytes(download: Download, bytes: Uint8Array): void {
  if (bytes.byteLength !== download.size || createHash("sha256").update(bytes).digest("hex") !== download.sha256) throw corrupt();
}

// Small files (firmware): into memory, verified.
export async function downloadBytes(download: Download): Promise<Uint8Array> {
  const response = await net.fetch(download.url, { signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS + STALL_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}).`);
  if (Number(response.headers.get("content-length") ?? 0) > download.size) throw new Error("The download is larger than the manifest says.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  verifyBytes(download, bytes);
  return bytes;
}

// Large files: streamed to `path`, hashed on the way, deleted on any failure.
export async function downloadVerified(download: Download, path: string, progress: (got: number, total: number) => void): Promise<void> {
  rmSync(path, { force: true });
  const response = await net.fetch(download.url, { signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) }).catch((cause: unknown) => {
    throw cause instanceof Error && cause.name === "TimeoutError" ? new Error("The download server didn't answer. Check the connection and try again.") : cause;
  });
  if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status}).`);
  const reader = response.body.getReader();
  const hash = createHash("sha256");
  const file = createWriteStream(path);
  // The first write error, surfaced at the next await instead of as an uncaught event.
  let writeError: Error | null = null;
  const failed = new Promise<never>((_, reject) =>
    // lifetime: OK — goes with the stream: ended on success, destroyed on any failure
    file.on("error", (err) => {
      writeError = err;
      reject(err);
    }),
  );
  failed.catch(() => undefined);
  let got = 0;
  let lastReport = 0;
  try {
    // loop: SERIAL-REQUIRED — stream order: each chunk is hashed and written in sequence, stall deadline
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      // lifetime: OK — cleared in .finally() after every read
      const stall = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(stalled()), STALL_TIMEOUT_MS)));
      const { done, value } = await Promise.race([reader.read(), failed, stall]).finally(() => clearTimeout(timer));
      if (done) break;
      if (writeError) throw writeError;
      got += value.byteLength;
      if (got > download.size) throw new Error("The download is larger than the manifest says.");
      hash.update(value);
      // lifetime: OK — fires once on drain; the stream is destroyed if `failed` wins instead
      if (!file.write(value)) await Promise.race([new Promise<void>((r) => file.once("drain", () => r())), failed]);
      if (Date.now() - lastReport > 150) {
        lastReport = Date.now();
        progress(got, download.size);
      }
    }
    await Promise.race([new Promise<void>((resolve, reject) => file.end((err?: Error | null) => (err ? reject(err) : resolve()))), failed]);
  } catch (cause) {
    void reader.cancel().catch(() => undefined);
    file.destroy();
    rmSync(path, { force: true });
    throw cause;
  }
  progress(got, download.size);
  if (got !== download.size || hash.digest("hex") !== download.sha256) {
    rmSync(path, { force: true });
    throw corrupt();
  }
}
