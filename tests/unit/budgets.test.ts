// The resource budget gate's arithmetic (tools/budgets_lib.mjs): /proc
// parsing, the Windows and macOS readers' parsing (tools/procs_windows.mjs,
// tools/procs_mac.mjs, with a sample recorded in the Windows VM), CPU and
// frame rates, the memory trend, PASS/FAIL against tools/budgets.json and
// the three-OS table.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  appTree,
  combineResults,
  cpuByType,
  cpuTotal,
  descendants,
  FRAME_MARKS,
  frameCounts,
  framesBetweenMarks,
  judgeBudgets,
  formatCombined,
  formatTable,
  fromMacSmoke,
  growthPerWindow,
  memoryJudged,
  memorySummary,
  parsePssKb,
  parseStat,
  passed,
  perSecond,
  procType,
  type Results,
} from "../../tools/budgets_lib.mjs";
import { parseWinProbe, parseWinProcs, winProbeScript, winQueryScript } from "../../tools/procs_windows.mjs";
import { diffSummaries, summarizeSnapshotData } from "../../tools/heap_summary.mjs";
import { parsePsTable } from "../../tools/procs_mac.mjs";

const config = JSON.parse(readFileSync(new URL("../../tools/budgets.json", import.meta.url), "utf8"));

describe("/proc parsing", () => {
  it("reads ticks and the parent from stat, even with spaces and parentheses in the name", () => {
    const stat = "4242 (electron (x) y) S 4200 4242 4242 0 -1 4194560 100 0 0 0 150 25 0 0 39 19 30 0 12345 0 0";
    expect(parseStat(stat)).toEqual({ ppid: 4200, ticks: 175 });
  });

  it("names the process by its Chromium --type", () => {
    expect(procType("/x/electron\0.\0--user-data-dir=/s\0")).toBe("main");
    expect(procType("/x/electron\0--type=renderer\0--foo\0")).toBe("renderer");
    expect(procType("/x/electron\0--type=gpu-process\0")).toBe("gpu-process");
    expect(procType("/x/electron\0--type=utility\0--utility-sub-type=network.mojom.NetworkService\0")).toBe("utility:NetworkService");
    // a child that rewrote its title into one string
    expect(procType("/x/electron --type=zygote --no-sandbox")).toBe("zygote");
  });

  it("reads PSS from smaps_rollup", () => {
    const text = "55d0-7ffd ---p 00000000 00:00 0 [rollup]\nRss:              204800 kB\nPss:              150123 kB\nPss_Anon:          90000 kB\n";
    expect(parsePssKb(text)).toBe(150123);
    expect(parsePssKb("Rss: 1 kB\n")).toBeNull();
  });

  it("walks the process tree from the main process only", () => {
    const procs = [
      { pid: 10, ppid: 1 },
      { pid: 11, ppid: 10 },
      { pid: 12, ppid: 11 },
      { pid: 13, ppid: 10 },
      { pid: 99, ppid: 1 },
    ];
    expect(descendants(10, procs).sort()).toEqual([10, 11, 12, 13]);
  });
});

