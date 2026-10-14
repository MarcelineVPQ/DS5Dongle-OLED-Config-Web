#!/usr/bin/env node
// Cache-pass candidates, listed mechanically (the AVIEW pass pattern: a script
// lists every candidate, one verdict per row, no sampling by eye). One TSV row
// per candidate in src/ and electron/ (tests and the vendored
// src/flash/picoflash excluded). Kinds:
//
//   Kept state (gated: each needs a "// cache:" comment, see below)
//     module    a top-level binding that is written after load: a collection
//               (Map/Set/WeakMap/array/record) mutated inside a function, or a
//               scalar that looks like a memo (named cache/memo/last/seen/...,
//               set with ??= / ||=, set inside an `if` that tests it, or
//               holding a timestamp {at, ...})
//     field     the same for a class field (`private x = new Map()`, `this.x = ...`)
//     closure   a function-local collection mutated by a nested function (a
//               cache captured by a closure), or a local named cache/memo
//     ref       useRef holding a collection, or a ref named cache/memo/last/prev
//     snapshot  a top-level or class binding whose value is read from disk,
//               storage, a process or the network once (a mirror of a file)
//   React memoization (verdict in the doc only; deps are the key)
//     useMemo / useCallback / memo
//   Persisted
//     storage   one row per localStorage key (readPref / writePref / usePref /
//               useFlagPref / useRawPref / localStorage.*)
//   Time-based
//     ttl       a comparison against the clock (TTL, throttle, "age" checks)
//   Repeated expensive work (ADD-CACHE candidates)
//     repeat-io a call inside a loop body that reads a file, spawns a
//               process, fetches, crosses IPC or talks HID (directly or through
//               functions that do, resolved with the type checker)
//     poll-io   a setInterval / usePoll callback, or a poll that re-arms itself
//               with setTimeout, that reaches the same reads
//     effect-io a useEffect that reaches them (runs again on each mount and
//               deps change: the renderer's scan results live in component state)
//     dup-read  the same file read (callee and arguments as written) more than
//               once in one function
//
// Usage: node tools/list_caches.mjs              TSV: file line function kind name detail verdict
//        node tools/list_caches.mjs --check      the gate (npm run gates): exit 1 on a kept-state
//                                                row without a valid "// cache:" comment
//        node tools/list_caches.mjs --firmware <repo>   also list the firmware's C/C++ statics
//                                                named like a memo (last/prev/cached/seen...) and
//                                                file-scope containers (src/, by pattern), read-only
//
// The comment for kept state, on the declaration's line or the line above:
//   // cache: OK — key=game key; invalidated=each scan; bound=games in the library
// Verdicts: OK FIX-STALE FIX-UNBOUNDED ADD-CACHE REMOVE NOT-WORTH; key=, invalidated=
// and bound= are required. See CLAUDE.md "Cache pass".
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { checker as tc, displayFn, isFn as isFunctionLike, isOurs as ours, isStmtLoop, iterCallOf, lineOf, relOf, resolveFns, sources as files } from "./ts_program.mjs";

export const CACHE_VERDICTS = ["OK", "FIX-STALE", "FIX-UNBOUNDED", "ADD-CACHE", "REMOVE", "NOT-WORTH"];
const COMMENT_RE = new RegExp(`cache:\\s*(${CACHE_VERDICTS.join("|")})\\s+—\\s+key=[^;]+;\\s*invalidated=[^;]+;\\s*bound=\\S`);
const GATED = new Set(["module", "field", "closure", "ref", "snapshot"]);
// The simulated dongle's fields are the fake device's memory (its config,
// slots, last command), not caches of anything: left out of kept state.
const NOT_KEPT_STATE = /src\/protocol\/simulatedDongle\.ts$/;
const MEMO_NAME = /cach|memo|^last|^latest|^prev|seen|known|loaded|resolved|promise$|^once/i;
const COLLECTION_TYPE = /^(Map|Set|WeakMap|WeakSet|Array|ReadonlyArray|Record)\b|\[\]$/;
const DOM_READS = /\b(querySelector|querySelectorAll|getAttribute|getComputedStyle|getBoundingClientRect|getContext)\(/;
const MUTATORS = new Set(["set", "add", "delete", "clear", "push", "pop", "shift", "unshift", "splice", "sort", "fill"]);

const relPath = (sf) => relOf.get(sf.fileName);
const enclosingFn = (n) => {
  for (let p = n.parent; p; p = p.parent) if (isFunctionLike(p)) return p;
  return null;
};
// The function column: the enclosing named function, or the class of a field.
const ownerName = (n) => {
  const name = displayFn(n);
  if (name !== "<module>") return name;
  for (let p = n.parent; p; p = p.parent) if ((ts.isClassDeclaration(p) || ts.isClassExpression(p)) && p.name) return p.name.text;
  return name;
};
// A function's own name (the re-arming poll check compares it with a call).
const nameOfFn = (fn) => (fn?.name && ts.isIdentifier(fn.name) ? fn.name.text : fn && ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name) ? fn.parent.name.text : "");
// Types as text, long ones cut (the table shows the shape, not the whole type).
const fullType = (node) => tc.typeToString(tc.getTypeAtLocation(node));
const typeText = (node) => {
  const t = fullType(node);
  return t.length > 70 ? `${t.slice(0, 70)}…` : t;
};
const declOf = (expr) => {
  let sym = tc.getSymbolAtLocation(expr);
  if (sym && sym.flags & ts.SymbolFlags.Alias) sym = tc.getAliasedSymbol(sym);
  return sym;
};
const iterCallback = (fn) => !!fn && !!iterCallOf(fn);

