#!/usr/bin/env node
// Error pass candidates, listed mechanically (the AVIEW rule: never review by
// eye). The rule it serves (CLAUDE.md "Error pass"): no silent failure. Every
// error a user's action can hit is shown to the user in plain words, or is
// logged on purpose with a one-line reason why the user needn't see it.
//
// One row per candidate in src/ and electron/ (tests and the vendored
// src/flash/picoflash excluded), found with the TypeScript compiler API and
// type checker:
//   catch         every try/catch, classed empty / rethrow / log-only / fallback,
//                 with what the try guards (JSON.parse, file reads, IPC, ...)
//   .catch        every .catch(handler) on a promise
//   .then-reject  every .then(ok, onRejected) on a promise
//   void          every `void <promise>`
//   floating      every promise statement neither awaited, handled nor voided
//   ipc-handler   every ipcMain.handle / ipcMain.on registration (ipc.ts)
//   ipc-call      every renderer call of a window.desktop (DesktopApi) method
//                 that returns a promise
//   schema        every zod .parse / .safeParse (and async forms)
//   spawn         every child_process call (and promisified wrappers)
//   fetch         every fetch / net.fetch
//   json-parse    every JSON.parse
//   result-field  every result-type field that carries a failure (ok, error,
//                 problem, blockedBy, ...), which the UI could ignore
//
// Each row resolves to exactly one verdict:
//   SHOWN       the user sees a plain message (cite the en.json string key)
//   LOGGED-OK   logged, and the reason the user needn't see it
//   SILENT-BUG  a user action fails with nothing shown (fix)
//   SWALLOWED   the error is discarded without a reason (fix or justify)
//   FLOATING    an unhandled promise
//   NOT-WORTH   cannot fail in practice (say why)
//   PASSES-ON   not a handling point: the error goes on to the caller, whose
//               row has the verdict (a rethrow, an awaited/returned call, a
//               call inside a try whose catch row has the verdict)
// A verdict is written as a comment on the row's line or the line above
// (for a catch: the `catch` line or the first line of its block):
//   } catch { // error: LOGGED-OK — the cache is rebuilt on the next scan
//   {/* error: SHOWN — desktop.errors.layoutSave */}
// or follows mechanically from the code:
//   .catch(shown("desktop.errors.layoutSave"))   SHOWN, with the key
//   .catch(logged("narrator lines are decoration")) LOGGED-OK, with the reason
//   a catch whose last statement is `throw`         PASSES-ON
//   a call that is awaited / returned, chained into a handler, or inside a
//   try: the verdict of where its error lands (the caller, the handler, the catch)
//
// Usage: node tools/list_errors.mjs          TSV: file line function kind detail verdict source reason
//        node tools/list_errors.mjs --check  the gate (npm run gates): exit 1 on a row without a
//                                            verdict, a SHOWN key missing from en.json, or a
//                                            FLOATING / SILENT-BUG / SWALLOWED row that doesn't
//                                            name its batch "(batch E<n>)"
//        node tools/list_errors.mjs --md     the per-file tables for docs/ERROR_PASS_2026-10.md
//        node tools/list_errors.mjs --counts verdict counts (now, and as found: "was X" in a reason)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { ROOT, checker, displayFn, isFn, isOurs, lineOf, relOf as relPaths, sources } from "./ts_program.mjs";

const relOf = (sf) => relPaths.get(sf.fileName);

export const VERDICTS = ["SHOWN", "LOGGED-OK", "SILENT-BUG", "SWALLOWED", "FLOATING", "NOT-WORTH", "PASSES-ON"];
const VERDICT_RE = new RegExp(`error:\\s*(${VERDICTS.join("|")})\\s+—\\s+(.+?)\\s*(?:\\*\\/\\}?)?\\s*$`);
const NEEDS_BATCH = new Set(["FLOATING", "SILENT-BUG", "SWALLOWED"]);
const RESULT_FIELDS = /^(ok|error|errors|problem|problems|blockedBy|blocked|failed|failure|refused|reason)$/;
const CHILD_FNS = new Set(["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]);
const GUARD_CALLS =
  /^(JSON\.parse|readFileSync|readFile|readdirSync|readdir|statSync|stat|lstatSync|existsSync|writeFileSync|writeFile|renameSync|rename|mkdirSync|mkdir|rmSync|rm|unlinkSync|unlink|copyFileSync|openSync|fetch|net\.fetch|decodeURIComponent|new URL)$/;

const en = JSON.parse(readFileSync(join(ROOT, "src/i18n/locales/en.json"), "utf8"));
const hasKey = (key) => key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), en) !== undefined;

