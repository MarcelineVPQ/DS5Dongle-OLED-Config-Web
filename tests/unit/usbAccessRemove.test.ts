// Remove USB access setup (Linux; 2026-10-31 app review S5): the undo of Set up
// USB access deletes only the two files the setup installs, through the same
// pkexec path with a fixed script and the paths as arguments, and runs nothing
// when there is nothing to remove or this isn't Linux.
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeUsbRule, usbAccessFiles, type PkexecResult } from "../../electron/main/linuxSetup";
import { REMOVE_SCRIPT, SANDBOX_PROFILE_PATH, USB_RULE_PATH } from "../../src/desktop/linuxRemoveScript";
import { keyedText } from "../../src/errorText";

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const on = (value: string) => Object.defineProperty(process, "platform", { value });
afterEach(() => Object.defineProperty(process, "platform", platform));

// A pkexec stand-in that records every argv it was asked to run.
function pkexec(result: PkexecResult = { ok: true }) {
  const calls: string[][] = [];
  return { calls, run: async (argv: string[]) => (calls.push(argv), result) };
}
const present = (...paths: string[]) => (path: string) => paths.includes(path);

describe("which files Remove deletes", () => {
  it("only the setup's two files, and only those that are there", () => {
    on("linux");
    expect(usbAccessFiles(present(USB_RULE_PATH, SANDBOX_PROFILE_PATH))).toEqual([USB_RULE_PATH, SANDBOX_PROFILE_PATH]);
    expect(usbAccessFiles(present(USB_RULE_PATH))).toEqual([USB_RULE_PATH]);
    expect(usbAccessFiles(present("/etc/passwd", "/etc/udev/rules.d/99-other.rules"))).toEqual([]);
    on("win32");
    expect(usbAccessFiles(present(USB_RULE_PATH))).toEqual([]);
  });

  it("they are the files Set up USB access installs (the app's own resources)", () => {
    expect(existsSync(new URL(`../../resources/linux/${basename(USB_RULE_PATH)}`, import.meta.url))).toBe(true);
    expect(existsSync(new URL(`../../resources/linux/${basename(SANDBOX_PROFILE_PATH)}.apparmor`, import.meta.url))).toBe(true);
  });

  it("the script deletes only its two arguments", () => {
    // loop: test — the script's rm commands
    expect([...REMOVE_SCRIPT.matchAll(/rm -f (\S+)/g)].map((m) => m[1])).toEqual(['"$2"', '"$1"']);
    expect(REMOVE_SCRIPT).not.toMatch(/\/etc\/|\$[3-9*@]/);
    expect(REMOVE_SCRIPT).toContain('apparmor_parser -R "$2"');
  });
});

describe("removing", () => {
  it("both files: one pkexec run of the fixed script with both paths", async () => {
    on("linux");
    const p = pkexec();
    expect(await removeUsbRule(p.run, present(USB_RULE_PATH, SANDBOX_PROFILE_PATH))).toEqual({ ok: true, message: keyedText("desktop.usbAccess.remove.doneSandbox") });
    expect(p.calls).toEqual([["/bin/sh", "-c", REMOVE_SCRIPT, "ds5-remove", USB_RULE_PATH, SANDBOX_PROFILE_PATH]]);
  });

  it("the rule only: the profile argument stays empty", async () => {
    on("linux");
    const p = pkexec();
    expect(await removeUsbRule(p.run, present(USB_RULE_PATH))).toEqual({ ok: true, message: keyedText("desktop.usbAccess.remove.done") });
    expect(p.calls).toEqual([["/bin/sh", "-c", REMOVE_SCRIPT, "ds5-remove", USB_RULE_PATH, ""]]);
  });

  it("refuses without running anything: nothing installed, or not Linux", async () => {
    on("linux");
    const p = pkexec();
    expect(await removeUsbRule(p.run, present())).toEqual({ ok: true, message: keyedText("desktop.usbAccess.remove.nothing") });
    on("darwin");
    expect(await removeUsbRule(p.run, present(USB_RULE_PATH))).toEqual({ ok: true, message: keyedText("desktop.usbAccess.result.notNeeded") });
    expect(p.calls).toEqual([]);
  });

  it("says what happened when pkexec doesn't run it", async () => {
    on("linux");
    const files = present(USB_RULE_PATH);
    const cancelled = await removeUsbRule(pkexec({ ok: false, reason: "cancelled", code: 126, message: "x" }).run, files);
    expect(cancelled).toEqual({ ok: false, message: keyedText("desktop.usbAccess.result.cancelled") });
    const missing = await removeUsbRule(pkexec({ ok: false, reason: "missing", code: null, message: "x" }).run, files);
    expect(missing).toEqual({ ok: false, message: keyedText("desktop.usbAccess.remove.noPkexec") });
    const failed = await removeUsbRule(pkexec({ ok: false, reason: "failed", code: 1, message: "rm: cannot remove" }).run, files);
    expect(failed).toEqual({ ok: false, message: keyedText("desktop.usbAccess.remove.failed", { detail: "rm: cannot remove" }) });
  });
});
