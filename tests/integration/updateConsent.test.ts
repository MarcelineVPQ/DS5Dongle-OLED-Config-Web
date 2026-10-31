// @vitest-environment jsdom
// "Check for updates automatically" keeps its promise: with it off, nothing
// goes online for updates (the update feed, its .sig, the firmware lookups,
// the Development channel preview, Sony's controller firmware info) across
// startup and page visits, until the user presses a check button. With it on,
// behaviour is unchanged. The renderer runs against the main process's real
// rules (firmwareSource.ts, updateFeed.ts, officialFirmware.ts) over a fake
// network.
import { createHash } from "node:crypto";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import { firmwareBytes, firmwareFeed, installFeed, latestFirmware, type FirmwareSourceDeps } from "../../electron/main/firmwareSource";
import { FeedCache, devChannelPreview } from "../../electron/main/updateFeed";
import { OfficialFirmwareSource } from "../../electron/main/officialFirmware";
import type { DesktopApi, UpdateChannel, UpdateState } from "../../src/desktop/api";
import type { UseDs5BridgeResult } from "../../src/hooks/useDs5Bridge";
import { Manifest } from "../../src/update/manifest";
import type { BoardIdentity } from "../../src/update/boardIdentity";
import { useFirmwareUpdate, type FirmwareUpdate } from "../../src/desktop/useUpdates";
import SetupScreen from "../../src/desktop/SetupScreen";
import { DevChannelDialog } from "../../src/desktop/pages/AppSettingsPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  delete window.desktop;
});

// The SHA-256 of the fake download's bytes ([1]).
const SHA = createHash("sha256")
  .update(new Uint8Array([1]))
  .digest("hex");
const feedFor = (ch: UpdateChannel) =>
  Manifest.parse({
    channel: ch,
    app: { version: ch === "dev" ? "9.9.9-dev.1" : "9.9.9", platforms: {} },
    firmware: { version: ch === "dev" ? "v9.9.9-dev.1-oled-edition" : "v9.9.9-oled-edition", uf2: { url: "https://github.com/x/fw.uf2", size: 1, sha256: SHA } },
  });

// The main process, as index.ts wires it, over a fake network.
function fakeMain(automatic: boolean) {
  const net = vi.fn(async (ch: UpdateChannel) => feedFor(ch)); // the feed + .sig
  const sony = vi.fn(async () => new Response("{}"));
  const feed = new FeedCache(net);
  const deps: FirmwareSourceDeps = {
    bundled: () => null,
    manifest: firmwareFeed(
      feed,
      () => automatic,
      () => "stable",
    ),
    freshFeed: installFeed(feed),
    download: vi.fn(async () => new Uint8Array([1])),
  };
  const official = new OfficialFirmwareSource(sony, () => automatic);
  const desktop = {
    latestFirmware: (asked: boolean, board: BoardIdentity) => latestFirmware(deps, board, asked),
    downloadFirmware: (shown: Parameters<DesktopApi["downloadFirmware"]>[0]) => firmwareBytes(deps, shown),
    checkForUpdates: async (): Promise<UpdateState> => {
      await feed.get("stable", 0);
      return { phase: "up-to-date", version: "9.9.9" };
    },
    devChannelPreview: (asked: boolean) => devChannelPreview(feed, automatic, asked),
    officialControllerFirmware: (asked: boolean) => official.lookup(asked),
    usbAccessInstalled: async () => true,
    setupUsbAccess: async () => ({ ok: true }),
    repairWindowsUsb: async () => ({ ok: true }),
  };
  window.desktop = desktop as unknown as DesktopApi;
  // The scheduled checks (index.ts): only with the switch on.
  const scheduled = () => automatic && void desktop.checkForUpdates();
  return { net, sony, scheduled, desktop, deps };
}

const bridge = { client: null, firmwareVersion: "v9.0.0-oled-edition", identity: { boardName: "Pico 2 W", protoMinor: 20 } } as unknown as UseDs5BridgeResult;
const card: { fw: FirmwareUpdate | null } = { fw: null };
function FirmwareCard({ app }: { app: UpdateState }) {
  const fw = useFirmwareUpdate(bridge, app);
  useEffect(() => {
    card.fw = fw;
  });
  return null;
}

async function mount(node: ReturnType<typeof createElement>) {
  container ??= document.createElement("div");
  document.body.append(container);
  root ??= createRoot(container);
  await act(async () => root!.render(node));
}

