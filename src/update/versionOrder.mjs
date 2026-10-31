// The one version ordering (2026-10-31 review: it was written three times
// across the repos and had drifted). Plain JavaScript so both the app
// (src/update/manifest.ts, the installed updater) and the Node tools
// (tools/doc_gates.mjs, the release gate) import this file; the firmware's
// feed builder (tools/manifest_lib.mjs versionKey) is held to the same table
// of cases by tests/unit/versionOrder.test.ts.

// `v0.8.0-oled-edition`, `0.8.0`, `0.7.0-vendor` -> [0, 8, 0]. Anything after
// the first "-" is a channel label, not part of the ordering. Returns null for
// anything else; callers treat null as "can't tell", never as "newer".
export function parseVersion(raw) {
  if (!raw) return null;
  let s = raw.trim();
  if (s.startsWith("v") || s.startsWith("V")) s = s.slice(1);
  const dash = s.indexOf("-");
  if (dash !== -1) s = s.slice(0, dash);
  const parts = s.split(".");
  // loop: HOT-PATH-OK — N = 3 version parts
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

// A development build's number: "0.9.1-dev.3", "v0.9.1-dev.3-oled-edition"
// -> 3; null for a stable version.
export function devNumber(raw) {
  const m = /-dev\.(\d+)(?:-|$)/.exec(raw?.trim() ?? "");
  return m ? Number(m[1]) : null;
}

// [major, minor, patch, dev number or Infinity]: development builds come
// before their release (0.9.1-dev.1 < 0.9.1-dev.2 < 0.9.1). null when it
// can't be read.
export function versionKey(raw) {
  const v = parseVersion(raw);
  if (!v) return null;
  return [...v, devNumber(raw) ?? Infinity];
}

// -1, 0 or 1 (a before, equal to, after b); null when either can't be read.
export function compareVersions(a, b) {
  const x = versionKey(a);
  const y = versionKey(b);
  if (!x || !y) return null;
  // loop: HOT-PATH-OK — N = 4 version parts
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
