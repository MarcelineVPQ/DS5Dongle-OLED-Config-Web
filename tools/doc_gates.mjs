#!/usr/bin/env node
// Documentation gates (ported from Sonata's tools/doc-gates.js; DS5's own
// Coming soon <-> BACKLOG parity stays in tests/unit/roadmapBacklog.test.ts).
// Each gate prints one verdict line (PASS, FAIL or SKIP) and, on FAIL, each
// problem with how to fix it.
//
//   node tools/doc_gates.mjs [--check] [--repo PATH] [--firmware PATH] [gate ...]
//        all gates, or the named ones, on this repo (or on the firmware repo
//        at --repo PATH); --check exits 1 on a FAIL (npm run gates, CI,
//        the firmware's tools/release.sh)
//   node tools/doc_gates.mjs privacy-sync
//        refresh tools/privacy-denylist.txt from SECRET_PROJECTS.md (untracked,
//        .git/info/exclude): one SHA-256 per secret project's name. It prints
//        only how many names it hashed, never a name.
//   node tools/doc_gates.mjs privacy-msg FILE
//        the commit-msg hook: FILE (the message) and the branch's name
//
// Gates:
//   changelog  every feat / fix / perf commit since the last release tag
//              (v*-oled-edition) that touches a shipped file is in the
//              CHANGELOG: the commit changes CHANGELOG.md itself, or its
//              message says "No user-facing change" (and why). And with any
//              such commit, [Unreleased] is not empty.
//   refs       README*.md, CLAUDE.md and docs/*.md name only files, folders
//              and npm scripts that exist (in this repo, or in the firmware
//              repo for a firmware path, when it's named with --firmware or
//              DS5_FIRMWARE_REPO; without it, firmware paths aren't checked).
//   version    one version everywhere: package.json and package-lock.json
//              (tools/update_version.mjs), no CHANGELOG section newer than
//              package.json's, the newest released section is package.json's
//              version, and (with --firmware) the firmware CHANGELOG's newest
//              section is the same release ([X-oled-edition]).
//   privacy    no tracked file, no commit message since the last release tag
//              and no branch name holds a secret project's name: the names'
//              SHA-256 hashes are in tools/privacy-denylist.txt, so the list
//              names nothing. A line that must say such a word anyway carries
//              "privacy-ok" and a reason.
//   quotes     no tracked file quotes Marcy's or the owner's own words: after
//              "Marcy" or "owner", a colon (or said / asked / wrote) and then a
//              double-quoted phrase of 8+ letters, or one that runs on to the
//              next line. Write the decision in neutral words and keep the
//              attribution ("Marcy 2026-10-19: reuse their ideas"). A line that
//              must quote anyway carries "quote-ok" and a reason.
//   community  the files GitHub's community standards ask for are tracked:
//              README, CODE_OF_CONDUCT, CONTRIBUTING, LICENSE, SECURITY (at
//              the root, in docs/ or .github/), an issue form in
//              .github/ISSUE_TEMPLATE/ and a pull request template.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DENYLIST = join(APP_ROOT, "tools", "privacy-denylist.txt");

// ---------- changelog ----------

const USER_COMMIT = /^(feat|fix|perf)(\([^)]*\))?!?:/;
const NO_USER_CHANGE = /no user-facing change/i;

/** "## [Unreleased]" (or another name) -> its body, trimmed; null when there is no such section. */
export function changelogSection(md, name) {
  const lines = String(md ?? "").split("\n");
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = lines.findIndex((l) => new RegExp(`^## \\[${esc}\\]`).test(l));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines
    .slice(start + 1, end < 0 ? lines.length : end)
    .join("\n")
    .trim();
}

/**
 * commits: [{ hash, subject, body, files }]; shipped(file) -> true for a file
 * that ships to users. -> problems ([] when every user-facing commit is in).
 */
