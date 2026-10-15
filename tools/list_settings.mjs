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
//   readout  a <Section> with no setting or action in it: no control (Toggle,
//            Slider, Segmented, KnobSlider, GripHaptics, BusyButton, a
//            button, input, select, textarea or link) in its body or in the
//            components it renders (followed by name; a Notice's × doesn't
//            count). The operating rule: the accordion holds SETTINGS and
//            ACTIONS only; readouts and info live in the page's main view
//            (MainBlock, src/desktop/accordion/MainBlock.tsx).
//            Also: a <Section> that renders a MainBlock's body component
//            (DiagnosticsBody, ControllerInfo, …): a readout moved to the
//            main view doesn't come back with its Reset or Refresh.
//   nav      a <Section> whose controls include navigation (inside a <nav>):
//            allowed only in NAVIGATION_SECTIONS, each with its reason;
//            elsewhere a jump link doesn't count as the section's action.
// An action button (BusyButton) in a MainBlock is a readout's own action
// (Reset next to the timings, Refresh next to Controller info), not a
// setting: allowed there. A setting row in a MainBlock is still a "row".
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
  "src/desktop/BoardBusyNotice.tsx": "the board-busy notice's Retry (another program holds the board), an error notice's action",
  "src/desktop/library/playBar.tsx": "the game page's Play bar and its launcher links (its main view)",
  "src/desktop/library/GameLibrary.tsx": "the game library's toolbar (sort and filter), not settings",
};

// Sections that are a navigation index (their controls jump within the page):
// the readout rule counts their <nav> links as the section's actions.
export const NAVIGATION_SECTIONS = {
  "src/desktop/pages/AboutPage.tsx": "About's sections are the index of its texts (Guide, the changelogs, Coming soon, Credits): each lists its chapters to jump to, the text itself is the main view",
};

// Sections the readout rule found that only show something, waiting for the
// owner's call on where they go (main view or not), each with its reason:
// "file#section id". Empty: Games → Home's This computer, the one found, is a
// main-view block since 2026-10-14. An entry whose section has an action now,
// or is gone, fails as stale.
export const READOUTS_PENDING = {};

