// Shared by the TypeScript listers (tools/list_loops.mjs, tools/list_caches.mjs,
// tools/list_lifetimes.mjs):
// one program over src/ and electron/ (tests and the vendored
// src/flash/picoflash excluded) with the type checker, and the helpers both
// use to name functions, spot array iteration callbacks and resolve calls to
// our own functions (through interfaces, object literals and factories).
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Forward slashes on every OS, as the TypeScript API reports file names.
const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\\/g, "/");
const SKIP = /(node_modules|src\/flash\/picoflash|\.d\.ts$)/;
const ITER_METHODS = new Set(["map", "forEach", "reduce", "reduceRight", "filter", "some", "every", "find", "findIndex", "findLast", "findLastIndex", "flatMap", "sort", "toSorted"]);
const ITER_OWNERS = /^(Array|ReadonlyArray|Set|ReadonlySet|Map|ReadonlyMap|\w+Array)$/;

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
  checkJs: false,
  noEmit: true,
  skipLibCheck: true,
  strict: true,
  resolveJsonModule: true,
});
const checker = program.getTypeChecker();
const sources = files.map((f) => program.getSourceFile(f)).filter(Boolean);
const relOf = new Map(sources.map((sf) => [sf.fileName, relative(ROOT, sf.fileName).replace(/\\/g, "/")]));
const isOurs = (sf) => !!sf && !sf.isDeclarationFile && sf.fileName.startsWith(ROOT) && !SKIP.test(sf.fileName);

// ---------- helpers ----------
const isFn = (n) =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isConstructorDeclaration(n) ||
  ts.isGetAccessorDeclaration(n) ||
  ts.isSetAccessorDeclaration(n);
