// The resource budget gate's arithmetic (tools/budgets_lib.mjs): /proc
// parsing, CPU and frame rates, the memory trend, and PASS/FAIL against
// tools/budgets.json.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cpuByType, cpuTotal, descendants, judgeBudgets, formatTable, growthPerWindow, parsePssKb, parseStat, passed, perSecond, procType, type Results } from "../../tools/budgets_lib.mjs";

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
    memory: { atS: 420, mb: 280 },
    soak: null,
    ...over,
  });

  it("passes at the limits that are inclusive and judges the GPU process as info only", () => {
    const rows = judgeBudgets(config, results());
    expect(rows.filter((r) => r.budget === "idle frames").map((r) => r.verdict)).toEqual(["PASS", "PASS"]); // 10 = limit
    expect(rows.find((r) => r.budget === "GPU process, shown")?.verdict).toBe("INFO");
    expect(rows.find((r) => r.budget === "CPU shown, idle" && r.scope === "controller")?.measured).toBe(1.4);
    expect(rows.find((r) => r.budget === "CPU hidden")?.measured).toBe(0.4); // the GPU process counts when hidden, DevTools tracing never
    expect(rows.find((r) => r.budget === "memory growth")?.verdict).toBe("SKIP");
    expect(rows.find((r) => r.budget === "CPU hidden, main")).toMatchObject({ measured: 0.3, verdict: "INFO" }); // the running-game check lives there
    expect(passed(rows)).toBe(true);
  });

  it("fails each budget that is over", () => {
    const rows = judgeBudgets(
      config,
      results({
        pages: [page("controller", 54, { main: 0.5, renderer: 1.6 })],
        hidden: { secs: 300, cpu: { main: 0.5 } }, // 0.5 is not < 0.5
        memory: { atS: 600, mb: 301 },
        soak: { windowS: 1800, samples: Array.from({ length: 31 }, (_, i) => ({ t: i * 60, mb: 250 + i * 0.2 })) }, // 6 MB / 30 min
      }),
    );
    const failed = rows.filter((r) => r.verdict === "FAIL").map((r) => r.budget);
    expect(failed).toEqual(["idle frames", "CPU shown, idle", "CPU hidden", "memory (PSS)", "memory growth"]);
    expect(passed(rows)).toBe(false);
  });

  it("passes a shrinking memory trend", () => {
    const rows = judgeBudgets(config, results({ soak: { windowS: 1800, samples: Array.from({ length: 31 }, (_, i) => ({ t: i * 60, mb: 300 - i })) } }));
    expect(rows.find((r) => r.budget === "memory growth")?.verdict).toBe("PASS");
  });

  it("prints an aligned table with every row", () => {
    const rows = judgeBudgets(config, results());
    const lines = formatTable(rows).split("\n");
    expect(lines[0]).toMatch(/^Budget\s+Scope\s+Measured\s+Limit\s+Unit\s+Verdict$/);
    expect(lines).toHaveLength(rows.length + 2);
    expect(lines.some((l) => /idle frames\s+controller\s+3\s+≤ 10\s+frames\/s\s+PASS/.test(l))).toBe(true);
  });
});
