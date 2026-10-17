// A program the app starts for the user (a launcher it reopens, xdg-open)
// must outlive the app: its restart, its self-update relaunch, quitting.
// Each test runs the real startForUser (schemeHandler.ts, bundled) inside a
// stand-in "app" child process, starts a harmless long-running process (a
// Node timer that writes its pid and waits 30 s), kills the app the way it
// really dies there, and checks the program still runs.
//
// - Linux with a user systemd: the app runs in its own transient unit (like
//   the dev copy's service) and that unit is stopped, which kills its whole
//   cgroup (the bug: Steam lost its login). Skipped without a user systemd
//   (CI containers and GitHub's runners have none).
// - Linux/macOS without systemd (systemctl hidden from PATH): the detached
//   spawn; the app's process group is SIGKILLed.
// - Windows: the app process exits (detached children are outside libuv's
//   kill-on-close job object).
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SHELL_START_TIMEOUT_MS } from "../../electron/main/games/schemeHandler";

const linux = process.platform === "linux";
const userSystemd =
  linux && spawnSync("systemctl", ["--user", "show-environment"], { stdio: "ignore", timeout: 3000 }).status === 0 && spawnSync("systemd-run", ["--version"], { stdio: "ignore" }).status === 0;

let dir = "";
let app = ""; // the stand-in app: node app.mjs <pidFile>
const survivors: number[] = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ds5-independent-"));
  await build({
    entryPoints: [fileURLToPath(new URL("../../electron/main/games/schemeHandler.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(dir, "schemeHandler.mjs"),
    logLevel: "silent",
  });
  // The program: writes its pid, then waits 30 s.
  writeFileSync(join(dir, "program.cjs"), 'require("fs").writeFileSync(process.argv[2], String(process.pid)); setTimeout(() => {}, 30000);\n');
  app = join(dir, "app.mjs");
  writeFileSync(
    app,
    [
      'import { startForUser } from "./schemeHandler.mjs";',
      'import { join } from "node:path";',
      "const pidFile = process.argv[2];",
      'const ok = await startForUser(process.execPath, [join(import.meta.dirname, "program.cjs"), pidFile]);',
      'process.stdout.write(ok ? "started\\n" : "failed\\n");',
      "setInterval(() => {}, 1000); // the app keeps running until it's killed",
      "",
    ].join("\n"),
  );
}, 30_000);

afterAll(() => {
  for (const pid of survivors) {
    try {
      process.kill(pid);
    } catch {
      // already gone
    }
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function waitFor<T>(get: () => T | null, ms = 10_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = get();
    if (v !== null) return v;
    if (Date.now() > until) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

const readPid = (file: string) => (existsSync(file) && readFileSync(file, "utf8") ? Number(readFileSync(file, "utf8")) : null);
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe.skipIf(!userSystemd)("Linux: a started program survives the app's systemd unit stopping", () => {
  it("runs in its own app-ds5configurator-* unit and keeps running after the app's unit is killed", async () => {
    const pidFile = join(dir, "systemd.pid");
    const appUnit = `ds5-test-app-${Date.now().toString(36)}.service`;
    // The app in its own unit, like the dev copy's service (its environment: ours).
    execFileSync("systemd-run", [
      "--user",
      "--collect",
      "--quiet",
      `--unit=${appUnit}`,
      "--property=Type=exec",
      ...Object.entries(process.env)
        .filter(([k]) => /^(PATH|HOME|DISPLAY|WAYLAND_DISPLAY|XDG_RUNTIME_DIR|DBUS_SESSION_BUS_ADDRESS)$/.test(k))
        .map(([k, v]) => `--setenv=${k}=${v}`),
      "--",
      process.execPath,
      app,
      pidFile,
    ]);
    try {
      const pid = await waitFor(() => readPid(pidFile));
      survivors.push(pid);
      const cgroup = readFileSync(`/proc/${pid}/cgroup`, "utf8");
      expect(cgroup).toMatch(/\/app-ds5configurator-node@[0-9a-z]+\.service$/m);
      expect(cgroup).not.toContain(appUnit);
      // Stopping the app's unit kills everything in its cgroup.
      execFileSync("systemctl", ["--user", "stop", appUnit]);
      await new Promise((r) => setTimeout(r, 500));
      expect(alive(pid)).toBe(true);
    } finally {
      spawnSync("systemctl", ["--user", "stop", appUnit], { stdio: "ignore" });
    }
  }, 30_000);
});

describe.skipIf(process.platform === "win32")("POSIX without systemd: a started program survives the app's process group being killed", () => {
  it("falls back to a detached spawn in its own session", async () => {
    const pidFile = join(dir, "setsid.pid");
    // systemctl out of reach: an empty PATH (node and the program are absolute paths).
    const env = { ...process.env, PATH: join(dir, "no-bin") };
    const child = spawn(process.execPath, [app, pidFile], { detached: true, stdio: ["ignore", "pipe", "ignore"], env });
    let out = "";
    child.stdout.on("data", (d) => (out += String(d)));
    const pid = await waitFor(() => readPid(pidFile));
    survivors.push(pid);
    await waitFor(() => (out.includes("started") ? true : null));
    if (linux) expect(readFileSync(`/proc/${pid}/cgroup`, "utf8")).not.toMatch(/app-ds5configurator-/);
    process.kill(-child.pid!, "SIGKILL"); // the app's whole process group
    await new Promise((r) => setTimeout(r, 300));
    expect(alive(child.pid!)).toBe(false);
    expect(alive(pid)).toBe(true);
  }, 30_000);
});

describe.skipIf(process.platform !== "win32")("Windows: a started program survives the app exiting", () => {
  // Windows starts the program through PowerShell (shellStart), whose cold
  // start is most of the time this takes and grows with CPU load: ~3 s on CI
  // while the other test files run, 10 s and more at times. So the test waits
  // the way the app does: first for startForUser's answer, as long as the app
  // itself would wait for PowerShell, then for the program it started.
  it("is detached from the app's job object", async () => {
    const pidFile = join(dir, "windows.pid");
    const t0 = Date.now();
    const secs = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
    const child = spawn(process.execPath, [app, pidFile], { stdio: ["ignore", "pipe", "pipe"] });
    const exited = new Promise((r) => child.once("exit", r));
    let out = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (out += String(d)));
    try {
      // The app's answer: node starting the app, then PowerShell (SHELL_START_TIMEOUT_MS at most).
      await waitFor(() => (/started|failed/.test(out) ? true : null), SHELL_START_TIMEOUT_MS + 15_000).catch((e: unknown) => {
        throw new Error(`the app gave no answer after ${secs()}; it said: ${out || "(nothing)"}`, { cause: e });
      });
      expect(out, `the app couldn't start the program (after ${secs()})`).toContain("started");
      // Start-Process returned: the program exists, it has to boot node and write its pid.
      const pid = await waitFor(() => readPid(pidFile), 15_000).catch((e: unknown) => {
        throw new Error(`the app said "started" but the program wrote no pid after ${secs()}`, { cause: e });
      });
      survivors.push(pid);
      child.kill();
      await exited; // the app's job object closes with it
      await new Promise((r) => setTimeout(r, 500));
      expect(alive(pid)).toBe(true);
    } finally {
      child.kill();
      const late = readPid(pidFile); // a program that started after a failure
      if (late !== null && !survivors.includes(late)) survivors.push(late);
    }
  }, 60_000);
});