const ROWS = new Set(["Row", "Toggle", "Slider", "Segmented", "KnobSlider", "GripHaptics", "BusyButton"]);
// What makes a Section a place to set or do something (the readout rule).
const CONTROLS = new Set(["Toggle", "Slider", "Segmented", "KnobSlider", "GripHaptics", "BusyButton", "button", "input", "select", "textarea", "a"]);
// Components whose own buttons aren't the section's action (a notice's ×).
const NOT_ACTIONS = new Set(["Notice"]);
export const READOUT_RULE = "the accordion holds settings and actions only; readouts and info go in the page's main view (MainBlock)";
const ROW_LIKE = new Set(["Row", "Toggle", "Slider", "Segmented", "KnobSlider", "GripHaptics"]);
export const tagOf = (n) => (ts.isJsxElement(n) ? n.openingElement.tagName.getText() : ts.isJsxSelfClosingElement(n) ? n.tagName.getText() : null);
export const attrsOf = (n) => (ts.isJsxElement(n) ? n.openingElement.attributes : n.attributes).properties;
export const attr = (n, name) => attrsOf(n).find((a) => ts.isJsxAttribute(a) && a.name.getText() === name);
const attrText = (n, name) => {
  const a = attr(n, name);
  if (!a?.initializer) return "";
  if (ts.isStringLiteral(a.initializer)) return a.initializer.text;
  return a.initializer.getText();
};
export const lineOf = (sf, n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
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
export const walk = (node, fn) => {
  fn(node);
  ts.forEachChild(node, (c) => walk(c, fn));
};

// Every finding in these sources ({ file, text }: TSX, paths from the repo root).
// `lookup: true` sources (src/components) are only followed into (LanguageToggle), never checked.
export function settingsFindings(sources) {
  const parsed = sources.map((x) => ({ ...x, sf: ts.createSourceFile(x.file, x.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) }));
  // Components rendered inside a Section, followed transitively by name.
  const bodies = new Map(); // component name -> its declaration nodes
  const frameworkDecl = new Set(); // declarations in the framework files (Row's own markup isn't a section's control)
  for (const x of parsed)
    walk(x.sf, (n) => {
      const name = ts.isFunctionDeclaration(n) && n.name ? n.name.text : ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && /^[A-Z]/.test(n.name.text) ? n.name.text : null;
      if (name && /^[A-Z]/.test(name)) {
        bodies.set(name, [...(bodies.get(name) ?? []), n]);
        if (FRAMEWORK.has(x.file)) frameworkDecl.add(n);
      }
    });
  const tagsUnder = (node, add, stop) =>
    walk(node, (n) => {
      const tag = tagOf(n);
      if (tag && /^[A-Z]/.test(tag) && tag !== stop) add(tag);
      // memo(Component): the memoized one renders the component.
      if (ts.isCallExpression(n) && n.expression.getText() === "memo" && n.arguments[0] && ts.isIdentifier(n.arguments[0])) add(n.arguments[0].text);
    });
  // The components the given roots render, followed transitively by name (`stop`: a nested container isn't followed).
  const rendered = (roots, stop) => {
    const found = new Set();
    const queue = [];
    const add = (name) => {
      if (!found.has(name)) {
        found.add(name);
        queue.push(name);
      }
    };
    // loop: NOT-WORTH — N = the roots (≤ ~100 elements); once per gate run
    for (const root of roots) tagsUnder(root, add, stop);
    // loop: NOT-WORTH — N = the components reached (≈ 200); once per gate run
    while (queue.length) for (const decl of bodies.get(queue.pop()) ?? []) tagsUnder(decl, add, stop);
    return found;
  };
  // Every <container> element in the sources.
  const all = (container) => {
    const out = [];
    for (const x of parsed)
      walk(x.sf, (n) => {
        if (tagOf(n) === container) out.push(n);
      });
    return out;
  };
  // Components rendered inside a Section or a MainBlock.
  const inSection = rendered(all("Section"), "Section");
  const inBlock = rendered(all("MainBlock"), "MainBlock");
  // The readouts themselves: what a MainBlock's body renders directly (DiagnosticsBody, ControllerInfo, …).
  const blockBodies = new Set();
  // loop: NOT-WORTH — N = the MainBlocks (≈ 3); once per gate run
  for (const n of all("MainBlock")) tagsUnder(n, (name) => blockBodies.add(name), "MainBlock");
  // A control in this node, or in a component it renders (by name, once each).
  // `nav`: links inside a <nav> count (a navigation section).
  const controlIn = (node, nav, seen) => {
    const tag = tagOf(node);
    if (tag) {
      if (NOT_ACTIONS.has(tag) || (tag === "nav" && !nav)) return false;
      if (CONTROLS.has(tag)) return true;
      if (/^[A-Z]/.test(tag) && !seen.has(tag)) {
        seen.add(tag);
        // loop: NOT-WORTH — N = a name's declarations (1, rarely 2); once per gate run
        for (const decl of bodies.get(tag) ?? []) if (!frameworkDecl.has(decl) && controlIn(decl, nav, seen)) return true;
      }
    }
    // memo(Component): the memoized one renders the component.
    if (ts.isCallExpression(node) && node.expression.getText() === "memo" && node.arguments[0] && ts.isIdentifier(node.arguments[0])) {
      const name = node.arguments[0].text;
      if (!seen.has(name)) {
        seen.add(name);
        // loop: NOT-WORTH — N = a name's declarations (1, rarely 2); once per gate run
        for (const decl of bodies.get(name) ?? []) if (controlIn(decl, nav, seen)) return true;
      }
    }
    return ts.forEachChild(node, (c) => controlIn(c, nav, seen) || undefined) ?? false;
  };
  const navControlIn = (node) => {
    let hit = false;
    walk(node, (n) => {
      if (!hit && tagOf(n) === "nav" && controlIn(n, true, new Set())) hit = true;
    });
    return hit;
  };

  const rows = [];
  const finding = (x, n, kind, detail) => rows.push({ file: x.file, line: lineOf(x.sf, n), kind, detail });
  for (const x of parsed) {
    if (FRAMEWORK.has(x.file) || x.lookup) continue;
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
        const nav = navControlIn(n);
        if (nav) finding(x, n, "nav", `section "${idText}" navigates (a <nav> of jump links)`);
        // Its body only (not the header's status or notice).
        // loop: NOT-WORTH — N = the body's children (1); once per gate run
        if (!kids.some((k) => controlIn(k, nav && x.file in NAVIGATION_SECTIONS, new Set())))
          finding(x, n, "readout", `section "${idText}" has no setting or action (a control, a button, a link): ${READOUT_RULE}`);
        // A readout moved to the main view doesn't come back into a section (its Reset or Refresh would pass the check above).
        // loop: NOT-WORTH — N = the components one section reaches (≈ 20); once per gate run
        const shown = [...rendered([n], "Section")].filter((name) => blockBodies.has(name));
        if (shown.length) finding(x, n, "readout", `section "${idText}" shows ${shown.map((c) => `<${c}>`).join(", ")}, a main-view readout (a MainBlock's body): ${READOUT_RULE}`);
        return;
      }
      const cls = attrText(n, "className");
      if (/\bdk-card\b/.test(cls) && !/\bdk-dialog\b/.test(cls) && ts.isJsxElement(n) && n.children.some((c) => tagOf(c) === "h2") && !exempt(x, n))
        finding(x, n, "card", `a settings card (${cls.replace(/\s+/g, " ").slice(0, 40)})`);
      const ancestors = jsxAncestors(n);
      if (ROWS.has(tag)) {
        const comp = componentOf(n);
        // A readout's own action (Reset, Refresh) goes with it in its main-view block.
        const blockAction = tag === "BusyButton" && (ancestors.includes("MainBlock") || (comp && inBlock.has(comp)));
        if (!ancestors.includes("Section") && !(comp && inSection.has(comp)) && !blockAction) finding(x, n, "row", `<${tag}> outside a Section${comp ? ` (in ${comp})` : ""}`);
      }
      const bareControl = tag === "select" || (tag === "input" && attrText(n, "type") === "range");
      if (bareControl && !ancestors.some((a) => ROW_LIKE.has(a))) finding(x, n, "bare", `<${tag}> outside a Row`);
    });
  }
  return rows;
}

