// Share's encoder off the UI thread: one request in (a PNG or a GIF of the
// OLED, oledShare.ts), the file's bytes out, then the page ends the worker.
// Started only when Share is used (shareEncode.ts), never kept running.
import { encodeShare, ShareTooBig, type ShareRequest } from "./oledShare";

// error: PASSES-ON — a failed reply rejects encodeOffThread; OledShare shows desktop.oledShare.errors.encode / .tooBig
export type ShareReply = { ok: true; bytes: Uint8Array } | { ok: false; tooBig: number | null; message: string };

// The dedicated worker's scope (the DOM lib types `self` as a Window).
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ShareRequest>) => void) | null;
  postMessage(reply: ShareReply, transfer?: Transferable[]): void;
};

// lifetime: OK — the worker's one handler; the page terminates the worker after its reply (shareEncode.ts)
scope.onmessage = (event) => {
  // error: PASSES-ON — the reply carries the failure; shareEncode.ts rejects with it and OledShare shows it
  encodeShare(event.data).then(
    (bytes) => scope.postMessage({ ok: true, bytes }, [bytes.buffer]),
    // error: PASSES-ON — the reply carries the failure; shareEncode.ts rejects with it and OledShare shows it
    (cause: unknown) => scope.postMessage({ ok: false, tooBig: cause instanceof ShareTooBig ? cause.limit : null, message: cause instanceof Error ? cause.message : String(cause) }),
  );
};
