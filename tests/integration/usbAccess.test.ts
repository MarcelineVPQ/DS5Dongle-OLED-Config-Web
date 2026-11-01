// @vitest-environment jsdom
// Set up USB access (Linux) is a button only while there's something to
// install: once the rule is in place the row says "✓ Installed" and offers
// no greyed-out button (no controls that do nothing, owner dev.15). Its undo,
// Remove USB access setup (2026-10-31 app review S5), is on the row only (the
// Pico 2 W page) and says which files go and the exact script before it runs.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import UsbAccessSetup from "../../src/desktop/UsbAccessSetup";
import { REMOVE_SCRIPT, SANDBOX_PROFILE_PATH, USB_RULE_PATH } from "../../src/desktop/linuxRemoveScript";
import { keyedText } from "../../src/errorText";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

let removes = 0;
async function render(installed: boolean, variant?: "row" | "compact" | "inline", files: string[] = []) {
  await i18n.changeLanguage("en");
  removes = 0;
  vi.stubGlobal("desktop", {
    platform: "linux",
    usbAccessInstalled: () => Promise.resolve(installed),
    usbAccessFiles: () => Promise.resolve(files),
    setupUsbAccess: () => Promise.resolve({ ok: true, message: "desktop.usbAccess.result.done" }),
    removeUsbAccess: () => (removes++, Promise.resolve({ ok: true, message: keyedText("desktop.usbAccess.remove.done") })),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(UsbAccessSetup, { variant })));
  return container;
}

describe("Set up USB access", () => {
  it("installed: the status only, no button", async () => {
    const el = await render(true);
    expect(el.querySelector("button")).toBeNull();
    expect(el.textContent).toContain(`✓ ${i18n.t("desktop.usbAccess.installed")}`);
    for (const variant of ["compact", "inline"] as const) expect((await render(true, variant)).querySelector("button")).toBeNull();
  });

  it("missing: the button, enabled; once done, the status replaces it", async () => {
    const el = await render(false);
    const button = el.querySelector("button")!;
    expect(button.textContent).toBe(i18n.t("desktop.usbAccess.button"));
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(el.querySelector("button")).toBeNull();
    expect(el.textContent).toContain(`✓ ${i18n.t("desktop.usbAccess.installed")}`);
  });
});

const named = (el: HTMLElement, label: string) => [...el.querySelectorAll("button")].find((b) => b.textContent === label);

describe("Remove USB access setup", () => {
  it("says which files go and shows the exact script first; Cancel runs nothing", async () => {
    const el = await render(true, "row", [USB_RULE_PATH, SANDBOX_PROFILE_PATH]);
    act(() => named(el, i18n.t("desktop.usbAccess.remove.button"))!.click());
    expect(el.textContent).toContain(USB_RULE_PATH);
    expect(el.textContent).toContain(SANDBOX_PROFILE_PATH);
    expect(el.textContent).toContain(i18n.t("desktop.usbAccess.remove.afterSandbox"));
    expect(el.querySelector("pre")!.textContent).toBe(REMOVE_SCRIPT);
    act(() => named(el, i18n.t("desktop.common.cancel"))!.click());
    expect(el.querySelector("pre")).toBeNull();
    expect(removes).toBe(0);
  });

  it("only Remove runs it; then the row offers Set up USB access again", async () => {
    const el = await render(true, "row", [USB_RULE_PATH]);
    act(() => named(el, i18n.t("desktop.usbAccess.remove.button"))!.click());
    expect(el.textContent).toContain(i18n.t("desktop.usbAccess.remove.after"));
    await act(async () => named(el, i18n.t("desktop.usbAccess.remove.run"))!.click());
    expect(removes).toBe(1);
    expect(el.textContent).toContain(i18n.t("desktop.usbAccess.remove.done"));
    expect(named(el, i18n.t("desktop.usbAccess.button"))).toBeDefined();
    expect(named(el, i18n.t("desktop.usbAccess.remove.button"))).toBeUndefined();
  });

  it("nothing installed: no Remove; the setup screen and Games never offer it", async () => {
    expect(named(await render(false, "row", []), i18n.t("desktop.usbAccess.remove.button"))).toBeUndefined();
    // loop: test — the two other places
    for (const variant of ["compact", "inline"] as const) expect(named(await render(true, variant, [USB_RULE_PATH]), i18n.t("desktop.usbAccess.remove.button"))).toBeUndefined();
  });
});
