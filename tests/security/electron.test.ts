// Security regression tests for the desktop app. The allowlists are tested
// directly; the window/session baseline is checked in the source so a change
// to it has to come with a change here (and a SECURITY_AUDIT.md note).
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isAllowedUsbDevice } from "../../electron/main/devices";
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

describe("window and session baseline", () => {
  it("keeps the renderer isolated and sandboxed", () => {
    expect(mainSource).toMatch(/contextIsolation:\s*true/);
    expect(mainSource).toMatch(/sandbox:\s*true/);
    expect(mainSource).toMatch(/nodeIntegration:\s*false/);
    expect(mainSource).toMatch(/webSecurity:\s*true/);
  });

  it("denies every web permission request and only checks usb (and audio device names)", () => {
    expect(mainSource).toMatch(/setPermissionRequestHandler\(\(_contents, _permission, callback\) => callback\(false\)\)/);
    expect(mainSource).toMatch(
      /isAppOrigin\(requestingOrigin\) &&\s*\(permission === "usb" \|\| \(permission as string\) === "speaker-selection" \|\| \(permission === "media" && \(details as \{ mediaType\?: string \}\)\.mediaType === "audio"\)\)/,
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
    expect(ipcSource).toMatch(/SettingUpdate\.parse\(raw\)/);
    expect((ipcSource.match(/trusted\(event\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("the status schema rejects extra keys and out-of-range slots", () => {
    expect(DeviceStatus.safeParse({ dongle: true, controller: true, slot: 2, firmware: "0.8.0" }).success).toBe(true);
    expect(DeviceStatus.safeParse({ dongle: true, controller: true, slot: 9, firmware: null }).success).toBe(false);
    expect(DeviceStatus.safeParse({ dongle: true, controller: true, slot: 0, firmware: null, extra: 1 }).success).toBe(false);
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
    // Windows checkouts may use CRLF line endings; the script itself must match exactly.
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(readme).toContain("```powershell\n" + REPAIR_SCRIPT + "\n```");
  });
});

describe("game links and folders on Linux", () => {
  const handlerSource = readFileSync(new URL("../../electron/main/games/schemeHandler.ts", import.meta.url), "utf8");

  it("open through xdg-open with a fixed argv, no shell, the launcher env", () => {
    expect(handlerSource).toMatch(/spawn\(cmd, args, \{ detached: true, stdio: "ignore", env: launcherEnv\(process\.env, realHome\(\)\) \}\)/);
    expect(handlerSource).toContain('return startForUser("xdg-open", [target]);');
    expect(handlerSource).not.toMatch(/(?<!\.)\bexec\(|execSync|shell: true/);
    // Only game actions use it, and only with what the main process built.
    expect(mainSource.match(/openForUser\(/g)).toHaveLength(2);
    expect(mainSource).toContain("return openForUser(target.url);");
    expect(mainSource).toContain("return openForUser(target.folder);");
  });
});

describe("closing and reopening game launchers (Linux)", () => {
  const source = readFileSync(new URL("../../electron/main/games/processes.ts", import.meta.url), "utf8");

  it("runs fixed programs without a shell, with the launcher environment, and never force-kills", () => {
    // Steam's own shutdown and the restart: execFile / spawn, no shell, the user's real home.
    expect(source).toMatch(/execFile\(cmd, args, \{ timeout: 15_000, env: launcherEnv\(process\.env, realHome\(\)\) \}/);
    expect(source).toContain("start: startForUser,"); // schemeHandler.ts: spawn, detached, no shell, the launcher env (tested above)
    expect(source).toContain('layer.run("steam", ["-shutdown"])');
    expect(source).toContain('layer.run("flatpak", ["run", FLATPAK_ID.steam, "-shutdown"])');
    expect(source).not.toMatch(/(?<!\.)\bexec\(|execSync|shell: true|SIGKILL|"-9"/);
    expect(source).toContain('process.kill(pid, "SIGTERM")');
  });

  it("closes only launchers the page named, from a schema-checked request", async () => {
    const { ApplyRequestSchema, UndoRequestSchema } = await import("../../electron/main/ipc");
    expect(ApplyRequestSchema.safeParse({ fixIds: [], restart: ["steam", "heroic", "lutris"] }).success).toBe(true);
    for (const restart of [["gog"], ["steam; reboot"], ["/usr/bin/steam"], "steam"]) expect(ApplyRequestSchema.safeParse({ fixIds: [], restart }).success, String(restart)).toBe(false);
    expect(ApplyRequestSchema.safeParse({ fixIds: [], restart: [], cmd: "steam" }).success).toBe(false);
    expect(UndoRequestSchema.safeParse({ backupId: "../../etc", restart: [] }).success).toBe(false);
  });
});

describe("HDR screen check (Linux)", () => {
  const source = readFileSync(new URL("../../electron/main/games/hdr.ts", import.meta.url), "utf8");

  it("runs only kscreen-doctor -o: fixed argv, no shell, a timeout, read-only", () => {
    expect(source).toContain("const run = promisify(execFile);");
    expect(source).toMatch(/exec\("kscreen-doctor", \["-o"\], \{ timeout: 5000, /);
    expect(source.match(/(?<!\.)\bexec\(/g)).toHaveLength(1); // the only program it runs
    expect(source).not.toMatch(/execSync|spawn|shell: true|writeFile|--output|\.(?:hdr|mode|enable)\./);
  });
});

describe("privileged Linux setup", () => {
  const setupSource = readFileSync(new URL("../../electron/main/linuxSetup.ts", import.meta.url), "utf8");

  it("runs pkexec through execFile with a fixed script and positional paths", () => {
    expect(setupSource).toMatch(/execFile\("pkexec", \["\/bin\/sh", "-c", script, "ds5-setup", source, RULE_DEST, profile, withProfile \? PROFILE_DEST : ""\]/);
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
// install", "Audio fix follow-ups", "Updater relaunch", "Menu entry refresh",
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

  it("updater relaunch: the installed file, an environment allowlist, the path never in a shell string", () => {
    const source = read("updater.ts");
    expect(source).toContain('execFileSync("systemd-run", ["--user", "--collect", `--unit=ds5-configurator-relaunch-${Date.now()}`, ...setenv, "--", target]');
    expect(source).toContain(`spawn("/bin/sh", ["-c", 'sleep 0.5; exec "$0"', target], { detached: true, stdio: "ignore", env })`);
    expect(source).toContain('spawn(target, [], { detached: true, stdio: "ignore" })');
    expect(source).toContain("const target = this.installedPath;");
    expect(source).not.toMatch(noShell);
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
    const { FixIdsSchema } = await import("../../electron/main/ipc");
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
    expect(mainSource.match(/updater\.downloadAndInstall\(\)/g)).toHaveLength(3);
    expect(mainSource.match(/hold\.whenDone\("install", \(\) => void updater\.downloadAndInstall\(\)\)/g)).toHaveLength(2);
    expect(mainSource).toMatch(/app\.on\("before-quit", \(event\) => \{\n\s+if \(hold\.allowQuit\(event, \(\) => app\.quit\(\)\)\)/);
    expect(mainSource).toContain("} else if (!hold.allowQuit(event, () => app.quit())) {");
    expect(mainSource).not.toMatch(/app\.(relaunch|exit)\(/);
  });
});
