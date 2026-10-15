// The budget gate's optional memory probe (DS5_BUDGET_PROBE=1, or
// tools/check_budgets_vm.sh --probe): for hunting memory growth, never part
// of a judged run. Each soak sample then also records, beside the judged
// memory by process type:
//   - the main process's V8 and Node numbers (process.memoryUsage, the V8
//     heap and its spaces, Electron's getProcessMemoryInfo and getAppMetrics,
//     Node's active handles by kind);
//   - the page's V8 heap (Runtime.getHeapUsage) and DOM counters (documents,
//     nodes, listeners: Memory.getDOMCounters);
//   - per process, the reader's native hints: on Windows handles, threads,
//     GDI and USER objects, private bytes, virtual size and pool usage; on
//     Linux threads, open files, RssAnon and VmData.
// And heap snapshots of main and the page at the start of the soak window and
// at its end (written to DS5_BUDGET_PROBE_DIR, summarized by constructor in
// the results: tools/heap_summary.mjs), each followed by a memory sample
// after that full garbage collection ("afterGc").
//
// It asks the app itself (CDP, getAppMetrics), so the app does a little work
// because it is measured: use it to find a cause, then judge with a run
// without it.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { summarizeHeapSnapshot } from "./heap_summary.mjs";

export const probeEnabled = () => process.env.DS5_BUDGET_PROBE === "1";

// The main process's numbers (evaluated there through its inspector).
const MAIN_PROBE = `(async () => {
  const v8 = require("v8");
  const { app } = require("electron");
  const mb = (n) => Math.round((n / 1048576) * 100) / 100;
  const mu = process.memoryUsage();
  const hs = v8.getHeapStatistics();
  const pm = await process.getProcessMemoryInfo();
  const handles = {};
  for (const r of process.getActiveResourcesInfo()) handles[r] = (handles[r] ?? 0) + 1;
  return {
    rss: mb(mu.rss), heapUsed: mb(mu.heapUsed), heapTotal: mb(mu.heapTotal), external: mb(mu.external), arrayBuffers: mb(mu.arrayBuffers),
    v8: { used: mb(hs.used_heap_size), total: mb(hs.total_heap_size), physical: mb(hs.total_physical_size), malloced: mb(hs.malloced_memory), external: mb(hs.external_memory), nativeContexts: hs.number_of_native_contexts, detachedContexts: hs.number_of_detached_contexts },
    spaces: Object.fromEntries(v8.getHeapSpaceStatistics().map((s) => [s.space_name, mb(s.space_used_size)])),
    processMemoryInfo: { privateMb: mb(pm.private * 1024), residentMb: mb((pm.residentSet ?? 0) * 1024), sharedMb: mb(pm.shared * 1024) },
    appMetrics: app.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, name: m.serviceName ?? m.name ?? null, wsMb: mb(m.memory.workingSetSize * 1024), privateMb: m.memory.privateBytes == null ? null : mb(m.memory.privateBytes * 1024) })),
    handles,
  };
})()`;

// One probe: { main, page, procs } (any part that fails is { error }).
export async function probeNow({ page, mainEv, ev, reader, mainPid }) {
  const safe = async (f) => {
    try {
      return await f();
    } catch (cause) {
      return { error: String(cause?.message ?? cause).slice(0, 200) };
    }
  };
  const mb = (n) => Math.round((n / 1048576) * 100) / 100;
  return {
    main: await safe(() => mainEv(MAIN_PROBE)),
    page: await safe(async () => {
      const heap = (await page.send("Runtime.getHeapUsage")).result ?? {};
      const dom = (await page.send("Memory.getDOMCounters")).result ?? {};
      const extra = await ev(
        `({ imgs: document.images.length, canvases: document.getElementsByTagName("canvas").length, elements: document.getElementsByTagName("*").length, animations: document.getAnimations().length })`,
      );
      return {
        heapUsed: mb(heap.usedSize ?? 0),
        heapTotal: mb(heap.totalSize ?? 0),
        embedderUsed: mb(heap.embedderHeapUsedSize ?? 0),
        backingStorage: mb(heap.backingStorageSize ?? 0),
        ...dom,
        ...extra,
      };
    }),
    procs: await safe(() => (reader.probe ? reader.probe(mainPid) : null)),
  };
}

// A heap snapshot of one CDP session (the page or main), written to `file`
// chunk by chunk, then summarized by constructor. Taking it runs a full
// garbage collection in that process.
export async function heapSnapshot(session, file) {
  writeFileSync(file, "");
  const h = (d) => {
    if (d.method === "HeapProfiler.addHeapSnapshotChunk") appendFileSync(file, d.params.chunk);
  };
  session.handlers.add(h);
  try {
    await session.send("HeapProfiler.enable");
    await session.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  } finally {
    session.handlers.delete(h);
  }
  return file;
}

// Snapshots of main and the page, labelled (e.g. "start", "end"); returns
// the files. Summaries are made afterwards (summarizeSnapshots), so parsing
// a big snapshot never sits inside the soak.
export async function snapshotBoth({ page, main }, label) {
  const dir = process.env.DS5_BUDGET_PROBE_DIR || "tmp/budget-probe";
  mkdirSync(dir, { recursive: true });
  return {
    label,
    main: await heapSnapshot(main, join(dir, `main-${label}.heapsnapshot`)),
    page: await heapSnapshot(page, join(dir, `page-${label}.heapsnapshot`)),
  };
}

export function summarizeSnapshots(snapshots) {
  return snapshots.map((s) => ({ label: s.label, t: s.t, main: summarizeHeapSnapshot(s.main, 200), page: summarizeHeapSnapshot(s.page, 200) }));
}