const isStmtLoop = (n) => ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n) || ts.isWhileStatement(n) || ts.isDoStatement(n);
const calleeName = (call) => {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return "";
};
// An array iteration call: x.map(cb) where map is the lib's Array/Set/Map method.
const iterCache = new Map();
function isIterCall(n) {
  if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return false;
  if (!ITER_METHODS.has(n.expression.name.text) || n.arguments.length === 0) return false;
  if (iterCache.has(n)) return iterCache.get(n);
  const sym = checker.getSymbolAtLocation(n.expression.name);
  const ok = !!sym?.declarations?.some((d) => {
    const owner = d.parent;
    const name = owner && (ts.isInterfaceDeclaration(owner) || ts.isClassDeclaration(owner)) ? owner.name?.text : "";
    return /typescript\/lib\/lib\./.test(d.getSourceFile().fileName) && ITER_OWNERS.test(name ?? "");
  });
  iterCache.set(n, ok);
  return ok;
}
const isLoop = (n) => isStmtLoop(n) || isIterCall(n);
const loopBody = (n) => (isStmtLoop(n) ? n.statement : n.arguments[0]);
const loopKind = (n) => {
  if (ts.isForOfStatement(n)) return n.awaitModifier ? "for-await" : "for-of";
  if (ts.isForInStatement(n)) return "for-in";
  if (ts.isForStatement(n)) return "for";
  if (ts.isWhileStatement(n)) return "while";
  if (ts.isDoStatement(n)) return "do";
  return `.${n.expression.name.text}`;
};
// Is fn the callback of an array iteration call?
const iterCallOf = (fn) => (fn.parent && ts.isCallExpression(fn.parent) && fn.parent.arguments[0] === fn && isIterCall(fn.parent) ? fn.parent : null);
const isCallbackOf = (fn, names) => {
  const p = fn.parent;
  return p && ts.isCallExpression(p) && p.arguments.includes(fn) && names.includes(calleeName(p));
};
// A function's display name.
function fnName(fn) {
  if (!fn) return "<module>";
  if (fn.name && (ts.isIdentifier(fn.name) || ts.isPrivateIdentifier(fn.name))) return fn.name.text;
  if (ts.isConstructorDeclaration(fn)) return "constructor";
  const p = fn.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p && (ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) && p.name && ts.isIdentifier(p.name)) return p.name.text;
  if (p && ts.isCallExpression(p)) {
    const c = calleeName(p);
    // memo(function X) / forwardRef(...) assigned to a const: take the const's name.
    if ((c === "memo" || c === "forwardRef") && p.parent && ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name)) return p.parent.name.text;
    return `${c || "?"}(cb)`;
  }
  if (p && ts.isJsxExpression(p) && p.parent && ts.isJsxAttribute(p.parent)) return `${p.parent.name.getText()}=`;
  return "<anonymous>";
}
// Enclosing named function (skipping anonymous callbacks, and the functions
// `skip` says to look through: by default array iteration callbacks) for the
// row's "function" column.
function displayFn(node, skip = iterCallOf) {
  const names = [];
  for (let p = node.parent; p; p = p.parent) {
    if (!isFn(p)) continue;
    if (skip(p)) continue;
    const n = fnName(p);
    names.unshift(n);
    if (!/\(cb\)$|^<anonymous>$|=$/.test(n)) break;
  }
  return names.length ? names.join(" > ") : "<module>";
}
const isComponentOrHook = (fn) => {
  const n = fnName(fn);
  const file = fn.getSourceFile().fileName;
  if (/\(cb\)$/.test(n)) return false; // useEffect(cb), useCallback(cb): not the render itself
  return /^use[A-Z]/.test(n) || (/\.tsx$/.test(file) && /^[A-Z]/.test(n) && !ts.isMethodDeclaration(fn));
};
// Resolve an identifier / property access to our own function-like declarations.
// The functions a value can be: f, a ? f : g, a ?? f (a default parameter
// "read = isWin ? readWindowsProcs : readGameProcs").
function fnsOfValue(e, depth) {
  if (isFn(e)) return [e];
  if (ts.isParenthesizedExpression(e)) return fnsOfValue(e.expression, depth);
  if (ts.isConditionalExpression(e)) return [...fnsOfValue(e.whenTrue, depth), ...fnsOfValue(e.whenFalse, depth)];
  if (ts.isBinaryExpression(e) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(e.operatorToken.kind)) return [...fnsOfValue(e.left, depth), ...fnsOfValue(e.right, depth)];
  if ((ts.isIdentifier(e) || ts.isPropertyAccessExpression(e)) && depth < 4) return resolveFns(e, depth + 1);
  return [];
}
function resolveFns(expr, depth = 0) {
  let sym = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expr) ? expr.name : expr);
  if (!sym) return [];
  if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
  const out = [];
  for (const d of sym.declarations ?? []) {
    if (!isOurs(d.getSourceFile())) continue;
    if (isFn(d)) out.push(d);
    else if ((ts.isVariableDeclaration(d) || ts.isPropertyDeclaration(d) || ts.isPropertyAssignment(d) || ts.isParameter(d)) && d.initializer) out.push(...fnsOfValue(d.initializer, depth));
    else if (ts.isMethodSignature(d) || ts.isPropertySignature(d)) out.push(...implementationsOf(d));
  }
  if (!out.length) {
    // A function value from a factory (const draw = makeRenderer().draw): the
    // declaration its type was inferred from.
    for (const sig of checker.getTypeAtLocation(expr).getCallSignatures()) {
      const d = sig.getDeclaration?.();
      if (d && isFn(d) && isOurs(d.getSourceFile())) out.push(d);
    }
  }
  return out;
}
// An interface member: every class method / object member of that name in a
// class that implements the interface (Ds5BridgeClient -> the real and the
// simulated dongle).
const classesByIface = new Map();
for (const sf of sources) {
  const visit = (n) => {
    if (ts.isClassDeclaration(n)) {
      for (const h of n.heritageClauses ?? [])
        for (const t of h.types) {
          const name = t.expression.getText(sf);
          if (!classesByIface.has(name)) classesByIface.set(name, []);
          classesByIface.get(name).push(n);
        }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
// Object literal members, by name, for interfaces/types implemented by a
// plain object ({ draw() {...} } returned as a Renderer).
const literalMembers = new Map();
for (const sf of sources) {
  const visit = (n) => {
    if (ts.isObjectLiteralExpression(n)) {
      for (const m of n.properties) {
        const fn = ts.isMethodDeclaration(m) ? m : ts.isPropertyAssignment(m) && isFn(m.initializer) ? m.initializer : null;
        if (!fn || !m.name) continue;
        const key = m.name.getText(sf);
        if (!literalMembers.has(key)) literalMembers.set(key, []);
        literalMembers.get(key).push({ lit: n, fn });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
function implementationsOf(sig) {
  const iface = sig.parent;
  if (!iface) return [];
  const name = sig.name.getText();
  const out = [];
  const owner = ts.isTypeLiteralNode(iface) && ts.isTypeAliasDeclaration(iface.parent) ? iface.parent : iface;
  for (const { lit, fn } of literalMembers.get(name) ?? []) {
    const t = checker.getContextualType(lit);
    const parts = t?.isUnion() ? t.types : t ? [t] : [];
    const decls = parts.flatMap((x) => [...(x.symbol?.declarations ?? []), ...(x.aliasSymbol?.declarations ?? [])]);
    if (decls.includes(iface) || decls.includes(owner)) out.push(fn);
  }
  if (!ts.isInterfaceDeclaration(iface)) return out;
  for (const cls of classesByIface.get(iface.name.text) ?? []) {
    for (const m of cls.members) {
      if (m.name?.getText() !== name) continue;
      if (isFn(m)) out.push(m);
      else if (ts.isPropertyDeclaration(m) && m.initializer && isFn(m.initializer)) out.push(m.initializer);
    }
  }
  return out;
}

// ---------- verdict comments and the report (both passes) ----------
// A pass's verdict comment: "// <prefix>: VERDICT — reason" ({/* … */} in JSX).
function verdictSyntax(prefix, verdicts) {
  const re = new RegExp(`${prefix}:\\s*(${verdicts.join("|")})\\s+—\\s+\\S`);
  const text = (line) => line.slice(line.indexOf(`${prefix}:`)).replace(/\s*\*\/\}?\s*$/, "");
  const COMMENT_LINE = /^\s*(\/\/|\{?\/\*|\*)/;
  // The verdict for a row whose code starts on one of `starts` (0-based
  // lines, in order of preference): on that line; a trailing comment on the
  // line above (Prettier puts it after "? " in a ternary) when that line has
  // no row of its own (`ownRow(line)`); or the comment block right above.
  // "INVALID …" for a comment with the prefix but no valid verdict.
  const find = (lines, starts, ownRow) => {
    for (const l of starts) {
      if (re.test(lines[l])) return text(lines[l]);
      const above = lines[l - 1] ?? "";
      if (above.includes(`${prefix}:`) && !COMMENT_LINE.test(above) && !ownRow(l - 1)) return re.test(above) ? text(above) : `INVALID ${above.trim()}`;
      for (let i = l - 1; i >= 0 && COMMENT_LINE.test(lines[i]); i--) {
        if (re.test(lines[i])) return text(lines[i]);
        if (lines[i].includes(`${prefix}:`)) return `INVALID ${lines[i].trim()}`;
      }
    }
    return lines[starts[0]].includes(`${prefix}:`) ? `INVALID ${lines[starts[0]].trim()}` : "";
  };
  // [verdict, reason] of a row's verdict text.
  const parts = (verdict) => {
    const m = new RegExp(`^${prefix}:\\s*(\\S+)\\s+—\\s+(.*?)\\s*(\\*\\/\\})?$`).exec(verdict) ?? [];
    return [m[1] ?? "?", m[2] ?? verdict];
  };
  return { re, find, parts };
}

// The CLI every pass shares: TSV by default, --check (the gate), --md (the
// per-file tables for the doc). `columns` are the TSV columns: a row key, or
// [key, heading],
// `md` = { header: [...], row: (r, esc) => [...] } after the file heading.
function report({ tool, rule, prefix, verdicts, rows, noun, what, failLine, hint, columns, md, extra = {} }) {
  const { parts } = verdictSyntax(prefix, verdicts);
  const mode = process.argv[2];
  if (mode === "--check") {
    const bad = rows.filter((r) => !r.verdict || r.verdict.startsWith("INVALID"));
    if (bad.length) {
      console.error(`${tool}: ${bad.length} ${what} without a valid verdict comment (CLAUDE.md "${rule}"):`);
      for (const r of bad) console.error(`  ${failLine(r)}  ${r.verdict || `no // ${prefix}: VERDICT — reason`}`);
      console.error(hint);
      process.exit(1);
    }
    const counts = verdicts.map((v) => `${v} ${rows.filter((r) => parts(r.verdict)[0] === v).length}`);
    console.log(`${tool}: ${rows.length} ${noun}, all with a verdict (${counts.join(", ")})`);
  } else if (mode === "--md") {
    const esc = (s) => String(s).replace(/\|/g, "\\|");
    let file = "";
    for (const r of rows) {
      if (r.file !== file) {
        file = r.file;
        console.log(`\n### ${file}\n\n| ${md.header.join(" | ")} |\n|${md.header.map(() => "---").join("|")}|`);
      }
      const [v, why] = parts(r.verdict);
      console.log(`| ${md.row(r, esc).join(" | ")} | **${v}** | ${esc(why)} |`);
    }
  } else if (extra[mode]) {
    extra[mode](parts);
  } else {
    const cols = columns.map((c) => (Array.isArray(c) ? c : [c, c]));
    console.log(cols.map(([, h]) => h).join("\t"));
    for (const r of rows) console.log(cols.map(([k]) => r[k]).join("\t"));
  }
}

// A node's 1-based line.
const lineOf = (node) => node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;

export {
  ROOT,
  lineOf,
  SKIP,
  program,
  checker,
  sources,
  relOf,
  isOurs,
  isFn,
  isStmtLoop,
  calleeName,
  isIterCall,
  isLoop,
  loopBody,
  loopKind,
  iterCallOf,
  isCallbackOf,
  fnName,
  displayFn,
  isComponentOrHook,
  resolveFns,
  verdictSyntax,
  report,
};
