// @vitest-environment jsdom
// Firmware is offered only to the board it is built for (DESIGN_FIRMWARE_IDENTITY
// step 4, review S4): schema 2's firmwares[] by board / chip / flash / persona,
// today's schema 1 feed only to a Pico 2 W, the old firmware's board by its
// name; firmware Back to stable only to newest_stable.
import { createHash } from "node:crypto";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { firmwareBytes, latestFirmware, type FirmwareSourceDeps } from "../../electron/main/firmwareSource";
import { boardIdentity, feedImages, PICO2_W, type BoardIdentity } from "../../src/update/boardIdentity";
import { Manifest } from "../../src/update/manifest";
import type { DesktopApi, LatestFirmware } from "../../src/desktop/api";
import type { UseDs5BridgeResult } from "../../src/hooks/useDs5Bridge";
import { firmwareOffer, useFirmwareUpdate, type FirmwareUpdate } from "../../src/desktop/useUpdates";
import FirmwarePage from "../../src/desktop/pages/FirmwarePage";
import i18n from "../../src/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MB = 1024 * 1024;
const sha = (b: number) =>
  createHash("sha256")
    .update(new Uint8Array([b]))
    .digest("hex");
const uf2 = (b: number) => ({ url: `https://github.com/x/fw-${b}.uf2`, size: 1, sha256: sha(b) });
const PICO_W = boardIdentity({ boardName: "Pico W", protoMinor: 20 })!;
const WAVESHARE: BoardIdentity = { board: "waveshare_rp2350b_plus_w", chip: "rp2350b", flashBytes: 16 * MB, persona: "ds5" };

const image = (version: string, board: string, chip: string, b: number, extra: object = {}) => ({
  version,
  board,
  chip,
  flash_min: 4 * MB,
  personas: ["ds5"],
  displays: ["none", "pico_oled_1_3"],
  uf2: uf2(b),
  ...extra,
});
// Schema 2: the legacy `firmware` (fw-1) is for installed apps; new apps read firmwares[].
const v2 = (firmwares: object[]) =>
  Manifest.parse({
    schema: 2,
    channel: "stable",
    issued_at: "2026-11-02T18:04:11Z",
    newest_stable: "0.9.5",
    app: { version: "0.9.5", platforms: {} },
    firmware: { version: "v0.9.5-oled-edition", uf2: uf2(1) },
    firmwares,
  });
// Schema 1: today's feeds, one `firmware`.
const v1 = Manifest.parse({ channel: "stable", app: { version: "0.9.5", platforms: {} }, firmware: { version: "v0.9.5-oled-edition", uf2: uf2(1) } });

const deps = (manifest: Manifest, bundled: string | null = null): FirmwareSourceDeps => ({
  bundled: () => (bundled ? { version: bundled, path: "/nowhere", sha256: sha(9) } : null),
  manifest: async () => ({ manifest, problem: null, channel: "stable" }),
  freshFeed: async () => manifest,
  download: vi.fn(async (u: { url: string }) => new Uint8Array([Number(/fw-(\d+)/.exec(u.url)![1])])),
});

describe("the board, on firmware without its own identity report (design §1.1)", () => {
  it("is told by its name; anything else is unknown", () => {
    expect(boardIdentity({ boardName: "Pico 2 W", protoMinor: 20 })).toEqual(PICO2_W);
    expect(boardIdentity({ boardName: null, protoMinor: 6 })).toEqual(PICO2_W); // before 1.7: every image was the Pico 2 W's
    expect(PICO_W).toMatchObject({ board: "pico_w", chip: "rp2040" });
    expect(boardIdentity({ boardName: "RP2350B-Plus-W", protoMinor: 20 })).toBeNull();
    expect(boardIdentity({ boardName: null, protoMinor: 20 })).toBeNull();
    expect(boardIdentity(null)).toBeNull();
  });
});

