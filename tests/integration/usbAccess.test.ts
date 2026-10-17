// @vitest-environment jsdom
// Set up USB access (Linux) is a button only while there's something to
// install: once the rule is in place the row says "✓ Installed" and offers
// no greyed-out button (no controls that do nothing, owner dev.15).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import UsbAccessSetup from "../../src/desktop/UsbAccessSetup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

async function render(installed: boolean, variant?: "row" | "compact" | "inline") {
  await i18n.changeLanguage("en");
  vi.stubGlobal("desktop", { platform: "linux", usbAccessInstalled: () => Promise.resolve(installed), setupUsbAccess: () => Promise.resolve({ ok: true, message: "desktop.usbAccess.result.done" }) });
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
