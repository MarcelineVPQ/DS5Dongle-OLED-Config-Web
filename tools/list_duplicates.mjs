#!/usr/bin/env node
// Duplication candidates, listed mechanically (the AVIEW rule: never review
// by eye). Three kinds, one TSV row each, for docs/DEDUPE_AUDIT.md:
//   css-selector  a selector defined in more than one rule (outside @media /
//                 theme blocks it may be a drifted copy)
//   name          a top-level function / const arrow defined in more than one file
//   block         the same 4 normalized lines in more than one place
// Usage: node tools/list_duplicates.mjs > dupes.tsv
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SKIP = /(node_modules|dist|out|release|src\/flash\/picoflash|src\/i18n|\.d\.ts$)/;
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (SKIP.test(p)) continue;
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
for (const file of files.filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !/tests?\//.test(f))) {
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

console.log(["kind", "what", "count", "where"].join("\t"));
for (const r of rows) console.log(r.join("\t"));