describe("which image main offers", () => {
  it("schema 2: only the entry built for the board, and Install takes only that entry", async () => {
    const d = deps(v2([image("v0.9.5-oled-edition", "pico2_w", "rp2350a", 2), image("v0.9.6-oled-edition", "waveshare_rp2350b_plus_w", "rp2350b", 3)]));
    const pico = (await latestFirmware(d, PICO2_W)).latest!;
    expect(pico).toMatchObject({ version: "v0.9.5-oled-edition", source: "online", board: "pico2_w", sha256: sha(2), newestStable: "0.9.5" });
    expect(await firmwareBytes(d, pico)).toEqual({ ok: true, version: "v0.9.5-oled-edition", bytes: new Uint8Array([2]) });
    expect((await latestFirmware(d, WAVESHARE)).latest).toMatchObject({ version: "v0.9.6-oled-edition", board: "waveshare_rp2350b_plus_w", sha256: sha(3) });
    // The Pico W: nothing built for it, never the Pico 2 W's image.
    expect(await latestFirmware(d, PICO_W)).toEqual({ latest: null, problem: "noBoardImage" });
    // An entry shown for one board is never installed as another's.
    expect(await firmwareBytes(d, { ...pico, board: "pico_w" })).toEqual({ ok: false, reason: "changed" });
  });

  it("chip, flash size and persona must fit too", async () => {
    const feed = v2([
      image("v0.9.6-oled-edition", "pico2_w", "rp2350a", 4, { flash_min: 16 * MB }),
      image("v0.9.7-oled-edition", "pico2_w", "rp2350a", 5, { personas: ["ds4"] }),
      image("v0.9.8-oled-edition", "pico2_w", "rp2350b", 6),
      image("v0.9.5-oled-edition", "pico2_w", "rp2350a", 2),
    ]);
    expect((await latestFirmware(deps(feed), PICO2_W)).latest).toMatchObject({ version: "v0.9.5-oled-edition", sha256: sha(2) });
  });

  it("schema 1 (today's feeds): the Pico 2 W is offered `firmware` as before; another board nothing, the bundled build included", async () => {
    expect(feedImages(v1)).toEqual([expect.objectContaining({ board: "pico2_w", chip: "rp2350a", flash_min: 4 * MB, personas: ["ds5"] })]);
    expect((await latestFirmware(deps(v1), PICO2_W)).latest).toMatchObject({ version: "v0.9.5-oled-edition", source: "online", board: "pico2_w", sha256: sha(1) });
    expect(await latestFirmware(deps(v1, "v0.9.6-oled-edition"), PICO_W)).toEqual({ latest: null, problem: "noBoardImage" });
    expect((await latestFirmware(deps(v1, "v0.9.6-oled-edition"), PICO2_W)).latest).toMatchObject({ version: "v0.9.6-oled-edition", source: "bundled", board: "pico2_w" });
  });
});

