// The TypeScript program and the small AST helpers the mechanical listers share
// (tools/list_loops.mjs, tools/list_errors.mjs): one copy, per the no-dupes rule.
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Forward slashes on every OS, as the TypeScript API reports file names.
export const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\\/g, "/");
// Tests aren't listed; the vendored picoflash isn't ours.
export const SKIP = /(node_modules|src\/flash\/picoflash|\.d\.ts$)/;

// The app's sources (src/ and electron/ by default) in one program with a type checker.
export function createProgram(dirs = ["src", "electron"]) {
  const files = dirs.flatMap((d) => ts.sys.readDirectory(join(ROOT, d), [".ts", ".tsx", ".js"])).filter((p) => !SKIP.test(p));
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
  const sources = files.map((f) => program.getSourceFile(f)).filter(Boolean);
  return { program, checker: program.getTypeChecker(), sources };
}
// A source file's path relative to the repo, with forward slashes.
export const relOf = (sf) => relative(ROOT, sf.fileName).replace(/\\/g, "/");
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
// `skip` says to pass over) for a row's "function" column.
export function enclosingFnName(node, skip = () => false) {
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