export function changelogProblems({ changelog, commits, shipped }) {
  // loop: NOT-WORTH — the commits since the last tag (tens)
  const user = commits.filter((c) => USER_COMMIT.test(c.subject) && c.files.some(shipped));
  const problems = [];
  // loop: NOT-WORTH — the user-facing commits
  for (const c of user) {
    if (c.files.includes("CHANGELOG.md") || NO_USER_CHANGE.test(c.body)) continue;
    problems.push(
      `${c.hash.slice(0, 7)} ${c.subject}: not in the CHANGELOG. Add its line under ## [Unreleased] in the same commit (amend it, or a follow-up commit that names it: "docs(changelog): ${c.hash.slice(0, 7)} …" counts), or say "No user-facing change: why" in its message`,
    );
  }
  // A follow-up "docs(changelog)" commit that names a commit's short hash covers it.
  // loop: NOT-WORTH — the problems x the commits since the tag (tens)
  const covered = (p) => commits.some((c) => c.files.includes("CHANGELOG.md") && `${c.subject}\n${c.body}`.includes(p.slice(0, 7)));
  const left = problems.filter((p) => !covered(p));
  if (user.length > 0 && !changelogSection(changelog, "Unreleased")) {
    left.push(`${user.length} user-facing commit(s) since the last release tag and CHANGELOG.md [Unreleased] is empty: say what changed for users there (Added / Changed / Fixed)`);
  }
  return left;
}

// What ships: the app's code and resources; the firmware's sources and build.
export const SHIPPED = {
  app: (f) => /^(src|electron|resources)\//.test(f) || ["index.html", "package.json", "electron-builder.yml", "electron.vite.config.ts", "firmwareChangelog.config.ts"].includes(f),
  firmware: (f) => /^(src|lib|cmake|boards)\//.test(f) || f === "CMakeLists.txt" || /^[^/]*\.cmake$/.test(f),
};

function lastTag(root) {
  try {
    return execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*-oled-edition"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    // error: SHOWN — no release tag in this clone (a shallow CI checkout): the gate prints SKIP and why
    return null;
  }
}

function commitsSince(root, tag) {
  const out = execFileSync("git", ["log", "--no-merges", "--format=%x1e%H%x1f%s%x1f%b%x1f", "--name-only", `${tag}..HEAD`], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });
  // loop: NOT-WORTH — the commits since the last tag (tens)
  return out
    .split("\x1e")
    .filter((s) => s.trim())
    .map((chunk) => {
      const [hash, subject, body, rest] = chunk.split("\x1f");
      return {
        hash,
        subject,
        body,
        files: String(rest ?? "")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      };
    });
}

// ---------- refs ----------

const EXT = "ts|tsx|mts|mjs|js|cjs|json|css|html|md|sh|py|ps1|yml|yaml|svg|png|jpg|webp|gif|txt|cpp|c|h|hpp|cmake|toml";
const TOP = "src|electron|tools|docs|tests|resources|site|build|assets-src|scripts|lib|\\.github|\\.hooks";
const PATH_TOKEN = new RegExp(`^[\\w@.+/-]+\\.(${EXT})$`);
const BARE_PATH = new RegExp(`(?:^|[\\s(\\[])((?:${TOP})/[\\w.+/-]*\\.(?:${EXT}))(?![\\w/])`, "g");

/**
 * docs: [{ name, text }]; ctx: { tracked: [paths], scripts: [names],
 * other: { tracked: [paths] } | null (the other repo, when it's there) }.
 * -> problems.
 */
