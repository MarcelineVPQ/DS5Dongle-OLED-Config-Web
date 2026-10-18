// tools/doc_gates.mjs: the changelog, refs, version and privacy gates catch
// what they're for, and pass what they should.
import { describe, expect, it } from "vitest";
// @ts-expect-error -- a plain ESM tool script without types
import * as gates from "../../tools/doc_gates.mjs";

type Commit = { hash: string; subject: string; body: string; files: string[] };
const g = gates as {
  changelogProblems: (a: { changelog: string; commits: Commit[]; shipped: (f: string) => boolean }) => string[];
  SHIPPED: Record<"app" | "firmware", (f: string) => boolean>;
  refProblems: (docs: { name: string; text: string }[], ctx: object) => string[];
  versionProblems: (a: { version: string; changelog: string; firmwareChangelog?: string | null }) => string[];
  privacyProblems: (texts: { name: string; text: string }[], hashes: Set<string>) => string[];
  phraseHash: (p: string) => string;
  secretNames: (md: string) => string[];
  versionCmp: (a: string, b: string) => number;
};

const commit = (subject: string, files: string[], body = "", hash = "a1b2c3d4e5"): Commit => ({ hash, subject, body, files });
const LOG = "# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- A thing.\n\n## [0.9.5-dev.19] — Release Candidate 1 — 2026-10-17\n\n- Old.\n";

describe("changelog gate", () => {
  const shipped = g.SHIPPED.app;
  it("passes a fix that changes the CHANGELOG with it", () => {
    expect(g.changelogProblems({ changelog: LOG, commits: [commit("fix(games): x", ["src/a.ts", "CHANGELOG.md"])], shipped })).toEqual([]);
  });
  it("fails a feat / fix / perf on shipped files without it, naming the commit", () => {
    const p = g.changelogProblems({ changelog: LOG, commits: [commit("perf(tray): y", ["electron/main/tray.ts"])], shipped });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("a1b2c3d perf(tray): y");
  });
  it("passes one that says No user-facing change, or touches only tests and tools", () => {
    expect(g.changelogProblems({ changelog: LOG, commits: [commit("fix(x): z", ["src/a.ts"], "No user-facing change: a dev-only path.")], shipped })).toEqual([]);
    expect(g.changelogProblems({ changelog: LOG, commits: [commit("fix(tools): z", ["tools/a.mjs", "tests/unit/a.test.ts"])], shipped })).toEqual([]);
    expect(g.changelogProblems({ changelog: LOG, commits: [commit("docs: z", ["src/a.ts"])], shipped })).toEqual([]);
  });
  it("passes one a later docs(changelog) commit names by its short hash", () => {
    const commits = [commit("docs(changelog): a1b2c3d's fix", ["CHANGELOG.md"], "", "ffff000011"), commit("fix(x): z", ["src/a.ts"])];
    expect(g.changelogProblems({ changelog: LOG, commits, shipped })).toEqual([]);
  });
  it("fails an empty [Unreleased] when user-facing work landed", () => {
    const empty = LOG.replace("### Fixed\n\n- A thing.\n", "");
    expect(g.changelogProblems({ changelog: empty, commits: [commit("fix(x): z", ["src/a.ts", "CHANGELOG.md"])], shipped })[0]).toContain("[Unreleased] is empty");
  });
  it("knows what the firmware ships", () => {
    expect(["src/cmd.cpp", "CMakeLists.txt"].every(g.SHIPPED.firmware)).toBe(true);
    expect(["tools/list_loops.py", "tests/host/test_cmd.cpp", "README.md"].some(g.SHIPPED.firmware)).toBe(false);
  });
});

describe("refs gate", () => {
  const ctx = { tracked: ["src/a.ts", "docs/GUIDE.md", "tools/x.mjs"], scripts: ["check"], other: null, localTops: { src: true, docs: true, tools: true }, code: 'write("game-library-2.json")' };
  const doc = (text: string) => [{ name: "docs/X.md", text }];
  it("passes names that exist, data files the code writes, and examples", () => {
    expect(g.refProblems(doc("See `src/a.ts`, tools/x.mjs, [the guide](GUIDE.md), `npm run check`, `game-library-2.json` and `x.sh`."), ctx)).toEqual([]);
  });
  it("fails a missing file, a dead link and an unknown script", () => {
    const p = g.refProblems(doc("See `src/missing.ts`.\nAnd [this](NOPE.md).\nRun `npm run nothing`."), ctx);
    expect(p.map((x) => x.split(":")[1])).toEqual(["1", "2", "3"]);
  });
  it("leaves alone lines that say a file is gone or planned, code blocks and BACKLOG rows still to do", () => {
    expect(g.refProblems(doc("`src/old.ts` was removed in 0.9.\n```\nsrc/gone.ts\n```"), ctx)).toEqual([]);
    expect(g.refProblems([{ name: "docs/BACKLOG.md", text: "| Idea | Open. A new `src/new.ts` | Low | - |" }], ctx)).toEqual([]);
  });
});

describe("version gate", () => {
  it("passes one version in both CHANGELOGs", () => {
    expect(g.versionProblems({ version: "0.9.5-dev.19", changelog: LOG, firmwareChangelog: "## [Unreleased]\n\n## [0.9.5-dev.19-oled-edition] — Release Candidate 1 — 2026-10-17\n" })).toEqual([]);
  });
  it("fails a newer section, a stale version and a firmware CHANGELOG on another release", () => {
    expect(g.versionProblems({ version: "0.9.5-dev.18", changelog: LOG })[0]).toContain("newer than");
    expect(g.versionProblems({ version: "0.9.5", changelog: LOG })[0]).toContain("newest section is [0.9.5-dev.19]");
    expect(g.versionProblems({ version: "0.9.5-dev.19", changelog: LOG, firmwareChangelog: "## [0.9.5-dev.18-oled-edition] - x\n" })[0]).toContain("firmware");
  });
  it("orders a dev build before its stable release", () => {
    expect(g.versionCmp("0.9.5-dev.19", "0.9.5")).toBe(-1);
    expect(g.versionCmp("0.9.5-dev.20", "0.9.5-dev.19")).toBe(1);
  });
});

describe("privacy gate", () => {
  // A made-up name: the real ones are only in SECRET_PROJECTS.md (untracked).
  const hashes = new Set([g.phraseHash("Velvet Otter")]);
  it("takes each project's name from SECRET_PROJECTS.md's headings", () => {
    expect(g.secretNames("# Secret projects\n\n## 1. The Velvet Otter (surprise, 2026-10-14)\n\ntext\n## 2. Moon Kite\n")).toEqual(["Velvet Otter", "Moon Kite"]);
  });
  it("finds the name in any case and spacing, and never prints it", () => {
    const p = g.privacyProblems([{ name: "docs/BACKLOG.md", text: "fine\nthe VELVET   otter, soon" }], hashes);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/^docs\/BACKLOG\.md:2: words 2-3/);
    expect(p[0].toLowerCase()).not.toContain("velvet");
  });
  it("passes its words apart, and a line marked privacy-ok", () => {
    expect(g.privacyProblems([{ name: "a", text: "a velvet cushion; an otter" }], hashes)).toEqual([]);
    expect(g.privacyProblems([{ name: "a", text: "velvet otter (privacy-ok: the toy's brand)" }], hashes)).toEqual([]);
  });
});
