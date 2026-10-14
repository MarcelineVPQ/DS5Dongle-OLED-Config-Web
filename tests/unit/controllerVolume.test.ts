// Linux: the controller's hardware volume and mic gain (ALSA) restored low at
// boot (owner's machine: Headset Capture Volume 0, PCM Playback Volume 80).
// The Games system check finds them below full (live, or in ALSA's saved
// state), Apply sets them to full and saves them (pkexec alsactl store), the
// card watcher sets them again when the card reappears, and Undo puts the old
// values back. Fake amixer, pkexec and card events: no real card is touched.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FixIdsSchema } from "../../electron/main/ipc";
import type { LauncherControl } from "../../electron/main/games/processes";
import { GamesService } from "../../electron/main/games/service";
import {
  ALSA_STATE_FILE,
  findDualSenseAlsaCards,
  lowMixerControls,
  parseAmixerContents,
  parseSavedLevels,
  saveCardState,
  type MixerLayer,
  type MixerName,
  type SaveResult,
} from "../../electron/main/games/system";
import { VolumeKeeper, type CardEvents } from "../../electron/main/games/volumeKeeper";
import type { PkexecRunner } from "../../electron/main/linuxSetup";
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

// One controller on card 6, USB port 3-3; `sets` records every write. `saved`
// is the card's entry in ALSA's saved state (asound.state); `save` (pkexec
// alsactl store) copies the live levels into it, or answers `saveResult`.
function fakeMixer(start: Record<string, number> | null = { ...RESTORED }, savedStart: Record<string, number> | null = { ...RESTORED }) {
  const state = start;
  const saved = { value: savedStart };
  const sets: Array<[number, MixerName, number]> = [];
  const saves: number[] = [];
  const result: { next: SaveResult } = { next: { ok: true } };
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
    saved: () => saved.value,
    save: async (card) => {
      saves.push(card);
      if (result.next.ok) saved.value = { ...state! };
      return result.next;
    },
  };
  return { layer, state, sets, saves, saved, result };
}

let home: string;
const control: LauncherControl = { running: () => new Set(), gameRunning: () => false, plan: () => null, close: async () => "closed", reopen: async () => true };
const service = (mixer?: MixerLayer, keep?: { on: boolean }) =>
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
    ...(keep
      ? {
          volumeKept: () => keep.on,
          keepVolume: (on: boolean) => {
            keep.on = on;
          },
        }
      : {}),
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
    const full = { "PCM Playback Switch": 1, "PCM Playback Volume": 100, "Headset Capture Switch": 1, "Headset Capture Volume": 101 };
    expect(await volumeFix(service(fakeMixer({ ...full }, { ...full }).layer))).toBeUndefined();
    // Full, with nothing saved for the card: the restore has nothing low to bring back.
    expect(await volumeFix(service(fakeMixer({ ...full }, null).layer))).toBeUndefined();
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