describe("firmware Back to stable", () => {
  const stable = (version: string, newestStable?: string): LatestFirmware => ({ version, source: "online", channel: "stable", sha256: sha(1), board: "pico2_w", newestStable });
  const dev = "v0.9.6-dev.2-oled-edition";

  it("offers only newest_stable (schema 1 feeds have none: as before), and says when it can't", () => {
    expect(firmwareOffer(stable("v0.9.5-oled-edition", "0.9.5"), dev)).toEqual({ available: true, backToStable: true, stableMismatch: false });
    expect(firmwareOffer(stable("v0.9.4-oled-edition", "0.9.5"), dev)).toEqual({ available: false, backToStable: false, stableMismatch: true });
    expect(firmwareOffer(stable("v0.9.4-oled-edition"), dev)).toEqual({ available: true, backToStable: true, stableMismatch: false });
    expect(firmwareOffer(stable("v0.9.5-oled-edition", "0.9.5"), "v0.9.4-oled-edition")).toEqual({ available: true, backToStable: false, stableMismatch: false });
    expect(firmwareOffer(stable("v0.9.4-oled-edition", "0.9.5"), "v0.9.4-oled-edition")).toEqual({ available: false, backToStable: false, stableMismatch: false });
  });

  it('the Firmware section gives the reason instead of "Up to date"', async () => {
    await i18n.changeLanguage("en");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const fw = {
      latest: stable("v0.9.4-oled-edition", "0.9.5"),
      problem: "stableMismatch",
      available: false,
      backToStable: false,
      state: { phase: "idle" },
      start: async () => undefined,
      refreshLatest: async () => ({ latest: stable("v0.9.4-oled-edition", "0.9.5"), problem: null }),
      dismiss: () => undefined,
    } as FirmwareUpdate;
    const bridge = { client: null, firmwareVersion: dev, identity: null } as unknown as UseDs5BridgeResult;
    window.desktop = { checkForUpdates: async () => ({ phase: "idle" }) } as unknown as DesktopApi;
    await act(async () => root.render(createElement(FirmwarePage, { bridge, fw })));
    const words = "doesn't match the newest stable release yet";
    expect(container.textContent).toContain(words);
    expect(container.textContent).not.toContain("Up to date");
    // Check for updates says the same, not "you're up to date".
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Check for updates")!.click());
    expect(container.textContent!.split(words).length - 1).toBe(2);
    expect(container.textContent).not.toContain("you're up to date");
    act(() => root.unmount());
    container.remove();
    delete window.desktop;
  });
});

// The firmware card's hook (S4: a Pico W was offered the Pico 2 W image).
describe("the firmware card", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    delete window.desktop;
  });

  async function card(identity: object, answer: LatestFirmware, installed = "v0.9.4-oled-edition") {
    const asked: BoardIdentity[] = [];
    window.desktop = {
      latestFirmware: async (_asked: boolean, board: BoardIdentity) => {
        asked.push(board);
        return { latest: answer, problem: null };
      },
    } as unknown as DesktopApi;
    const bridge = { client: null, firmwareVersion: installed, identity } as unknown as UseDs5BridgeResult;
    const out: { fw: FirmwareUpdate | null } = { fw: null };
    function Card() {
      const fw = useFirmwareUpdate(bridge, { phase: "idle" });
      useEffect(() => {
        out.fw = fw;
      });
      return null;
    }
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(createElement(Card)));
    return { asked, fw: () => out.fw! };
  }
  const pico2wImage: LatestFirmware = { version: "v0.9.5-oled-edition", source: "online", channel: "stable", sha256: sha(1), board: "pico2_w" };

  it("a Pico 2 W is offered its image", async () => {
    const c = await card({ boardName: "Pico 2 W", protoMinor: 20 }, pico2wImage);
    expect(c.asked).toEqual([PICO2_W]);
    expect(c.fw()).toMatchObject({ latest: pico2wImage, available: true });
  });

  it("a Pico W is refused the Pico 2 W image, with its own reason", async () => {
    const c = await card({ boardName: "Pico W", protoMinor: 20 }, pico2wImage);
    expect(c.asked.map((b) => b.board)).toEqual(["pico_w"]);
    expect(c.fw()).toMatchObject({ latest: null, problem: "noBoardImage", available: false });
  });

  it("a development build on Stable whose feed firmware isn't newest_stable: the reason, nothing offered", async () => {
    const c = await card({ boardName: "Pico 2 W", protoMinor: 20 }, { ...pico2wImage, version: "v0.9.4-oled-edition", newestStable: "0.9.5" }, "v0.9.6-dev.2-oled-edition");
    expect(c.fw()).toMatchObject({ problem: "stableMismatch", available: false, backToStable: false });
  });

  it("an unknown board: no lookup, the same refusal", async () => {
    const c = await card({ boardName: "RP2350B-Plus-W", protoMinor: 20 }, pico2wImage);
    expect(c.asked).toEqual([]);
    expect(c.fw()).toMatchObject({ latest: null, problem: "noBoardImage", available: false });
    expect(await c.fw().refreshLatest()).toEqual({ latest: null, problem: "noBoardImage" });
    expect(c.asked).toEqual([]);
  });
});
