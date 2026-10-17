import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { descendantPids, mountGuardArgs } from "../../electron/main/appImageQuit";

// Quitting a Linux AppImage: a helper keeps the FUSE mount up until the app
// and every process below it are gone (a zygote took a SIGBUS when the mount
// went first, 0.9.5-dev.17).

describe("descendantPids", () => {
  const tree: Record<number, number[]> = { 1: [2, 3, 9], 2: [4], 3: [5, 6], 4: [], 5: [7], 6: [], 7: [], 9: [] };
  const childrenOf = (pid: number) => tree[pid] ?? [];

  it("lists every process below the root, children first", () => {
    expect(descendantPids(1, childrenOf)).toEqual([2, 3, 9, 4, 5, 6, 7]);
  });

  it("a process with no children has none; a loop in the lookup ends", () => {
    expect(descendantPids(4, childrenOf)).toEqual([]);
    expect(descendantPids(1, (pid) => (pid === 1 ? [2] : [1, 2]))).toEqual([2]);
  });

  it("stops at 256 processes", () => {
    expect(descendantPids(0, (pid) => (pid < 1000 ? [pid * 2 + 1, pid * 2 + 2] : []))).toHaveLength(256);
  });
});

describe.runIf(process.platform === "linux")("the mount guard's script", () => {
  const run = (pids: number[]) =>
    new Promise<number>((resolve) => {
      const started = Date.now();
      // lifetime: OK — the test's own /bin/sh; ends by itself (5 s at most)
      spawn("/bin/sh", mountGuardArgs(pids), { stdio: "ignore", env: { PATH: "/usr/bin:/bin" } }).once("exit", () => resolve(Date.now() - started)); // lifetime: OK — fires once
    });

  it("ends right away when the processes are gone", { timeout: 20_000 }, async () => {
    expect(await run([2 ** 22 + 1])).toBeLessThan(3000);
  });

  it("waits while one is alive and ends soon after it exits", { timeout: 20_000 }, async () => {
    // lifetime: OK — exits by itself after 0.4 s
    const sleeper = spawn("sleep", ["0.4"], { stdio: "ignore" });
    const took = await run([sleeper.pid!]);
    expect(took).toBeGreaterThanOrEqual(300);
    expect(took).toBeLessThan(4000);
  });

  it("never waits more than 5 s", async () => {
    const took = await run([process.pid]);
    expect(took).toBeGreaterThanOrEqual(4000);
    // The script checks the clock (5–6 s); a loaded PC (the whole test suite at once) can run it late.
    expect(took).toBeLessThan(20_000);
  }, 30_000);
});