describe("Windows reader (a CIM sample recorded in the win11-test VM, 2026-10-14)", () => {
  // The query's output for a dev.10 copy hidden in the tray: main, GPU,
  // network service, renderer; perf rows for those and two system processes.
  const raw = readFileSync(new URL("../fixtures/budgets/win-procs.json", import.meta.url), "utf8");
  const rows = parseWinProcs(raw);

  it("reads CPU time (user + kernel, 100 ns), private working set and commit in kB", () => {
    expect(rows.map((r) => r.pid)).toEqual([9344, 8352, 8376, 2556]);
    expect(rows[0]).toMatchObject({ ppid: 6536, ticks: 2563593750 + 6676718750, memKb: 18964480 / 1024, commitKb: 105668608 / 1024 });
  });

  it("names each process by its --type from a quoted Windows command line", () => {
    const procs = appTree(9344, rows, (r) => r.cmd);
    expect(procs.map((p) => p.type)).toEqual(["main", "gpu-process", "utility:NetworkService", "renderer"]);
    // the launcher (the portable exe's parent) and anything else is not in the tree
    expect(appTree(8352, rows, (r) => r.cmd).map((p) => p.pid)).toEqual([8352]);
  });

  it("sums memory per type as the commit (judged), the private working set beside it", () => {
    // What windowsReader's appProcs hands memorySummary: the commit as memKb, the working set as alsoKb.
    const procs = appTree(9344, rows, (r) => r.cmd).map((r) => ({ ...r, memKb: r.commitKb, alsoKb: r.memKb }));
    const m = memorySummary(procs, "commit", "private working set");
    expect(m.metric).toBe("commit");
    expect(m.byType).toEqual({ main: 100.8, "gpu-process": 18.2, "utility:NetworkService": 11.9, renderer: 67.6 });
    // The tray-trimmed working set (Windows squeezed it to a few MB): reported, never judged.
    expect(m.also).toEqual({ metric: "private working set", byType: { main: 18.1, "gpu-process": 1, "utility:NetworkService": 1.2, renderer: 3.2 } });
    expect(memorySummary(procs, "commit").also).toBeUndefined();
    // a CPU-only sample (no perf rows): no memory, not zero
    const cpuOnly = parseWinProcs(JSON.stringify({ ...JSON.parse(raw), perf: [] }));
    expect(cpuOnly.every((r) => r.memKb === null)).toBe(true);
  });

  it("turns 100 ns CPU time into % of a core", () => {
    const before = appTree(9344, rows, (r) => r.cmd);
    // 20 s later: main +1.3 s of CPU (the old tasklist-based check), renderer +10 ms
    const after = before.map((p) => ({ ...p, ticks: p.ticks + (p.type === "main" ? 13_000_000 : p.type === "renderer" ? 100_000 : 0) }));
    expect(cpuByType(before, after, 20, 1e7)).toEqual({ main: 6.5, "gpu-process": 0, "utility:NetworkService": 0, renderer: 0.05 });
  });

  it("takes PowerShell 5.1's bare object for a one-item list", () => {
    const one = JSON.stringify({ procs: { pid: 5, ppid: 1, user: 10, kernel: 5, commit: 2048, cmd: "x.exe" }, perf: { pid: 5, ws: 4096 } });
    expect(parseWinProcs(one)).toEqual([{ pid: 5, ppid: 1, ticks: 15, cmd: "x.exe", memKb: 4, commitKb: 2 }]);
    expect(parseWinProcs(JSON.stringify({ procs: null, perf: null }))).toEqual([]);
  });

  it("queries the app's exe by name, and the counters only when memory is asked for", () => {
    expect(winQueryScript("DS5 Dongle OLED Edition Configurator.exe")).toContain(`Name='DS5 Dongle OLED Edition Configurator.exe'`);
    expect(winQueryScript("it's.exe")).toContain(`Name='it''s.exe'`);
    expect(winQueryScript("a.exe", true)).toContain("WorkingSetPrivate");
    expect(winQueryScript("a.exe", false)).not.toContain("WorkingSetPrivate");
  });
});

describe("macOS reader", () => {
  it("parses ps's table: CPU time in seconds, RSS, the command with spaces", () => {
    const text =
      "  501   1   1:02.50 204800 /Applications/DS5 Dongle.app/Contents/MacOS/DS5 Dongle\n  510 501   0:00.25  10240 /Applications/DS5 Dongle.app/Contents/Frameworks/DS5 Dongle Helper (GPU).app/x --type=gpu-process\n";
    expect(parsePsTable(text)).toEqual([
      { pid: 501, ppid: 1, cpuS: 62.5, rssKb: 204800, cmd: "/Applications/DS5 Dongle.app/Contents/MacOS/DS5 Dongle" },
      { pid: 510, ppid: 501, cpuS: 0.25, rssKb: 10240, cmd: "/Applications/DS5 Dongle.app/Contents/Frameworks/DS5 Dongle Helper (GPU).app/x --type=gpu-process" },
    ]);
    expect(appTree(501, parsePsTable(text), (r) => r.cmd).map((p) => p.type)).toEqual(["main", "gpu-process"]);
  });
});

