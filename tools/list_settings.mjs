#!/usr/bin/env node
// The settings gate: one framework for every setting (CLAUDE.md "Gates, not
// prose"; src/desktop/accordion/Section.tsx). Listed mechanically from the
// TSX syntax of src/desktop (no type checker needed):
//   card     a settings card: an element whose class has "dk-card" with an
//            <h2> right inside it (the old card-per-setting pattern). Dialogs
//            (dk-dialog) are not cards; anything else that only looks like
//            one says so: `// settings-gate: not-settings — reason` on its
//            line or the line above ({/* … */} in JSX).
//   row      a setting row (Row, Toggle, Slider, Segmented, KnobSlider,
//            GripHaptics) or an action button (BusyButton) that isn't inside
//            a Section: neither under a <Section> in its JSX nor in a
//            component rendered inside one (followed by name, transitively).
//   bare     a <select> or <input type="range"> outside a Row (a setting
//            without its label and hint).
//   section  a <Section> without a stable id (a string, or a value from a
//            typed list), a lucide icon, a translated title (t(...)), a
//            unique id in its file, or a body that is a function (so a
//            closed section renders nothing).
// Every page is on the accordion: no page is allowed findings. Files that
// aren't settings pages at all (the setup flow, the shell's bars, the game
// library's views) are NOT_SETTINGS, each with its reason; an entry with no
// findings left fails too, so the list only shrinks.
//
// Usage: node tools/list_settings.mjs           TSV: file line kind detail
//        node tools/list_settings.mjs --check   the gate (npm run gates)
// tests/unit/settingsGate.test.ts runs settingsFindings() on small sources.
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\\/g, "/");
// The framework itself (Row and the controls are defined here) is not checked.
const FRAMEWORK = new Set(["src/desktop/controls.tsx", "src/desktop/accordion/Section.tsx"]);

// Not settings pages: their buttons and choices aren't settings rows.
export const NOT_SETTINGS = {
  "src/desktop/DesktopApp.tsx": "the app shell: the save bar and the profile-editing bar (they stay as they are)",
  "src/desktop/UpdateBanners.tsx": "the update notices' actions (Download and install)",
  "src/desktop/SetupScreen.tsx": "the first-run setup flow (flash the board), not a settings page",
  "src/desktop/WindowsUsbRepair.tsx": "a one-time repair flow (the Windows driver), shown in a notice",
  "src/desktop/library/playBar.tsx": "the game page's Play bar and its launcher links (its main view)",
  "src/desktop/library/GameLibrary.tsx": "the game library's toolbar (sort and filter), not settings",
};

const ROWS = new Set(["Row", "Toggle", "Slider", "Segmented", "KnobSlider", "GripHaptics", "BusyButton"]);
const ROW_LIKE = new Set(["Row", "Toggle", "Slider", "Segmented", "KnobSlider", "GripHaptics"]);
const tagOf = (n) => (ts.isJsxElement(n) ? n.openingElement.tagName.getText() : ts.isJsxSelfClosingElement(n) ? n.tagName.getText() : null);
const attrsOf = (n) => (ts.isJsxElement(n) ? n.openingElement.attributes : n.attributes).properties;
const attr = (n, name) => attrsOf(n).find((a) => ts.isJsxAttribute(a) && a.name.getText() === name);
const attrText = (n, name) => {
  const a = attr(n, name);
  if (!a?.initializer) return "";
  if (ts.isStringLiteral(a.initializer)) return a.initializer.text;
  return a.initializer.getText();
};
const lineOf = (sf, n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
const exempt = (x, n) => {
  const lines = x.text.split("\n");
  const at = lineOf(x.sf, n) - 1;
  return [lines[at], lines[at - 1]].some((l) => l && /settings-gate: not-settings — \S/.test(l));
};
// The JSX-tag ancestors of a node (within its file).
const jsxAncestors = (n) => {
  const out = [];
  for (let p = n.parent; p; p = p.parent) {
    const tag = tagOf(p);
    if (tag) out.push(tag);
  }
  return out;
};
// The module-level component a node is in (its name), if any.
const componentOf = (n) => {
  let top = null;
  for (let p = n; p && !ts.isSourceFile(p); p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name) top = p.name.text;
    else if (
      ts.isVariableDeclaration(p) &&
      ts.isIdentifier(p.name) &&
      p.initializer &&
      (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer) || ts.isCallExpression(p.initializer))
    )
      top = p.name.text;
  }
  return top && /^[A-Z]/.test(top) ? top : null;
};
const walk = (node, fn) => {
  fn(node);
  ts.forEachChild(node, (c) => walk(c, fn));
};