export function refProblems(docs, ctx) {
  const problems = [];
  const index = (files) => ({
    files: new Set(files),
    names: new Set(files.map((f) => basename(f))),
    dirs: new Set(
      files.flatMap((f) =>
        f
          .split("/")
          .slice(0, -1)
          .map((_, i, a) => a.slice(0, i + 1).join("/")),
      ),
    ),
  });
  const here = index(ctx.tracked);
  const other = ctx.other ? index(ctx.other.tracked) : null;
  const inRepo = (ix, ref) => (ref.includes("/") ? ix.files.has(ref) || ix.dirs.has(ref.replace(/\/$/, "")) || [...ix.files].some((f) => f.endsWith(`/${ref}`)) : ix.names.has(ref));
  // A path that isn't here may be the other repo's (the docs name both): fine when it's there, unchecked when that repo isn't next to this one.
  const exists = (ref) => inRepo(here, ref) || (other ? inRepo(other, ref) : !looksLocal(ref));
  // Without the other repo, only paths in this repo's own folders are judged.
  const looksLocal = (ref) => ref.split("/")[0] in ctx.localTops;
  // loop: NOT-WORTH — the docs (a few dozen), once per run
  for (const doc of docs) {
    // HTML comments are parked text; code blocks show commands and output.
    const lines = doc.text
      .replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, " "))
      .replace(/^```[\s\S]*?^```/gm, (c) => c.replace(/[^\n]/g, " "))
      .split("\n");
    // loop: NOT-WORTH — once per line of a doc
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // A path on another branch, a removed file or a planned one is named as such on its line;
      // another project's files are that project's.
      if (/\b(branch|removed|deleted|renamed|retired|planned|will be|would be|was|were|no longer|gone)\b/i.test(line)) continue;
      if (/\b(AVNetworkMonitor|AVIEW|Sonata|upstream|awalol|zurce|loteran)\b/.test(line)) continue;
      // A BACKLOG row still to do describes what doesn't exist yet.
      if (/(^|\/)BACKLOG\.md$/.test(doc.name) && line.startsWith("|") && !/\bDone\b/.test(line)) continue;
      // A line naming a folder outside the repo (`~/projects/…`): its bare file names are that folder's.
      const outside = /`~\//.test(line);
      const where = `${doc.name}:${i + 1}`;
      const seen = new Set();
      const check = (raw) => {
        const ref = raw.replace(/^\.\//, "").replace(/[):,.;]+$/, "");
        if (seen.has(ref) || /^(~|\/|\$|https?:|\.\.\/)/.test(ref) || /[<>*{}[\]]/.test(ref) || /(^|\/)(tmp|out|dist|node_modules)\//.test(ref)) return;
        // An example name (x.sh, example.json), or a data file the code reads or writes (game-library-2.json, Heroic's nile_library.json).
        if ((outside && !ref.includes("/")) || /^(x|y|foo|example|my|your)\./i.test(basename(ref)) || (/\.(json|txt|yml|yaml|ini|vdf)$/.test(ref) && ctx.code?.includes(basename(ref)))) return;
        seen.add(ref);
        if (!exists(ref)) problems.push(`${where}: ${ref} is not in the repo (renamed or removed?): fix the name, or say on that line that it's gone or planned`);
      };
      // loop: NOT-WORTH — a few code spans per line
      for (const m of line.matchAll(/`([^`\s]+)`/g)) if (PATH_TOKEN.test(m[1])) check(m[1]);
      // loop: NOT-WORTH — a few paths per line
      for (const m of line.matchAll(BARE_PATH)) check(m[1]);
      // Markdown links to repo files.
      // loop: NOT-WORTH — a few links per line
      for (const m of line.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
        if (/^(https?:|mailto:|#)/.test(m[1])) continue;
        const target = join(dirname(doc.name), decodeURIComponent(m[1])).replace(/\\/g, "/");
        if (!target.startsWith("..") && !inRepo(here, target)) problems.push(`${where}: the link ${m[1]} goes to ${target}, which is not in the repo`);
      }
      // loop: NOT-WORTH — a few per line
      for (const m of line.matchAll(/\bnpm run ([\w:-]+)/g)) if (ctx.scripts && !ctx.scripts.includes(m[1])) problems.push(`${where}: "npm run ${m[1]}" is not a package.json script`);
    }
  }
  return problems;
}

// ---------- version ----------

const VERSION_HEAD = /^## \[(\d+\.\d+\.\d+(?:-dev\.\d+)?)(-oled-edition)?\]/gm;
/** A dev build sorts before its stable release: [major, minor, patch, dev or Infinity]. */
export function versionKey(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-dev\.(\d+))?$/.exec(v);
  return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? Infinity : +m[4]] : null;
}
export function versionCmp(a, b) {
  const x = versionKey(a);
  const y = versionKey(b);
  // loop: NOT-WORTH — 4 parts
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
/** The CHANGELOG's released sections, newest first (as written). */
export const changelogVersions = (md) => [...String(md).matchAll(VERSION_HEAD)].map((m) => m[1]);

/** -> problems: package.json's version against both CHANGELOGs (firmware's when given). */
export function versionProblems({ version, changelog, firmwareChangelog }) {
  const problems = [];
  const app = changelogVersions(changelog);
  // loop: NOT-WORTH — the CHANGELOG's sections (~60)
  const newer = app.filter((v) => versionCmp(v, version) > 0);
  if (newer.length) problems.push(`CHANGELOG.md has sections newer than package.json's ${version}: ${newer.join(", ")} (set the version with tools/update_version.mjs)`);
  if (app[0] && app[0] !== version && !newer.length)
    problems.push(`CHANGELOG.md's newest section is [${app[0]}], package.json says ${version}: the release cut its section (tools/release.sh) or the version is stale`);
  if (firmwareChangelog != null) {
    const fw = changelogVersions(firmwareChangelog);
    if (fw[0] && fw[0] !== version) problems.push(`the firmware CHANGELOG's newest section is [${fw[0]}-oled-edition], the app's version is ${version}: one release carries both (tools/release.sh)`);
  }
  return problems;
}

// ---------- privacy ----------

