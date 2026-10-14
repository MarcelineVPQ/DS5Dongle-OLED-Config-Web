#!/usr/bin/env node
// The hint gate: what stays on screen under a label is what you must know
// before acting; longer explanations go behind the ⓘ (InfoTip, controls.tsx:
// Row's `info`, SectionGroup's `info`). Listed mechanically from the TSX
// syntax of src/desktop (no type checker needed):
//   sub    a row's visible hint: the `sub` of a Row, Toggle, Slider,
//          Segmented or KnobSlider;
//   hint   a hint paragraph: an element whose class has "dk-hint".
// Each t("key") in it (and a file's own helpers like
// `const td = (k) => t(\`desktop.dash.${k}\`)`) is looked up in the English
// strings (a template key: its longest match). Longer than HINT_LIMIT
// characters fails, unless the element says why it must stay visible:
// `// hint: MUST-SHOW — reason` on its line or the line above
// ({/* … */} in JSX). Must-show: a warning, a unit or range, a live status
// (what is happening now), the text that IS the content (an empty state).
//
// Usage: node tools/list_hints.mjs           TSV: file line kind length key
//        node tools/list_hints.mjs --check   the gate (npm run gates)
// tests/unit/hintGate.test.ts runs hintFindings() on small sources.
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { attr, lineOf, tagOf, walk } from "./list_settings.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\\/g, "/");
export const HINT_LIMIT = 60;
const ROW_TAGS = new Set(["Row", "Toggle", "Slider", "Segmented", "KnobSlider"]);
const MUST_SHOW = /hint: MUST-SHOW — \S/;

// "a.b.c" -> value, for every string in a nested locale object.
export function flatten(obj, prefix = "", out = new Map()) {
  // loop: NOT-WORTH — the locale's keys (≈ 3000), once per gate run
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else if (v && typeof v === "object") flatten(v, key, out);
  }
  return out;
}

// A key argument as a pattern: a string literal, or a template with `${…}` parts (any one key segment).
const reSafe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function keyPattern(arg, prefix = "", suffix = "") {
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return { key: prefix + arg.text + suffix, re: null };
  if (ts.isTemplateExpression(arg)) {
    // loop: NOT-WORTH — N = a template's parts (≤ 3)
    const parts = [reSafe(arg.head.text), ...arg.templateSpans.map((s) => `[^.]+${reSafe(s.literal.text)}`)];
    const text = prefix + arg.getText() + suffix;
    return { key: text, re: new RegExp(`^${reSafe(prefix)}${parts.join("")}${reSafe(suffix)}$`) };
  }
  // Any other expression (a variable): any key at this place.
  if (prefix || suffix) return { key: `${prefix}…${suffix}`, re: new RegExp(`^${reSafe(prefix)}[^.]+${reSafe(suffix)}$`) };
  return null;
}

