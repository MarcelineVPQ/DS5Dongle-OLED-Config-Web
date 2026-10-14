#!/usr/bin/env node
// Lifetime-pass candidates, listed mechanically (the AVIEW pass pattern: never
// review resource lifetimes by eye). One TSV row per acquisition in src/ and
// electron/ (tests and the vendored src/flash/picoflash excluded):
//   listener   addEventListener; .on/.once/.addListener/.prependListener (Node
//              and Electron emitters: ipcMain, ipcRenderer, app, windows, child
//              processes, streams, sockets, tray, powerMonitor ...); an
//              on<event> = handler property assignment (navigator.usb.onconnect,
//              port.onmessage)
//   ipc        ipcMain.handle / handleOnce
//   timer      setInterval; setTimeout (rearm = the callback calls the function
//              that armed it); requestAnimationFrame (raf)
//   poll       usePoll
//   media      getUserMedia, AudioContext, audioWorklet.addModule,
//              AudioWorkletNode, MediaStream sources, new Audio, MediaRecorder
//   observer   ResizeObserver, MutationObserver, IntersectionObserver,
//              PerformanceObserver
//   device     WebUSB/HID device open() / claimInterface, requestDevice
//   process    spawn / exec / execFile / fork (not the *Sync forms),
//              utilityProcess.fork; "+systemd-run" when it starts a unit
//   watcher    fs.watch / fs.watchFile
//   socket     net/tls/http(s) createServer / connect / request, WebSocket,
//              dgram sockets
//   electron   BrowserWindow, Tray, Menu.buildFromTemplate, Notification,
//              powerSaveBlocker.start, globalShortcut.register, protocol.handle,
//              Worker, MessageChannel
//   url        URL.createObjectURL
//   effect     useEffect / useLayoutEffect (the cleanup column says whether it
//              returns a cleanup on every path, some paths, or none)
// The context column: "module" (module scope: lives as long as the process or
// page), "effect" (inside an effect body), "effect-cleanup", "render" (a
// component or hook body), or "-" (an ordinary function or handler).
//
// Usage: node tools/list_lifetimes.mjs           TSV: file line function kind detail context verdict head
//        node tools/list_lifetimes.mjs --check   the gate (npm run gates): exit 1 on a row
//                                                without a valid verdict comment
//        node tools/list_lifetimes.mjs --md      the per-file tables for docs/LIFETIME_PASS_*.md
//        node tools/list_lifetimes.mjs --counts  verdict counts per kind
//
// A verdict is a comment on the acquisition's line or in the comment block
// right above it (the statement's first line):
//   // lifetime: OK — removed in the effect cleanup (unmount)
//   {/* lifetime: NOT-WORTH — one per app, lives until quit */}   (inside JSX)
// Verdicts: OK (the release point named), LEAK, WASTE, HOT-ALLOC, NOT-WORTH,
// each followed by " — " and the reason. See CLAUDE.md "Lifetime pass".
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\\/g, "/");
const SKIP = /(node_modules|src\/flash\/picoflash|\.d\.ts$)/;
export const VERDICTS = ["OK", "LEAK", "WASTE", "HOT-ALLOC", "NOT-WORTH"];
const VERDICT_RE = new RegExp(`lifetime:\\s*(${VERDICTS.join("|")})\\s+—\\s+\\S`);

const files = ["src", "electron"].flatMap((d) => ts.sys.readDirectory(join(ROOT, d), [".ts", ".tsx", ".js"])).filter((p) => !SKIP.test(p));
const program = ts.createProgram(files, {
  target: ts.ScriptTarget.ES2022,
  lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  types: ["node", "w3c-web-usb", "vite/client"],
  typeRoots: [join(ROOT, "node_modules/@types"), join(ROOT, "node_modules")],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  allowJs: true,
  noEmit: true,
  skipLibCheck: true,
  strict: true,
  resolveJsonModule: true,
});
const checker = program.getTypeChecker();
const sources = files.map((f) => program.getSourceFile(f)).filter(Boolean);
const rel = (sf) => relative(ROOT, sf.fileName).replace(/\\/g, "/");

// ---------- helpers ----------
const isFn = (n) =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isConstructorDeclaration(n) ||
  ts.isGetAccessorDeclaration(n) ||
  ts.isSetAccessorDeclaration(n);
