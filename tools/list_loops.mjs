#!/usr/bin/env node
// Loop-pass candidates, listed mechanically (the AVIEW "serial-loop pass":
// never review hot paths by eye). One TSV row per loop in src/ and electron/
// (tests and the vendored src/flash/picoflash excluded) that matches a trigger:
//   await   the body awaits (serial async work: IPC to the board, file I/O,
//           spawns, fetch). Nested functions don't count, except an async
//           array callback (.map(async ...)), which awaits per element.
//   hot     it runs on a hot path: a component or hook render (incl. useMemo),
//           a requestAnimationFrame / setInterval callback, a poll (usePoll's
//           read, a function that re-arms itself with setTimeout), a
//           useEffect body (re-runs when its deps change), a WebUSB
//           connect/disconnect handler, the audio worklet's process(), the
//           game library scan, or anything those call (resolved with the
//           TypeScript type checker, transitively).
//   nested  inside another loop in the same function (O(n^2) candidate).
// Loops are for / for-of / for-in / for-await / while / do and the array
// iteration callbacks (.map .forEach .reduce .filter .some .every .find* .flatMap
// .sort .toSorted on Array/Set/Map/typed arrays, checked with the type checker).
//
// Usage: node tools/list_loops.mjs            TSV: file line function kind trigger verdict head
//        node tools/list_loops.mjs --check    the gate (npm run gates): exit 1 on a
//                                             row without a valid verdict comment
//        node tools/list_loops.mjs --md       the per-file tables for docs/LOOP_PASS_*.md
//
// A verdict is a comment on the loop's line or the line above it:
//   // loop: SERIAL-REQUIRED — one HID session
//   {/* loop: HOT-PATH-OK — N ≤ 6 slots */}      (inside JSX)
// Verdicts: PARALLELIZE BATCH SERIAL-REQUIRED HOT-PATH-OK FIX-HOT-PATH NOT-WORTH,
// each followed by " — " and the reason. See CLAUDE.md "Loop pass".
import ts from "typescript";
import { calleeName, checker, displayFn, fnName, isCallbackOf, isComponentOrHook, isFn, isLoop, isStmtLoop, iterCallOf, loopBody, loopKind, relOf, resolveFns, sources } from "./ts_program.mjs";

export const VERDICTS = ["PARALLELIZE", "BATCH", "SERIAL-REQUIRED", "HOT-PATH-OK", "FIX-HOT-PATH", "NOT-WORTH"];
const VERDICT_RE = new RegExp(`loop:\\s*(${VERDICTS.join("|")})\\s+—\\s+\\S`);
// Library scan roots: the game library scan (electron/main/games/games.ts).
const SCAN_ROOTS = new Set(["electron/main/games/games.ts:scan"]);