// The gate's verdict: findings outside the lists, and list entries with none left.
const readoutKey = (r) => `${r.file}#${/section "([^"]*)"/.exec(r.detail)?.[1] ?? ""}`;
export function gateProblems(rows, files) {
  const allowed = (r) => (r.kind === "nav" ? r.file in NAVIGATION_SECTIONS : r.kind === "readout" ? readoutKey(r) in READOUTS_PENDING : r.kind !== "section" && r.file in NOT_SETTINGS);
  const known = new Set(files);
  // loop: NOT-WORTH — N = the list's entries (≈ 10); once per gate run
  const stale = Object.keys(NOT_SETTINGS).filter((f) => !known.has(f) || !rows.some((r) => r.file === f && r.kind !== "nav"));
  // loop: NOT-WORTH — N = the navigation list's entries (1); once per gate run
  const staleNav = Object.keys(NAVIGATION_SECTIONS).filter((f) => !known.has(f) || !rows.some((r) => r.file === f && r.kind === "nav"));
  // loop: NOT-WORTH — N = the pending list's entries (≤ a few); once per gate run
  const staleReadouts = Object.keys(READOUTS_PENDING).filter((k) => !rows.some((r) => r.kind === "readout" && readoutKey(r) === k));
  return { bad: rows.filter((r) => !allowed(r)), stale: [...stale, ...staleNav, ...staleReadouts] };
}

function main() {
  const list = (dir) => ts.sys.readDirectory(join(ROOT, dir), [".tsx"]).map((f) => relative(ROOT, f).replace(/\\/g, "/"));
  const files = list("src/desktop");
  // loop: NOT-WORTH — N = the app's TSX files (≈ 150); once per gate run
  const sources = files.map((file) => ({ file, text: readFileSync(join(ROOT, file), "utf8") }));
  // loop: NOT-WORTH — N = 2 shared components; once per gate run
  const lookup = list("src/components").map((file) => ({ file, text: readFileSync(join(ROOT, file), "utf8"), lookup: true }));
  const rows = settingsFindings([...sources, ...lookup]);
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
  for (const f of stale) console.error(`${f}: listed in tools/list_settings.mjs but has no findings (no buttons, rows, navigation or readout left, or gone): take it off the list`);
  if (bad.length || stale.length) {
    console.error(
      `\n${bad.length + stale.length} settings-gate problem(s). Every setting goes in a Row inside a Section (src/desktop/accordion/Section.tsx); ${READOUT_RULE} (src/desktop/accordion/MainBlock.tsx).`,
    );
    process.exit(1);
  }
  console.log(`settings gate: ${rows.length} findings, all in files that aren't settings pages (${Object.keys(NOT_SETTINGS).length}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