// Every over-long visible hint in these sources ({ file, text }), with `strings` (Map key -> English).
export function hintFindings(sources, strings, limit = HINT_LIMIT) {
  const rows = [];
  // loop: NOT-WORTH — N = the app's TSX files (≈ 150); once per gate run
  for (const x of sources) {
    const sf = ts.createSourceFile(x.file, x.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const lines = x.text.split("\n");
    // The file's own t() helpers: const td = (k, o) => t(`desktop.dash.${k}`, o)
    const helpers = new Map();
    walk(sf, (n) => {
      if (!ts.isVariableDeclaration(n) || !ts.isIdentifier(n.name) || !n.initializer || !ts.isArrowFunction(n.initializer)) return;
      const body = n.initializer.body;
      if (!ts.isCallExpression(body) || body.expression.getText() !== "t" || !body.arguments[0] || !ts.isTemplateExpression(body.arguments[0])) return;
      const tpl = body.arguments[0];
      if (tpl.templateSpans.length !== 1) return;
      helpers.set(n.name.text, { prefix: tpl.head.text, suffix: tpl.templateSpans[0].literal.text });
    });
    // The longest English text a t() call in this expression can show.
    const longest = (expr) => {
      let best = null;
      walk(expr, (n) => {
        if (!ts.isCallExpression(n) || !n.arguments[0]) return;
        const callee = n.expression.getText();
        const h = helpers.get(callee);
        const pat = callee === "t" || callee === "i18n.t" ? keyPattern(n.arguments[0]) : h ? keyPattern(n.arguments[0], h.prefix, h.suffix) : null;
        if (!pat) return;
        const fallback = n.arguments[1] && ts.isStringLiteral(n.arguments[1]) ? n.arguments[1].text : null;
        // loop: NOT-WORTH — N = the locale's keys (≈ 3000) for a template key; once per gate run
        const texts = pat.re ? [...strings].filter(([k]) => pat.re.test(k)).map(([, v]) => v) : [strings.get(pat.key) ?? fallback ?? ""];
        // loop: NOT-WORTH — N = a template key's matches (≤ ~10)
        for (const text of texts) if (!best || text.length > best.text.length) best = { key: pat.key, text };
      });
      return best;
    };
    const check = (n, kind, expr) => {
      const found = longest(expr);
      if (!found || found.text.length <= limit) return;
      const at = lineOf(sf, n) - 1;
      const marked = [lines[at], lines[at - 1]].some((l) => l && MUST_SHOW.test(l));
      rows.push({ file: x.file, line: at + 1, kind, length: found.text.length, key: found.key, mustShow: marked });
    };
    walk(sf, (n) => {
      const tag = tagOf(n);
      if (!tag) return;
      if (ROW_TAGS.has(tag)) {
        const sub = attr(n, "sub");
        if (sub?.initializer && ts.isJsxExpression(sub.initializer) && sub.initializer.expression) check(n, "sub", sub.initializer.expression);
      }
      const cls = attr(n, "className");
      const clsText = cls?.initializer ? (ts.isStringLiteral(cls.initializer) ? cls.initializer.text : cls.initializer.getText()) : "";
      if (/(^|[\s"'`])dk-hint($|[\s"'`])/.test(clsText) && ts.isJsxElement(n)) {
        // loop: NOT-WORTH — N = an element's children (≤ ~5)
        for (const c of n.children) if (ts.isJsxExpression(c) && c.expression) check(n, "hint", c.expression);
      }
    });
  }
  return rows;
}

function main() {
  const files = ts.sys.readDirectory(join(ROOT, "src/desktop"), [".tsx"]).map((f) => relative(ROOT, f).replace(/\\/g, "/"));
  // loop: NOT-WORTH — N = the app's TSX files (≈ 150); once per gate run
  const sources = files.map((file) => ({ file, text: readFileSync(join(ROOT, file), "utf8") }));
  const strings = flatten(JSON.parse(readFileSync(join(ROOT, "src/i18n/locales/en.json"), "utf8")));
  const rows = hintFindings(sources, strings);
  if (!process.argv.includes("--check")) {
    console.log("file\tline\tkind\tlength\tmust-show\tkey");
    // loop: NOT-WORTH — N = the findings; once per run
    for (const r of rows) console.log(`${r.file}\t${r.line}\t${r.kind}\t${r.length}\t${r.mustShow ? "yes" : ""}\t${r.key}`);
    return;
  }
  // loop: NOT-WORTH — N = the findings; once per gate run
  const bad = rows.filter((r) => !r.mustShow);
  // loop: NOT-WORTH — N = the problems; once per gate run
  for (const r of bad) console.error(`${r.file}:${r.line}: ${r.kind}: ${r.key} is ${r.length} characters on screen (over ${HINT_LIMIT})`);
  if (bad.length) {
    console.error(
      `\n${bad.length} hint(s) too long to stay on screen. Move the explanation behind the ⓘ (Row's or SectionGroup's \`info\`, InfoTip), or say why it must stay visible: // hint: MUST-SHOW — reason`,
    );
    process.exit(1);
  }
  console.log(`hint gate: ${rows.length} long hints, each marked must-show with its reason.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
