// The error pass in the main process (CLAUDE.md "Error pass"): a request that
// fails its schema answers in plain words, and a user's change that can't be
// saved is put back and reported instead of only logged. index.ts runs only
// inside Electron, so its wiring is pinned by source, as tests/security does.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { BAD_REQUEST, MAIN_ERROR_KEYS } from "../../src/desktop/api";
import en from "../../src/i18n/locales/en.json";

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const hasKey = (key: string) => key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), en) !== undefined;

afterEach(() => vi.restoreAllMocks());

describe("a request that doesn't fit its schema", () => {
  it("answers BAD_REQUEST (the page says desktop.errors.badRequest) and logs the details", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { parseRequest } = await import("../../electron/main/ipc");
    const Ids = z.array(z.string().regex(/^steam-[0-9a-f]{8}$/));
    expect(parseRequest("desktop:games-apply", Ids, ["steam-1a2b3c4d"])).toEqual(["steam-1a2b3c4d"]);
    expect(() => parseRequest("desktop:games-apply", Ids, ["steam-1a2b3c4d:mode:dx12"])).toThrow(BAD_REQUEST);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("desktop:games-apply"), expect.any(String));
  });

  it("every invoke with a payload goes through it", () => {
    const ipc = source("electron/main/ipc.ts");
    expect(ipc).toContain("return run(parseRequest(channel, schema, raw));");
    expect(ipc).not.toMatch(/\.parse\(raw\)/);
  });
});

describe("launch at login", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it.runIf(process.platform === "linux")("throws when the autostart entry can't be written (it was only logged)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ds5-autostart-"));
    dirs.push(dir);
    const notADir = join(dir, "file");
    writeFileSync(notADir, "");
    vi.stubEnv("XDG_CONFIG_HOME", notADir); // autostart/ can't be made under a file
    const { applyAutostart } = await import("../../electron/main/autostart");
    expect(() => applyAutostart(true, false)).toThrow();
    vi.stubEnv("XDG_CONFIG_HOME", dir);
    expect(() => applyAutostart(true, false)).not.toThrow();
  });
});

describe("main-process wiring (index.ts)", () => {
  // Whitespace folded, so Prettier's line breaks don't matter.
  const main = source("electron/main/index.ts")
    .replace(/\s+/g, " ")
    .replace(/,\s*\)/g, ")");

  it("a setting that can't be saved is put back and the caller hears it", () => {
    expect(main).toMatch(/const before = settings;.*saveSettings\(settings\);.*catch \(cause\) \{.*settings = before;.*throw new Error\(/);
    expect(source("electron/main/settings.ts")).not.toContain('console.error("settings save failed:"');
  });

  it("the tray's toggles and opened links report a failure to the page's notice", () => {
    expect(main).toContain('showMainError("desktop.errors.settingNotSaved");');
    expect(main).toContain('opened.then( (ok) => ok || showMainError("desktop.errors.linkNotOpened"), () => showMainError("desktop.errors.linkNotOpened"));');
    for (const key of MAIN_ERROR_KEYS) expect(hasKey(key)).toBe(true);
  });

  it("a game link that doesn't open answers false (the page shows desktop.library.action.failed)", () => {
    expect(main).toContain("return shell.openExternal(target.url).then( () => true, () => false);");
    expect(main).not.toContain("shell.openExternal(target.url).catch(() => undefined);");
  });

  it("an app update that fails to install is marked, so the banner says it", () => {
    expect(source("electron/main/updater.ts")).toContain('Your current version is untouched.`, during: "install" });');
  });

  it("Undo reports a failed audio service restart instead of dropping it", () => {
    const service = source("electron/main/games/service.ts");
    expect(service).not.toContain("await restartWirePlumber().catch(() => undefined)");
    expect(service).toContain("...(audioRestartFailed ? { audioRestartFailed } : {})");
  });
});