const calleeName = (call) => {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return "";
};
const receiverText = (call, sf) => (ts.isPropertyAccessExpression(call.expression) ? call.expression.expression.getText(sf) : "");
const short = (s, n = 40) => s.replace(/\s+/g, " ").trim().slice(0, n);
function fnName(fn) {
  if (fn.name && (ts.isIdentifier(fn.name) || ts.isPrivateIdentifier(fn.name))) return fn.name.text;
  if (ts.isConstructorDeclaration(fn)) return "constructor";
  const p = fn.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p && (ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) && p.name && ts.isIdentifier(p.name)) return p.name.text;
  if (p && ts.isCallExpression(p)) {
    const c = calleeName(p);
    if ((c === "memo" || c === "forwardRef") && p.parent && ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name)) return p.parent.name.text;
    return `${c || "?"}(cb)`;
  }
  if (p && ts.isJsxExpression(p) && p.parent && ts.isJsxAttribute(p.parent)) return `${p.parent.name.getText()}=`;
  return "<anonymous>";
}
function displayFn(node) {
  const names = [];
  for (let p = node.parent; p; p = p.parent) {
    if (!isFn(p)) continue;
    const n = fnName(p);
    names.unshift(n);
    if (!/\(cb\)$|^<anonymous>$|=$/.test(n)) break;
  }
  return names.length ? names.join(" > ") : "<module>";
}
const EFFECTS = new Set(["useEffect", "useLayoutEffect"]);
const isEffectCall = (n) => ts.isCallExpression(n) && EFFECTS.has(calleeName(n)) && n.arguments.length > 0 && isFn(n.arguments[0]);
const isComponentOrHook = (fn) => {
  const n = fnName(fn);
  if (/\(cb\)$/.test(n)) return false;
  return /^use[A-Z]/.test(n) || (/\.tsx$/.test(fn.getSourceFile().fileName) && /^[A-Z]/.test(n) && !ts.isMethodDeclaration(fn));
};
// Where the acquisition runs: the nearest function decides.
function context(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (!isFn(p)) continue;
    const call = p.parent;
    if (call && ts.isCallExpression(call) && call.arguments[0] === p && EFFECTS.has(calleeName(call))) return "effect";
    // The function an effect returns (its cleanup).
    const eff = effectOfCleanup(p);
    if (eff) return "effect-cleanup";
    if (isComponentOrHook(p)) return "render";
    return "-";
  }
  return "module";
}
function effectOfCleanup(fn) {
  const r = fn.parent;
  if (!r) return null;
  let body = null;
  if (ts.isReturnStatement(r)) {
    for (let p = r.parent; p; p = p.parent) if (isFn(p)) { body = p; break; }
  } else if (ts.isArrowFunction(r) && r.body === fn) body = r;
  if (!body) return null;
  const call = body.parent;
  return call && ts.isCallExpression(call) && call.arguments[0] === body && EFFECTS.has(calleeName(call)) ? call : null;
}
// Does an effect callback return a cleanup? "all", "some" (some return paths
// return nothing) or "none".
function effectCleanup(cb) {
  if (!ts.isBlock(cb.body)) return isFn(cb.body) || ts.isCallExpression(cb.body) || ts.isIdentifier(cb.body) ? "all?" : "none";
  const rets = [];
  const visit = (n) => {
    if (isFn(n)) return;
    if (ts.isReturnStatement(n)) rets.push(n);
    ts.forEachChild(n, visit);
  };
  cb.body.statements.forEach(visit);
  const withValue = rets.filter((r) => r.expression && r.expression.kind !== ts.SyntaxKind.UndefinedKeyword && r.expression.getText() !== "undefined");
  if (!withValue.length) return "none";
  const last = cb.body.statements.at(-1);
  const endsInReturn = last && ts.isReturnStatement(last) && last.expression;
  return withValue.length === rets.length && endsInReturn ? "all" : "some";
}
const typeName = (expr) => {
  try {
    return checker.typeToString(checker.getTypeAtLocation(expr));
  } catch {
    return "";
  }
};
const strArg = (call, i = 0) => {
  const a = call.arguments[i];
  return a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) ? a.text : a ? short(a.getText(), 30) : "";
};
const TIMER_IDS = new Set(["setTimeout", "setInterval", "requestAnimationFrame"]);
const isGlobalCall = (call, names) => {
  const e = call.expression;
  if (ts.isIdentifier(e)) return names.has(e.text);
  return ts.isPropertyAccessExpression(e) && /^(window|globalThis|self)$/.test(e.expression.getText()) && names.has(e.name.text);
};
// A timer whose callback calls the function that armed it (a self re-arming poll).
function rearms(call) {
  const cb = call.arguments[0];
  let owner = null;
  for (let p = call.parent; p; p = p.parent) if (isFn(p) && p !== cb) { owner = p; break; }
  if (!owner || !cb) return false;
  const name = fnName(owner);
  if (ts.isIdentifier(cb)) return cb.text === name;
  let hit = false;
  const visit = (n) => {
    if (ts.isCallExpression(n) && calleeName(n) === name) hit = true;
    if (!hit) ts.forEachChild(n, visit);
  };
  visit(cb);
  return hit;
}
const OBSERVERS = new Set(["ResizeObserver", "MutationObserver", "IntersectionObserver", "PerformanceObserver"]);
const ELECTRON_NEW = new Set(["BrowserWindow", "Tray", "Notification", "Worker", "MessageChannel", "WebSocket", "AudioContext", "OfflineAudioContext", "AudioWorkletNode", "Audio", "MediaRecorder", "SharedWorker"]);
const PROC = new Set(["spawn", "exec", "execFile", "fork"]);
const EMIT_ON = new Set(["on", "once", "addListener", "prependListener", "prependOnceListener"]);

