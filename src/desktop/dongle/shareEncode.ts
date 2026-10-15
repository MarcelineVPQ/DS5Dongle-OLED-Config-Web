// Runs Share's encoder (src/oled/oledShare.ts) in a worker, so a GIF of 100
// big frames never stalls the page. One worker per request, ended with its
// reply: nothing runs until Share is used.
import { ShareTooBig, type ShareRequest } from "../../oled/oledShare";
import type { ShareReply } from "../../oled/share.worker";

export function encodeOffThread(req: ShareRequest): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    // lifetime: OK — terminated on its reply or error, below (one request per worker)
    const worker = new Worker(new URL("../../oled/share.worker.ts", import.meta.url), { type: "module" });
    const done = () => worker.terminate();
    // lifetime: OK — the worker (and its handlers) end with done() on the first reply
    worker.onmessage = (event: MessageEvent<ShareReply>) => {
      done();
      const r = event.data;
      if (r.ok) resolve(r.bytes);
      else reject(r.tooBig !== null ? new ShareTooBig(r.tooBig) : new Error(r.message));
    };
    // lifetime: OK — the worker (and its handlers) end with done()
    // error: PASSES-ON — rejects; OledShare shows desktop.oledShare.errors.encode
    worker.onerror = (event) => {
      done();
      reject(new Error(event.message || "The encoder didn't start"));
    };
    worker.postMessage(req);
  });
}