// ---------- type helpers ----------
function isThenable(node) {
  let type;
  try {
    type = checker.getTypeAtLocation(node);
  } catch {
    // error: NOT-WORTH — the checker can't type a synthetic node; such a node is no promise
    return false;
  }
  const parts = type.isUnion() ? type.types : [type];
  return parts.some((t) => {
    const then = checker.getApparentType(t).getProperty("then");
    if (!then) return false;
    const tt = checker.getTypeOfSymbolAtLocation(then, node);
    return tt.getCallSignatures().length > 0;
  });
}
const declsOf = (expr) => {
  let sym = checker.getSymbolAtLocation(expr);
  if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
  return sym?.declarations ?? [];
};
// The callee with its object: "JSON.parse", "net.fetch", "spawn".
const qualifiedCallee = (call) => {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return `${ts.isIdentifier(e.expression) ? e.expression.text + "." : ""}${e.name.text}`;
  return "";
};
const nameNode = (call) => (ts.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression);
const isDesktopApiMember = (call) =>
  declsOf(nameNode(call)).some((d) => (ts.isPropertySignature(d) || ts.isMethodSignature(d)) && ts.isInterfaceDeclaration(d.parent) && d.parent.name.text === "DesktopApi");
const fromZod = (call) =>
  ts.isPropertyAccessExpression(call.expression) &&
  /^(parse|safeParse|parseAsync|safeParseAsync)$/.test(call.expression.name.text) &&
  declsOf(call.expression.name).some((d) => /node_modules\/zod\//.test(d.getSourceFile().fileName));
const fromChildProcess = (ident) => declsOf(ident).some((d) => /@types\/node\/child_process\.d\.ts$/.test(d.getSourceFile().fileName));
// Variables bound to promisify(execFile) and the like call a child process too.
const promisifiedChild = new Set();
for (const sf of sources) {
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isCallExpression(n.initializer) && qualifiedCallee(n.initializer).endsWith("promisify")) {
      const a = n.initializer.arguments[0];
      if (a && ts.isIdentifier(a) && CHILD_FNS.has(a.text) && fromChildProcess(a)) promisifiedChild.add(checker.getSymbolAtLocation(n.name));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
const isSpawnCall = (call) => {
  const e = call.expression;
  if (ts.isIdentifier(e)) {
    if (CHILD_FNS.has(e.text) && fromChildProcess(e)) return true;
    const sym = checker.getSymbolAtLocation(e);
    return !!sym && promisifiedChild.has(sym);
  }
  return ts.isPropertyAccessExpression(e) && CHILD_FNS.has(e.name.text) && fromChildProcess(e.name);
};
const isFetch = (call) => {
  const n = qualifiedCallee(call);
  return n === "fetch" || n === "net.fetch" || /\.fetch$/.test(n);
};

// ---------- syntax helpers ----------
// Throws in this block that aren't inside a nested function.
function hasOwn(node, test) {
  let found = false;
  const visit = (n) => {
    if (found || isFn(n)) return;
    if (test(n)) found = true;
    else ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}
const isConsoleCall = (s) => ts.isExpressionStatement(s) && ts.isCallExpression(s.expression) && /^console\./.test(qualifiedCallee(s.expression));
function catchClass(clause) {
  const stmts = clause.block.statements;
  if (stmts.length === 0) return "empty";
  const last = stmts[stmts.length - 1];
  if (ts.isThrowStatement(last)) return "rethrow";
  if (hasOwn(clause.block, ts.isThrowStatement)) return "maybe-rethrow";
  if (stmts.every(isConsoleCall)) return "log-only";
  return "fallback";
}
function guardsOf(tryBlock) {
  const found = new Set();
  const visit = (n) => {
    if (isFn(n) && n !== tryBlock) return;
    if (ts.isCallExpression(n)) {
      const name = qualifiedCallee(n);
      const short = name.replace(/^(fs|fsp|promises|sync)\./, "");
      if (GUARD_CALLS.test(name) || GUARD_CALLS.test(short)) found.add(short);
      else if (isDesktopApiMember(n)) found.add(`ipc:${ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : name}`);
      else if (fromZod(n)) found.add(`zod.${n.expression.name.text}`);
      else if (isSpawnCall(n)) found.add("child_process");
    }
    if (ts.isNewExpression(n) && n.expression.getText() === "URL") found.add("new URL");
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(tryBlock, visit);
  return [...found].slice(0, 4).join(", ");
}

// ---------- rows ----------
const rows = [];
const byNode = new Map();
function addRow(sf, node, line, kind, detail, extra = {}) {
  const row = { file: relOf(sf), sf, node, line, fn: displayFn(node), kind, detail, verdict: "", source: "", reason: "", ...extra };
  rows.push(row);
  byNode.set(node, row);
  return row;
}
// A .catch(handler) / .then(ok, handler) call that handles the promise `call`.
const handlerOf = (call) => {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  const m = call.expression.name.text;
  if (m === "catch" && call.arguments.length >= 1) return call.arguments[0];
  if (m === "then" && call.arguments.length >= 2) return call.arguments[1];
  return null;
};

for (const sf of sources) {
  if (!isOurs(sf)) continue;
  const visit = (n) => {
    if (ts.isCatchClause(n)) {
      const tryStmt = n.parent;
      addRow(sf, n, lineOf(n), "catch", `${catchClass(n)}${guardsOf(tryStmt.tryBlock) ? `: ${guardsOf(tryStmt.tryBlock)}` : ""}`);
    } else if (ts.isCallExpression(n)) {
      const h = handlerOf(n);
      if (h && isThenable(n.expression.expression)) {
        addRow(sf, n, lineOf(n.expression.name), n.expression.name.text === "catch" ? ".catch" : ".then-reject", h.getText(sf).replace(/\s+/g, " ").slice(0, 60), { handler: h });
      }
      if (isDesktopApiMember(n) && isThenable(n)) addRow(sf, n, lineOf(nameNode(n)), "ipc-call", nameNode(n).getText(sf));
      else if (fromZod(n)) addRow(sf, n, lineOf(nameNode(n)), "schema", `${n.expression.expression.getText(sf).slice(0, 40)}.${n.expression.name.text}`);
      else if (isSpawnCall(n)) {
        // Sync calls throw and promisified ones reject: those land like any call. Callback and event forms need their own verdict.
        const name = n.expression.getText(sf);
        const throws = /Sync$/.test(name) || (ts.isIdentifier(n.expression) && promisifiedChild.has(checker.getSymbolAtLocation(n.expression)));
        addRow(sf, n, lineOf(n), "spawn", `${name}(${(n.arguments[0]?.getText(sf) ?? "").slice(0, 40)})`, { throws });
      } else if (isFetch(n)) addRow(sf, n, lineOf(n), "fetch", qualifiedCallee(n));
      else if (qualifiedCallee(n) === "JSON.parse") addRow(sf, n, lineOf(n), "json-parse", (n.arguments[0]?.getText(sf) ?? "").slice(0, 40));
      if (relOf(sf) === "electron/main/ipc.ts") {
        const c = qualifiedCallee(n);
        if (["ipcMain.handle", "ipcMain.on", "invoke", "invokeWith"].includes(c) && n.arguments[0] && !isFn(n.parent)) {
          const ch = n.arguments[0].getText(sf);
          if (ch !== "channel") addRow(sf, n, lineOf(n), "ipc-handler", `${c === "ipcMain.on" ? "on" : "handle"} ${ch}`, { send: c === "ipcMain.on" });
        }
      }
    } else if (ts.isVoidExpression(n) && isThenable(n.expression)) {
      addRow(sf, n, lineOf(n), "void", n.expression.getText(sf).replace(/\s+/g, " ").slice(0, 60));
    } else if (ts.isExpressionStatement(n)) {
      const e = n.expression;
      // .finally(f) passes its promise's outcome on: look through it (as ESLint's no-floating-promises does).
      let inner = e;
      while (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression) && inner.expression.name.text === "finally") inner = inner.expression.expression;
      if (!ts.isVoidExpression(e) && !ts.isAwaitExpression(e) && !ts.isBinaryExpression(e) && isThenable(e) && !(ts.isCallExpression(inner) && handlerOf(inner))) {
        addRow(sf, n, lineOf(n), "floating", e.getText(sf).replace(/\s+/g, " ").slice(0, 60));
      }
    } else if (
      ts.isPropertySignature(n) &&
      n.name &&
      ts.isIdentifier(n.name) &&
      RESULT_FIELDS.test(n.name.text) &&
      (ts.isInterfaceDeclaration(n.parent) || ts.isTypeLiteralNode(n.parent)) &&
      n.type?.getText(sf) !== "true"
    ) {
      // The owner: the interface, or the type alias / function the literal sits in. (\`ok: true\` is the success arm, not a failure field.)
      let o = n.parent;
      while (o && !ts.isInterfaceDeclaration(o) && !ts.isTypeAliasDeclaration(o) && !isFn(o) && !ts.isPropertySignature(o.parent ?? o)) o = o.parent;
      const owner =
        o && (ts.isInterfaceDeclaration(o) || ts.isTypeAliasDeclaration(o))
          ? o.name.text
          : o && ts.isPropertySignature(o.parent ?? {})
            ? `${o.parent.parent?.name?.text ?? "?"}.${o.parent.name.getText(sf)}`
            : displayFn(n);
      addRow(sf, n, lineOf(n), "result-field", `${owner}.${n.name.text}: ${n.type?.getText(sf).replace(/\s+/g, " ").slice(0, 40) ?? "?"}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

// ---------- verdicts ----------
const linesCache = new Map();
const linesOf = (sf) => {
  if (!linesCache.has(sf)) linesCache.set(sf, sf.text.split("\n"));
  return linesCache.get(sf);
};
function commentVerdict(sf, lines) {
  const text = linesOf(sf);
  for (const l of lines) {
    const m = VERDICT_RE.exec(text[l - 1] ?? "");
    if (m) return { verdict: m[1], reason: m[2].replace(/\s*\*\/\s*\}?\s*$/, "").trim(), source: "comment" };
  }
  return null;
}
const helperVerdict = (h) => {
  if (h && ts.isCallExpression(h) && ts.isIdentifier(h.expression) && h.arguments[0] && ts.isStringLiteralLike(h.arguments[0])) {
    if (h.expression.text === "shown") return { verdict: "SHOWN", reason: h.arguments[0].text, source: "shown()" };
    if (h.expression.text === "logged") return { verdict: "LOGGED-OK", reason: h.arguments[0].text, source: "logged()" };
  }
  if (h && isFn(h) && h.body && ts.isBlock(h.body) && h.body.statements.length && ts.isThrowStatement(h.body.statements.at(-1)))
    return { verdict: "PASSES-ON", reason: "the handler rethrows", source: "rethrow" };
  return null;
};
// Where an error raised by `node` (a call) lands: walk up through the promise chain.
function landing(node) {
  let top = node;
  for (;;) {
    const p = top.parent;
    if (ts.isParenthesizedExpression(p) || ts.isNonNullExpression(p) || ts.isAsExpression(p) || (ts.isConditionalExpression(p) && p.condition !== top)) top = p;
    else if ((ts.isNewExpression(p) || ts.isSpreadElement(p) || ts.isObjectLiteralExpression(p) || ts.isPropertyAssignment(p) || ts.isSpreadAssignment(p)) && !ts.isPropertyAssignment(top)) top = p;
    else if (ts.isPropertyAccessExpression(p) && p.expression === top && ts.isCallExpression(p.parent) && p.parent.expression === p) {
      const call = p.parent;
      if (handlerOf(call)) return { row: byNode.get(call), how: `.${p.name.text} handler` };
      top = call;
    } else break;
  }
  const p = top.parent;
  if (ts.isVoidExpression(p)) return { row: byNode.get(p), how: "void" };
  if (ts.isExpressionStatement(p) && byNode.get(p)) return { row: byNode.get(p), how: "floating" };
  const passes = ts.isAwaitExpression(p) || ts.isReturnStatement(p) || (ts.isArrowFunction(p) && p.body === top) || ts.isThrowStatement(p);
  // Inside a try block of the same function: that catch decides.
  for (let q = top; q && !isFn(q); q = q.parent) {
    const par = q.parent;
    if (par && ts.isTryStatement(par) && par.tryBlock === q && par.catchClause) {
      if (passes || ts.isVariableDeclaration(p) || ts.isExpressionStatement(p) || ts.isBinaryExpression(p) || ts.isCallExpression(p)) return { row: byNode.get(par.catchClause), how: "catch" };
    }
  }
  if (passes) return { passes: true, how: ts.isAwaitExpression(p) ? "awaited" : "returned" };
  // A synchronous throw with no try in its function goes to the caller too.
  if (!isThenable(top) && (ts.isVariableDeclaration(p) || ts.isExpressionStatement(p) || ts.isCallExpression(p) || ts.isBinaryExpression(p) || ts.isPropertyAssignment(p) || ts.isReturnStatement(p)))
    return { passes: true, how: "throws to the caller" };
  return null;
}

function resolve(row, depth = 0) {
  if (row.verdict || depth > 20) return row;
  const { sf, node } = row;
  let v;
  if (row.kind === "catch") {
    const blockLine = lineOf(node.block);
    v = commentVerdict(
      sf,
      [row.line, row.line - 1, blockLine, blockLine + 1, blockLine + 2].filter((l, i, a) => a.indexOf(l) === i),
    );
    if (!v && row.detail.startsWith("rethrow")) v = { verdict: "PASSES-ON", reason: "rethrows to the caller", source: "rethrow" };
  } else {
    v = commentVerdict(sf, [row.line, row.line - 1]);
    if (!v && (row.kind === ".catch" || row.kind === ".then-reject")) v = helperVerdict(row.handler);
    if (!v && row.kind === "void") {
      let e = node.expression;
      while (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === "finally") e = e.expression.expression;
      const inner = byNode.get(e);
      if (inner) {
        resolve(inner, depth + 1);
        if (inner.verdict) v = { verdict: inner.verdict, reason: inner.reason, source: `via ${inner.kind} L${inner.line}` };
      }
    }
    if (!v && row.kind === "ipc-handler" && !row.send) v = { verdict: "PASSES-ON", reason: "a throw rejects the renderer's call; that ipc-call row has the verdict", source: "ipc" };
    if (!v && ["ipc-call", "schema", "spawn", "fetch", "json-parse"].includes(row.kind) && !(row.kind === "schema" && /safeParse/.test(row.detail)) && !(row.kind === "spawn" && !row.throws)) {
      const l = landing(node);
      if (l?.passes) v = { verdict: "PASSES-ON", reason: `${l.how}: the caller of ${row.fn.split(" > ").at(-1)} handles it`, source: "flow" };
      else if (l?.row && l.row !== row) {
        resolve(l.row, depth + 1);
        if (l.row.verdict) v = { verdict: l.row.verdict, reason: l.row.reason, source: `via ${l.row.kind} L${l.row.line}` };
      }
    }
  }
  if (v) Object.assign(row, v);
  return row;
}
rows.forEach((r) => resolve(r));
rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind));

// ---------- output ----------
const args = process.argv.slice(2);
const wasOf = (r) => /\bwas (SILENT-BUG|SWALLOWED|FLOATING|NOT-WORTH|LOGGED-OK)\b/.exec(r.reason)?.[1] ?? r.verdict;
if (args.includes("--check")) {
  const bad = [];
  for (const r of rows) {
    const at = `${r.file}:${r.line} ${r.kind} (${r.fn})`;
    if (!r.verdict) bad.push(`${at}: no verdict. Add "// error: VERDICT — reason" (CLAUDE.md "Error pass")`);
    else if (r.verdict === "SHOWN" && r.source !== "via" && !/^via /.test(r.source)) {
      const key = /^([\w-]+(?:\.[\w-]+)+)/.exec(r.reason)?.[1];
      // An en.json key, or "english:" / "main-english:" for text not translated yet (batch E4).
      if (!/^(main-)?english:/.test(r.reason) && (!key || !hasKey(key))) bad.push(`${at}: SHOWN must start its reason with an en.json key that exists, or "english:" (got "${r.reason}")`);
    } else if (NEEDS_BATCH.has(r.verdict) && !/\(batch E\d+\)/.test(r.reason)) bad.push(`${at}: ${r.verdict} must name its batch "(batch E<n>)" in docs/ERROR_PASS_2026-10.md`);
  }
  if (bad.length) {
    console.error(`Error pass: ${bad.length} row(s) need a verdict (tools/list_errors.mjs):\n${bad.join("\n")}`);
    process.exit(1);
  }
  console.log(`Error pass: ${rows.length} rows, every one with a verdict.`);
} else if (args.includes("--counts")) {
  const now = {};
  const was = {};
  const kinds = {};
  for (const r of rows) {
    now[r.verdict || "(none)"] = (now[r.verdict || "(none)"] ?? 0) + 1;
    was[wasOf(r) || "(none)"] = (was[wasOf(r) || "(none)"] ?? 0) + 1;
    kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
  }
  console.log(JSON.stringify({ total: rows.length, now, asFound: was, kinds }, null, 1));
} else if (args.includes("--md")) {
  const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/`/g, "'");
  let heading = "";
  for (const r of rows) {
    if (r.file !== heading) {
      heading = r.file;
      console.log(`\n#### ${heading}\n\n| Line | Function | Kind | Detail | Verdict | Why |\n|---|---|---|---|---|---|`);
    }
    const via = r.source && !["comment"].includes(r.source) ? ` _(${r.source})_` : "";
    console.log(`| ${r.line} | \`${esc(r.fn)}\` | ${r.kind} | \`${esc(r.detail)}\` | **${r.verdict || "-"}** | ${esc(r.reason)}${via} |`);
  }
} else {
  console.log("file\tline\tfunction\tkind\tdetail\tverdict\tsource\treason");
  for (const r of rows) console.log([r.file, r.line, r.fn, r.kind, r.detail, r.verdict, r.source, r.reason].join("\t"));
}