// ---------- I/O sinks and the functions that reach them ----------
const FS_READS = /^(read|readFile|readFileSync|readdir|readdirSync|readlink|readlinkSync|stat|statSync|lstat|lstatSync|exists|existsSync|access|accessSync|opendir|opendirSync|realpath|realpathSync)$/;
const SPAWNS = /^(exec|execFile|execSync|execFileSync|spawn|spawnSync)$/;
function sinkOf(call) {
  const sig = tc.getResolvedSignature(call);
  const decl = sig?.declaration;
  if (!decl) return null;
  const file = decl.getSourceFile().fileName;
  const name = decl.name && ts.isIdentifier(decl.name) ? decl.name.text : "";
  if (/@types\/node\/(fs|fs\/promises)\.d\.ts$/.test(file) && FS_READS.test(name)) return "fs";
  if (/@types\/node\/child_process\.d\.ts$/.test(file) && SPAWNS.test(name)) return "spawn";
  if (/lib\.dom\.d\.ts$/.test(file) && name === "fetch") return "net";
  if (/lib\.dom\.d\.ts$/.test(file) && name === "getItem") return "storage";
  if (/electron\/electron\.d\.ts$/.test(file) && (name === "fetch" || name === "request")) return "net";
  if (/@types\/node\/globals\.d\.ts$|undici/.test(file) && name === "fetch") return "net";
  if (file.endsWith("src/desktop/api.ts") && ts.isInterfaceDeclaration(decl.parent) && decl.parent.name.text === "DesktopApi") return "ipc";
  if (/w3c-web-usb/.test(file) && /^(getDevices|requestDevice)$/.test(name)) return "usb";
  if (file.endsWith("src/protocol/transport.ts") && /^(getReport|setReport)$/.test(name)) return "hid";
  return null;
}
// Our functions a call resolves to (shared resolver: interfaces, object literals, factories).
function targetsOf(call) {
  const decl = tc.getResolvedSignature(call)?.declaration;
  if (decl && ours(decl.getSourceFile()) && isFunctionLike(decl)) return [decl];
  return ts.isIdentifier(call.expression) || ts.isPropertyAccessExpression(call.expression) ? resolveFns(call.expression) : [];
}
const directSinks = new Map(); // fn node -> Set of sink kinds
const callees = new Map(); // fn node -> Set of fn nodes
const allCalls = [];
for (const sf of files) {
  const visit = (n) => {
    if (ts.isCallExpression(n)) {
      allCalls.push(n);
      const sink = sinkOf(n);
      const targets = targetsOf(n);
      for (const fn of inPlaceOwners(enclosingFn(n))) {
        if (sink) (directSinks.get(fn) ?? directSinks.set(fn, new Set()).get(fn)).add(sink);
        for (const t of targets) (callees.get(fn) ?? callees.set(fn, new Set()).get(fn)).add(t);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
// A function's own calls plus those of the callbacks it passes to a call (they
// run in place); a function it returns or stores runs later and doesn't count.
function* inPlaceOwners(fn) {
  for (let c = fn; c; c = c.parent && ts.isCallExpression(c.parent) && c.parent.arguments.includes(c) ? enclosingFn(c) : null) yield c;
}
const reach = new Map();
function sinksOf(fn, stack = new Set()) {
  if (reach.has(fn)) return reach.get(fn);
  if (stack.has(fn)) return new Set();
  stack.add(fn);
  const out = new Set(directSinks.get(fn) ?? []);
  for (const c of callees.get(fn) ?? []) for (const s of sinksOf(c, stack)) out.add(s);
  stack.delete(fn);
  if (stack.size === 0) reach.set(fn, out);
  return out;
}
const callSinks = (call) => {
  const out = new Set();
  const s = sinkOf(call);
  if (s) out.add(s);
  for (const t of targetsOf(call)) for (const k of sinksOf(t)) out.add(k);
  for (const a of call.arguments) if (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) for (const k of sinksOf(a)) out.add(k);
  return out;
};

// ---------- rows ----------
const rows = [];
const add = (node, kind, name, detail) =>
  GATED.has(kind) && NOT_KEPT_STATE.test(node.getSourceFile().fileName) ? 0 : rows.push({ sf: node.getSourceFile(), node, line: lineOf(node), fn: ownerName(node), kind, name, detail });

// Writes to a binding (symbol), outside its own declaration.
function writesTo(sym, scope) {
  const out = [];
  const visit = (n) => {
    if (ts.isIdentifier(n) && tc.getSymbolAtLocation(n) === sym) {
      const p = n.parent;
      const target = ts.isPropertyAccessExpression(p) && p.name === n ? p : n;
      const up = target.parent;
      if (ts.isBinaryExpression(up) && up.left === target && up.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && up.operatorToken.kind <= ts.SyntaxKind.LastAssignment)
        out.push({ n, how: ts.tokenToString(up.operatorToken.kind) });
      else if ((ts.isPrefixUnaryExpression(up) || ts.isPostfixUnaryExpression(up)) && (up.operator === ts.SyntaxKind.PlusPlusToken || up.operator === ts.SyntaxKind.MinusMinusToken))
        out.push({ n, how: "++" });
      else if (ts.isPropertyAccessExpression(up) && up.expression === target && ts.isCallExpression(up.parent) && up.parent.expression === up && MUTATORS.has(up.name.text))
        out.push({ n, how: `.${up.name.text}` });
      else if ((ts.isElementAccessExpression(up) || ts.isPropertyAccessExpression(up)) && up.expression === target) {
        const a = up.parent;
        if ((ts.isBinaryExpression(a) && a.left === up && a.operatorToken.kind === ts.SyntaxKind.EqualsToken) || ts.isDeleteExpression(a)) out.push({ n, how: "[]=" });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(scope);
  return out;
}
const isCollectionInit = (init) =>
  !!init &&
  ((ts.isNewExpression(init) && ts.isIdentifier(init.expression) && /^(Map|Set|WeakMap|WeakSet)$/.test(init.expression.text)) ||
    ts.isArrayLiteralExpression(init) ||
    (ts.isObjectLiteralExpression(init) && init.properties.length === 0));
const isListenerSet = (node) => {
  const t = tc.getTypeAtLocation(node);
  const arg = t.aliasTypeArguments?.[0] ?? tc.getTypeArguments?.(t)?.[0];
  return !!arg && arg.getCallSignatures().length > 0;
};
const hasTimestamp = (node) => {
  const t = tc.getNonNullableType(tc.getTypeAtLocation(node));
  return ["at", "since", "expires", "time"].some((p) => {
    const prop = t.getProperty?.(p);
    return prop && tc.getTypeOfSymbolAtLocation(prop, node).flags & ts.TypeFlags.NumberLike;
  });
};
const ioInit = (init) => {
  const out = new Set();
  const visit = (n) => {
    if (isFunctionLike(n)) return;
    // what the call itself reaches; a callback it's given runs later
    if (ts.isCallExpression(n)) for (const s of [sinkOf(n), ...targetsOf(n).flatMap((t) => [...sinksOf(t)])]) if (s) out.add(s);
    ts.forEachChild(n, visit);
  };
  if (init) visit(init);
  return out;
};
// Does an assignment's value come from I/O (directly, or a local read from it)?
const rhsIo = (w) => {
  let a = w.n.parent;
  while (a && !ts.isBinaryExpression(a)) a = a.parent;
  if (!a || a.operatorToken.kind < ts.SyntaxKind.FirstAssignment || a.operatorToken.kind > ts.SyntaxKind.LastAssignment) return false;
  if (ioInit(a.right).size) return true;
  // or built from locals that were read from I/O
  let hit = false;
  const v = (n) => {
    if (ts.isIdentifier(n)) {
      const d = declOf(n)?.valueDeclaration;
      if (d && ts.isVariableDeclaration(d) && d.initializer && enclosingFn(d) && ioInit(d.initializer).size) hit = true;
    }
    if (!hit) ts.forEachChild(n, v);
  };
  v(a.right);
  if (hit) return true;
  let root = a.right;
  while (ts.isPropertyAccessExpression(root) || ts.isAwaitExpression(root) || ts.isNonNullExpression(root) || ts.isParenthesizedExpression(root)) root = root.expression;
  const d = ts.isIdentifier(root) ? declOf(root)?.valueDeclaration : null;
  return !!d && ts.isVariableDeclaration(d) && ioInit(d.initializer).size > 0;
};
// Is a write inside an `if` (or ?:) whose condition reads the same binding (lazy init)?
const guarded = (w, sym) => {
  for (let p = w.n.parent; p && !isFunctionLike(p); p = p.parent) {
    const cond = ts.isIfStatement(p) ? p.expression : ts.isConditionalExpression(p) ? p.condition : null;
    if (!cond) continue;
    let hit = false;
    const v = (n) => {
      if (ts.isIdentifier(n) && tc.getSymbolAtLocation(n) === sym) hit = true;
      ts.forEachChild(n, v);
    };
    v(cond);
    if (hit) return true;
  }
  return false;
};
function judgeBinding(declNode, nameNode, init, scope, kind, inFnOnly) {
  const sym = tc.getSymbolAtLocation(nameNode);
  if (!sym) return;
  const name = nameNode.text;
  const writes = writesTo(sym, scope).filter((w) => !inFnOnly || enclosingFn(w.n));
  const type = typeText(nameNode);
  const collection = isCollectionInit(init) || COLLECTION_TYPE.test(fullType(nameNode));
  if (collection && isListenerSet(nameNode)) return; // a subscriber registry, not a cache
  const io = ioInit(init);
  const mutated = writes.length > 0;
  if (collection && mutated) return add(declNode, kind, name, `${type}; written by ${[...new Set(writes.map((w) => w.how))].join(" ")}`);
  if (!collection && mutated) {
    const why = MEMO_NAME.test(name)
      ? "name"
      : writes.some((w) => w.how === "??=" || w.how === "||=")
        ? "??="
        : writes.some((w) => guarded(w, sym))
          ? "lazy"
          : hasTimestamp(nameNode)
            ? "timestamp"
            : writes.some(rhsIo)
              ? "io"
              : null;
    if (why) return add(declNode, kind, name, `${type}; memo by ${why}`);
  }
  if (io.size && (kind === "module" || kind === "field")) return add(declNode, "snapshot", name, `${type}; read once: ${[...io].join(",")}`);
  if (kind === "closure" && MEMO_NAME.test(name) && /cach|memo/i.test(name)) return add(declNode, kind, name, `${type}; named`);
}

for (const sf of files) {
  // module-level bindings
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) judgeBinding(d, d.name, d.initializer, sf, "module", true);
  }
  const visit = (n) => {
    // class fields
    if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) {
      for (const m of n.members) {
        if (ts.isPropertyDeclaration(m) && ts.isIdentifier(m.name) && !(m.initializer && (ts.isArrowFunction(m.initializer) || ts.isFunctionExpression(m.initializer)))) {
          const ctorInit = n.members.find(ts.isConstructorDeclaration);
          let init = m.initializer;
          if (!init && ctorInit) {
            const v = (x) => {
              if (
                ts.isBinaryExpression(x) &&
                x.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
                ts.isPropertyAccessExpression(x.left) &&
                x.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
                x.left.name.text === m.name.text
              )
                init = x.right;
              ts.forEachChild(x, v);
            };
            v(ctorInit);
          }
          const sym = tc.getSymbolAtLocation(m.name);
          if (!sym) continue;
          // writes in methods (not the constructor); this.x is a property access
          const writes = [];
          const v = (x) => {
            if (ts.isPropertyAccessExpression(x) && x.expression.kind === ts.SyntaxKind.ThisKeyword && x.name.text === m.name.text) {
              const fn = enclosingFn(x);
              if (fn && !ts.isConstructorDeclaration(fn)) {
                const up = x.parent;
                if (ts.isBinaryExpression(up) && up.left === x && up.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && up.operatorToken.kind <= ts.SyntaxKind.LastAssignment)
                  writes.push({ n: x.name, how: ts.tokenToString(up.operatorToken.kind) });
                else if ((ts.isPostfixUnaryExpression(up) || ts.isPrefixUnaryExpression(up)) && up.operator !== ts.SyntaxKind.ExclamationToken) writes.push({ n: x.name, how: "++" });
                else if (ts.isPropertyAccessExpression(up) && up.expression === x && ts.isCallExpression(up.parent) && up.parent.expression === up && MUTATORS.has(up.name.text))
                  writes.push({ n: x.name, how: `.${up.name.text}` });
                else if (
                  (ts.isElementAccessExpression(up) || ts.isPropertyAccessExpression(up)) &&
                  up.expression === x &&
                  ts.isBinaryExpression(up.parent) &&
                  up.parent.left === up &&
                  up.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
                )
                  writes.push({ n: x.name, how: "[]=" });
              }
            }
            ts.forEachChild(x, v);
          };
          v(n);
          const type = typeText(m.name);
          const collection = isCollectionInit(init) || COLLECTION_TYPE.test(fullType(m.name));
          const io = ioInit(init);
          if (collection && isListenerSet(m.name)) continue;
          if (collection && writes.length) add(m, "field", m.name.text, `${type}; written by ${[...new Set(writes.map((w) => w.how))].join(" ")}`);
          else if (!collection && writes.length) {
            const why = MEMO_NAME.test(m.name.text) ? "name" : writes.some((w) => w.how === "??=" || w.how === "||=") ? "??=" : hasTimestamp(m.name) ? "timestamp" : writes.some(rhsIo) ? "io" : null;
            if (why) add(m, "field", m.name.text, `${type}; memo by ${why}`);
            else if (io.size) add(m, "snapshot", m.name.text, `${type}; read once: ${[...io].join(",")}`);
          } else if (io.size) add(m, "snapshot", m.name.text, `${type}; read once: ${[...io].join(",")}`);
        }
      }
    }
    // closures: a function-local binding mutated from a nested function
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && enclosingFn(n) && ts.isVariableDeclarationList(n.parent)) {
      const outer = enclosingFn(n);
      const callee = n.initializer && ts.isCallExpression(n.initializer) ? n.initializer.expression : null;
      const hook = callee && ts.isIdentifier(callee) ? callee.text : "";
      if (hook === "useRef") {
        const arg = n.initializer.arguments[0];
        const why = arg && isCollectionInit(arg) ? "collection" : /cach|memo|^last|^prev|seen/i.test(n.name.text) ? "name" : refMemo(n, outer);
        if (why) add(n, "ref", n.name.text, `${typeText(n.name)}; ${why}`);
      } else if (hook === "useMemo" || hook === "useCallback") {
        add(n, hook, n.name.text, depsText(n.initializer));
      } else {
        const sym = tc.getSymbolAtLocation(n.name);
        const collection = isCollectionInit(n.initializer) || COLLECTION_TYPE.test(fullType(n.name));
        if (sym && collection && !isListenerSet(n.name)) {
          // a memo, not an accumulator: a nested function writes it and something looks it up
          const writes = writesTo(sym, outer).filter((w) => enclosingFn(w.n) !== outer && !iterCallback(enclosingFn(w.n)));
          const looked = lookups(sym, outer);
          if (writes.length && looked)
            add(n, "closure", n.name.text, `${typeText(n.name)}; written by a nested function (${[...new Set(writes.map((w) => w.how))].join(" ")}), looked up with ${looked}`);
        }
      }
    }
    // useMemo / useCallback not bound to a name (inline), and memo()
    if (ts.isCallExpression(n)) {
      const c = n.expression;
      const name = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === "React" ? c.name.text : "";
      if ((name === "useMemo" || name === "useCallback") && !(ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name))) add(n, name, "(inline)", depsText(n));
      if (name === "memo" && declOf(c)?.declarations?.some((d) => /react/.test(d.getSourceFile().fileName))) add(n, "memo", memoName(n), "React.memo");
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
// A ref used as a memo: ref.current ??= …, or ref.current (or a key of it) set
// from a DOM read (looked up once instead of on every frame).
// The initializer texts of the locals an expression reads.
function localInits(expr) {
  const out = [];
  const v = (n) => {
    if (ts.isIdentifier(n)) {
      const d = declOf(n)?.valueDeclaration;
      if (d && (ts.isVariableDeclaration(d) || ts.isBindingElement(d))) {
        const decl = ts.isBindingElement(d) ? d.parent.parent : d;
        if (decl.initializer && enclosingFn(decl)) out.push(decl.initializer.getText());
      }
    }
    ts.forEachChild(n, v);
  };
  v(expr);
  return out;
}
function refMemo(decl, scope) {
  const sym = tc.getSymbolAtLocation(decl.name);
  let why = "";
  const v = (n) => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      let t = n.left;
      while (ts.isElementAccessExpression(t) || (ts.isPropertyAccessExpression(t) && t.name.text !== "current")) t = t.expression;
      if (ts.isPropertyAccessExpression(t) && t.name.text === "current" && ts.isIdentifier(t.expression) && tc.getSymbolAtLocation(t.expression) === sym) {
        if (n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionEqualsToken || n.operatorToken.kind === ts.SyntaxKind.BarBarEqualsToken) why = "memo by ??=";
        else if (DOM_READS.test(n.right.getText()) || localInits(n.right).some((t) => DOM_READS.test(t))) why ||= "DOM lookup kept";
      }
    }
    ts.forEachChild(n, v);
  };
  v(scope);
  return why;
}
function memoName(call) {
  const a = call.arguments[0];
  if (a && ts.isIdentifier(a)) return a.text;
  if (a && isFunctionLike(a) && a.name) return a.name.text;
  return ts.isVariableDeclaration(call.parent) && ts.isIdentifier(call.parent.name) ? call.parent.name.text : "(inline)";
}
function lookups(sym, scope) {
  let how = "";
  const v = (n) => {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && tc.getSymbolAtLocation(n.expression) === sym && /^(get|has|includes)$/.test(n.name.text) && ts.isCallExpression(n.parent))
      how = `.${n.name.text}`;
    ts.forEachChild(n, v);
  };
  v(scope);
  return how;
}
function depsText(call) {
  const deps = call.arguments[1];
  return deps ? `deps ${deps.getText().replace(/\s+/g, " ")}` : "no deps";
}

// storage keys: one row per key
const PREF_FNS = new Set(["readPref", "writePref", "usePref", "useFlagPref", "useRawPref"]);
const storageKeys = new Map();
for (const call of allCalls) {
  const c = call.expression;
  const name = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : "";
  const viaPref = PREF_FNS.has(name) && declOf(c)?.declarations?.some((d) => d.getSourceFile().fileName.endsWith("src/desktop/storage.ts"));
  const viaLs = /^(getItem|setItem|removeItem)$/.test(name) && ts.isPropertyAccessExpression(c) && /localStorage|sessionStorage/.test(c.expression.getText());
  if (!viaPref && !viaLs) continue;
  if (call.getSourceFile().fileName.endsWith("src/desktop/storage.ts")) continue; // the helpers themselves
  const arg = call.arguments[0];
  if (!arg) continue;
  let key = arg.getText();
  const sym = ts.isIdentifier(arg) ? declOf(arg) : null;
  const d = sym?.valueDeclaration;
  if (d && ts.isVariableDeclaration(d) && d.initializer && (ts.isStringLiteral(d.initializer) || ts.isNoSubstitutionTemplateLiteral(d.initializer))) key = JSON.stringify(d.initializer.text);
  const entry = storageKeys.get(key) ?? { first: call, sites: [] };
  if (`${relPath(call.getSourceFile())}:${lineOf(call)}`.localeCompare(`${relPath(entry.first.getSourceFile())}:${lineOf(entry.first)}`, "en", { numeric: true }) < 0) entry.first = call;
  entry.sites.push(`${relPath(call.getSourceFile())}:${lineOf(call)} ${name}`);
  storageKeys.set(key, entry);
}
for (const [key, e] of storageKeys) {
  e.sites.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  add(e.first, "storage", key, `${e.sites.length} site(s): ${e.sites.join(", ")}`);
}

// ttl: a relational comparison against the clock
const CLOCK = /Date\.now\(\)|performance\.now\(\)|\.now\(\)|\bnow\b|\bage\b|\belapsed\b/;
for (const sf of files) {
  const visit = (n) => {
    if (
      ts.isBinaryExpression(n) &&
      [ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanEqualsToken].includes(n.operatorToken.kind)
    ) {
      const text = n.getText();
      if (CLOCK.test(text) && (/-/.test(text) || /\bage\b|\belapsed\b/.test(text))) add(n, "ttl", text.replace(/\s+/g, " ").slice(0, 80), "");
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

// repeat-io: an I/O-reaching call inside a loop body (same function)
function loopAround(call) {
  for (let c = call, p = call.parent; p; c = p, p = p.parent) {
    // a for-of / for-in's iterable and a for's initializer run once
    if ((ts.isForOfStatement(p) || ts.isForInStatement(p)) && c === p.expression) continue;
    if (ts.isForStatement(p) && c === p.initializer) continue;
    if (isStmtLoop(p)) return p;
    if (isFunctionLike(p)) return iterCallback(p) ? p.parent : null;
  }
  return null;
}
const seenRepeat = new Set();
for (const call of allCalls) {
  if (!ours(call.getSourceFile())) continue;
  const loop = loopAround(call);
  if (!loop) continue;
  // a callback inside the call is counted where it's called from, not here
  const sinks = new Set([sinkOf(call), ...targetsOf(call).flatMap((t) => [...sinksOf(t)])].filter(Boolean));
  if (!sinks.size) continue;
  const name = ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : call.expression.getText().slice(0, 40);
  const key = `${relPath(call.getSourceFile())}:${lineOf(call)}:${name}`;
  if (seenRepeat.has(key)) continue;
  seenRepeat.add(key);
  add(
    call,
    "repeat-io",
    name,
    `in ${ts.isCallExpression(loop) ? "." + loop.expression.name.text : ts.SyntaxKind[loop.kind].replace("Statement", "").toLowerCase()} (line ${lineOf(loop)}); reaches ${[...sinks].join(",")}`,
  );
}
// dup-read: the same read (callee and arguments, as written) more than once in
// one function, e.g. one JSON file parsed twice per scan
const sameRead = new Map();
for (const call of allCalls) {
  if (!ours(call.getSourceFile()) || !call.arguments.length) continue;
  const direct = sinkOf(call);
  const viaOurs = !direct && targetsOf(call).some((t) => sinksOf(t).has("fs"));
  if (direct !== "fs" && !viaOurs) continue;
  const key = `${relPath(call.getSourceFile())}\0${ownerName(call)}\0${call.getText().replace(/\s+/g, " ")}`;
  (sameRead.get(key) ?? sameRead.set(key, []).get(key)).push(call);
}
for (const [, calls] of sameRead) {
  if (calls.length < 2) continue;
  const name = ts.isPropertyAccessExpression(calls[0].expression) ? calls[0].expression.name.text : calls[0].expression.getText();
  add(calls[0], "dup-read", name, `${calls.length}× ${calls[0].getText().replace(/\s+/g, " ").slice(0, 90)} (lines ${calls.map(lineOf).join(", ")})`);
}

// poll-io: setInterval / usePoll callbacks that reach I/O
for (const call of allCalls) {
  const c = call.expression;
  const name = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : "";
  const cb = call.arguments[0];
  if (!cb) continue;
  // a poll that re-arms itself: setTimeout(() => tick(), ms) inside tick
  const rearm =
    name === "setTimeout" &&
    (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) &&
    (() => {
      const self = nameOfFn(enclosingFn(call));
      let calls = false;
      const v = (n) => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === self) calls = true;
        ts.forEachChild(n, v);
      };
      v(cb);
      return calls;
    })();
  if (name !== "setInterval" && name !== "usePoll" && !rearm) continue;
  const sinks = new Set();
  if (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) for (const s of sinksOf(cb)) sinks.add(s);
  else if (ts.isCallExpression(cb)) for (const s of callSinks(cb)) sinks.add(s);
  else
    for (const d of declOf(cb)?.declarations ?? []) {
      const fn = isFunctionLike(d) ? d : ts.isVariableDeclaration(d) && d.initializer && isFunctionLike(d.initializer) ? d.initializer : null;
      if (fn) for (const s of sinksOf(fn)) sinks.add(s);
    }
  // a method reference or wrapper: look inside the callback's body calls
  if (!sinks.size && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) {
    const v = (n) => {
      if (ts.isCallExpression(n)) for (const s of callSinks(n)) sinks.add(s);
      ts.forEachChild(n, v);
    };
    v(cb);
  }
  if (sinks.size) add(call, "poll-io", name, `every ${call.arguments[1]?.getText() ?? "?"}; reaches ${[...sinks].join(",")}`);
}

// effect-io: a useEffect that reaches I/O, so it runs again on every mount and
// deps change (the renderer's scan results, details and colors live in
// component state, asked for again when a page opens)
for (const call of allCalls) {
  const c = call.expression;
  if (!(ts.isIdentifier(c) && c.text === "useEffect")) continue;
  const cb = call.arguments[0];
  if (!cb || !(ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) continue;
  const sinks = new Set();
  const names = new Set();
  const v = (n) => {
    if (ts.isCallExpression(n)) {
      const k = callSinks(n);
      for (const x of k) sinks.add(x);
      if (k.size) names.add(ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : n.expression.getText().slice(0, 30));
    }
    // a function stored for later (a handler, a timer) runs later, not on mount
    if (
      n !== cb &&
      isFunctionLike(n) &&
      !(
        ts.isCallExpression(n.parent) &&
        /^(then|catch|finally|all|race|map|forEach)$/.test(
          ts.isPropertyAccessExpression(n.parent.expression) ? n.parent.expression.name.text : ts.isIdentifier(n.parent.expression) ? n.parent.expression.text : "",
        )
      )
    )
      return;
    ts.forEachChild(n, v);
  };
  v(cb.body);
  if (sinks.size) add(call, "effect-io", [...names].join(" ").slice(0, 60), `${depsText(call)}; reaches ${[...sinks].join(",")}`);
}

// ---------- verdict comments ----------
function commentFor(row) {
  const lines = row.sf.text.split("\n");
  const at = row.line - 1;
  for (let i = at; i >= Math.max(0, at - 3); i--) {
    const m = lines[i].match(/cache:\s*([A-Z-]+)\s+—\s+(.*)$/);
    if (m) return { ok: COMMENT_RE.test(lines[i]), verdict: m[1], text: m[2].replace(/\s*\*\/\}?\s*$/, "") };
    if (i < at && !/^\s*(\/\/|\/\*|\*|\{\/\*)/.test(lines[i])) break;
  }
  return null;
}

const out = rows.map((r) => ({ ...r, file: relPath(r.sf), c: commentFor(r) })).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind));

// ---------- firmware (read-only, C/C++) ----------
function firmwareRows(repo) {
  const res = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(c|cpp|h|hpp)$/.test(e)) {
        const lines = readFileSync(p, "utf8").split("\n");
        lines.forEach((l, i) => {
          // a file-scope container (a keyed table that can hold answers)
          const c = l.match(/^(?:static\s+)?(?:std::)?(?:unordered_map|map|unordered_set|set|vector|deque)\s*<.*>\s+(\w+)\s*(?:=|;|\{)/);
          if (c) return res.push({ file: `fw:${relative(repo, p)}`, line: i + 1, fn: "-", kind: "fw-table", name: c[1], detail: l.trim().slice(0, 100) });
          const m = l.match(/^\s*static\s+(?!inline|constexpr|const\b|void\b|bool\s+\w+\s*\()[\w:<>, ]+?[\s*&]+(\w+)\s*(\[[^\]]*\])*\s*(=|;)/);
          if (m && !/\(/.test(l.split("=")[0]) && (MEMO_NAME.test(m[1]) || /prev|last|cached|seen|valid|have_/i.test(m[1])))
            res.push({ file: `fw:${relative(repo, p)}`, line: i + 1, fn: "-", kind: "fw-static", name: m[1], detail: l.trim().slice(0, 100) });
        });
      }
    }
  };
  walk(join(repo, "src"));
  return res;
}

const args = process.argv.slice(2);
if (args.includes("--check")) {
  const bad = out.filter((r) => GATED.has(r.kind) && !r.c?.ok);
  for (const r of bad)
    console.error(`${r.file}:${r.line}: ${r.kind} "${r.name}" needs "// cache: VERDICT — key=…; invalidated=…; bound=…" (${r.c ? "malformed" : "missing"}); see CLAUDE.md "Cache pass"`);
  if (bad.length) process.exit(1);
  console.log(`cache gate: ${out.filter((r) => GATED.has(r.kind)).length} kept-state rows, all with a cache comment`);
} else {
  const fwAt = args.indexOf("--firmware");
  const fw = fwAt >= 0 ? firmwareRows(args[fwAt + 1]) : [];
  console.log(["file", "line", "function", "kind", "name", "detail", "verdict", "comment"].join("\t"));
  for (const r of [...out, ...fw]) console.log([r.file, r.line, r.fn, r.kind, r.name, r.detail, r.c?.verdict ?? "", r.c?.text ?? ""].map((x) => String(x).replace(/\s+/g, " ")).join("\t"));
}