// The levels came back low after every firmware flash: udev runs `alsactl
// restore` each time the controller's card appears, from ALSA's saved state.
describe("keeping the levels after a reconnect (ALSA's saved state)", () => {
  // The owner's /var/lib/alsa/asound.state (2026-10-13), shortened.
  const STATE = `state.R24 {
\tcontrol.1 {
\t\tiface MIXER
\t\tname 'PCM Playback Volume'
\t\tvalue 3
\t}
}
state.Controller {
\tcontrol.1 {
\t\tiface PCM
\t\tname 'Playback Channel Map'
\t\tvalue.0 0
\t\tvalue.1 0
\t}
\tcontrol.3 {
\t\tiface MIXER
\t\tname 'PCM Playback Switch'
\t\tvalue true
\t\tcomment {
\t\t\taccess 'read write'
\t\t\ttype BOOLEAN
\t\t}
\t}
\tcontrol.4 {
\t\tiface MIXER
\t\tname 'PCM Playback Volume'
\t\tvalue 80
\t\tcomment {
\t\t\trange '0 - 100'
\t\t\tdbvalue.0 -2000
\t\t}
\t}
\tcontrol.6 {
\t\tiface MIXER
\t\tname 'Headset Capture Volume'
\t\tvalue 0
\t}
}
state.Controller_1 {
\tcontrol.4 {
\t\tiface MIXER
\t\tname 'PCM Playback Volume'
\t\tvalue 100
\t}
}
`;

  it("reads one card's saved levels by its id (switches as 1/0), null without an entry", () => {
    expect(parseSavedLevels(STATE, "Controller")).toEqual({ "PCM Playback Switch": 1, "PCM Playback Volume": 80, "Headset Capture Volume": 0 });
    expect(parseSavedLevels(STATE, "Controller_1")).toEqual({ "PCM Playback Volume": 100 });
    expect(parseSavedLevels(STATE, "Headset")).toBeNull();
  });

  it("saving runs `pkexec alsactl store <card>`: fixed argv, alsactl by path; skipped without alsactl or a saved state", async () => {
    const calls: string[][] = [];
    const pkexec: PkexecRunner = async (argv) => {
      calls.push(argv);
      return { ok: true };
    };
    const has = (paths: string[]) => (p: string) => paths.includes(p);
    expect(await saveCardState(6, pkexec, has(["/usr/sbin/alsactl", ALSA_STATE_FILE]))).toEqual({ ok: true });
    expect(calls).toEqual([["/usr/sbin/alsactl", "store", "6"]]);
    expect(await saveCardState(6, pkexec, has([ALSA_STATE_FILE]))).toEqual({ ok: true, skipped: true });
    expect(await saveCardState(6, pkexec, has(["/usr/sbin/alsactl"]))).toEqual({ ok: true, skipped: true });
    expect(calls).toHaveLength(1);
    await expect(saveCardState(-1, pkexec, has(["/usr/sbin/alsactl", ALSA_STATE_FILE]))).rejects.toThrow();
    const cancelled: PkexecRunner = async () => ({ ok: false, reason: "cancelled", code: 126, message: "Cancelled" });
    expect(await saveCardState(6, cancelled, has(["/usr/sbin/alsactl", ALSA_STATE_FILE]))).toMatchObject({ ok: false, reason: "cancelled" });
  });

  it("Apply sets them to full AND saves them; remembered; no recommendation after, also after a reconnect", async () => {
    const m = fakeMixer();
    const keep = { on: false };
    const s = service(m.layer, keep);
    const r = await s.apply([(await volumeFix(s))!.id], []);
    expect(r.applied[0]).toMatchObject({ ok: true, message: undefined });
    expect(m.saves).toEqual([6]);
    expect(m.saved.value).toMatchObject({ "PCM Playback Volume": 100, "Headset Capture Volume": 101 });
    expect(keep.on).toBe(true);
    expect(await volumeFix(s)).toBeUndefined();
    // A reconnect: udev's restore puts back what's saved, now full.
    Object.assign(m.state!, m.saved.value);
    expect(await volumeFix(s)).toBeUndefined();
  });

  it("password prompt cancelled: set to full, said on the row; then offered again as a save", async () => {
    const m = fakeMixer();
    m.result.next = { ok: false, reason: "cancelled", code: 126, message: "Cancelled" };
    const s = service(m.layer, { on: false });
    const r = await s.apply([(await volumeFix(s))!.id], []);
    expect(r.applied[0]).toMatchObject({ ok: true, message: { key: "result.volumeNotSaved", params: { error: { key: "result.passwordCancelled" } } } });
    expect(m.state).toMatchObject({ "PCM Playback Volume": 100, "Headset Capture Volume": 101 });
    // Live full, saved low: the next reconnect would lower them, so the fix stays, as a save.
    const again = (await volumeFix(s))!;
    expect(again).toMatchObject({ label: { key: "label.audioVolumeSaved" }, why: { key: "why.audioVolumeSaved" } });
    m.result.next = { ok: true };
    await s.apply([again.id], []);
    expect(m.saves).toEqual([6, 6]);
    expect(await volumeFix(s)).toBeUndefined();
  });

  it("applied before but low again: explains that something else lowered them", async () => {
    const s = service(fakeMixer().layer, { on: true });
    expect(await volumeFix(s)).toMatchObject({ label: { key: "label.audioVolume" }, why: { key: "why.audioVolumeAgain" } });
  });

  it("Undo puts back the old live levels AND the old saved ones (pkexec again), and forgets the fix", async () => {
    const m = fakeMixer();
    const keep = { on: false };
    const s = service(m.layer, keep);
    const r = await s.apply([(await volumeFix(s))!.id], []);
    expect(await s.undo(r.backupId!, [])).toEqual({ ok: true, restored: [] });
    expect(m.state).toEqual(RESTORED);
    expect(m.saves).toEqual([6, 6]);
    expect(m.saved.value).toEqual(RESTORED);
    expect(keep.on).toBe(false);
  });

  it("Undo with the password prompt cancelled: live levels back, the page is told the saved ones aren't", async () => {
    const m = fakeMixer();
    const s = service(m.layer, { on: false });
    const r = await s.apply([(await volumeFix(s))!.id], []);
    m.result.next = { ok: false, reason: "cancelled", code: 126, message: "Cancelled" };
    expect(await s.undo(r.backupId!, [])).toEqual({ ok: true, restored: [], volumeNotSaved: "cancelled" });
    expect(m.state).toEqual(RESTORED);
  });

  it("Undo of a change whose save was cancelled asks for no password", async () => {
    const m = fakeMixer();
    m.result.next = { ok: false, reason: "cancelled", code: 126, message: "Cancelled" };
    const s = service(m.layer, { on: false });
    const r = await s.apply([(await volumeFix(s))!.id], []);
    expect(await s.undo(r.backupId!, [])).toEqual({ ok: true, restored: [] });
    expect(m.saves).toEqual([6]);
  });
});