describe("rates", () => {
  it("turns tick deltas into % of a core per process type, ignoring processes in one sample only", () => {
    const a = [
      { pid: 1, type: "main", ticks: 100 },
      { pid: 2, type: "renderer", ticks: 50 },
      { pid: 3, type: "gpu-process", ticks: 0 },
      { pid: 4, type: "utility:Audio", ticks: 7 },
    ];
    const b = [
      { pid: 1, type: "main", ticks: 103 }, // 3 ticks over 60 s at 100 Hz = 0.05 %
      { pid: 2, type: "renderer", ticks: 56 }, // 0.1 %
      { pid: 3, type: "gpu-process", ticks: 600 }, // 10 %
      { pid: 5, type: "renderer", ticks: 900 }, // new: left out
    ];
    const cpu = cpuByType(a, b, 60, 100);
    expect(cpu).toEqual({ main: 0.05, renderer: 0.1, "gpu-process": 10 });
    expect(cpuTotal(cpu)).toBe(10.15);
    expect(cpuTotal(cpu, ["gpu-process"])).toBe(0.15);
  });

  it("counts events per second", () => {
    expect(perSecond(63, 5)).toBe(12.6);
    expect(perSecond(undefined, 5)).toBe(0);
  });

  it("counts frames between the trace's two marks only", () => {
    const mark = (message: string, ts: number) => ({ name: "TimeStamp", ts, args: { data: { message } } });
    // A frame every 100 ms from t = 0.05 s to 20.15 s (the trace ran on past
    // the end mark: 202 frames in it), marks at 0.07 s and 20.07 s.
    const frames = Array.from({ length: 202 }, (_, i) => ({ name: "Display::DrawAndSwap", ts: 50_000 + i * 100_000 }));
    const events = [...frames, mark(FRAME_MARKS.start, 70_000), mark(FRAME_MARKS.end, 20_070_000)];
    expect(framesBetweenMarks(events)).toBe(10);
    // Wherever the window starts (here 101 frames fall inside it), the rate is the frames' own.
    expect(framesBetweenMarks([...frames, mark(FRAME_MARKS.start, 49_000), mark(FRAME_MARKS.end, 10_051_000)])).toBe(10);
    // One extra frame in 10 s on top of the 10 Hz steps still shows (and fails ≤ 10).
    const extra = { name: "Display::DrawAndSwap", ts: 5_120_000 };
    expect(framesBetweenMarks([...frames, extra, mark(FRAME_MARKS.start, 70_000), mark(FRAME_MARKS.end, 10_070_000)])).toBe(10.1);
    // The plain counts of the same trace, reported beside it: the whole trace
    // (202 frames over the 20 s asked for) and the window (200 in 20 s).
    expect(frameCounts(events, 20)).toEqual({ wholeTrace: 10.1, window: 10 });
    expect(frameCounts(frames, 20)).toEqual({ wholeTrace: 10.1, window: null });
    // A few frames close together on an idle page: counted over the window.
    expect(framesBetweenMarks([frames[3], frames[4], mark(FRAME_MARKS.start, 0), mark(FRAME_MARKS.end, 10_000_000)])).toBe(0.2);
    // Idle: no frames at all; a single frame: the count over the window.
    expect(framesBetweenMarks([frames[3], mark(FRAME_MARKS.start, 0), mark(FRAME_MARKS.end, 10_000_000)])).toBe(0.1);
    expect(framesBetweenMarks([mark(FRAME_MARKS.start, 0), mark(FRAME_MARKS.end, 10_000_000)])).toBe(0);
    // A mark missing (the page never ran it): not measured, never a made-up number.
    expect(framesBetweenMarks(frames)).toBeNull();
  });
});

describe("memory trend", () => {
  it("is the least-squares slope scaled to the window, robust to one noisy sample", () => {
    const flat = Array.from({ length: 31 }, (_, i) => ({ t: i * 60, mb: 250 + (i === 7 ? 6 : 0) }));
    expect(Math.abs(growthPerWindow(flat, 1800) ?? 99)).toBeLessThan(1);
    // 0.5 MB a minute = 15 MB per 30 min
    const leaking = Array.from({ length: 31 }, (_, i) => ({ t: i * 60, mb: 250 + i * 0.5 }));
    expect(growthPerWindow(leaking, 1800)).toBeCloseTo(15, 5);
  });

  it("needs at least three samples", () => {
    expect(
      growthPerWindow(
        [
          { t: 0, mb: 1 },
          { t: 60, mb: 2 },
        ],
        1800,
      ),
    ).toBeNull();
  });
});

