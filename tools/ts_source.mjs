// The app's sources as one TypeScript program with the type checker, plus the
// AST helpers the mechanical passes share (tools/list_loops.mjs,
// tools/list_lifetimes.mjs): src/ and electron/, tests and the vendored
// src/flash/picoflash excluded.
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Forward slashes on every OS, as the TypeScript API reports file names.
export const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\\/g, "/");
export const SKIP = /(node_modules|src\/flash\/picoflash|\.d\.ts$)/;

const files = ["src", "electron"].flatMap((d) => ts.sys.readDirectory(join(ROOT, d), [".ts", ".tsx", ".js"])).filter((p) => !SKIP.test(p));

export const program = ts.createProgram(files, {
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
export const checker = program.getTypeChecker();
export const sources = files.map((f) => program.getSourceFile(f)).filter(Boolean);
export const relOf = new Map(sources.map((sf) => [sf.fileName, relative(ROOT, sf.fileName).replace(/\\/g, "/")]));
export const isOurs = (sf) => !!sf && !sf.isDeclarationFile && sf.fileName.startsWith(ROOT) && !SKIP.test(sf.fileName);

export const isFn = (n) =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isConstructorDeclaration(n) ||
  ts.isGetAccessorDeclaration(n) ||
  ts.isSetAccessorDeclaration(n);
export const calleeName = (call) => {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return "";
};
// A function's display name.
export function fnName(fn) {
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
// Enclosing named function (skipping anonymous callbacks, and any function
// `skip` says to look through) for a row's "function" column.
export function displayFn(node, skip = () => false) {
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
export const isComponentOrHook = (fn) => {
  const n = fnName(fn);
  const file = fn.getSourceFile().fileName;
  if (/\(cb\)$/.test(n)) return false; // useEffect(cb), useCallback(cb): not the render itself
  return /^use[A-Z]/.test(n) || (/\.tsx$/.test(file) && /^[A-Z]/.test(n) && !ts.isMethodDeclaration(fn));
};

// ---------- verdict comments and the report (both passes) ----------
// A pass's verdict comment: "// <prefix>: VERDICT — reason" ({/* … */} in JSX).
export function verdictSyntax(prefix, verdicts) {
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
export function report({ tool, rule, prefix, verdicts, rows, noun, what, failLine, hint, columns, md, extra = {} }) {
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