describe("the card watcher (VolumeKeeper): sets the levels again when the card reappears", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function fakeEvents() {
    const e = { fire: () => undefined as void, stopped: 0 };
    const events: CardEvents = (onChange) => {
      e.fire = onChange;
      return () => void e.stopped++;
    };
    return { e, events };
  }

  it("a card appearing low is set to full and the page is told; a full one isn't touched", async () => {
    const m = fakeMixer({ "PCM Playback Switch": 1, "PCM Playback Volume": 100, "Headset Capture Switch": 1, "Headset Capture Volume": 101 });
    const { e, events } = fakeEvents();
    let raised = 0;
    const k = new VolumeKeeper(() => raised++, m.layer, events, 100);
    k.start();
    await vi.advanceTimersByTimeAsync(150); // the check at start: already full
    expect(raised).toBe(0);
    expect(m.sets).toEqual([]);
    // The board restarts (a firmware update): udev's restore lowers them again.
    Object.assign(m.state!, RESTORED);
    e.fire();
    e.fire(); // the card's nodes come in a burst: one check
    await vi.advanceTimersByTimeAsync(150);
    expect(raised).toBe(1);
    expect(m.sets).toEqual([
      [6, "PCM Playback Volume", 100],
      [6, "Headset Capture Volume", 101],
    ]);
    expect(m.saves).toEqual([]); // no password prompt in the background
    k.stop();
    expect(e.stopped).toBe(1);
    expect(k.running).toBe(false);
  });

  it("a card not open yet (udev still at work): tried again, then set", async () => {
    const m = fakeMixer();
    let denied = 2;
    const layer: MixerLayer = {
      ...m.layer,
      contents: async (card) => {
        if (denied-- > 0) throw new Error("amixer: Permission denied");
        return m.layer.contents(card);
      },
    };
    const { events } = fakeEvents();
    let raised = 0;
    const k = new VolumeKeeper(() => raised++, layer, events, 100);
    k.start();
    await vi.advanceTimersByTimeAsync(350);
    expect(raised).toBe(1);
    expect(m.state).toMatchObject({ "PCM Playback Volume": 100, "Headset Capture Volume": 101 });
    k.stop();
  });

  it("stopped (Undo, or the setting off): nothing runs after", async () => {
    const m = fakeMixer();
    const { events } = fakeEvents();
    const k = new VolumeKeeper(() => undefined, m.layer, events, 100);
    k.start();
    k.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(m.sets).toEqual([]);
  });
});