describe("budgets.json", () => {
  it("states every budget the gate judges, with a number and a unit", () => {
    for (const key of ["idleFrames", "shownCpu", "hiddenCpu", "memory", "growth"]) {
      expect(typeof config.budgets[key].max).toBe("number");
      expect(config.budgets[key].unit).toBeTruthy();
    }
    expect(config.pages).toEqual(["controller", "dongle", "gameshome", "gamepage", "app", "about"]);
  });

  it("has a quick mode short enough for a release check and a long mode with the soak", () => {
    const q = config.modes.quick;
    const quickS = config.pages.length * (q.settleS + q.cpuS + q.traceS) + q.hiddenS;
    expect(quickS).toBeLessThan(10 * 60);
    expect(q.soakS).toBe(0);
    expect(config.modes.long.memoryAtS).toBe(600);
    expect(config.modes.long.soakS).toBe(1800);
    expect(config.modes.long.hiddenS).toBe(300);
  });
});

describe("judgeBudgets", () => {
  const page = (name: string, framesPerS: number, cpu: Record<string, number>) => ({ page: name, framesPerS, cpu });
  const results = (over: Partial<Results> = {}): Results => ({
    mode: "quick",
    pages: [page("controller", 3, { main: 0.4, renderer: 1, "gpu-process": 40 }), page("about", 10, { main: 0.3, renderer: 0.5 })],
    hidden: { secs: 120, cpu: { main: 0.3, renderer: 0.05, "gpu-process": 0.05, "utility:TracingService": 3 } },
    memory: { atS: 420, mb: 520, byType: { main: 95, renderer: 100, "gpu-process": 245, zygote: 24, "utility:NetworkService": 27, "utility:TracingService": 21 } }, // 246 without GPU and tracing
    soak: null,
    ...over,
  });

  it("passes at the limits that are inclusive and judges the GPU process as info only", () => {
    const rows = judgeBudgets(config, results());
    expect(rows.filter((r) => r.budget === "idle frames").map((r) => r.verdict)).toEqual(["PASS", "PASS"]); // 10 = limit
    expect(rows.find((r) => r.budget === "GPU process, shown")?.verdict).toBe("INFO");
    expect(rows.find((r) => r.budget === "CPU shown, idle" && r.scope === "controller")?.measured).toBe(1.4);
    expect(rows.find((r) => r.budget === "CPU hidden")?.measured).toBe(0.4); // the GPU process counts when hidden, DevTools tracing never
    expect(rows.find((r) => r.id === "growth")?.verdict).toBe("SKIP");
    expect(rows.find((r) => r.budget === "memory (PSS) without GPU")).toMatchObject({ measured: 246, verdict: "PASS" });
    expect(rows.find((r) => r.budget === "memory, GPU process")).toMatchObject({ measured: 245, verdict: "INFO" });
    expect(rows.find((r) => r.budget === "CPU hidden, main")).toMatchObject({ measured: 0.3, verdict: "INFO" }); // the running-game check lives there
    expect(passed(rows)).toBe(true);
  });

  it("fails each budget that is over", () => {
    const rows = judgeBudgets(
      config,
      results({
        pages: [page("controller", 54, { main: 0.5, renderer: 1.6 })],
        hidden: { secs: 300, cpu: { main: 0.5 } }, // 0.5 is not < 0.5
        memory: { atS: 600, mb: 276 }, // no breakdown: the total is judged
        soak: { windowS: 1800, samples: Array.from({ length: 31 }, (_, i) => ({ t: i * 60, mb: 250 + i * 0.2 })) }, // 6 MB / 30 min
      }),
    );
    const failed = rows.filter((r) => r.verdict === "FAIL").map((r) => r.budget);
    expect(failed).toEqual(["idle frames", "CPU shown, idle", "CPU hidden", "memory (PSS) without GPU", "memory growth without GPU"]);
    expect(passed(rows)).toBe(false);
  });

  it("judges memory without the GPU process, at most the limit", () => {
    expect(memoryJudged({ mb: 999, byType: { main: 100, renderer: 175, "gpu-process": 600, "utility:TracingService": 20 } })).toBe(275);
    const at = (byType: Record<string, number>) => judgeBudgets(config, results({ memory: { atS: 600, mb: 0, byType } })).find((r) => r.budget === "memory (PSS) without GPU")?.verdict;
    expect(at({ main: 100, renderer: 175, "gpu-process": 600 })).toBe("PASS"); // 275 = limit
    expect(at({ main: 100, renderer: 175.1, "gpu-process": 1 })).toBe("FAIL");
  });

  it("passes a shrinking memory trend", () => {
    const rows = judgeBudgets(config, results({ soak: { windowS: 1800, samples: Array.from({ length: 31 }, (_, i) => ({ t: i * 60, mb: 300 - i })) } }));
    expect(rows.find((r) => r.id === "growth")?.verdict).toBe("PASS");
  });

  it("judges growth without the GPU process and reports the total beside it", () => {
    // The GPU process's PSS swings between samples and creeps; the app's own processes are flat.
    const samples = Array.from({ length: 31 }, (_, i) => ({ t: i * 60, mb: 560 + (i % 2 ? 15 : 0) + i * 0.5, mbWithoutGpu: 260 }));
    const rows = judgeBudgets(config, results({ soak: { windowS: 1800, samples } }));
    expect(rows.find((r) => r.id === "growth")).toMatchObject({ budget: "memory growth without GPU", measured: 0, verdict: "PASS" });
    expect(rows.find((r) => r.id === "growthTotal")?.verdict).toBe("INFO");
    expect(rows.find((r) => r.id === "growthTotal")?.measured).toBeGreaterThan(5);
    // The app's own processes growing: fails whatever the GPU process does.
    const leaking = samples.map((s, i) => ({ ...s, mbWithoutGpu: 260 + i * 0.2 }));
    expect(judgeBudgets(config, results({ soak: { windowS: 1800, samples: leaking } })).find((r) => r.id === "growth")?.verdict).toBe("FAIL");
    // Older results without the split: the total is judged (and says so).
    const old = judgeBudgets(config, results({ soak: { windowS: 1800, samples: samples.map(({ t, mb }) => ({ t, mb })) } }));
    expect(old.find((r) => r.id === "growth")).toMatchObject({ verdict: "FAIL", scope: "30 min soak, 31 samples (no split: total)" });
  });

  it("names the memory measure the OS used", () => {
    const rows = judgeBudgets(config, results({ memory: { atS: 600, mb: 200, byType: { main: 200 }, metric: "private working set" } }));
    expect(rows.find((r) => r.id === "memory")).toMatchObject({ budget: "memory (private working set) without GPU", measured: 200, verdict: "PASS" });
  });

  it("prints an aligned table with every row", () => {
    const rows = judgeBudgets(config, results());
    const lines = formatTable(rows).split("\n");
    expect(lines[0]).toMatch(/^Budget\s+Scope\s+Measured\s+Limit\s+Unit\s+Verdict$/);
    expect(lines).toHaveLength(rows.length + 2);
    expect(lines.some((l) => /idle frames\s+controller\s+3\s+≤ 10\s+frames\/s\s+PASS/.test(l))).toBe(true);
  });
});

