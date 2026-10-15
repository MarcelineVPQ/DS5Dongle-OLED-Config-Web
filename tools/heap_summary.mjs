// A V8 heap snapshot (.heapsnapshot, from DevTools or the budget probe:
// tools/budget_probe.mjs) summarized like DevTools' "Summary" view: self size
// and count per constructor (objects, closures, native objects by name;
// strings, code, arrays and the like by type), the totals, and how many nodes
// are detached DOM. Two summaries diffed say what grew.
//
//   node tools/heap_summary.mjs <a.heapsnapshot> [<b.heapsnapshot>]   one summary, or b - a
import { readFileSync } from "node:fs";

// Types whose names are values (a string's text, a number), not constructors.
const BY_TYPE = new Set(["string", "concatenated string", "sliced string", "number", "code", "hidden", "array", "symbol", "bigint", "object shape", "synthetic"]);

// The summary of a parsed snapshot: { totalMb, nodes, detached, byName: { key: { count, size } } }.
export function summarizeSnapshotData(snap, top = 400) {
  const meta = snap.snapshot.meta;
  const fields = meta.node_fields;
  const types = meta.node_types[0];
  const F = fields.length;
  const iType = fields.indexOf("type");
  const iName = fields.indexOf("name");
  const iSize = fields.indexOf("self_size");
  const iDetached = fields.indexOf("detachedness");
  const nodes = snap.nodes;
  const groups = new Map();
  let total = 0;
  let detached = 0;
  for (let i = 0; i < nodes.length; i += F) {
    const type = types[nodes[i + iType]];
    const size = nodes[i + iSize];
    total += size;
    if (iDetached >= 0 && nodes[i + iDetached] === 2) detached++;
    const key = BY_TYPE.has(type) ? `(${type})` : `${type}:${String(snap.strings[nodes[i + iName]]).slice(0, 80)}`;
    const g = groups.get(key) ?? { count: 0, size: 0 };
    g.count++;
    g.size += size;
    groups.set(key, g);
  }
  const byName = Object.fromEntries([...groups].sort((a, b) => b[1].size - a[1].size).slice(0, top));
  return { totalMb: Math.round((total / 1048576) * 100) / 100, nodes: nodes.length / F, detached, byName };
}

export const summarizeHeapSnapshot = (file, top) => summarizeSnapshotData(JSON.parse(readFileSync(file, "utf8")), top);

// What grew from summary a to b: [{ key, count, size (bytes) }], largest first.
export function diffSummaries(a, b, top = 40) {
  const keys = new Set([...Object.keys(a.byName), ...Object.keys(b.byName)]);
  const rows = [...keys].map((key) => {
    const x = a.byName[key] ?? { count: 0, size: 0 };
    const y = b.byName[key] ?? { count: 0, size: 0 };
    return { key, count: y.count - x.count, size: y.size - x.size };
  });
  return rows.sort((p, q) => Math.abs(q.size) - Math.abs(p.size)).slice(0, top);
}

if (process.argv[1]?.endsWith("heap_summary.mjs")) {
  const [a, b] = process.argv.slice(2);
  if (!a) {
    console.error("usage: node tools/heap_summary.mjs <a.heapsnapshot> [<b.heapsnapshot>]");
    process.exit(2);
  }
  const sa = summarizeHeapSnapshot(a);
  if (!b) console.log(JSON.stringify({ ...sa, byName: Object.fromEntries(Object.entries(sa.byName).slice(0, 40)) }, null, 2));
  else {
    const sb = summarizeHeapSnapshot(b);
    console.log(`total ${sa.totalMb} -> ${sb.totalMb} MB, nodes ${sa.nodes} -> ${sb.nodes}, detached ${sa.detached} -> ${sb.detached}`);
    for (const r of diffSummaries(sa, sb)) console.log(`${(r.size / 1024).toFixed(1).padStart(10)} kB ${String(r.count).padStart(8)}  ${r.key}`);
  }
}
