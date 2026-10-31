#!/usr/bin/env node
// Pre-commit / CI gate: one theme system (CLAUDE.md, load-bearing rules).
//
// Every color in app CSS and components comes from the theme tokens
// (--bg-*, --text-*, --border-*, --dk-accent, --status-*...), so a new theme,
// a controller colorway or Color vision restyles everything. This blocks a
// literal color (#hex, rgb()/rgba(), named) anywhere except:
//   - a token definition (a line that sets a --custom-property) in a PALETTE
//     file (src/styles.css): every literal-colour token lives in that one
//     place, so a component stylesheet can't mint its own (--my-red: #f00
//     would escape the themes and Color vision);
//   - a neutral shadow: pure black with alpha in a box-/text-shadow or filter;
//   - a line marked `theme-exempt: <reason>` (the controller's real LEDs, the
//     OLED console, 42PS brand colors...); listed by `--list`;
//   - a token source (TOKEN_SOURCES below): the .ts files whose job is to hold
//     the palettes the tokens are built from. Exempt by path, listed by `--list`.
// And in a palette file, each dark block (html[data-theme="dark"] X) and its
// copy for the system's dark mode (inside @media (prefers-color-scheme: dark))
// must stay identical: CSS can't share one block between the two.
// It walks .css, .tsx and .ts (F44: .ts was skipped, so tray/trayIcon.ts drew
// with literal colors unseen).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src"];
const SKIP = [/^src\/i18n\//, /^src\/flash\/picoflash\//, /\.test\./, /^src\/assets\//, /\.d\.ts$/];
// Token sources: each file here IS a palette, so a literal color in it is the
// point, not a violation. Keep this list short; anything else marks its lines.
const TOKEN_SOURCES = new Map([
  ["src/desktop/theme/desktopPalette.ts", "builds the Desktop theme's tokens from the OS palette"],
  ["src/desktop/colorVision.ts", "the Color vision status palettes (set as --status-* / --cv-* tokens)"],
  ["src/desktop/live/colorways.ts", "the controllers' real factory colorways (the drawing shows the real controller)"],
  // Not colors at all: user-facing prose ("the black parts") that the named-color pattern matches.
  ["src/desktop/about/roadmap.ts", "prose only (About -> Coming soon text)"],
]);
// The one place for literal-colour tokens (CLAUDE.md, "One theme system").
const PALETTE_FILES = ["src/styles.css"];
const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![\w-])(white|black|red|green|blue|orange|yellow|purple|gray|grey)(?![\w-])/;
const SHADOW_BLACK = /\brgba?\(\s*0[ ,]+0[ ,]+0\s*(\/|,)/g;

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(css|tsx?)$/.test(p) && !SKIP.some((r) => r.test(p))) files.push(p);
  }
};
ROOTS.forEach(walk);
const staleSources = [...TOKEN_SOURCES.keys(), ...PALETTE_FILES].filter((f) => !files.includes(f));
if (staleSources.length) {
  console.log(`Theme gate: TOKEN_SOURCES lists files that aren't walked (moved or deleted?): ${staleSources.join(", ")}`);
  process.exit(1);
}

const hits = [];
const exempt = [...TOKEN_SOURCES].map(([file, why]) => `${file}: (whole file) token source: ${why}`);
const check = (file, startLine, text, rawText) => {
  if (!COLOR.test(text)) return;
  const where = `${file}:${startLine}: ${rawText.trim().replace(/\s+/g, " ").slice(0, 160)}`;
  if (/^\s*--[\w-]+\s*:/.test(text) && PALETTE_FILES.includes(file)) return; // a token definition in the palette
  if (/(box-shadow|text-shadow|filter)\s*:/.test(text) && !COLOR.test(text.replace(SHADOW_BLACK, "x("))) return;
  if (/theme-exempt:/.test(rawText)) {
    exempt.push(where);
    return;
  }
  hits.push(where);
};
for (const file of files) {
  if (TOKEN_SOURCES.has(file)) continue;
  const source = readFileSync(file, "utf8");
  if (file.endsWith(".css")) {
    // One declaration (up to ; { or }) at a time, so a marker anywhere in a
    // multi-line value covers it (the formatter moves comments around).
    const noComments = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
    let start = 0;
    for (let k = 0; k <= noComments.length; k++) {
      const ch = noComments[k];
      if (k === noComments.length || ch === ";" || ch === "{" || ch === "}") {
        const text = noComments.slice(start, k);
        // ...plus the rest of the line it ends on (where a trailing marker sits).
        const eol = source.indexOf("\n", k);
        const raw = source.slice(start, eol < 0 ? source.length : eol);
        if (ch !== "{") {
          const lead = text.length - text.trimStart().length;
          const line = source.slice(0, start + lead).split("\n").length;
          check(file, line, text, raw);
        }
        start = k + 1;
      }
    }
  } else {
    source.split("\n").forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "");
      if (!/(style=|color|background|fill|stroke|Color|#[0-9a-fA-F]{6}")/.test(code)) return;
      if (/^\s*(import|export type|\*)/.test(code)) return;
      check(file, i + 1, code, line);
    });
  }
}

// A palette's dark blocks and their system-dark copies: same declarations, same order.
const norm = (body) =>
  body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
// loop: NOT-WORTH — the palette files (one), once per run
for (const file of PALETTE_FILES) {
  const css = readFileSync(file, "utf8");
  const media = /@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\n\}/g;
  const systemCopies = new Map();
  // loop: NOT-WORTH — the palette's dark media blocks (a few)
  for (const m of css.matchAll(media)) for (const b of m[1].matchAll(/html\[data-theme="system"\]([^,{]*),\s*html:not\(\[data-theme\]\)\1\s*\{([^}]*)\}/g)) systemCopies.set(b[1].trim(), norm(b[2]));
  const outside = css.replace(media, "");
  // loop: NOT-WORTH — the palette's dark blocks (a few)
  for (const b of outside.matchAll(/html\[data-theme="dark"\]([^,{]*)\{([^}]*)\}/g)) {
    const scope = b[1].trim();
    const copy = systemCopies.get(scope);
    if (copy === undefined)
      hits.push(
        `${file}: html[data-theme="dark"] ${scope} has no copy for the system's dark mode (@media (prefers-color-scheme: dark) html[data-theme="system"] ${scope}, html:not([data-theme]) ${scope})`,
      );
    else if (copy !== norm(b[2])) hits.push(`${file}: html[data-theme="dark"] ${scope} and its system-dark copy differ: make them identical`);
    systemCopies.delete(scope);
  }
  // loop: NOT-WORTH — what's left of a few blocks
  for (const scope of systemCopies.keys()) hits.push(`${file}: a system-dark block for "${scope || "html"}" without its html[data-theme="dark"] block`);
}

if (process.argv.includes("--list")) {
  console.log(exempt.join("\n"));
  process.exit(0);
}
if (hits.length) {
  console.log("Theme gate: literal color outside the theme tokens (use a token defined in src/styles.css, or mark the line 'theme-exempt: <reason>')");
  console.log(hits.join("\n"));
  process.exit(1);
}