describe("three-OS table", () => {
  const linux: Results = {
    mode: "quick",
    pages: [
      { page: "controller", framesPerS: 10.6, cpu: { main: 0.5, renderer: 1.6, "gpu-process": 60 } },
      { page: "about", framesPerS: 10, cpu: { main: 0.4, renderer: 1 } },
    ],
    hidden: { secs: 300, cpu: { main: 0.3 } },
    memory: { atS: 600, mb: 246, byType: { main: 246 } },
    soak: null,
  };
  const windows: Results = {
    ...linux,
    pages: [{ page: "controller", framesPerS: 4, cpu: { main: 0.2, renderer: 0.5 } }],
    memory: { atS: 600, mb: 180, byType: { main: 180, "gpu-process": 90 }, metric: "private working set" },
  };
  const macSmoke = {
    budgets: {
      pages: [{ page: "about", framesPerS: 0, cpu: { main: 0.2, renderer: 0.3, total: 0.5 }, anims: [] }],
      hidden: { secs: 60, cpu: { main: 0.9, total: 0.9 }, pageSawHide: true },
      memory: { shown: { footprintMb: 300, gpuFootprintMb: 50, rssMb: 500 }, hidden: { footprintMb: 260, gpuFootprintMb: 40, rssMb: 450 } },
    },
  };

  it("reads the macOS smoke test's budgets: no total, footprint taken hidden", () => {
    const mac = fromMacSmoke(macSmoke);
    expect(mac?.pages[0].cpu).toEqual({ main: 0.2, renderer: 0.3 });
    expect(mac?.hidden?.cpu).toEqual({ main: 0.9 });
    expect(mac?.memory).toMatchObject({ mb: 260, metric: "footprint", byType: { app: 260, "gpu-process": 40 } });
    expect(memoryJudged(mac!.memory!)).toBe(260);
    expect(fromMacSmoke({})).toBeNull();
  });

  it("lines the OSes up by budget and page, n/a where an OS didn't measure it", () => {
    const rows = combineResults(config, { Linux: linux, Windows: windows, macOS: fromMacSmoke(macSmoke) });
    const frames = rows.find((r) => r.id === "frames:controller")!;
    expect(frames.cells.Linux).toMatchObject({ measured: 10.6, verdict: "FAIL" });
    expect(frames.cells.Windows).toMatchObject({ measured: 4, verdict: "PASS" });
    expect(frames.cells.macOS).toBeUndefined();
    const mem = rows.find((r) => r.id === "memory")!;
    expect(mem.budget).toBe("memory without GPU");
    expect(mem.cells.Windows).toMatchObject({ measured: 180, verdict: "PASS" });
    expect(rows.find((r) => r.id === "hidden")!.cells.macOS).toMatchObject({ measured: 0.9, verdict: "FAIL" });
    const text = formatCombined(rows, ["Linux", "Windows", "macOS"]).split("\n");
    expect(text[0]).toMatch(/^Budget\s+Page\s+Linux\s+Windows\s+macOS\s+Limit\s+Unit$/);
    expect(text.some((l) => /^idle frames\s+controller\s+10\.6 FAIL\s+4 PASS\s+n\/a\s+≤ 10/.test(l))).toBe(true);
  });

  it("leaves out an OS with no results", () => {
    const rows = combineResults(config, { Linux: linux, Windows: undefined });
    expect(Object.keys(rows[0].cells)).toEqual(["Linux"]);
  });
});

