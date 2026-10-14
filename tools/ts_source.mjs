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
