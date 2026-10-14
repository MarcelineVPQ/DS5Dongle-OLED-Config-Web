// Linux: the controller's hardware volume and mic gain (ALSA) restored low at
// boot (owner's machine: Headset Capture Volume 0, PCM Playback Volume 80).
// The Games system check finds them below full, Apply sets them to full and
// Undo puts the old values back. A fake amixer layer: no real card is touched.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FixIdsSchema } from "../../electron/main/ipc";
import type { LauncherControl } from "../../electron/main/games/processes";
import { GamesService } from "../../electron/main/games/service";
import { findDualSenseAlsaCards, lowMixerControls, parseAmixerContents, type MixerLayer, type MixerName } from "../../electron/main/games/system";
import { NO_HDR_SYSTEM } from "../../src/desktop/games/hdrSetup";
import { asLinux } from "../support/platform";

asLinux();

// `amixer -c 6 contents` on the owner's machine (2026-10-13), C locale.
const contents = (v: Record<string, number>) => `numid=7,iface=CARD,name='Headphone Jack'
  ; type=BOOLEAN,access=r-------,values=1
  : values=on
numid=3,iface=MIXER,name='PCM Playback Switch'
  ; type=BOOLEAN,access=rw------,values=1
  : values=${v["PCM Playback Switch"] ? "on" : "off"}
numid=4,iface=MIXER,name='PCM Playback Volume'
  ; type=INTEGER,access=rw---R--,values=1,min=0,max=100,step=0
  : values=${v["PCM Playback Volume"]}
  | dBminmax-min=-100.00dB,max=0.00dB
numid=5,iface=MIXER,name='Headset Capture Switch'
  ; type=BOOLEAN,access=rw------,values=1
  : values=${v["Headset Capture Switch"] ? "on" : "off"}
numid=6,iface=MIXER,name='Headset Capture Volume'
  ; type=INTEGER,access=rw---R--,values=1,min=0,max=101,step=0
  : values=${v["Headset Capture Volume"]}
  | dBminmax-min=0.00dB,max=48.00dB
numid=1,iface=PCM,name='Playback Channel Map'
  ; type=INTEGER,access=r--v-R--,values=4,min=0,max=36,step=0
  : values=0,0,0,0
`;

const RESTORED = { "PCM Playback Switch": 1, "PCM Playback Volume": 80, "Headset Capture Switch": 1, "Headset Capture Volume": 0 };

// One controller on card 6, USB port 3-3; `sets` records every write.
function fakeMixer(start: Record<string, number> | null = { ...RESTORED }) {
  const state = start;
  const sets: Array<[number, MixerName, number]> = [];
  const layer: MixerLayer = {
    cards: () => (state ? [{ card: 6, key: "3-3" }] : []),
    contents: async (card) => {
      if (!state || card !== 6) throw new Error("amixer: Invalid card number");
      return contents(state);
    },
    set: async (card, name, value) => {
      if (!state || card !== 6) throw new Error("amixer: Invalid card number");
      sets.push([card, name, value]);
      state[name] = value;
    },
  };
  return { layer, state, sets };
}

let home: string;
const control: LauncherControl = { running: () => new Set(), gameRunning: () => false, plan: () => null, close: async () => "closed", reopen: async () => true };
const service = (mixer?: MixerLayer) =>
  new GamesService({
    userData: join(home, "userdata"),
    allowed: () => true,
    fetchManifest: () => Promise.reject(new Error("offline")),
    download: () => Promise.reject(new Error("offline")),
    onProtonProgress: () => undefined,
    notDetected: () => new Set(),
    hdrMarked: () => new Set(),
    launchers: control,
    probes: { audioCards: async () => [], hdr: async () => NO_HDR_SYSTEM, mixer },
  });