function classify(n, sf) {
  if (ts.isNewExpression(n) && ts.isIdentifier(n.expression)) {
    const c = n.expression.text;
    if (OBSERVERS.has(c)) return ["observer", c];
    if (ELECTRON_NEW.has(c)) return [/Audio|MediaRecorder/.test(c) ? "media" : c === "WebSocket" ? "socket" : "electron", c];
    return null;
  }
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left)) {
    const name = n.left.name.text;
    if (/^on[a-z]+$/.test(name) && n.right.kind !== ts.SyntaxKind.NullKeyword && !(ts.isIdentifier(n.right) && n.right.text === "undefined")) return ["listener", `${short(n.left.expression.getText(sf), 30)}.${name} =`];
    return null;
  }
  if (!ts.isCallExpression(n)) return null;
  const name = calleeName(n);
  const recv = receiverText(n, sf);
  if (isGlobalCall(n, TIMER_IDS)) {
    if (name === "requestAnimationFrame") return ["timer", "raf"];
    if (name === "setInterval") return ["timer", "setInterval"];
    return ["timer", rearms(n) ? "setTimeout rearm" : "setTimeout"];
  }
  if (EFFECTS.has(name) && n.arguments[0] && isFn(n.arguments[0])) return ["effect", `${name} cleanup:${effectCleanup(n.arguments[0])}`];
  if (name === "usePoll") return ["poll", "usePoll"];
  if (name === "addEventListener") return ["listener", `${short(recv, 30) || "this"} "${strArg(n)}"`];
  if (EMIT_ON.has(name) && recv && n.arguments.length >= 2) {
    if (recv === "ipcMain" || recv === "ipcRenderer") return ["listener", `${recv}.${name} "${strArg(n)}"`];
    return ["listener", `${short(recv, 30)}.${name} "${strArg(n)}"`];
  }
  if ((name === "handle" || name === "handleOnce") && recv === "ipcMain") return ["ipc", `ipcMain.${name} "${strArg(n)}"`];
  if (name === "handle" && recv === "protocol") return ["electron", `protocol.handle "${strArg(n)}"`];
  if (name === "getUserMedia") return ["media", "getUserMedia"];
  if (name === "addModule" && /audioWorklet/.test(recv)) return ["media", "audioWorklet.addModule"];
  if (/^createMedia(Stream|Element)(Source|Destination)$/.test(name)) return ["media", name];
  if (name === "createObjectURL") return ["url", "createObjectURL"];
  if ((name === "open" || name === "claimInterface" || name === "requestDevice") && recv) {
    const t = typeName(n.expression.expression);
    if (/USBDevice|HIDDevice|USB\b|HID\b/.test(t) || name === "requestDevice") return ["device", `${t || recv}.${name}`];
    return null;
  }
  if (PROC.has(name) && (ts.isIdentifier(n.expression) || /^(child_process|cp|utilityProcess|childProcess)$/.test(recv))) {
    const unit = /systemd-run/.test(n.getText(sf)) ? " +systemd-run" : "";
    return ["process", `${recv ? recv + "." : ""}${name} ${strArg(n)}${unit}`];
  }
  if ((name === "watch" || name === "watchFile") && /^(fs|fsp|promises|fs\.promises)$/.test(recv)) return ["watcher", `${recv}.${name}`];
  if (ts.isIdentifier(n.expression) && (name === "watch" || name === "watchFile")) {
    const sym = checker.getSymbolAtLocation(n.expression);
    const decl = sym && (sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym).declarations?.[0];
    if (decl && /@types\/node/.test(decl.getSourceFile().fileName)) return ["watcher", name];
  }
  if (/^(createServer|createConnection|connect|request|createSocket)$/.test(name) && /^(net|tls|http|https|dgram)$/.test(recv)) return ["socket", `${recv}.${name}`];
  if (name === "buildFromTemplate" && recv === "Menu") return ["electron", "Menu.buildFromTemplate"];
  if (name === "start" && recv === "powerSaveBlocker") return ["electron", "powerSaveBlocker.start"];
  if (name === "register" && recv === "globalShortcut") return ["electron", "globalShortcut.register"];
  if (name === "fork" && recv === "utilityProcess") return ["process", "utilityProcess.fork"];
  return null;
}