const sha = (s) => createHash("sha256").update(s).digest("hex");
export const words = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .match(/[\p{L}\p{N}]+/gu) ?? [];
export const phraseHash = (phrase) => sha(words(phrase).join(" "));

/** SECRET_PROJECTS.md -> each project's name ("## 1. The Name (note)" -> "Name"). */
export function secretNames(md) {
  // loop: NOT-WORTH — the file's headings (a handful)
  return [...String(md).matchAll(/^##\s+(?:\d+\.\s*)?(.+?)\s*(?:\(.*\))?\s*$/gm)].map((m) => m[1].replace(/^the\s+/i, "").trim()).filter(Boolean);
}

/** Every line of `texts` ([{ name, text }]) without `okTag`, through `check(line)`: a message for a problem, else null. */
function lineProblems(texts, okTag, check) {
  const problems = [];
  // loop: NOT-WORTH — every tracked text file once (~1000 files)
  for (const f of texts) {
    const lines = f.text.split("\n");
    // loop: NOT-WORTH — once per line
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(okTag)) continue;
      const why = check(lines[i]);
      if (why) problems.push(`${f.name}:${i + 1}: ${why}`);
    }
  }
  return problems;
}

/** texts: [{ name, text }]; hashes: Set of phraseHash values -> problems (never the phrase itself). */
export function privacyProblems(texts, hashes) {
  return lineProblems(texts, "privacy-ok", (line) => {
    const w = words(line);
    // loop: NOT-WORTH — 1- to 4-word phrases per line
    for (let a = 0; a < w.length; a++)
      // loop: NOT-WORTH — up to 4 words
      for (let n = 1; n <= 4 && a + n <= w.length; n++)
        if (hashes.has(sha(w.slice(a, a + n).join(" "))))
          return `words ${a + 1}-${a + n} are a secret project's name (SECRET_PROJECTS.md): take them out; secret work stays out of the public repos, commits and branch names`;
    return null;
  });
}

// ---------- quotes ----------

// "Marcy" / "owner", up to 80 characters in the same sentence (no quote mark,
// table cell break or ". "), a colon or said / asked / wrote, then the opening quote.
const QUOTED = /\b(?:Marcy|[Oo]wner)\b(?:[^"“”|\n.]|\.(?!\s)){0,80}?(?::|\bsaid|\basked|\bwrote)\s*[*_]{0,2}\s*["“]([^"”\n]*)(["”]?)/g;

/** texts: [{ name, text }] -> problems: each line that quotes Marcy's or the owner's words. */
export function quoteProblems(texts) {
  return lineProblems(texts, "quote-ok", (line) => {
    // loop: NOT-WORTH — the few matches on one line
    for (const m of line.matchAll(QUOTED)) {
      const letters = (m[1].match(/\p{L}/gu) ?? []).length;
      if (letters >= 8 || (!m[2] && letters > 0))
        return "quotes Marcy's or the owner's words: write the decision in neutral words and keep the attribution (Marcy <date>: …); public repos never carry her quoted words";
    }
    return null;
  });
}

// ---------- community ----------

// GitHub's community standards: each file at the root, in docs/ or in .github/ (any case).
const COMMUNITY = [
  ["README", /^(docs\/|\.github\/)?readme(\.\w+)?$/i],
  ["CODE_OF_CONDUCT.md", /^(docs\/|\.github\/)?code_of_conduct\.md$/i],
  ["CONTRIBUTING.md", /^(docs\/|\.github\/)?contributing\.md$/i],
  ["LICENSE", /^(licen[cs]e|copying)(\.\w+)?$/i],
  ["SECURITY.md", /^(docs\/|\.github\/)?security\.md$/i],
  ["an issue template (.github/ISSUE_TEMPLATE/*.yml or *.md)", /^\.github\/ISSUE_TEMPLATE\/(?!config\.ya?ml$)[^/]+\.(ya?ml|md)$/i],
  ["a pull request template (.github/pull_request_template.md)", /^(docs\/|\.github\/)?(pull_request_template\.md|pull_request_template\/[^/]+\.md)$/i],
];

/** tracked: [paths] -> problems: each community file that's missing. */
export function communityProblems(tracked) {
  // loop: NOT-WORTH — 7 files x the tracked paths, once per run
  return COMMUNITY.filter(([, re]) => !tracked.some((f) => re.test(f))).map(([name]) => `${name} is not tracked: GitHub's community standards ask for it (Insights → Community standards); restore it`);
}

const BINARY = /\.(png|jpe?g|webp|gif|ico|icns|ttf|otf|woff2?|wav|flac|mp3|ogg|opus|uf2|bin|elf|zip|gz|pdf|psd|blend|glb)$/i;
const loadDenylist = () =>
  existsSync(DENYLIST)
    ? new Set(
        readFileSync(DENYLIST, "utf8")
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => /^[0-9a-f]{64}$/.test(l)),
      )
    : new Set();