const volumeFix = async (s: GamesService) => (await s.scan()).system.fixes.find((f) => f.kind === "audio-volume");

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "ds5-volume-")));
  process.env.HOME = home;
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("reading the controller's ALSA controls", () => {
  it("parses amixer's contents: volumes with their maximum, switches as 1/0", () => {
    const controls = parseAmixerContents(contents(RESTORED));
    expect(controls).toContainEqual({ name: "PCM Playback Volume", value: 80, max: 100 });
    expect(controls).toContainEqual({ name: "Headset Capture Volume", value: 0, max: 101 });
    expect(controls).toContainEqual({ name: "PCM Playback Switch", value: 1, max: 1 });
  });

  it("only the four target controls below full count as low", () => {
    expect(lowMixerControls(parseAmixerContents(contents(RESTORED)))).toEqual([
      { name: "PCM Playback Volume", from: 80, to: 100 },
      { name: "Headset Capture Volume", from: 0, to: 101 },
    ]);
    expect(lowMixerControls(parseAmixerContents(contents({ ...RESTORED, "Headset Capture Switch": 0 })))).toContainEqual({ name: "Headset Capture Switch", from: 0, to: 1 });
    expect(lowMixerControls(parseAmixerContents(contents({ "PCM Playback Switch": 1, "PCM Playback Volume": 100, "Headset Capture Switch": 1, "Headset Capture Volume": 101 })))).toEqual([]);
  });

  // sysfs names hold ":" (3-3:1.0), which Windows file names can't.
  it.skipIf(process.platform === "win32")("finds the DualSense card by Sony's USB id, keyed by its USB port", () => {
    const sys = join(home, "sys"),
      proc = join(home, "proc");
    const card = (n: number, usbid: string | null, port: string) => {
      mkdirSync(join(sys, "devices", port), { recursive: true });
      mkdirSync(join(sys, "sound", `card${n}`), { recursive: true });
      symlinkSync(join(sys, "devices", port), join(sys, "sound", `card${n}`, "device"));
      mkdirSync(join(proc, `card${n}`), { recursive: true });
      if (usbid) writeFileSync(join(proc, `card${n}`, "usbid"), `${usbid}\n`);
    };
    card(0, "2e8a:000a", "1-1:1.0"); // another USB card
    card(4, null, "0000:00:01.1"); // HDA: no usbid
    card(6, "054c:0ce6", "3-3:1.0"); // DualSense
    card(7, "054C:0DF2", "3-4:1.0"); // DualSense Edge
    mkdirSync(join(sys, "sound", "controlC6"), { recursive: true });
    expect(findDualSenseAlsaCards(join(sys, "sound"), proc)).toEqual([
      { card: 6, key: "3-3" },
      { card: 7, key: "3-4" },
    ]);
    expect(findDualSenseAlsaCards(join(home, "nothing"), proc)).toEqual([]);
  });
});

describe("the controller volume check (Games → This computer)", () => {
  it("restored low: offers one recommended fix with an id the IPC accepts", async () => {
    const fix = await volumeFix(service(fakeMixer().layer));
    expect(fix).toMatchObject({ launcher: "system", recommended: true, files: [], label: { key: "label.audioVolume" }, why: { key: "why.audioVolume" } });
    expect(FixIdsSchema.safeParse([fix!.id]).success).toBe(true);
  });

  it("already full, no controller, or no amixer layer (Windows, macOS, tests): no fix", async () => {
    expect(await volumeFix(service(fakeMixer({ "PCM Playback Switch": 1, "PCM Playback Volume": 100, "Headset Capture Switch": 1, "Headset Capture Volume": 101 }).layer))).toBeUndefined();
    expect(await volumeFix(service(fakeMixer(null).layer))).toBeUndefined();
    expect(await volumeFix(service(undefined))).toBeUndefined();
  });

  it("Apply sets them to full; Undo puts the old values back", async () => {
    const m = fakeMixer();
    const s = service(m.layer);
    const fix = (await volumeFix(s))!;
    const r = await s.apply([fix.id], []);
    expect(r.applied).toEqual([{ id: fix.id, ok: true, message: undefined }]);
    expect(m.sets).toEqual([
      [6, "PCM Playback Volume", 100],
      [6, "Headset Capture Volume", 101],
    ]);
    expect(await volumeFix(s)).toBeUndefined();
    // In the change history like any other change, with no files.
    expect(s.listBackups()).toMatchObject([{ id: r.backupId, changes: [{ key: "label.audioVolume" }], files: [], restored: false }]);

    expect(await s.undo(r.backupId!, [])).toEqual({ ok: true, restored: [] });
    expect(m.state).toEqual(RESTORED);
    expect(s.listBackups()[0].restored).toBe(true);
  });

  it("Undo leaves a control the user changed since", async () => {
    const m = fakeMixer();
    const s = service(m.layer);
    const r = await s.apply([(await volumeFix(s))!.id], []);
    m.state!["PCM Playback Volume"] = 90; // the user's own change after ours
    await s.undo(r.backupId!, []);
    expect(m.state).toEqual({ ...RESTORED, "PCM Playback Volume": 90 });
  });

  it("Undo with the controller unplugged: refused, nothing marked undone, works once it's back", async () => {
    const m = fakeMixer();
    let plugged = true;
    const layer: MixerLayer = { ...m.layer, cards: () => (plugged ? m.layer.cards() : []) };
    const s = service(layer);
    const r = await s.apply([(await volumeFix(s))!.id], []);
    plugged = false;
    expect(await s.undo(r.backupId!, [])).toEqual({ ok: false, noController: true });
    expect(s.listBackups()[0].restored).toBe(false);
    plugged = true;
    expect((await s.undo(r.backupId!, [])).ok).toBe(true);
    expect(m.state).toEqual(RESTORED);
  });

  it("a failed write reports the error (translated sentence) and the fix as not applied", async () => {
    const m = fakeMixer();
    const s = service({
      ...m.layer,
      set: async () => {
        throw new Error("amixer: Control not writable");
      },
    });
    const fix = (await volumeFix(s))!;
    const r = await s.apply([fix.id], []);
    expect(r.applied).toEqual([{ id: fix.id, ok: false, message: { key: "result.volumeFailed", params: { error: expect.stringContaining("not writable") } } }]);
  });
});