// ---------- hot roots + call graph ----------
const tags = new Map(); // fn node -> Set of tags
const addTag = (fn, tag) => {
  if (!tags.has(fn)) tags.set(fn, new Set());
  const s = tags.get(fn);
  if (s.has(tag)) return false;
  s.add(tag);
  return true;
};
const fnArgs = (arg) => (isFn(arg) ? [arg] : ts.isIdentifier(arg) || ts.isPropertyAccessExpression(arg) ? resolveFns(arg) : []);
const allFns = [];
for (const sf of sources) {
  const visit = (n) => {
    if (isFn(n)) allFns.push(n);
    if (ts.isCallExpression(n)) {
      const c = calleeName(n);
      const a0 = n.arguments[0];
      if (a0 && c === "requestAnimationFrame") fnArgs(a0).forEach((f) => addTag(f, "raf"));
      if (a0 && c === "setInterval") fnArgs(a0).forEach((f) => addTag(f, "interval"));
      if (a0 && c === "usePoll") fnArgs(a0).forEach((f) => addTag(f, "poll"));
      if (c === "addEventListener" && n.arguments[1] && ts.isStringLiteral(a0) && ["connect", "disconnect", "inputreport"].includes(a0.text))
        fnArgs(n.arguments[1]).forEach((f) => addTag(f, "usb-event"));
      // A poll loop: a function that re-arms itself, setTimeout(() => f(), ms) or setTimeout(f, ms).
      if (a0 && c === "setTimeout") {
        const self = (() => {
          for (let p = n.parent; p; p = p.parent) if (isFn(p) && !(p === a0)) return p;
          return null;
        })();
        const targets = [];
        if (isFn(a0))
          a0.forEachChild(function find(x) {
            if (ts.isCallExpression(x)) targets.push(...resolveFns(x.expression));
            x.forEachChild(find);
          });
        else targets.push(...fnArgs(a0));
        if (self && targets.includes(self)) addTag(self, "poll");
      }
    }
    if (ts.isMethodDeclaration(n) && n.name.getText() === "process" && /\.worklet\.js$/.test(sf.fileName)) addTag(n, "audio");
    if (isFn(n) && SCAN_ROOTS.has(`${relOf.get(sf.fileName)}:${fnName(n)}`)) addTag(n, "scan");
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
// Does a call inside fn run synchronously as part of fn? Through iteration
// callbacks, promise continuations and nested inner functions declared
// in fn's own body that fn calls (resolved separately), yes.
// A React state updater, setX((prev) => ...): runs as part of the call.
const isSetterCallback = (f) => {
  const p = f.parent;
  if (!p || !ts.isCallExpression(p) || p.arguments[0] !== f || !ts.isIdentifier(p.expression) || !/^set[A-Z]/.test(p.expression.text)) return false;
  return /Dispatch<SetStateAction/.test(checker.typeToString(checker.getTypeAtLocation(p.expression)));
};
const transparent = (f) => isSetterCallback(f) || iterCallOf(f) || isCallbackOf(f, ["then", "catch", "finally", "Promise"]) || (f.parent && ts.isNewExpression(f.parent));
function callsOf(fn) {
  const out = [];
  const visit = (n) => {
    if (n !== fn && isFn(n) && !transparent(n)) return;
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) out.push(...resolveFns(n.expression));
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      // child components are render roots of their own
    }
    ts.forEachChild(n, visit);
  };
  visit(fn);
  return out;
}
const queue = [...tags.keys()];
while (queue.length) {
  const fn = queue.shift();
  for (const callee of callsOf(fn)) {
    if (isComponentOrHook(callee)) continue; // a hook/component is its own render root
    let changed = false;
    for (const t of tags.get(fn)) changed = addTag(callee, t) || changed;
    if (changed) queue.push(callee);
  }
}
// Render: components and hooks, and what they call during render.
const renderQueue = allFns.filter(isComponentOrHook);
renderQueue.forEach((f) => addTag(f, "render"));
while (renderQueue.length) {
  const fn = renderQueue.shift();
  // only calls made during render: skip effects, callbacks, handlers
  const visit = (n) => {
    if (n !== fn && isFn(n)) {
      if (!(iterCallOf(n) || isCallbackOf(n, ["useMemo"]))) return;
    }
    if (ts.isCallExpression(n)) {
      for (const callee of resolveFns(n.expression)) {
        if (isComponentOrHook(callee)) continue;
        if (addTag(callee, "render")) renderQueue.push(callee);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(fn);
}

// ---------- loops ----------
function hasAwait(body, isAsyncCallback) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (n !== body && isFn(n)) return;
    if (ts.isAwaitExpression(n) || (ts.isForOfStatement(n) && n.awaitModifier)) found = true;
    else ts.forEachChild(n, visit);
  };
  if (isFn(body)) {
    if (!isAsyncCallback) return false;
    ts.forEachChild(body, visit);
  } else visit(body);
  return found;
}
// Walk from the loop up to the function that runs it: nested? which hot tags?
function context(loop) {
  let nested = false;
  const hot = new Set();
  for (let p = loop.parent; p; p = p.parent) {
    if (isStmtLoop(p) && (p.statement === loop || isAncestor(p.statement, loop))) nested = true;
    if (!isFn(p)) continue;
    const it = iterCallOf(p);
    if (it) {
      nested = true;
      continue;
    }
    if (isCallbackOf(p, ["useMemo"])) continue; // runs during render
    // An effect re-runs whenever its deps change, which for live input is
    // every frame: count its body as part of the component.
    if (isCallbackOf(p, ["useEffect", "useLayoutEffect"])) {
      hot.add("effect");
      break;
    }
    if (isCallbackOf(p, ["then", "catch", "finally"]) || isSetterCallback(p)) {
      continue;
    }
    for (const t of tags.get(p) ?? []) hot.add(t);
    break;
  }
  return { nested, hot };
}
function isAncestor(a, b) {
  for (let p = b; p; p = p.parent) if (p === a) return true;
  return false;
}
// Lines where a loop starts, per file: a trailing comment on the line above
// counts only if no loop of its own starts there.
const loopLines = new Map();
for (const sf of sources) {
  const set = new Set();
  const visit = (n) => {
    if (isLoop(n)) set.add(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  loopLines.set(sf, set);
}
const verdictText = (text) => text.slice(text.indexOf("loop:")).replace(/\s*\*\/\}?\s*$/, "");
function verdictOf(sf, loop) {
  const lines = sf.text.split("\n");
  const line = sf.getLineAndCharacterOfPosition(loop.getStart(sf)).line;
  // The loop's own line; the line above when it ends in the comment (Prettier
  // puts it after "? " in a ternary) and starts no loop itself; or the
  // comment block right above.
  if (VERDICT_RE.test(lines[line])) return verdictText(lines[line]);
  const above = lines[line - 1] ?? "";
  if (/(\/\/|\/\*)\s*loop:/.test(above) && !/^\s*(\/\/|\{?\/\*|\*)/.test(above) && !loopLines.get(sf).has(line - 1)) {
    return VERDICT_RE.test(above) ? verdictText(above) : `INVALID ${above.trim()}`;
  }
  for (let i = line - 1; i >= 0 && /^\s*(\/\/|\{?\/\*|\*)/.test(lines[i]); i--) {
    if (VERDICT_RE.test(lines[i])) return verdictText(lines[i]);
    if (/loop:/.test(lines[i])) return `INVALID ${lines[i].trim()}`;
  }
  if (/loop:/.test(lines[line])) return `INVALID ${lines[line].trim()}`;
  return "";
}
const rows = [];
for (const sf of sources) {
  const visit = (n) => {
    if (isLoop(n)) {
      const body = loopBody(n);
      const awaits = isStmtLoop(n)
        ? hasAwait(body, false) || (ts.isForOfStatement(n) && !!n.awaitModifier)
        : !!body && isFn(body) && hasAwait(body, !!body.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword));
      const { nested, hot } = context(n);
      const trig = [awaits && "await", hot.size && `hot:${[...hot].sort().join("+")}`, nested && "nested"].filter(Boolean);
      if (trig.length) {
        const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        const head = (isStmtLoop(n) ? sf.text.slice(n.getStart(sf), n.statement.getStart(sf)) : n.getText(sf).split("\n")[0]).replace(/\s+/g, " ").trim().slice(0, 100);
        rows.push({ file: relOf.get(sf.fileName), line, fn: displayFn(n), kind: loopKind(n), trigger: trig.join(" "), verdict: verdictOf(sf, n), head });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

const mode = process.argv[2];
if (mode === "--check") {
  const bad = rows.filter((r) => !r.verdict || r.verdict.startsWith("INVALID"));
  if (bad.length) {
    console.error(`list_loops: ${bad.length} loop(s) on a hot path or awaiting without a valid verdict comment (CLAUDE.md "Loop pass"):`);
    for (const r of bad) console.error(`  ${r.file}:${r.line}  ${r.fn}  ${r.kind}  [${r.trigger}]  ${r.verdict || "no // loop: VERDICT — reason"}`);
    console.error(`Add "// loop: <${VERDICTS.join("|")}> — <reason>" on the loop's line or the line above.`);
    process.exit(1);
  }
  const counts = Object.fromEntries(VERDICTS.map((v) => [v, rows.filter((r) => r.verdict.startsWith(`loop: ${v} `)).length]));
  console.log(`list_loops: ${rows.length} loops, all with a verdict (${VERDICTS.map((v) => `${v} ${counts[v]}`).join(", ")})`);
} else if (mode === "--md") {
  const esc = (s) => s.replace(/\|/g, "\\|");
  let file = "";
  for (const r of rows) {
    if (r.file !== file) {
      file = r.file;
      console.log(`\n### ${file}\n\n| Line | Function | Kind | Trigger | Verdict | Reason |\n|---|---|---|---|---|---|`);
    }
    const m = /^loop:\s*(\S+)\s+—\s+(.*?)\s*(\*\/\})?$/.exec(r.verdict) ?? [];
    console.log(`| ${r.line} | \`${esc(r.fn)}\` | ${esc(r.kind)} | ${r.trigger} | **${m[1] ?? "?"}** | ${esc(m[2] ?? r.verdict)} |`);
  }
} else {
  console.log(["file", "line", "function", "kind", "trigger", "verdict", "head"].join("\t"));
  for (const r of rows) console.log([r.file, r.line, r.fn, r.kind, r.trigger, r.verdict, r.head].join("\t"));
}
