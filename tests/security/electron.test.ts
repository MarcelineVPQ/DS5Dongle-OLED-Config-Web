// Security regression tests for the desktop app. The allowlists are tested
// directly; the window/session baseline is checked in the source so a change
// to it has to come with a change here (and a SECURITY_AUDIT.md note).
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isAllowedUsbDevice } from "../../electron/main/devices";
import { artRequestTarget } from "../../electron/main/games/artRequest";
import { ART_WIDTHS } from "../../src/desktop/games/types";
// Imported up front: a cold import of the IPC module took over 5 s inside a test on the Windows runner.
import { ApplyRequestSchema, FixIdsSchema, UndoRequestSchema } from "../../electron/main/ipc";
import { allowPermissionCheck, allowPermissionRequest } from "../../electron/main/permissions";
import { isAllowedExternalUrl } from "../../electron/main/urls";
import { OFFICIAL_FIRMWARE_HOSTS, isAllowedOfficialFirmwareUrl } from "../../electron/main/officialFirmware";
import { OFFICIAL_FIRMWARE_URL } from "../../src/protocol/officialFirmware";

const mainSource = readFileSync(new URL("../../electron/main/index.ts", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../../electron/preload/index.ts", import.meta.url), "utf8");
const viteSource = readFileSync(new URL("../../electron.vite.config.ts", import.meta.url), "utf8");

describe("USB device allowlist", () => {
  it("allows the dongle (DS5 and Edge mode) and the RP2350 boot device", () => {
    expect(isAllowedUsbDevice({ vendorId: 0x054c, productId: 0x0ce6 })).toBe(true);
    expect(isAllowedUsbDevice({ vendorId: 0x054c, productId: 0x0df2 })).toBe(true);
    expect(isAllowedUsbDevice({ vendorId: 0x2e8a, productId: 0x000f })).toBe(true);
  });

  it("denies everything else, including other Sony and Raspberry Pi devices", () => {
    expect(isAllowedUsbDevice({ vendorId: 0x054c, productId: 0x09cc })).toBe(false);
    expect(isAllowedUsbDevice({ vendorId: 0x2e8a, productId: 0x0003 })).toBe(false);
    expect(isAllowedUsbDevice({ vendorId: 0x046d, productId: 0xc52b })).toBe(false);
    expect(isAllowedUsbDevice(undefined)).toBe(false);
    expect(isAllowedUsbDevice({})).toBe(false);
  });
});

describe("external URL allowlist", () => {
  it("allows https GitHub and the project site", () => {
    expect(isAllowedExternalUrl("https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition")).toBe(true);
    expect(isAllowedExternalUrl("https://marcelinevpq.github.io/DS5Dongle-OLED-Config-Web/")).toBe(true);
    expect(isAllowedExternalUrl("https://42pixelstudios.com/")).toBe(true);
    // Sony's PlayStation Accessories page (how to update the controller's firmware).
    expect(isAllowedExternalUrl("https://controller.dl.playstation.net/controller/lang/en/2100004.html")).toBe(true);
  });

  it("refuses other schemes, hosts, look-alikes and embedded credentials", () => {
    for (const url of [
      "http://github.com/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://github.com.evil.example/",
      "https://evil.example/github.com",
      "https://user:pass@github.com/",
      "https://github.com:8443/",
      "not a url",
    ]) {
      expect(isAllowedExternalUrl(url), url).toBe(false);
    }
  });
});

describe("outbound requests from the main process", () => {
  it("Sony's firmware versions: one host, HTTPS, the fixed URL", () => {
    expect([...OFFICIAL_FIRMWARE_HOSTS]).toEqual(["fwupdater.dl.playstation.net"]);
    expect(isAllowedOfficialFirmwareUrl(OFFICIAL_FIRMWARE_URL)).toBe(true);
    for (const url of [
      "http://fwupdater.dl.playstation.net/fwupdater/info.json",
      "https://dl.playstation.net/",
      "https://fwupdater.dl.playstation.net.evil.example/",
      "https://a:b@fwupdater.dl.playstation.net/",
    ]) {
      expect(isAllowedOfficialFirmwareUrl(url), url).toBe(false);
    }
  });

  it("only the reviewed modules call net.fetch (a new caller needs a SECURITY_AUDIT.md entry)", () => {
    const dir = new URL("../../electron/main/", import.meta.url);
    const callers = readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".ts") && readFileSync(new URL(f, dir), "utf8").includes("net.fetch("))
      .sort();
    expect(callers).toEqual(["download.ts", "index.ts", "updater.ts"]);
    // index.ts: the local ds5-art:// files, and Sony's info.json through OfficialFirmwareSource.
    expect([...mainSource.matchAll(/net\.fetch\(([^,)]*)/g)].map((m) => m[1])).toEqual(["pathToFileURL(file", "url"]);
    expect(mainSource).toMatch(/new OfficialFirmwareSource\(\s*\(url, init\) => net\.fetch\(url, init\)/);
  });
});

describe("game art requests (ds5-art://)", () => {
  const base = `ds5-art://art/${encodeURIComponent("steam-1a2b3c4d:steam:4078430")}/cover`;
  it("accepts a width only from the fixed list", () => {
    for (const w of ART_WIDTHS) expect(artRequestTarget(`${base}?w=${w}`)?.width, String(w)).toBe(w);
    expect(artRequestTarget(base)?.width).toBeNull();
  });

  it("refuses any other query, width or fragment", () => {
    for (const q of [
      "?w=100",
      "?w=0",
      "?w=-64",
      "?w=0256",
      "?w=256.0",
      "?w=1e3",
      "?w=99999",
      "?w=",
      "?w=256&w=512",
      "?w=256&x=1",
      "?x=1",
      "?%77=256",
      "?w=256#x",
      "#x",
      "?path=/etc/passwd",
      "?w=256%00",
    ])
      expect(artRequestTarget(`${base}${q}`), q).toBeNull();
  });

  it("serves only the scanned file or a copy made from it (the URL never names a path)", () => {
    // index.ts: the width only picks a copy of the file the scan resolved.
    // (Fake games, dev builds only: the fake library's own generated pictures.)
    expect(mainSource).toMatch(/const source = !target \? undefined : fakeArt \? await fakeArt\.artFile\(target\.key, target\.kind\) : games\?\.artPath\(target\.key, target\.kind\);/);
    expect(mainSource).toMatch(/const file = source && target\?\.width \? await thumbs\.path\(source, target\.kind, target\.width\) : source;/);
  });
});

describe("web permissions", () => {
  it("grants a capture request only for audio alone, from the app's page", () => {
    expect(allowPermissionRequest("media", { mediaTypes: ["audio"] }, true)).toBe(true);
  });

  it("refuses the camera, audio with video, other permissions and other pages", () => {
    expect(allowPermissionRequest("media", { mediaTypes: ["video"] }, true)).toBe(false);
    expect(allowPermissionRequest("media", { mediaTypes: ["audio", "video"] }, true)).toBe(false);
    expect(allowPermissionRequest("media", { mediaTypes: [] }, true)).toBe(false);
    expect(allowPermissionRequest("media", {}, true)).toBe(false);
    expect(allowPermissionRequest("media", { mediaTypes: ["audio"] }, false)).toBe(false);
    for (const p of ["display-capture", "geolocation", "notifications", "usb", "hid", "serial", "clipboard-read", "openExternal", "fullscreen"])
      expect(allowPermissionRequest(p, { mediaTypes: ["audio"] }, true)).toBe(false);
  });

  it("checks pass only for usb, speaker-selection and audio device names, from the app origin", () => {
    expect(allowPermissionCheck("usb", {}, true)).toBe(true);
    expect(allowPermissionCheck("speaker-selection", {}, true)).toBe(true);
    expect(allowPermissionCheck("media", { mediaType: "audio" }, true)).toBe(true);
    expect(allowPermissionCheck("media", { mediaType: "video" }, true)).toBe(false);
    expect(allowPermissionCheck("hid", {}, true)).toBe(false);
    expect(allowPermissionCheck("usb", {}, false)).toBe(false);
    expect(allowPermissionCheck("media", { mediaType: "audio" }, false)).toBe(false);
  });
});

describe("window and session baseline", () => {
  it("keeps the renderer isolated and sandboxed", () => {
    expect(mainSource).toMatch(/contextIsolation:\s*true/);
    expect(mainSource).toMatch(/sandbox:\s*true/);
    expect(mainSource).toMatch(/nodeIntegration:\s*false/);
    expect(mainSource).toMatch(/webSecurity:\s*true/);
  });

  it("routes every web permission request and check through permissions.ts, with the app page/origin", () => {
    expect(mainSource).toMatch(
      /setPermissionRequestHandler\(\(contents, permission, callback, details\) =>\s*callback\(allowPermissionRequest\(permission, details as \{ mediaTypes\?: string\[\] \}, isTrusted\(contents, details\.requestingUrl\)\)\)/,
    );
    expect(mainSource).toMatch(
      /setPermissionCheckHandler\(\(_contents, permission, requestingOrigin, details\) =>\s*allowPermissionCheck\(permission, details as \{ mediaType\?: string \}, isAppOrigin\(requestingOrigin\)\)/,
    );
    expect(mainSource).toMatch(/setDevicePermissionHandler/);
  });

  it("blocks new windows and off-app navigation", () => {
    expect(mainSource).toMatch(/return \{ action: "deny" \}/);
    expect(mainSource).toMatch(/will-navigate/);
  });

  it("never hands ipcRenderer to the page, only fixed channel functions", () => {
    const code = preloadSource.replace(/\/\/.*$/gm, "").replace(/^import .*$/gm, "");
    expect(code).toMatch(/contextBridge\.exposeInMainWorld\("desktop", api\)/);
    // ipcRenderer may be used inside the wrapper functions, but never placed on
    // the exposed object or passed to the bridge.
    expect(code).not.toMatch(/[{,]\s*ipcRenderer\s*[,}:]/);
    expect(code).not.toMatch(/exposeInMainWorld\([^)]*ipcRenderer/);
    // Every channel comes from the IPC constant table, no ad-hoc strings.
    for (const call of code.match(/ipcRenderer\.(send|invoke|on|removeListener)\(([^,)]+)/g) ?? []) {
      expect(call, call).toMatch(/\(IPC\./);
    }
  });

  it("ships a CSP without eval or remote origins", () => {
    const csp = viteSource.slice(viteSource.indexOf("const CSP"), viteSource.indexOf('].join("; ")'));
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/https?:/);
  });
});

describe("IPC payload validation", async () => {
  // Loaded lazily: the module imports electron, which only exists at runtime.
  const { z } = await import("zod");
  const DeviceStatus = z.strictObject({ dongle: z.boolean(), controller: z.boolean(), slot: z.number().int().min(-1).max(3), firmware: z.string().max(64).nullable() });
  const ipcSource = readFileSync(new URL("../../electron/main/ipc.ts", import.meta.url), "utf8");

  it("validates every renderer message and checks the sender", () => {
    expect(ipcSource).toMatch(/DeviceStatusSchema\.safeParse\(raw\)/);
    expect(ipcSource).toMatch(/parseRequest\(IPC\.setSetting, SettingUpdate, raw\)/);
    expect(ipcSource).toMatch(/run\(parseRequest\(channel, schema, raw\)\)/);
    expect((ipcSource.match(/trusted\(event\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("the status schema rejects extra keys and out-of-range slots", () => {
    expect(DeviceStatus.safeParse({ dongle: true, controller: true, slot: 2, firmware: "0.8.0" }).success).toBe(true);
    expect(DeviceStatus.safeParse({ dongle: true, controller: true, slot: 9, firmware: null }).success).toBe(false);
    expect(DeviceStatus.safeParse({ dongle: true, controller: true, slot: 0, firmware: null, extra: 1 }).success).toBe(false);
  });
});

describe("Share your OLED: the page never names a path", async () => {
  const { OledImageSchema, OledPngSchema } = await import("../../electron/main/oledShare");
  const { GIF_MAX_BYTES, PNG_MAX_BYTES, PNG_MAGIC, GIF_MAGIC } = await import("../../src/oled/oledShare");
  const ipcSource = readFileSync(new URL("../../electron/main/ipc.ts", import.meta.url), "utf8");
  const png = Uint8Array.from([...PNG_MAGIC, 0]);
  const gif = Uint8Array.from([...GIF_MAGIC, 0]);

  it("takes only a kind and bytes of that format, within its size cap", () => {
    expect(OledImageSchema.safeParse({ kind: "png", bytes: png }).success).toBe(true);
    expect(OledImageSchema.safeParse({ kind: "gif", bytes: gif }).success).toBe(true);
    // A path, a name or any other field is refused: the save dialog alone picks where.
    expect(OledImageSchema.safeParse({ kind: "png", bytes: png, path: "/home/me/.bashrc" }).success).toBe(false);
    expect(OledImageSchema.safeParse({ kind: "png", bytes: png, name: "x.sh" }).success).toBe(false);
    expect(OledImageSchema.safeParse({ kind: "sh", bytes: png }).success).toBe(false);
    // The bytes must be the format they claim.
    expect(OledImageSchema.safeParse({ kind: "png", bytes: gif }).success).toBe(false);
    expect(OledImageSchema.safeParse({ kind: "gif", bytes: Uint8Array.from([0x23, 0x21, 0x2f]) }).success).toBe(false);
    expect(OledImageSchema.safeParse({ kind: "png", bytes: [...png] }).success).toBe(false);
    expect(OledImageSchema.safeParse({ kind: "png", bytes: "iVBORw0KGgo=" }).success).toBe(false);
    // Size caps.
    const big = (magic: readonly number[], n: number) => {
      const b = new Uint8Array(n);
      b.set(magic);
      return b;
    };
    expect(OledImageSchema.safeParse({ kind: "png", bytes: big(PNG_MAGIC, PNG_MAX_BYTES + 1) }).success).toBe(false);
    expect(OledImageSchema.safeParse({ kind: "gif", bytes: big(GIF_MAGIC, GIF_MAX_BYTES) }).success).toBe(true);
    expect(OledImageSchema.safeParse({ kind: "gif", bytes: big(GIF_MAGIC, GIF_MAX_BYTES + 1) }).success).toBe(false);
    expect(OledPngSchema.safeParse(png).success).toBe(true);
    expect(OledPngSchema.safeParse(gif).success).toBe(false);
  });

  it("checks the sender and parses the payload on both channels", () => {
    expect(ipcSource).toMatch(/h\.saveOledImage\(parseRequest\(IPC\.saveOledImage, OledImageSchema, raw\), event\.sender\)/);
    expect(ipcSource).toMatch(/invokeWith\(IPC\.copyOledImage, OledPngSchema, h\.copyOledImage\)/);
  });

  it("the path is the dialog's, written by the main process", () => {
    expect(mainSource).toMatch(/dialog\.showSaveDialog\(win, options\)/);
    expect(mainSource).toMatch(/write: writeFileAtomic/);
  });
});

describe("stereo headset profile (Linux): the page names no card, profile or node", async () => {
  const ipcSource = readFileSync(new URL("../../electron/main/ipc.ts", import.meta.url), "utf8");
  const { SettingUpdate } = await import("../../electron/main/settings");
  const { setDefaultNode, setCardProfile } = await import("../../electron/main/games/system");

  it("the hint is a boolean or null from our own page; Undo takes no payload", () => {
    expect(ipcSource).toMatch(
      /ipcMain\.on\(IPC\.headsetHint, \(event, raw: unknown\) => \{\n\s*if \(!trusted\(event\)\) return;\n\s*.*\n\s*const headphones = z\.boolean\(\)\.nullable\(\)\.safeParse\(raw\);/,
    );
    expect(ipcSource).toMatch(/invoke\(IPC\.headsetUndo, h\.headsetUndo\)/);
  });

  it("the page can turn the setting on or off, but not mark it explained", () => {
    expect(SettingUpdate.safeParse({ key: "headsetStereo", value: false }).success).toBe(true);
    expect(SettingUpdate.safeParse({ key: "headsetStereo", value: "off" }).success).toBe(false);
    expect(SettingUpdate.safeParse({ key: "headsetStereoExplained", value: true }).success).toBe(false);
  });

  it("pactl is only ever asked to change the DualSense's own card and nodes", async () => {
    await expect(setDefaultNode("sink", "alsa_output.pci-0000_00_1f.3.analog-stereo")).rejects.toThrow(/Not a DualSense/);
    await expect(setDefaultNode("source", "-h")).rejects.toThrow(/Not a DualSense/);
    await expect(setCardProfile("alsa_card.pci-0000_00_1f.3", "off")).rejects.toThrow(/Not a DualSense/);
  });
});

describe("trusted page", () => {
  const mainSource = readFileSync(new URL("../../electron/main/index.ts", import.meta.url), "utf8");

  it("trusts only the exact packaged page, not any file under a renderer/ folder", () => {
    expect(mainSource).toMatch(/pagePath\(parsed\.pathname\) === APP_PAGE/);
    expect(mainSource).not.toMatch(/includes\("\/renderer\/"\)/);
    expect(mainSource).not.toMatch(/url\.startsWith\(devServerUrl\)/);
  });
});

describe("privileged Windows USB repair", () => {
  const source = readFileSync(new URL("../../electron/main/windowsSetup.ts", import.meta.url), "utf8");

  it("runs a fixed script, elevated, through PowerShell by its full path", async () => {
    const { REPAIR_SCRIPT, launcherScript, encodeCommand } = await import("../../electron/main/windowsSetup");
    // Only the dongle's own IDs: Windows' cached answers and device entries for 054C:0CE6 / 0DF2.
    const lines = REPAIR_SCRIPT.split("\n").map((l) => l.trim());
    expect(lines).toContain("foreach ($id in @('0CE6', '0DF2')) {");
    expect(REPAIR_SCRIPT).toContain('"HKLM:\\SYSTEM\\CurrentControlSet\\Control\\usbflags\\054C$($id)0100"');
    expect(REPAIR_SCRIPT).toContain('-like "USB\\VID_054C&PID_$($id)*"');
    expect(REPAIR_SCRIPT).toContain('& "$env:SystemRoot\\System32\\pnputil.exe" /remove-device');
    // Nothing else removed or run.
    expect(REPAIR_SCRIPT.match(/Remove-Item/g)).toHaveLength(1);
    expect(REPAIR_SCRIPT.match(/pnputil/g)).toHaveLength(1);
    expect(REPAIR_SCRIPT).not.toMatch(/Invoke-Expression|iex |Start-Process|DownloadString|http/i);
    const launcher = launcherScript("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", REPAIR_SCRIPT);
    expect(launcher).toContain(`'-EncodedCommand','${encodeCommand(REPAIR_SCRIPT)}'`);
    expect(launcher).toContain("-Verb RunAs");
    expect(Buffer.from(encodeCommand(REPAIR_SCRIPT), "base64").toString("utf16le")).toBe(REPAIR_SCRIPT);
    expect(source).toMatch(/join\(process\.env\.SystemRoot \?\? "C:\\\\Windows", "System32", "WindowsPowerShell", "v1\.0", "powershell\.exe"\)/);
    expect(source).toMatch(/execFile\(powershell, \["-NoProfile", "-NonInteractive", "-EncodedCommand"/);
    expect(source).not.toMatch(/\bexec\(|shell: true/);
  });

  it("publishes the exact script in the README", async () => {
    const { REPAIR_SCRIPT } = await import("../../src/desktop/windowsRepairScript");
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    expect(readme).toContain("```powershell\n" + REPAIR_SCRIPT + "\n```");
  });
});

describe("game links, folders and web links on Linux", () => {
  const handlerSource = readFileSync(new URL("../../electron/main/games/schemeHandler.ts", import.meta.url), "utf8");

  it("open through xdg-open with a fixed argv, no shell, the launcher env", () => {
    expect(handlerSource).toContain('return startForUser("xdg-open", [target]);');
    expect(handlerSource).not.toMatch(/(?<!\.)\bexec\(|execSync|shell: true/);
    // Game actions with what the main process built, and allowlisted web links.
    expect(mainSource.match(/openForUser\(/g)).toHaveLength(3);
    expect(mainSource).toContain("return openForUser(target.url);");
    expect(mainSource).toContain("return openForUser(target.folder);");
    expect(mainSource).toContain('const opened = process.platform === "linux" ? openForUser(url) : shell.openExternal(url).then(() => true);');
    expect(mainSource.match(/openExternalLink\(url\)/g)).toHaveLength(2);
    expect(mainSource).toMatch(/if \(isAllowedExternalUrl\(url\)\) openExternalLink\(url\);[\s\S]*if \(isAllowedExternalUrl\(url\)\) openExternalLink\(url\);/);
  });

  it("start programs independent of the app: own systemd user unit, else a detached spawn; fixed argv, no shell", () => {
    // Linux: systemd-run, the program and its arguments after "--", never through a shell.
    expect(handlerSource).toContain('execFile("systemd-run", argv, { timeout: 10_000, env }');
    expect(handlerSource).toContain('return ["--user", "--collect", "--quiet", `--unit=${unit}`, "--property=Type=exec", lifetime, ...setenv, "--", cmd, ...args];');
    expect(handlerSource).toContain('execFile("systemctl", args, { encoding: "utf8", timeout: 3000, env }');
    expect(handlerSource).toContain('run(["--user", "show-environment"]), run(["--version"])');
    // Fallback and Windows/macOS: detached spawn, no shell.
    expect(handlerSource).toContain('spawn(cmd, args, { detached: true, stdio: "ignore", env })');
    // Every start gets the launcher environment.
    expect(handlerSource).toContain("env: () => launcherEnv(process.env, realHome()),");
    expect(handlerSource).toContain("export const startForUser = (cmd: string, args: string[]): Promise<boolean> => startIndependent(cmd, args);");
  });
});

describe("▶ Play starting a launcher in the background", () => {
  const actionsSource = readFileSync(new URL("../../electron/main/games/actions.ts", import.meta.url), "utf8");
  const handlerSource = readFileSync(new URL("../../electron/main/games/schemeHandler.ts", import.meta.url), "utf8");

  it("starts it through startForUser with a fixed argv: the program, a fixed flag and the link we built", () => {
    expect(mainSource).toContain('const quiet = u.action === "play" ? await withGames((g) => g.quietPlay(u.gameKey)).catch(() => null) : null;');
    expect(mainSource).toContain("if (quiet && (await startForUser(quiet.cmd, quiet.args))) return true;");
    expect(mainSource.match(/startForUser\(/g)).toHaveLength(1);
    expect(actionsSource).toContain('const flag = launcher === "steam" ? "-silent" : "--no-gui";');
    expect(actionsSource).toContain("return exe ? { cmd: exe, args: [flag, url] } : null;");
    expect(actionsSource).toContain('if (sys.flatpak) return { cmd: "flatpak", args: ["run", FLATPAK_ID[launcher], flag, url] };');
    expect(actionsSource).toContain("return { cmd: program.cmd, args: [...program.args, flag, url] };");
    // Never Heroic's gui=false (it hides a window the player has open).
    expect(actionsSource).not.toMatch(/[?&]gui=/);
    expect(actionsSource).not.toMatch(/child_process|spawn\(|exec(File)?\(/);
  });

  it("takes only Heroic's own program from its link handler, never its arguments", () => {
    expect(actionsSource).toContain('if (basename(prog) === "flatpak" && rest.includes(FLATPAK_ID.heroic)) return { cmd: "flatpak", args: ["run", FLATPAK_ID.heroic] };');
    expect(actionsSource).toContain(
      'if (isAbsolute(prog) && !prog.startsWith("/tmp/") && /^heroic(([-_.][^/]*)?\\.appimage)?$/i.test(basename(prog)) && exists(prog)) return { cmd: prog, args: [] };',
    );
    expect(handlerSource).toContain("if (!entry || !/^[\\w.-]+\\.desktop$/.test(entry)) return null;");
    expect(handlerSource).toContain('execFile("xdg-mime", ["query", "default", `x-scheme-handler/${scheme}`], { encoding: "utf8", timeout: 3000, env }');
  });

  it("asks whether a launcher is installed: xdg-mime on Linux, Electron's lookup elsewhere (no process)", () => {
    expect(mainSource).toContain("if (!(await hasSchemeHandler(target.url, (u) => app.getApplicationNameForProtocol(u)))) return false;");
    expect(handlerSource).toContain('return nameForProtocol(`${scheme}://`) !== "";');
  });
});

describe("closing and reopening game launchers (Linux)", () => {
  const source = readFileSync(new URL("../../electron/main/games/processes.ts", import.meta.url), "utf8");

  it("runs fixed programs without a shell, with the launcher environment, and never force-kills", () => {
    // Steam's own shutdown and the restart: execFile / spawn, no shell, the user's real home.
    expect(source).toMatch(/execFile\(cmd, args, \{ timeout: 15_000, env: launcherEnv\(process\.env, realHome\(\)\) \}/);
    expect(source).toContain("start: startForUser,"); // schemeHandler.ts: own systemd unit or detached spawn, no shell, the launcher env (tested above)
    expect(source).toContain('layer.run("steam", ["-shutdown"])');
    expect(source).toContain('layer.run("flatpak", ["run", FLATPAK_ID.steam, "-shutdown"])');
    expect(source).not.toMatch(/(?<!\.)\bexec\(|execSync|shell: true|SIGKILL|"-9"/);
    expect(source).toContain('process.kill(pid, "SIGTERM")');
  });

  it("closes only launchers the page named, from a schema-checked request", async () => {
    expect(ApplyRequestSchema.safeParse({ fixIds: [], restart: ["steam", "heroic", "lutris"] }).success).toBe(true);
    for (const restart of [["gog"], ["steam; reboot"], ["/usr/bin/steam"], "steam"]) expect(ApplyRequestSchema.safeParse({ fixIds: [], restart }).success, String(restart)).toBe(false);
    expect(ApplyRequestSchema.safeParse({ fixIds: [], restart: [], cmd: "steam" }).success).toBe(false);
    expect(UndoRequestSchema.safeParse({ backupId: "../../etc", restart: [] }).success).toBe(false);
  });
});

describe("closing and reopening game launchers (Windows)", () => {
  const source = readFileSync(new URL("../../electron/main/games/processes.ts", import.meta.url), "utf8");

  it("lists with tasklist, closes with steam.exe -shutdown or taskkill /PID (never /F), by full paths and no shell", () => {
    // The process list: running.ts's one tasklist reader (security-tested there: full path, fixed argv).
    expect(source).toContain("list: readWindowsProcs,");
    expect(source).toContain('signal: (pid) => execFile(system32("taskkill.exe"), taskkillArgs(pid), { timeout: 5000, windowsHide: true }, () => undefined),');
    expect(source).toContain('export const taskkillArgs = (pid: number): string[] => ["/PID", String(pid)];');
    expect(source).not.toMatch(/"\/F"|"\/T"|"\/IM"/i);
    // Steam's own shutdown: its steam.exe from the registry's SteamPath (or Program Files), checked to exist.
    expect(source).toContain('layer.run(exe, ["-shutdown"]);');
    expect(source).toContain("steamExe: () => steamExeIn(windowsSteamRoots(), existsSync),");
    expect(source).toContain('roots.map((root) => join(root, "steam.exe")).find((exe) => exists(exe)) ?? null;');
    expect(source).toContain('execFile(system32("reg.exe"), ["query", "HKCU\\\\Software\\\\Valve\\\\Steam", "/v", "RunningAppID"]');
    expect(source).toMatch(/run: \(cmd, args\) => execFile\(cmd, args, \{ timeout: 15_000, windowsHide: true, env: launcherEnv\(process\.env, realHome\(\)\) \}/);
    // Reopening: the same startForUser (detached spawn, no shell), with steam.exe or Heroic.exe only.
    expect(source).toContain("return exe ? { cmd: exe, args: [] } : null;");
  });
});

describe("HDR requirement check (Linux)", () => {
  const source = readFileSync(new URL("../../electron/main/games/hdr.ts", import.meta.url), "utf8");

  it("runs only kscreen-doctor -o, Mutter's GetCurrentState and gamescope --version: fixed argv, no shell, a timeout, read-only", () => {
    expect(source).toContain("const run = promisify(execFile);");
    expect(source).toContain('const OPTS = (env: NodeJS.ProcessEnv) => ({ timeout: 5000, env: { ...env, LC_ALL: "C" }, maxBuffer: 1024 * 1024 });');
    const calls = source.match(/(?<!\.)\bexec\(.*?OPTS\(env\)\)|(?<!\.)\bexec\(/g) ?? [];
    expect(calls).toEqual(['exec("kscreen-doctor", ["-o"], OPTS(env))', 'exec("gdbus", MUTTER, OPTS(env))', 'exec(path, ["--version"], OPTS(env))']);
    // The gdbus call is the one read-only method; nothing that applies a configuration.
    expect(source).toContain(
      'const MUTTER = ["call", "--session", "--dest", "org.gnome.Mutter.DisplayConfig", "--object-path", "/org/gnome/Mutter/DisplayConfig", "--method", "org.gnome.Mutter.DisplayConfig.GetCurrentState"];',
    );
    expect(source).not.toMatch(/ApplyMonitorsConfig|SetBacklight|execSync|spawn|shell: true|writeFile|mkdir|unlink|rename|--output|\.(?:hdr|mode|enable)\./);
    // gamescope's path only ever comes from PATH lookup (findOnPath), never from the page.
    expect(source).toContain('const path = findOnPath("gamescope", env);');
  });
});

describe("privileged Linux setup", () => {
  const setupSource = readFileSync(new URL("../../electron/main/linuxSetup.ts", import.meta.url), "utf8");

  it("runs pkexec through execFile with a fixed script and positional paths", () => {
    expect(setupSource).toMatch(/runPkexec\(\["\/bin\/sh", "-c", script, "ds5-setup", source, RULE_DEST, profile, withProfile \? PROFILE_DEST : ""\]\)/);
    // One pkexec spawn in the app: runPkexec, execFile with the caller's argv (no shell option).
    expect(setupSource.match(/execFile\("pkexec"/g)).toHaveLength(1);
    expect(setupSource).toContain('execFile("pkexec", argv, (error) => {');
    expect(setupSource).toMatch(/'command -v udevadm >\/dev\/null \|\| exit 3; install -m 0644 "\$1" "\$2"/);
    // The sandbox profile: only fixed paths, positional ($3/$4), and only AppArmor's parser.
    expect(setupSource).toMatch(/' && \{ \[ -z "\$3" \] \|\| \{ install -m 0644 "\$3" "\$4" && apparmor_parser -r "\$4"; \}; \}'/);
    expect(setupSource).toMatch(/const PROFILE_DEST = "\/etc\/apparmor\.d\/ds5-dongle-configurator";/);
    expect(setupSource).not.toMatch(/\bexec\(/);
    expect(setupSource).not.toMatch(/script\s*=\s*`/);
  });

  it("ships a sandbox profile that only names the app and allows user namespaces", () => {
    const profile = readFileSync(new URL("../../resources/linux/ds5-dongle-configurator.apparmor", import.meta.url), "utf8");
    expect(profile).toMatch(/^profile ds5-dongle-configurator \/\{,var\/\}tmp\/\.mount_\*\/\{AppRun,ds5-dongle-configurator\} flags=\(unconfined\) \{$/m);
    const rules = profile
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !/^(abi|include|profile|\})/.test(l));
    expect(rules).toEqual(["userns,"]);
  });
});

// Helper programs the main process runs (SECURITY_AUDIT.md rows "Proton
// install", "Audio fix follow-ups" (with the controller volume), "Updater relaunch", "Menu entry refresh",
// "Desktop accent read"): fixed argv through execFile/spawn, never a shell.
describe("helper programs", () => {
  const read = (path: string) => readFileSync(new URL(`../../electron/main/${path}`, import.meta.url), "utf8");
  const noShell = /(?<!\.)\bexec\(|execSync\(|shell: true/;

  it("Proton install: lists before it unpacks, never keeps the archive's owners, copies with cp -a", async () => {
    const source = read("games/proton.ts");
    expect(source).toContain("const run = promisify(execFile);");
    expect(source).toContain('run("tar", ["-tzf", archive]');
    expect(source).toContain('run("tar", ["-xzf", archive, "-C", out, "--no-same-owner"]');
    expect(source).toContain('run("cp", ["-a", join(primary, build.name), join(staging, build.name)])');
    expect(source.indexOf("checkArchiveEntries(stdout")).toBeLessThan(source.indexOf('run("tar", ["-xzf"'));
    expect(source).not.toMatch(noShell);
    const { checkArchiveEntries } = await import("../../electron/main/games/proton");
    expect(checkArchiveEntries(["GE-Proton11-7-DualSense/", "GE-Proton11-7-DualSense/proton"], "GE-Proton11-7-DualSense")).toBeNull();
    for (const bad of ["/etc/passwd", "GE-Proton11-7-DualSense/../../x", "other/file"]) expect(checkArchiveEntries([bad], "GE-Proton11-7-DualSense"), bad).not.toBeNull();
  });

  it("audio follow-ups: the user's WirePlumber and DualSense cards only", () => {
    const source = read("games/system.ts");
    expect(source).toContain('run("systemctl", ["--user", "restart", "wireplumber"], { timeout: 15_000 })');
    expect(source).toMatch(/if \(!DS5_CARD\.test\(card\)\) throw new Error\("Not a DualSense audio card\."\);\n\s+await run\("pactl", \["set-card-profile", card, profile\]/);
    expect(source).not.toMatch(noShell);
  });

  it("controller volume: amixer on Sony's DualSense cards only, fixed controls, integer values", () => {
    const source = read("games/system.ts");
    expect(source).toContain('const DS5_USB_IDS = new Set(["054c:0ce6", "054c:0df2"]);');
    expect(source).toContain('export const MIXER_TARGETS = ["PCM Playback Volume", "Headset Capture Volume", "PCM Playback Switch", "Headset Capture Switch"] as const;');
    expect(source).toContain('run("amixer", ["-c", String(card), "contents"], { env: { ...process.env, LC_ALL: "C" }, maxBuffer: 1024 * 1024, timeout: 5000 })');
    expect(source).toMatch(
      /if \(!\(MIXER_TARGETS as readonly string\[\]\)\.includes\(name\) \|\| !Number\.isInteger\(value\) \|\| value < 0\) throw new Error\("Not a controller volume control\."\);\n\s+await run\("amixer", \["-c", String\(card\), "-q", "cset", `name=\$\{name\}`, String\(value\)\], \{ env: \{ \.\.\.process\.env, LC_ALL: "C" \}, timeout: 5000 \}\);/,
    );
    expect(source.match(/run\("amixer"/g)).toHaveLength(2);
    // Keeping the levels: root only through runPkexec, alsactl by a fixed absolute path, `store` + a card number.
    expect(source).toContain('const ALSACTL_PATHS = ["/usr/sbin/alsactl", "/sbin/alsactl", "/usr/bin/alsactl"];');
    expect(source).toMatch(/if \(!Number\.isInteger\(card\) \|\| card < 0\) throw new Error\("Not a sound card number\."\);\n[\s\S]{0,200}return pkexec\(\[alsactl, "store", String\(card\)\]\);/);
    expect(source.match(/pkexec\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/execFile\("pkexec"|run\("pkexec"|run\("alsactl"/);
    // The card watcher only reads /dev/snd's names and runs no program of its own.
    const keeper = read("games/volumeKeeper.ts");
    expect(keeper).toContain('watch("/dev/snd", (_event, file) => {');
    expect(keeper).not.toMatch(/execFile|spawn|pkexec\(/);
    // The page names only a fix id; the backup manifest's values are schema-checked.
    expect(read("ipc.ts")).toContain("|^system:audio-(rule|profile|volume):[0-9a-f]{8}$/");
    expect(read("games/backup.ts")).toContain("changes: z.array(z.object({ name: z.enum(MIXER_TARGETS), from: z.number().int().min(0), to: z.number().int().min(0) }))");
  });

  it("updater relaunch: the installed file, an environment allowlist, the path never in a shell string", () => {
    const source = read("updater.ts");
    expect(source).toContain('execFileSync("systemd-run", ["--user", "--collect", `--unit=ds5-configurator-relaunch-${Date.now()}`, lifetime, ...setenv, "--", target]');
    expect(source).toContain('for (const lifetime of ["--property=ExitType=cgroup", "--property=KillMode=process"]) {');
    expect(source).toContain(`spawn("/bin/sh", ["-c", 'sleep 0.5; exec "$0"', target], { detached: true, stdio: "ignore", env })`);
    expect(source).toContain('spawn(target, [], { detached: true, stdio: "ignore" })');
    expect(source).toContain("const target = this.installedPath;");
    expect(source).not.toMatch(noShell);
  });

  it("AppImage quit guard: /bin/sh with a fixed script, only process ids as arguments, a fixed PATH", async () => {
    const source = read("appImageQuit.ts");
    expect(source).toContain('spawn("/bin/sh", mountGuardArgs(pids), { detached: true, stdio: "ignore", env: { PATH: "/usr/bin:/bin" } }).unref();');
    expect(source).not.toMatch(noShell);
    const { mountGuardArgs, WAIT_SCRIPT } = await import("../../electron/main/appImageQuit");
    expect(mountGuardArgs([12, 34])).toEqual(["-c", WAIT_SCRIPT, "sh", "12", "34"]);
    expect(WAIT_SCRIPT).not.toMatch(/\$\{|`/);
  });

  it("menu refresh and the desktop accent: fixed programs and arguments", () => {
    const integration = read("integration.ts");
    expect(integration).toContain('execFile("update-desktop-database", [appsDir], () => undefined);');
    expect(integration).toContain('execFile("kbuildsycoca6", () => execFile("kbuildsycoca5", () => undefined));');
    expect(integration).not.toMatch(noShell);
    const theme = read("desktopTheme.ts");
    expect(theme).toMatch(
      /execFile\(\s*"gdbus",\s*\[\s*"call",\s*"--session",\s*"--dest",\s*"org\.freedesktop\.portal\.Desktop",\s*"--object-path",\s*"\/org\/freedesktop\/portal\/desktop",\s*"--method",\s*"org\.freedesktop\.portal\.Settings\.ReadOne",\s*"org\.freedesktop\.appearance",\s*"accent-color",\s*\]/,
    );
    expect(theme).not.toMatch(noShell);
  });
});

// SECURITY_AUDIT.md "XInput fix files": the variable and its value are constants,
// and the page can only pick a scanned fix id.
describe("XInput fix", () => {
  it("writes only PROTON_PREFER_SDL=1, from a fix id", async () => {
    const source = readFileSync(new URL("../../electron/main/games/games.ts", import.meta.url), "utf8");
    expect(source).toContain('export const PREFER_SDL = "PROTON_PREFER_SDL";');
    expect(source).toContain('cfg.enviromentOptions = [...list, { key: PREFER_SDL, value: "1" }];');
    expect(source).toContain('doc.setIn(["system", "env", PREFER_SDL], "1")');
    const { withPreferSdl } = await import("../../electron/main/games/games");
    expect(withPreferSdl("")).toBe("PROTON_PREFER_SDL=1 %command%");
    expect(withPreferSdl("PROTON_PREFER_SDL=0 %command% -dx11")).toBe("PROTON_PREFER_SDL=1 %command% -dx11");
    for (const bad of [["steam-1234abcd:xinput:1; rm -rf ~"], ["../../etc/passwd"], [{ file: "x" }]]) expect(FixIdsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

// SECURITY_AUDIT.md "Firmware-write hold": every restart, install and quit path
// in the main process goes through the one hold.
describe("no restart or quit while firmware is written", () => {
  it("routes restart, install and quit through FirmwareHold", () => {
    expect(mainSource).toContain('hold.whenDone("restart", () => updater.restart())');
    expect(mainSource.match(/updater\.restart\(\)/g)).toHaveLength(1);
    expect(mainSource).toContain("installUpdate: () => (hold.active ? Promise.resolve(updater.getState()) : updater.downloadAndInstall()),");
    expect(mainSource.match(/updater\.downloadAndInstall\(\)/g)).toHaveLength(2);
    expect(mainSource).toContain("const installInBackground = () => void updater.downloadAndInstall()");
    expect(mainSource.match(/hold\.whenDone\("install", installInBackground\)/g)).toHaveLength(2);
    expect(mainSource).toMatch(/app\.on\("before-quit", \(event\) => \{\n\s+if \(hold\.allowQuit\(event, \(\) => app\.quit\(\)\)\)/);
    expect(mainSource).toContain("} else if (!hold.allowQuit(event, () => app.quit())) {");
    expect(mainSource).not.toMatch(/app\.(relaunch|exit)\(/);
  });
});
