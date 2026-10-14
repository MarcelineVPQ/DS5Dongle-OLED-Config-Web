// @vitest-environment jsdom
// The profile hook against the simulated dongle (which records every command):
// a profile that fails partway, a slot switch while one goes on, saving while
// another game's profile is on, and a failed save. The never-flash guarantee:
// no save (0xF6 0x02) and no slot switch (0x04, saves) with a game's config in
// RAM, and the normal mode (whose Save to dongle writes RAM to flash) never
// shown over a game's config.
import { act, createElement, useCallback, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import "../../src/i18n";
import { Ds5BridgeClient, type BridgeIdentity } from "../../src/protocol/bridgeClient";
import { DEFAULT_CONFIG, decodeConfigBody, normalizeConfig, type ConfigBody } from "../../src/protocol/config";
import type { UseDs5BridgeResult } from "../../src/hooks/useDs5Bridge";
import type { LibraryFile, ProfileSettings } from "../../src/desktop/games/library";
import { useGameProfile, type GameProfileState } from "../../src/desktop/library/useGameProfile";
import { FakeDongle } from "../support/fakeDongle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const A = "steam-1a2b3c4d:steam:100";
const B = "steam-1a2b3c4d:steam:200";
const NORMAL: ConfigBody = { ...DEFAULT_CONFIG, hapticsGain: 1.5, speakerVolume: -6 };
const profileA: ProfileSettings = { format: 2, hapticsGain: 4, speakerVolume: 6, buttonLayout: "l-a" };
const profileB: ProfileSettings = { format: 2, hapticsGain: 3 };
const swapped = Array.from({ length: 16 }, (_, i) => (i === 0 ? 1 : i === 1 ? 0 : i));

function gate() {
  let open = () => undefined as void;
  const wait = new Promise<void>((r) => (open = r));
  return { wait, open };
}

// The main process's library (libraryStore.ts), in memory.
function fakeDesktop(start: LibraryFile, running: string | null) {
  let lib: LibraryFile = structuredClone(start);
  let onRunning: ((key: string | null) => void) | null = null;
  const d = {
    calls: [] as string[],
    failProfile: false,
    restoreGate: null as Promise<void> | null,
    failRestore: false,
    lib: () => lib,
    setRunning: (key: string | null) => onRunning?.(key),
    api: {
      libraryGet: async () => structuredClone(lib),
      gamesRunning: async () => running,
      onRunningGame: (cb: (key: string | null) => void) => {
        onRunning = cb;
        return () => undefined;
      },
      librarySetRestore: async (restore: LibraryFile["restore"] | null) => {
        d.calls.push("restore");
        const wait = d.restoreGate; // both once
        d.restoreGate = null;
        if (wait) await wait;
        if (d.failRestore) {
          d.failRestore = false;
          throw new Error("disk full");
        }
        lib = { ...lib, restore: restore ?? undefined };
        if (!restore) delete lib.restore;
        return structuredClone(lib);
      },
      librarySetProfile: async (u: { gameKey: string; title: string; settings: ProfileSettings }) => {
        d.calls.push(`profile:${u.gameKey}`);
        if (d.failProfile) throw new Error("disk full");
        lib = { ...lib, games: { ...lib.games, [u.gameKey]: { title: u.title, profile: { settings: u.settings, updated: Date.now() } } } };
        return structuredClone(lib);
      },
      librarySetLayout: async (l: { id: string; name: string; table: number[]; extra?: number[] }) => {
        d.calls.push(`layout:${l.id}`);
        lib = { ...lib, layouts: { ...lib.layouts, [l.id]: { name: l.name, table: l.table, updated: Date.now() } } };
        return structuredClone(lib);
      },
    },
  };
  return d;
}

// What the bridge hook does for the profile hook: its config copy, and
// applyBody (RAM only) resolving false when the dongle refuses.
function useFakeBridge(client: Ds5BridgeClient, identity: BridgeIdentity, initial: ConfigBody, refuse: () => boolean): UseDs5BridgeResult {
  const [config, setConfig] = useState(initial);
  const [operation, setOperation] = useState<"applying" | null>(null);
  const applyBody = useCallback(
    async (body: ConfigBody) => {
      setOperation("applying");
      try {
        if (refuse()) throw new Error("refused");
        const n = normalizeConfig(body);
        await client.applyConfig(n);
        setConfig(n);
        return true;
      } catch {
        return false;
      } finally {
        setOperation(null);
      }
    },
    [client, refuse],
  );
  return { isConnected: true, client, identity, config, operation, applyBody } as unknown as UseDs5BridgeResult;
}

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

async function setup(o: { running?: string | null; library?: Partial<LibraryFile> } = {}) {
  const dongle = new FakeDongle({ protoMinor: 10 });
  const client = new Ds5BridgeClient(dongle);
  await client.checkCompatible();
  await client.applyConfig(NORMAL);
  await client.saveToFlash();
  dongle.sets = [];
  const identity = await client.identity();
  const initial = normalizeConfig(await client.readConfig());
  const library: LibraryFile = {
    version: 1,
    games: { [A]: { title: "Game A", profile: { settings: profileA, updated: 1 } }, [B]: { title: "Game B", profile: { settings: profileB, updated: 1 } } },
    layouts: { "l-a": { name: "Game A", table: swapped, updated: 1 } },
    ...o.library,
  };
  const desktop = fakeDesktop(library, o.running === undefined ? A : o.running);
  (window as unknown as { desktop: unknown }).desktop = desktop.api;
  const refusals = { from: Infinity, count: 0 }; // applyBody calls from this one on are refused
  const refuse = () => ++refusals.count >= refusals.from;
  let latest: GameProfileState | null = null;
  const seen = (p: GameProfileState) => (latest = p);
  function Probe() {
    const bridge = useFakeBridge(client, identity, initial, refuse);
    const profiles = useGameProfile(bridge, false);
    useEffect(() => void seen(profiles));
    return null;
  }
  const container = document.createElement("div");
  const start = async () => {
    root = createRoot(container);
    await act(async () => root!.render(createElement(Probe)));
  };
  const profiles = () => latest!;
  const flashWrites = () => dongle.sets.filter((p) => p[0] === 0x02 || p[0] === 0x04);
  // The normal mode shows Save to dongle: never while RAM holds anything but the normal values.
  const saveToDongleWithGameValues = () => !profiles().active && decodeConfigBody(dongle.config).hapticsGain !== NORMAL.hapticsGain;
  return { dongle, client, desktop, refusals, start, profiles, flashWrites, saveToDongleWithGameValues };
}

async function until(cond: () => boolean, what: string) {
  for (let i = 0; i < 300; i++) {
    if (cond()) return;
    await act(async () => new Promise((r) => setTimeout(r, 10)));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const ram = (dongle: FakeDongle) => decodeConfigBody(dongle.config);

describe("game profile hook (never-flash guarantee)", () => {
  it("parts write fails mid-apply: no 0xF6 0x02, normal values back, Save to dongle unreachable with profile values", async () => {
    const s = await setup();
    s.client.applyRemapTemporary = async () => {
      throw new Error("remap refused");
    };
    await s.start();
    await until(() => !!s.profiles().error, "the apply to fail");
    expect(s.flashWrites()).toEqual([]);
    expect(ram(s.dongle).hapticsGain).toBe(NORMAL.hapticsGain);
    expect(s.profiles().active).toBeNull();
    expect(s.saveToDongleWithGameValues()).toBe(false);
    expect(s.profiles().error).toContain("Game A");
  });

  it("parts write fails and the normal values can't go back: the profile mode stays", async () => {
    const s = await setup();
    s.client.applyRemapTemporary = async () => {
      s.refusals.from = s.refusals.count + 1; // the dongle refuses from now on
      throw new Error("remap refused");
    };
    await s.start();
    await until(() => !!s.profiles().error, "the apply to fail");
    expect(ram(s.dongle).hapticsGain).toBe(profileA.hapticsGain); // the game's config is still on
    expect(s.profiles().active?.gameKey).toBe(A);
    expect(s.saveToDongleWithGameValues()).toBe(false);
    expect(s.flashWrites()).toEqual([]);
  });

  it("switchSlot during apply waits for it and switches with the normal values in RAM", async () => {
    const s = await setup();
    const parts = gate();
    const remap = s.client.applyRemapTemporary.bind(s.client);
    s.client.applyRemapTemporary = async (t) => {
      await parts.wait;
      return remap(t);
    };
    const switchSlot = s.client.switchSlot.bind(s.client);
    const atSwitch: number[] = [];
    s.client.switchSlot = async (slot) => {
      atSwitch.push(ram(s.dongle).hapticsGain);
      return switchSlot(slot);
    };
    await s.start();
    await until(() => ram(s.dongle).hapticsGain === profileA.hapticsGain, "the game's config to land");
    let switched = false;
    void s
      .profiles()
      .switchSlot(1)
      .then(() => (switched = true));
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(atSwitch).toEqual([]); // still waiting for the apply
    parts.open();
    await until(() => switched, "the slot switch");
    expect(atSwitch).toEqual([NORMAL.hapticsGain]);
    expect(decodeConfigBody(s.dongle.flashConfig).hapticsGain).toBe(NORMAL.hapticsGain);
    expect(s.dongle.sets.some((p) => p[0] === 0x02)).toBe(false);
    // The profile goes on again after.
    await until(() => s.profiles().active?.gameKey === A && ram(s.dongle).hapticsGain === profileA.hapticsGain, "the profile to follow");
  });

  it("save while editing a non-active profile targets the edited one, never the active game's", async () => {
    const s = await setup();
    await s.start();
    await until(() => s.profiles().active?.gameKey === A, "A's profile on");
    // B's profile is slow to go on: saving meanwhile mustn't touch A's.
    const restore = gate();
    s.desktop.restoreGate = restore.wait;
    act(() => s.profiles().startEditing(B, "Game B"));
    let saved: boolean | null = null;
    await act(async () => {
      saved = await s.profiles().saveToProfile();
    });
    expect(saved).toBe(false);
    expect(s.profiles().error).toContain("Game B");
    expect(s.desktop.calls.filter((c) => c.startsWith("profile:"))).toEqual([]);
    restore.open();
    await until(() => s.profiles().active?.gameKey === B, "B's profile on");
    await act(async () => {
      saved = await s.profiles().saveToProfile();
    });
    expect(saved).toBe(true);
    expect(s.desktop.calls.filter((c) => c.startsWith("profile:"))).toEqual([`profile:${B}`]);
    expect(s.desktop.lib().games[A].profile?.settings).toEqual(profileA);
    expect(s.profiles().error).toBeNull();
  });

  it("saveToProfile failure surfaces and leaves no orphan layout", async () => {
    const s = await setup({ library: { games: { [B]: { title: "Game B", profile: { settings: profileB, updated: 1 } } }, layouts: {} }, running: B });
    await s.start();
    await until(() => s.profiles().active?.gameKey === B, "B's profile on");
    act(() => s.profiles().setButtonsDraft({ table: swapped, revert: () => undefined }));
    s.desktop.failProfile = true;
    let saved: boolean | null = null;
    await act(async () => {
      saved = await s.profiles().saveToProfile(); // never rejects
    });
    expect(saved).toBe(false);
    expect(s.profiles().error).toContain("disk full");
    expect(s.desktop.lib().layouts).toEqual({});
    expect(s.desktop.calls.some((c) => c.startsWith("layout:"))).toBe(false);
    // Saved once it works: the profile first, then its new layout.
    s.desktop.failProfile = false;
    await act(async () => {
      saved = await s.profiles().saveToProfile();
    });
    expect(saved).toBe(true);
    const id = s.desktop.lib().games[B].profile?.settings.buttonLayout;
    expect(id).toBeTruthy();
    expect(s.desktop.calls.slice(-2)).toEqual([`profile:${B}`, `layout:${id}`]);
  });

  // Error pass: these used to be only logged (console.error), with nothing on screen.
  it("the restore point can't be saved: the profile doesn't go on, and the page says so", async () => {
    const s = await setup({ running: A });
    s.desktop.failRestore = true;
    await s.start();
    await until(() => !!s.profiles().error, "the failure to be shown");
    expect(s.profiles().error).toContain("Game A");
    expect(s.profiles().error).toContain("disk full");
    expect(ram(s.dongle).hapticsGain).toBe(NORMAL.hapticsGain);
    expect(s.flashWrites()).toEqual([]);
  });

  it("the normal settings can't be put back after the game: the page says so", async () => {
    const s = await setup({ running: null, library: { restore: { gameKey: A, settings: { format: 2, hapticsGain: NORMAL.hapticsGain } } } });
    s.desktop.failRestore = true;
    await s.start();
    await until(() => !!s.profiles().error, "the failure to be shown");
    expect(s.profiles().error).toMatch(/normal settings didn't go back/);
    expect(s.profiles().error).toContain("disk full");
  });

  it("a step dropped while another switch runs is retried", async () => {
    const s = await setup({ running: A });
    const restore = gate();
    s.desktop.restoreGate = restore.wait;
    s.desktop.failRestore = true; // A's switch fails before anything reaches the dongle
    await s.start();
    await until(() => s.desktop.calls.includes("restore"), "A's switch to start");
    act(() => s.desktop.setRunning(B)); // decided while A's switch runs: dropped then
    restore.open();
    await until(() => s.profiles().active?.gameKey === B, "B's profile on");
    expect(ram(s.dongle).hapticsGain).toBe(profileB.hapticsGain);
    expect(s.flashWrites()).toEqual([]);
  });
});