describe("memory probe (DS5_BUDGET_PROBE=1)", () => {
  it("asks Windows for handles, GDI and USER objects of the app's exe by name", () => {
    const script = winProbeScript("DS5 Dongle OLED Edition Configurator.exe");
    expect(script).toContain("Get-Process -Name 'DS5 Dongle OLED Edition Configurator'");
    expect(script).toContain("GetGuiResources");
    expect(winProbeScript("it's.exe")).toContain("-Name 'it''s'");
  });

  it("takes PowerShell 5.1's bare object for one process", () => {
    const one = { pid: 5, handles: 300, threads: 20, gdi: 12, user: 30, privateKb: 1, virtualKb: 2, pagedPoolKb: 3, nonpagedPoolKb: 4 };
    expect(parseWinProbe(JSON.stringify({ rows: one }))).toEqual([one]);
    expect(parseWinProbe(JSON.stringify({ rows: [one, one] }))).toHaveLength(2);
    expect(parseWinProbe(JSON.stringify({ rows: null }))).toEqual([]);
  });

  // A tiny heap snapshot in V8's format: nodes are flat [type, name, id, self_size, edge_count, trace_node_id, detachedness].
  const snapshot = (nodes: number[][]) => ({
    snapshot: {
      meta: { node_fields: ["type", "name", "id", "self_size", "edge_count", "trace_node_id", "detachedness"], node_types: [["hidden", "array", "string", "object", "code", "closure", "native"]] },
    },
    nodes: nodes.flat(),
    strings: ["", "Map", "some text", "HTMLDivElement", "onClick"],
  });

  it("sums a heap snapshot by constructor, strings by type, and counts detached nodes", () => {
    const s = summarizeSnapshotData(
      snapshot([
        [3, 1, 1, 100, 0, 0, 0], // object Map
        [3, 1, 2, 50, 0, 0, 0], // object Map
        [2, 2, 3, 40, 0, 0, 0], // a string
        [6, 3, 4, 200, 0, 0, 2], // a detached div
        [5, 4, 5, 32, 0, 0, 0], // closure onClick
      ]),
    );
    expect(s.nodes).toBe(5);
    expect(s.detached).toBe(1);
    expect(s.byName["object:Map"]).toEqual({ count: 2, size: 150 });
    expect(s.byName["(string)"]).toEqual({ count: 1, size: 40 });
    expect(Object.keys(s.byName)[0]).toBe("native:HTMLDivElement");
  });

  it("diffs two summaries, biggest change first", () => {
    const a = summarizeSnapshotData(snapshot([[3, 1, 1, 100, 0, 0, 0]]));
    const b = summarizeSnapshotData(
      snapshot([
        [3, 1, 1, 100, 0, 0, 0],
        [3, 1, 2, 100, 0, 0, 0],
        [5, 4, 3, 32, 0, 0, 0],
      ]),
    );
    expect(diffSummaries(a, b)).toEqual([
      { key: "object:Map", count: 1, size: 100 },
      { key: "closure:onClick", count: 1, size: 32 },
    ]);
  });
});