// ---------- running them ----------

const runGit = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });
const trackedIn = (root) => runGit(root, ["ls-files"]).split("\n").filter(Boolean);
const repoKind = (root) => (existsSync(join(root, "package.json")) && existsSync(join(root, "electron")) ? "app" : existsSync(join(root, "CMakeLists.txt")) ? "firmware" : null);

function gates(root, firmwareRoot) {
  const kind = repoKind(root);
  const read = (f) => readFileSync(join(root, f), "utf8");
  const tracked = trackedIn(root);
  const appRoot = kind === "app" ? root : APP_ROOT;
  const otherRoot = kind === "app" ? firmwareRoot : appRoot;
  // loop: NOT-WORTH — every tracked text file once
  const textFiles = () =>
    tracked
      .filter((f) => !BINARY.test(f) && existsSync(join(root, f)) && statSync(join(root, f)).isFile())
      .map((f) => ({ name: f, text: read(f) }))
      .filter((f) => !f.text.includes("\u0000"));
  return {
    changelog() {
      const tag = lastTag(root);
      if (!tag) return { skip: "no release tag in this clone (a CI checkout needs fetch-depth: 0)" };
      const commits = commitsSince(root, tag);
      return { problems: changelogProblems({ changelog: read("CHANGELOG.md"), commits, shipped: SHIPPED[kind] }), info: `${commits.length} commits since ${tag}` };
    },
    refs() {
      const docs = tracked.filter((f) => /^(README[^/]*|CLAUDE|QUALITY)\.md$/.test(f) || /^docs\/[^/]+\.md$/.test(f)).map((f) => ({ name: f, text: read(f) }));
      const other = otherRoot && existsSync(join(otherRoot, ".git")) ? { tracked: trackedIn(otherRoot) } : null;
      const localTops = Object.fromEntries(tracked.filter((f) => f.includes("/")).map((f) => [f.split("/")[0], true]));
      // The firmware's own top folders that the app has too (src/, tools/, docs/) can't be told apart without it.
      if (!other) for (const shared of ["src", "tools", "docs", "tests", "lib"]) delete localTops[shared];
      const scripts = kind === "app" ? Object.keys(JSON.parse(read("package.json")).scripts ?? {}) : null;
      // loop: NOT-WORTH — the code files once (a few MB)
      const code = tracked
        .filter((f) => /^(src|electron|tools)\/.*\.(ts|tsx|mjs|js|py|cpp|h|sh)$/.test(f))
        .map(read)
        .join("\n");
      return {
        problems: refProblems(docs, { tracked, scripts, other, localTops, code }),
        info: `${docs.length} docs${other ? "" : `, the ${kind === "app" ? "firmware" : "app"} repo not named: its paths unchecked`}`,
      };
    },
    version() {
      if (kind !== "app") return { skip: "run from the app repo (it checks both)" };
      const problems = [];
      try {
        execFileSync("node", ["tools/update_version.mjs", "--verify"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        // error: SHOWN — the verify's own message is the problem
        problems.push(`tools/update_version.mjs --verify: ${String(e.stdout ?? "") + String(e.stderr ?? "")}`.trim());
      }
      const fwLog = firmwareRoot && existsSync(join(firmwareRoot, "CHANGELOG.md")) ? readFileSync(join(firmwareRoot, "CHANGELOG.md"), "utf8") : null;
      problems.push(...versionProblems({ version: JSON.parse(read("package.json")).version, changelog: read("CHANGELOG.md"), firmwareChangelog: fwLog }));
      return { problems, info: fwLog ? "app and firmware" : "app (name the firmware repo with --firmware to check it too)" };
    },
    privacy() {
      const hashes = loadDenylist();
      if (!hashes.size) return { problems: ["tools/privacy-denylist.txt has no names: node tools/doc_gates.mjs privacy-sync (in the app repo, where SECRET_PROJECTS.md is)"] };
      // loop: NOT-WORTH — every tracked text file once
      const files = textFiles().filter((f) => f.name !== "tools/privacy-denylist.txt");
      const tag = lastTag(root);
      const messages = tag ? commitsSince(root, tag).map((c) => ({ name: `commit ${c.hash.slice(0, 7)}`, text: `${c.subject}\n${c.body}` })) : [];
      const branches = runGit(root, ["branch", "--format=%(refname:short)"])
        .split("\n")
        .filter(Boolean)
        .map((b) => ({ name: "branch name", text: b.replace(/[-_/]/g, " ") }));
      return {
        problems: privacyProblems([...files, ...messages, ...branches], hashes),
        info: `${files.length} files, ${messages.length} commit messages, ${branches.length} branches, ${hashes.size} names`,
      };
    },
    quotes() {
      const files = textFiles();
      return { problems: quoteProblems(files), info: `${files.length} files` };
    },
    community() {
      if (kind !== "app") return { skip: "run from the app repo" };
      return { problems: communityProblems(tracked), info: `${COMMUNITY.length} files` };
    },
  };
}

function privacySync() {
  // In a worktree, the file is in the main checkout (git's common dir's parent).
  const main = resolve(runGit(APP_ROOT, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim(), "..");
  const file = [APP_ROOT, main].map((d) => join(d, "SECRET_PROJECTS.md")).find(existsSync) ?? join(APP_ROOT, "SECRET_PROJECTS.md");
  if (!existsSync(file)) {
    console.error("privacy-sync: no SECRET_PROJECTS.md here (it lives untracked in the app repo's main checkout)");
    return 2;
  }
  const names = secretNames(readFileSync(file, "utf8"));
  const hashes = [...new Set(names.map(phraseHash))].sort();
  writeFileSync(
    DENYLIST,
    `# SHA-256 of each secret project's name (SECRET_PROJECTS.md), lowercased words joined by one space.\n# Refresh: node tools/doc_gates.mjs privacy-sync. Checked by: node tools/doc_gates.mjs privacy.\n${hashes.join("\n")}\n`,
  );
  console.log(`privacy-sync: ${hashes.length} name(s) hashed into tools/privacy-denylist.txt`);
  return 0;
}

// A commit message (the commit-msg hook's file) and the current branch's name.
function privacyMsg(file) {
  const hashes = loadDenylist();
  const branch = runGit(APP_ROOT, ["branch", "--show-current"]).trim();
  const problems = privacyProblems(
    [
      { name: "the commit message", text: readFileSync(file, "utf8") },
      { name: "the branch name", text: branch.replace(/[-_/]/g, " ") },
    ],
    hashes,
  );
  // loop: NOT-WORTH — the problems found
  for (const p of problems) console.log(`  ✗ ${p}`);
  return problems.length ? 1 : 0;
}

function main(argv) {
  if (argv[0] === "privacy-sync") return privacySync();
  if (argv[0] === "privacy-msg") return privacyMsg(argv[1]);
  const opt = (name) => (argv.includes(name) ? resolve(argv[argv.indexOf(name) + 1]) : null);
  const root = opt("--repo") ?? APP_ROOT;
  // The firmware repo only when named (tools/release.sh does): a checkout next to this one may be on any branch.
  const firmware = opt("--firmware") ?? (process.env.DS5_FIRMWARE_REPO ? resolve(process.env.DS5_FIRMWARE_REPO) : repoKind(root) === "firmware" ? root : "/nonexistent");
  // loop: NOT-WORTH — 2 options
  const values = new Set(["--repo", "--firmware"].filter((o) => argv.includes(o)).map((o) => argv[argv.indexOf(o) + 1]));
  const names = argv.filter((a) => !a.startsWith("--") && !values.has(a));
  if (!repoKind(root)) {
    console.error(`doc_gates: ${root} is neither the app nor the firmware repo`);
    return 2;
  }
  const all = gates(root, existsSync(join(firmware, "CMakeLists.txt")) ? firmware : null);
  let failed = 0;
  // loop: NOT-WORTH — six gates
  for (const name of names.length ? names : Object.keys(all)) {
    if (!all[name]) {
      console.error(`unknown gate ${name} (${Object.keys(all).join(", ")})`);
      return 2;
    }
    const r = all[name]();
    if (r.skip) {
      console.log(`SKIP ${name}: ${r.skip}`);
      continue;
    }
    console.log(`${r.problems.length ? "FAIL" : "PASS"} ${name}${r.info ? ` (${r.info})` : ""}`);
    // loop: NOT-WORTH — the problems found
    for (const p of r.problems) console.log(`  ✗ ${p}`);
    if (r.problems.length) failed++;
  }
  return argv.includes("--check") && failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
