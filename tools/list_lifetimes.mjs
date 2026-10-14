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
//   subscribe  the app's own onX(listener) calls that return an unsubscribe
//              (window.desktop.on*, theme / store subscriptions)
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
import ts from "typescript";
import { calleeName, checker, displayFn, fnName, isComponentOrHook, isFn, relOf, report, sources, verdictSyntax } from "./ts_program.mjs";

export const VERDICTS = ["OK", "LEAK", "WASTE", "HOT-ALLOC", "NOT-WORTH"];

// ---------- helpers ----------
const receiverText = (call, sf) => (ts.isPropertyAccessExpression(call.expression) ? call.expression.expression.getText(sf) : "");
const short = (s, n = 40) => s.replace(/\s+/g, " ").trim().slice(0, n);
const EFFECTS = new Set(["useEffect", "useLayoutEffect"]);
// Where the acquisition runs: the nearest function decides.
function runsIn(node) {
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
    for (let p = r.parent; p; p = p.parent)
      if (isFn(p)) {
        body = p;
        break;
      }
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
  for (let p = call.parent; p; p = p.parent)
    if (isFn(p) && p !== cb) {
      owner = p;
      break;
    }
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
const ELECTRON_NEW = new Set([
  "BrowserWindow",
  "Tray",
  "Notification",
  "Worker",
  "MessageChannel",
  "WebSocket",
  "AudioContext",
  "OfflineAudioContext",
  "AudioWorkletNode",
  "Audio",
  "MediaRecorder",
  "SharedWorker",
]);
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
    if (/^on[a-z]+$/.test(name) && n.right.kind !== ts.SyntaxKind.NullKeyword && !(ts.isIdentifier(n.right) && n.right.text === "undefined"))
      return ["listener", `${short(n.left.expression.getText(sf), 30)}.${name} =`];
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
  // The app's own subscriptions: onX(listener) returning an unsubscribe
  // (window.desktop.onWindowVisible, onThemeChange, store subscribe helpers).
  if (
    /^on[A-Z]\w*$/.test(name) &&
    n.arguments.some((a) => isFn(a) || checker.getNonNullableType(checker.getTypeAtLocation(a)).getCallSignatures().length > 0) &&
    checker.getNonNullableType(checker.getTypeAtLocation(n)).getCallSignatures().length > 0
  ) {
    return ["subscribe", `${recv ? short(recv, 30) + "." : ""}${name}`];
  }
  if ((name === "handle" || name === "handleOnce") && recv === "ipcMain") return ["ipc", `ipcMain.${name} "${strArg(n)}"`];
  if (name === "handle" && recv === "protocol") return ["electron", `protocol.handle "${strArg(n)}"`];
  if (name === "getUserMedia") return ["media", "getUserMedia"];
  if (name === "addModule" && /audioWorklet/.test(recv)) return ["media", "audioWorklet.addModule"];
  if (/^createMedia(Stream|Element)(Source|Destination)$/.test(name)) return ["media", name];
  if (name === "createObjectURL") return ["url", "createObjectURL"];
  if ((name === "open" || name === "connect" || name === "claimInterface" || name === "requestDevice") && recv) {
    const t = typeName(n.expression.expression);
    if (/USBDevice|HIDDevice|USB\b|HID\b|Picoflash/.test(t) || name === "requestDevice") return ["device", `${t || recv}.${name}`];
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
const VERDICT = verdictSyntax("lifetime", VERDICTS);
// The acquisition's own line, then its statement's first line (a call deep in
// an expression), each with a trailing comment on the line above (when that
// line has no row of its own) or the comment block right above.
function lifetimeVerdict(sf, node, rowLines) {
  let stmt = node;
  while (stmt.parent && !ts.isBlock(stmt.parent) && !ts.isSourceFile(stmt.parent) && !ts.isCaseClause(stmt.parent) && !ts.isJsxElement(stmt.parent) && !isFn(stmt.parent)) stmt = stmt.parent;
  const at = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;
  return VERDICT.find(sf.text.split("\n"), [...new Set([at(node), at(stmt)])], (l) => rowLines.has(l));
}

const rows = [];
for (const sf of sources) {
  const found = [];
  const visit = (n) => {
    const c = classify(n, sf);
    if (c) found.push([n, c]);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const rowLines = new Set(found.map(([n]) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line));
  for (const [n, c] of found) {
    const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    rows.push({
      file: relOf.get(sf.fileName),
      line,
      fn: displayFn(n, () => false),
      kind: c[0],
      detail: c[1],
      ctx: runsIn(n),
      verdict: lifetimeVerdict(sf, n, rowLines),
      head: short(n.getText(sf).split("\n")[0], 90),
    });
  }
}
rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

report({
  tool: "list_lifetimes",
  rule: "Lifetime pass",
  prefix: "lifetime",
  verdicts: VERDICTS,
  rows,
  noun: "acquisitions",
  what: "acquisition(s)",
  failLine: (r) => `${r.file}:${r.line}  ${r.fn}  ${r.kind} ${r.detail}  [${r.ctx}]`,
  hint: `Add "// lifetime: <${VERDICTS.join("|")}> — <where it is released, or why not>" on its line or the comment block above.`,
  columns: ["file", "line", ["fn", "function"], "kind", "detail", ["ctx", "context"], "verdict", "head"],
  md: { header: ["Line", "Function", "Kind", "What", "Runs in", "Verdict", "Release point / reason"], row: (r, esc) => [r.line, `\`${esc(r.fn)}\``, r.kind, esc(r.detail), r.ctx] },
  extra: {
    // Verdict counts per kind, for the doc.
    "--counts": (parts) => {
      const kinds = [...new Set(rows.map((r) => r.kind))].sort();
      console.log(`| Kind | ${VERDICTS.join(" | ")} | Total |\n|---|${VERDICTS.map(() => "---").join("|")}|---|`);
      for (const k of [...kinds, "**Total**"]) {
        const rs = k === "**Total**" ? rows : rows.filter((r) => r.kind === k);
        console.log(`| ${k} | ${VERDICTS.map((v) => rs.filter((r) => parts(r.verdict)[0] === v).length).join(" | ")} | ${rs.length} |`);
      }
    },
  },
});
