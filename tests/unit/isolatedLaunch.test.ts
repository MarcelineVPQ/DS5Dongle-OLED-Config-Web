// Test copies of the app start only through tools/isolated.sh, and that
// launcher keeps them off the owner's desktop: a clean environment, its own
// runtime folder, a private bus that can start nothing (no portals or
// kscreen: a test run on 2026-10-18 left SIGABRT dumps of
// xdg-desktop-portal-kde and kscreen_backend_launcher), no keyring, and a
// quit through the app instead of a signal.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tool = (name: string) => readFileSync(new URL(`../../tools/${name}`, import.meta.url), "utf8");
const code = (text: string) =>
  text
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
const launcher = code(tool("isolated.sh"));

describe("tools/isolated.sh", () => {
  it("builds a clean environment with its own runtime folder, display and home", () => {
    expect(launcher).toMatch(/setsid env -i PATH=/);
    expect(launcher).toMatch(/XDG_RUNTIME_DIR="\$run"/);
    expect(launcher).toMatch(/chmod 700 "\$run"/);
    expect(launcher).toMatch(/HOME="\$STATE\/home"/);
    expect(launcher).toMatch(/xvfb-run -a/);
    expect(launcher).toMatch(/--tmpfs "\/run\/user\/\$\(id -u\)"/);
  });

  it("runs a private bus whose only service folder is empty, and keeps the toolkit off portals", () => {
    expect(launcher).toMatch(/dbus-run-session --config-file="\$ISO\/session.conf"/);
    expect(launcher).toMatch(/<servicedir>\$ISO\/no-services<\/servicedir>/);
    expect(launcher).not.toMatch(/standard_session_servicedirs/);
    for (const v of ["GTK_USE_PORTAL=0", "NO_AT_BRIDGE=1", "GSETTINGS_BACKEND=memory"]) expect(launcher).toContain(v);
  });

  it("passes --password-store=basic and hides USB and hidraw", () => {
    expect(launcher).toContain("--password-store=basic");
    expect(launcher).toMatch(/bwrap --dev-bind \/ \/ --dev \/dev/);
  });

  it("quits through app.quit(), SIGKILL only as the last resort, never SIGTERM", () => {
    expect(launcher).toContain("app.quit()");
    expect(launcher).not.toMatch(/kill (-TERM|-15|-s TERM)|kill \$|pkill(?! -KILL)/);
    expect(launcher.match(/kill -KILL/g)?.length).toBe(1);
  });

  it("checks afterwards for core dumps, desktop helpers and leftovers", () => {
    expect(launcher).toMatch(/coredumpctl list --since/);
    for (const name of ["xdg-desktop-portal", "kscreen_backend_launcher", "kwalletd", "ksecretd"]) expect(launcher).toContain(name);
  });
});

describe("the test launchers", () => {
  it("start the app only through tools/isolated.sh", () => {
    const dir = new URL("../../tools/", import.meta.url);
    // loop: NOT-WORTH — test only: the tools folder's scripts
    const scripts = readdirSync(dir).filter((f) => f.endsWith(".sh") && f !== "isolated.sh");
    // loop: NOT-WORTH — test only
    for (const f of scripts) expect(code(tool(f)), f).not.toMatch(/electron\/dist\/electron|xvfb-run|dbus-run-session/);
    for (const f of ["check_ui.sh", "check_budgets.sh"]) expect(code(tool(f)), f).toMatch(/tools\/isolated\.sh" stop|tools\/isolated\.sh start/);
  });
});