// Startup, an update-phase round, and visits to the setup screen, the
// Development channel dialog and the Controller info card.
async function startupAndVisits(main: ReturnType<typeof fakeMain>) {
  await mount(createElement(FirmwareCard, { app: { phase: "idle" } }));
  await act(async () => main.scheduled());
  for (const phase of [{ phase: "checking" }, { phase: "up-to-date", version: "9.9.9" }] as UpdateState[]) await mount(createElement(FirmwareCard, { app: phase }));
  await mount(createElement(SetupScreen, { supported: false }));
  await mount(createElement(DevChannelDialog, { automatic: false, onJoin: () => undefined, onCancel: () => undefined }));
  await act(async () => void (await main.desktop.officialControllerFirmware(false)));
}

const button = (text: string) => [...container!.querySelectorAll("button")].find((b) => b.textContent === text)!;

describe("Check for updates automatically", () => {
  it("off: startup and page visits never reach the network", async () => {
    await i18n.changeLanguage("en");
    const main = fakeMain(false);
    await startupAndVisits(main);
    expect(main.net).not.toHaveBeenCalled();
    expect(main.sony).not.toHaveBeenCalled();
    expect(card.fw!.problem).toBe("disabled");
    expect(container!.textContent).toContain("Automatic update checks are off");
  });

  it("off: an explicit check goes online, once per check", async () => {
    await i18n.changeLanguage("en");
    const main = fakeMain(false);
    await startupAndVisits(main);
    // The Development channel dialog's own check button.
    await act(async () => button("Check the development feed").click());
    expect(main.net).toHaveBeenCalledExactlyOnceWith("dev");
    // The setup screen's Check for updates: the app check and the firmware lookup share one fetch.
    await mount(createElement(SetupScreen, { supported: false }));
    await act(async () => button("Check for updates").click());
    expect(main.net.mock.calls).toEqual([["dev"], ["stable"]]);
    // The firmware card's Check now (refreshLatest) right after reuses that fetch.
    const lookup = await act(async () => card.fw!.refreshLatest());
    expect(main.net).toHaveBeenCalledTimes(2);
    expect(lookup.latest).toMatchObject({ version: "v9.9.9-oled-edition", source: "online", channel: "stable", sha256: SHA });
    // Sony's info: the card's Refresh.
    await main.desktop.officialControllerFirmware(true);
    expect(main.sony).toHaveBeenCalledOnce();
  });

  it("on: unchanged, the firmware card gets the published firmware; one check is one feed fetch", async () => {
    const main = fakeMain(true);
    await mount(createElement(FirmwareCard, { app: { phase: "idle" } }));
    expect(main.net).toHaveBeenCalledOnce(); // the lookup at start
    expect(card.fw!.latest).toMatchObject({ version: "v9.9.9-oled-edition", source: "online" });
    expect(card.fw!.available).toBe(true);
    main.net.mockClear();
    // A scheduled check: idle -> checking -> result.
    await act(async () => main.scheduled());
    for (const phase of [{ phase: "checking" }, { phase: "up-to-date", version: "9.9.9" }] as UpdateState[]) await mount(createElement(FirmwareCard, { app: phase }));
    expect(main.net).toHaveBeenCalledOnce();
    await main.desktop.officialControllerFirmware(false);
    expect(main.sony).toHaveBeenCalledOnce();
  });

  // Cache pass batch 1: one fetch per check, and Install downloads from the
  // feed the offer came from (same object, version and channel).
  it("off: Check now, the offer, then Install: one feed fetch, and Install takes the offer's own entry", async () => {
    await i18n.changeLanguage("en");
    const main = fakeMain(false);
    await startupAndVisits(main);
    expect(main.net).not.toHaveBeenCalled();
    const lookup = await act(async () => card.fw!.refreshLatest()); // Check now
    expect(main.net).toHaveBeenCalledExactlyOnceWith("stable");
    const offered = await main.net.mock.results[0].value;
    expect(lookup.latest).toMatchObject({ version: offered.firmware!.version, channel: "stable", sha256: offered.firmware!.uf2.sha256 });
    expect(await main.desktop.downloadFirmware(lookup.latest!)).toMatchObject({ ok: true, version: offered.firmware!.version });
    expect(main.net).toHaveBeenCalledOnce();
    expect(vi.mocked(main.deps.download).mock.calls[0][0]).toBe(offered.firmware!.uf2);
  });
});