// Every finding in these sources ({ file, text }: TSX, paths from the repo root).
export function settingsFindings(sources) {
  const parsed = sources.map((x) => ({ ...x, sf: ts.createSourceFile(x.file, x.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) }));
  // Components rendered inside a Section, followed transitively by name.
  const bodies = new Map(); // component name -> its declaration nodes
  for (const x of parsed)
    walk(x.sf, (n) => {
      const name = ts.isFunctionDeclaration(n) && n.name ? n.name.text : ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && /^[A-Z]/.test(n.name.text) ? n.name.text : null;
      if (name && /^[A-Z]/.test(name)) bodies.set(name, [...(bodies.get(name) ?? []), n]);
    });
  const inSection = new Set();
  const queue = [];
  const tagsUnder = (node, add) =>
    walk(node, (n) => {
      const tag = tagOf(n);
      if (tag && /^[A-Z]/.test(tag) && tag !== "Section") add(tag);
      // memo(Component): the memoized one renders the component.
      if (ts.isCallExpression(n) && n.expression.getText() === "memo" && n.arguments[0] && ts.isIdentifier(n.arguments[0])) add(n.arguments[0].text);
    });
  const add = (name) => {
    if (!inSection.has(name)) {
      inSection.add(name);
      queue.push(name);
    }
  };
  for (const x of parsed)
    walk(x.sf, (n) => {
      if (tagOf(n) === "Section") tagsUnder(n, add);
    });
  while (queue.length) for (const decl of bodies.get(queue.pop()) ?? []) tagsUnder(decl, add);

  const rows = [];
  const finding = (x, n, kind, detail) => rows.push({ file: x.file, line: lineOf(x.sf, n), kind, detail });
  for (const x of parsed) {
    if (FRAMEWORK.has(x.file)) continue;
    const ids = new Map();
    const lucide = new Set();
    walk(x.sf, (n) => {
      if (ts.isImportDeclaration(n) && n.moduleSpecifier.getText().includes("lucide-react")) n.importClause?.namedBindings?.elements?.forEach((e) => lucide.add(e.name.text));
    });
    walk(x.sf, (n) => {
      const tag = tagOf(n);
      if (!tag) return;
      if (tag === "Section") {
        const id = attr(n, "id");
        const icon = attr(n, "icon");
        const title = attr(n, "title");
        const idText = attrText(n, "id");
        if (!id?.initializer) finding(x, n, "section", "no id");
        else if (ts.isStringLiteral(id.initializer)) {
          if (ids.has(idText)) finding(x, n, "section", `id "${idText}" used twice`);
          ids.set(idText, true);
        }
        const iconExpr = icon?.initializer && ts.isJsxExpression(icon.initializer) ? icon.initializer.expression : null;
        if (!iconExpr || (ts.isIdentifier(iconExpr) ? !lucide.has(iconExpr.text) : lucide.size === 0)) finding(x, n, "section", "icon is not a lucide icon");
        if (!title?.initializer || !/\bt\(/.test(title.initializer.getText())) finding(x, n, "section", "title is not translated (t(...))");
        const kids = ts.isJsxElement(n) ? n.children.filter((c) => !(ts.isJsxText(c) && !c.text.trim())) : [];
        const fnBody = kids.length === 1 && ts.isJsxExpression(kids[0]) && kids[0].expression && (ts.isArrowFunction(kids[0].expression) || ts.isFunctionExpression(kids[0].expression));
        if (!fnBody) finding(x, n, "section", "body is not a function ({() => …}): a closed section would still render it");
        return;
      }
      const cls = attrText(n, "className");
      if (/\bdk-card\b/.test(cls) && !/\bdk-dialog\b/.test(cls) && ts.isJsxElement(n) && n.children.some((c) => tagOf(c) === "h2") && !exempt(x, n))
        finding(x, n, "card", `a settings card (${cls.replace(/\s+/g, " ").slice(0, 40)})`);
      const ancestors = jsxAncestors(n);
      if (ROWS.has(tag)) {
        const comp = componentOf(n);
        if (!ancestors.includes("Section") && !(comp && inSection.has(comp))) finding(x, n, "row", `<${tag}> outside a Section${comp ? ` (in ${comp})` : ""}`);
      }
      const bareControl = tag === "select" || (tag === "input" && attrText(n, "type") === "range");
      if (bareControl && !ancestors.some((a) => ROW_LIKE.has(a))) finding(x, n, "bare", `<${tag}> outside a Row`);
    });
  }
  return rows;
}

// The gate's verdict: findings outside the lists, and list entries with none left.
export function gateProblems(rows, files) {
  const allowed = (r) => r.kind !== "section" && r.file in NOT_SETTINGS;
  const known = new Set(files);
  // loop: NOT-WORTH — N = the list's entries (≈ 10); once per gate run
  const stale = Object.keys(NOT_SETTINGS).filter((f) => !known.has(f) || !rows.some((r) => r.file === f));
  return { bad: rows.filter((r) => !allowed(r)), stale };
}

function main() {
  const files = ts.sys.readDirectory(join(ROOT, "src/desktop"), [".tsx"]).map((f) => relative(ROOT, f).replace(/\\/g, "/"));
  // loop: NOT-WORTH — N = the app's TSX files (≈ 150); once per gate run
  const rows = settingsFindings(files.map((file) => ({ file, text: readFileSync(join(ROOT, file), "utf8") })));
  if (!process.argv.includes("--check")) {
    console.log("file\tline\tkind\tdetail");
    // loop: NOT-WORTH — N = the findings; once per run
    for (const r of rows) console.log(`${r.file}\t${r.line}\t${r.kind}\t${r.detail}`);
    return;
  }
  const { bad, stale } = gateProblems(rows, files);
  // loop: NOT-WORTH — N = the problems; once per gate run
  for (const r of bad) console.error(`${r.file}:${r.line}: ${r.kind}: ${r.detail}`);
  // loop: NOT-WORTH — N = the stale entries; once per gate run
  for (const f of stale) console.error(`${f}: listed in tools/list_settings.mjs but has no findings (no buttons or rows left, or gone): take it off the list`);
  if (bad.length || stale.length) {
    console.error(`\n${bad.length + stale.length} settings-gate problem(s). Every setting goes in a Row inside a Section (src/desktop/accordion/Section.tsx).`);
    process.exit(1);
  }
  console.log(`settings gate: ${rows.length} findings, all in files that aren't settings pages (${Object.keys(NOT_SETTINGS).length}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
