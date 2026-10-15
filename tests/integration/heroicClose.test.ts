// Heroic crashed when it exited after the app had started it (core dumps of
// 2026-10-13: SIGBUS in _dl_fini inside libnotify.so.4 from the app's own
// AppImage mount, /tmp/.mount_DS5Don…/usr/lib). The AppImage's AppRun puts
// its mount first in LD_LIBRARY_PATH, XDG_DATA_DIRS and GSETTINGS_SCHEMA_DIR;
// a launcher that inherited them loaded the app's bundled libraries, and once
// that copy of the app had exited the mount was gone.
//
// A fake Heroic process tree (a main process named "heroic" and two helpers
// with Chromium's --type= switches) is started the way the app starts
// launchers (launcherEnv, a detached start) from an AppImage-like
// environment, then closed by the app's real launcherControl. Checked: the
// launcher gets no AppImage mount in any variable; only the main process is
// asked to quit (SIGTERM), its helpers are never signalled by us, and the
// main process ends them itself and exits cleanly before the close reports
// "closed". The process list is filtered to this fake tree only: the test
// never sees, let alone signals, a real Heroic or Steam.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launcherControl, type ProcLayer } from "../../electron/main/games/processes";
import { readProcs } from "../../electron/main/games/running";
import { launcherEnv } from "../../electron/main/games/schemeHandler";

const MOUNT = "/tmp/.mount_DS5DonTEST01";

// The fake launcher: `heroic fake.cjs <dir> [--type=…]`.
const FAKE = String.raw`
const fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const dir = process.argv[2];
const type = process.argv.find((a) => a.startsWith("--type="));
const log = (line) => fs.appendFileSync(path.join(dir, "log"), line + "\n");
if (type) {
  // A helper: ends when the main process closes its pipe; a signal from outside is logged.
  process.on("SIGTERM", () => { log("helper-signalled " + type); process.exit(1); });
  process.stdin.on("end", () => process.exit(0));
  process.stdin.resume();
  log("helper-up " + type);
} else {
  const pick = (k) => process.env[k] ?? null;
  fs.writeFileSync(path.join(dir, "env.json"), JSON.stringify({ LD_LIBRARY_PATH: pick("LD_LIBRARY_PATH"), XDG_DATA_DIRS: pick("XDG_DATA_DIRS"), GSETTINGS_SCHEMA_DIR: pick("GSETTINGS_SCHEMA_DIR"), PATH: pick("PATH"), APPDIR: pick("APPDIR") }));
  const helpers = ["--type=zygote", "--type=gpu-process"].map((t) => spawn(process.argv0, [process.argv[1], dir, t], { stdio: ["pipe", "ignore", "ignore"] }));
  process.on("SIGTERM", () => {
    // Like Chromium's own quit: the helpers are still there, the main process ends them.
    log("main-term helpers-alive=" + helpers.every((h) => h.exitCode === null && h.signalCode === null));
    let left = helpers.length;
    for (const h of helpers) { h.once("exit", (code, signal) => { log("helper-exit " + code + " " + signal); if (--left === 0) { log("main-clean"); process.exit(0); } }); h.stdin.end(); }
  });
  setInterval(() => {}, 1000);
}
`;

let dir = "";
let heroic = "";
const started: number[] = [];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ds5-heroic-"));
  heroic = join(dir, "heroic");
  symlinkSync(process.execPath, heroic); // the process is named "heroic", like the real one
  writeFileSync(join(dir, "fake.cjs"), FAKE);
});

afterAll(() => {
  for (const pid of started) {
    try {
      process.kill(pid, "SIGKILL"); // only the fake tree's main, if a test failed half way
    } catch {
      // already gone
    }
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const log = () => (existsSync(join(dir, "log")) ? readFileSync(join(dir, "log"), "utf8") : "");

async function waitFor(check: () => boolean, ms = 10_000): Promise<void> {
  const until = Date.now() + ms;
  // loop: SERIAL-REQUIRED — deadline: polls the fake tree's log until it's up or ms passed
  while (!check()) {
    if (Date.now() > until) throw new Error(`timed out; log:\n${log()}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe.runIf(process.platform === "linux")("closing Heroic the app started (a fake process tree)", () => {
  it("starts it without the app's AppImage mount, asks only its main process to quit and waits for a clean exit", async () => {
    // The environment AppRun gives the app (electron-builder's AppImage).
    const appEnv: NodeJS.ProcessEnv = {
      HOME: process.env.HOME ?? "/",
      APPDIR: MOUNT,
      APPIMAGE: "/home/me/Apps/DS5.AppImage",
      PATH: `${MOUNT}:${MOUNT}/usr/sbin:/usr/bin:/bin`,
      LD_LIBRARY_PATH: `${MOUNT}/usr/lib`,
      XDG_DATA_DIRS: `${MOUNT}/usr/share/:/usr/share/gnome:/usr/local/share/:/usr/share/`,
      GSETTINGS_SCHEMA_DIR: `${MOUNT}/usr/share/glib-2.0/schemas`,
    };
    const env = launcherEnv(appEnv, appEnv.HOME!);
    const ours = (pid: number) => readProcs().some((p) => p.pid === pid);
    const layer: ProcLayer = {
      // Only this fake tree, never the user's own launchers.
      list: () => readProcs().filter((p) => p.args[0] === heroic),
      env: () => undefined,
      exists: existsSync,
      run: () => undefined,
      start: (cmd, args) =>
        new Promise((resolve) => {
          // lifetime: OK — the fake launcher; closed by the test, SIGKILLed in afterAll if a test failed
          const child = spawn(cmd, args, { detached: true, stdio: "ignore", env });
          child.once("error", () => resolve(false)); // lifetime: OK — fires once
          // lifetime: OK — fires once
          child.once("spawn", () => {
            started.push(child.pid!);
            child.unref();
            resolve(true);
          });
        }),
      signal: (pid) => {
        if (!ours(pid)) throw new Error(`signal to a process outside the fake tree: ${pid}`);
        process.kill(pid, "SIGTERM");
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)), // lifetime: OK — fires once
    };

    expect(await layer.start(heroic, [join(dir, "fake.cjs"), dir])).toBe(true);
    await waitFor(() => (log().match(/helper-up/g) ?? []).length === 2);

    // The launcher's environment: nothing from the app's AppImage mount, the rest kept.
    const seen = JSON.parse(readFileSync(join(dir, "env.json"), "utf8")) as Record<string, string | null>;
    expect(JSON.stringify(seen)).not.toContain(".mount_");
    expect(seen).toEqual({ LD_LIBRARY_PATH: null, XDG_DATA_DIRS: "/usr/share/gnome:/usr/local/share/:/usr/share/", GSETTINGS_SCHEMA_DIR: null, PATH: "/usr/bin:/bin", APPDIR: null });

    // The tree as the app sees it: one main process and two helpers.
    const tree = await layer.list();
    expect(tree).toHaveLength(3);

    const control = launcherControl(layer, 10_000);
    expect(await control.running()).toEqual(new Set(["heroic"]));
    expect(await control.close("heroic")).toBe("closed");

    const lines = log();
    expect(lines).toContain("main-term helpers-alive=true"); // nobody killed the helpers first
    expect(lines).not.toContain("helper-signalled");
    expect(lines).toContain("main-clean");
    expect(lines.match(/helper-exit 0 null/g)).toHaveLength(2);
    expect(await layer.list()).toEqual([]);
  }, 30_000);
});