// ---------- verdict comments ----------
const verdictText = (text) => text.slice(text.indexOf("lifetime:")).replace(/\s*\*\/\}?\s*$/, "");
const COMMENT_LINE = /^\s*(\/\/|\{?\/\*|\*)/;
function verdictOf(sf, node) {
  const lines = sf.text.split("\n");
  const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
  // The node's own line, then the statement's first line (a call deep in an
  // expression), each with the comment block right above.
  let stmt = node;
  while (stmt.parent && !ts.isBlock(stmt.parent) && !ts.isSourceFile(stmt.parent) && !ts.isCaseClause(stmt.parent) && !ts.isJsxElement(stmt.parent) && !isFn(stmt.parent)) stmt = stmt.parent;
  const starts = [...new Set([line, sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line])];
  for (const l of starts) {
    if (VERDICT_RE.test(lines[l])) return verdictText(lines[l]);
    for (let i = l - 1; i >= 0 && COMMENT_LINE.test(lines[i]); i--) {
      if (VERDICT_RE.test(lines[i])) return verdictText(lines[i]);
      if (/lifetime:/.test(lines[i])) return `INVALID ${lines[i].trim()}`;
    }
    // A trailing comment on the line above (Prettier moves it after "? ").
    const above = lines[l - 1] ?? "";
    if (!COMMENT_LINE.test(above) && VERDICT_RE.test(above)) return verdictText(above);
  }
  if (/lifetime:/.test(lines[line])) return `INVALID ${lines[line].trim()}`;
  return "";
}

const rows = [];
for (const sf of sources) {
  const visit = (n) => {
    const c = classify(n, sf);
    if (c) {
      const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
      rows.push({ file: rel(sf), line, fn: displayFn(n), kind: c[0], detail: c[1], ctx: context(n), verdict: verdictOf(sf, n), head: short(n.getText(sf).split("\n")[0], 90) });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

const verdictWord = (r) => /^lifetime:\s*(\S+)/.exec(r.verdict)?.[1] ?? "?";
const mode = process.argv[2];
if (mode === "--check") {
  const bad = rows.filter((r) => !r.verdict || r.verdict.startsWith("INVALID"));
  if (bad.length) {
    console.error(`list_lifetimes: ${bad.length} acquisition(s) without a valid verdict comment (CLAUDE.md "Lifetime pass"):`);
    for (const r of bad) console.error(`  ${r.file}:${r.line}  ${r.fn}  ${r.kind} ${r.detail}  [${r.ctx}]  ${r.verdict || "no // lifetime: VERDICT — release point"}`);
    console.error(`Add "// lifetime: <${VERDICTS.join("|")}> — <where it is released, or why not>" on its line or the comment block above.`);
    process.exit(1);
  }
  const counts = Object.fromEntries(VERDICTS.map((v) => [v, rows.filter((r) => verdictWord(r) === v).length]));
  console.log(`list_lifetimes: ${rows.length} acquisitions, all with a verdict (${VERDICTS.map((v) => `${v} ${counts[v]}`).join(", ")})`);
} else if (mode === "--counts") {
  const kinds = [...new Set(rows.map((r) => r.kind))].sort();
  console.log(`| Kind | ${VERDICTS.join(" | ")} | Total |\n|---|${VERDICTS.map(() => "---").join("|")}|---|`);
  for (const k of [...kinds, "**Total**"]) {
    const rs = k === "**Total**" ? rows : rows.filter((r) => r.kind === k);
    console.log(`| ${k} | ${VERDICTS.map((v) => rs.filter((r) => verdictWord(r) === v).length).join(" | ")} | ${rs.length} |`);
  }
} else if (mode === "--md") {
  const esc = (s) => s.replace(/\|/g, "\\|");
  let file = "";
  for (const r of rows) {
    if (r.file !== file) {
      file = r.file;
      console.log(`\n### ${file}\n\n| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |\n|---|---|---|---|---|---|---|`);
    }
    const m = /^lifetime:\s*(\S+)\s+—\s+(.*?)\s*(\*\/\})?$/.exec(r.verdict) ?? [];
    console.log(`| ${r.line} | \`${esc(r.fn)}\` | ${r.kind} | ${esc(r.detail)} | ${r.ctx} | **${m[1] ?? "?"}** | ${esc(m[2] ?? r.verdict)} |`);
  }
} else {
  console.log(["file", "line", "function", "kind", "detail", "context", "verdict", "head"].join("\t"));
  for (const r of rows) console.log([r.file, r.line, r.fn, r.kind, r.detail, r.ctx, r.verdict, r.head].join("\t"));
}
