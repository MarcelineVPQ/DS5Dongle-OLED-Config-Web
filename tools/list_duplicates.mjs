#!/usr/bin/env node
// Duplication candidates, listed mechanically (the AVIEW rule: never review
// by eye). Three kinds, one TSV row each, for docs/DEDUPE_AUDIT.md:
//   css-selector  a selector defined in more than one rule (outside @media /
//                 theme blocks it may be a drifted copy)
//   name          a top-level function / const arrow defined in more than one file
//   block         the same 4 normalized lines in more than one place
// Usage: node tools/list_duplicates.mjs > dupes.tsv
//        node tools/list_duplicates.mjs --check   (in `npm run gates`)
// --check compares the rows with docs/DEDUPE_AUDIT.md's "Every row now" table
// (kind + what + the set of files; line numbers and counts are ignored) and
// fails on a row with no verdict there, or a table row the lister no longer
// finds (merged: take it out). F48: the lister used to be manual only.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
// Matched against the repo-relative path (forward slashes), never the absolute
// one: a checkout under ".../about-light/" or ".../dist/" must not skip everything.
const SKIP = /(^|\/)(node_modules|dist|out|release)\/|^src\/flash\/picoflash\/|^src\/i18n\/|\.d\.ts$/;
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (SKIP.test(relative(ROOT, p).replace(/\\/g, "/"))) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|css|mjs)$/.test(p)) files.push(p);
  }
};
["src", "electron", "tools", ".hooks"].forEach((d) => walk(join(ROOT, d)));
const rel = (p) => relative(ROOT, p);
const rows = [];

// --- CSS: each selector of each top-level or @media rule ---
const selectors = new Map();
for (const file of files.filter((f) => f.endsWith(".css"))) {
  const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const visit = (text, offset, context) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) break;
      let depth = 0;
      let k = open;
      for (; k < text.length; k++) {
        if (text[k] === "{") depth++;
        else if (text[k] === "}" && --depth === 0) break;
      }
      const prelude = text.slice(i, open).trim();
      const body = text.slice(open + 1, k);
      if (prelude.startsWith("@media") || prelude.startsWith("@supports")) visit(body, offset + open + 1, prelude);
      else if (!prelude.startsWith("@")) {
        const line = src.slice(0, offset + i + (text.slice(i).length - text.slice(i).trimStart().length)).split("\n").length;
        for (const sel of prelude.split(",").map((s) => s.trim().replace(/\s+/g, " "))) {
          if (!sel || /^(from|to|\d+%)$/.test(sel)) continue;
          const key = `${context}|${sel}`;
          if (!selectors.has(key)) selectors.set(key, []);
          selectors.get(key).push(`${rel(file)}:${line}`);
        }
      }
      i = k + 1;
    }
  };
  visit(src, 0, "");
}
for (const [key, at] of selectors) {
  if (at.length < 2) continue;
  const [context, sel] = key.split("|");
  rows.push(["css-selector", `${sel}${context ? ` (${context})` : ""}`, at.length, at.join(" ")]);
}

// --- Names: top-level functions / const arrows in more than one file ---
const names = new Map();
for (const file of files.filter((f) => /\.(ts|tsx|mjs)$/.test(f))) {
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      const m = /^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>)/.exec(line);
      const name = m?.[1] ?? m?.[2];
      if (!name) return;
      if (!names.has(name)) names.set(name, []);
      names.get(name).push(`${rel(file)}:${i + 1}`);
    });
}
for (const [name, at] of names) {
  const filesWith = new Set(at.map((a) => a.split(":")[0]));
  if (filesWith.size > 1 && !/^(default|App|main)$/.test(name)) rows.push(["name", name, filesWith.size, at.join(" ")]);
}

// --- Blocks: 6 normalized non-trivial lines repeated ---
const WINDOW = 4;
const blocks = new Map();
for (const file of files.filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !/(^|\/)tests?\//.test(rel(f)))) {
  const lines = readFileSync(file, "utf8").split("\n");
  const norm = lines.map((l) => l.trim().replace(/\s+/g, " "));
  for (let i = 0; i + WINDOW <= norm.length; i++) {
    const win = norm.slice(i, i + WINDOW);
    // skip windows that are mostly braces, imports, comments or blank
    const real = win.filter((l) => l.length > 12 && !/^(import|\/\/|\*|\/\*|[})\];,]+$)/.test(l));
    if (real.length < WINDOW - 1) continue;
    const key = win.join("\n");
    if (!blocks.has(key)) blocks.set(key, []);
    blocks.get(key).push(`${rel(file)}:${i + 1}`);
  }
}
// Collapse overlapping windows: keep the first window of each run per location pair.
const seen = new Set();
for (const [key, at] of blocks) {
  if (at.length < 2) continue;
  const sig = at.map((a) => a.replace(/:(\d+)$/, (_, n) => `:${Math.floor(Number(n) / WINDOW)}`)).join(" ");
  if (seen.has(sig)) continue;
  seen.add(sig);
  rows.push(["block", key.split("\n")[0].slice(0, 80), at.length, at.join(" ")]);
}

if (!process.argv.includes("--check")) {
  console.log(["kind", "what", "count", "where"].join("\t"));
  for (const r of rows) console.log(r.join("\t"));
  process.exit(0);
}

// A row's identity: kind, what (a blank first line reads "(blank line)" in the
// doc) and its files, without line numbers.
const BLANK = "(blank line)";
const keyOf = (kind, what, where) => [kind, what || BLANK, [...new Set(where.map((w) => w.replace(/:\d+$/, "")))].sort().join(" ")].join("\t");
const DOC = join(ROOT, "docs/DEDUPE_AUDIT.md");
const table =
  readFileSync(DOC, "utf8")
    .split(/^## Every row now$/m)[1]
    ?.split(/^## /m)[0] ?? "";
// Cells split on unescaped pipes; `\|` inside code is a literal pipe.
const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
const stripTicks = (c) => c.replace(/^`+ ?/, "").replace(/ ?`+$/, "");
const documented = new Set();
for (const line of table.split("\n")) {
  if (!line.startsWith("|") || /^\|\s*(Kind|---)/.test(line)) continue;
  const c = cells(line);
  if (c.length < 6) continue;
  const where = [...c[5].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  documented.add(keyOf(c[0], stripTicks(c[1]), where));
}
const found = new Set(rows.map((r) => keyOf(r[0], r[1], r[3].split(" "))));
const missing = rows.filter((r) => !documented.has(keyOf(r[0], r[1], r[3].split(" "))));
const stale = [...documented].filter((k) => !found.has(k));
if (!documented.size) {
  console.log("Duplicates gate: no rows read from docs/DEDUPE_AUDIT.md (## Every row now)");
  process.exit(1);
}
if (missing.length || stale.length) {
  if (missing.length) {
    console.log("Duplicates gate: new duplicate candidates with no verdict in docs/DEDUPE_AUDIT.md (merge them, or add a row):");
    for (const r of missing) console.log(r.join("\t"));
  }
  if (stale.length) {
    console.log("Duplicates gate: docs/DEDUPE_AUDIT.md rows the lister no longer finds (merged or moved: update the table):");
    for (const k of stale) console.log(k);
  }
  process.exit(1);
}
