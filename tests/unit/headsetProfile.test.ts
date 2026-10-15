// Linux: the controller's sound profile follows its headset jack
// (electron/main/games/headsetProfile.ts), and the Games fix's switch back
// from pro-audio is jack-aware and undoable. A fake pactl (cards, profiles,
// default nodes) and fake card events: no real sound server is touched.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HeadsetProfile, type CardEvents, type PactlLayer, type Switched } from "../../electron/main/games/headsetProfile";
import type { LauncherControl } from "../../electron/main/games/processes";
import { GamesService } from "../../electron/main/games/service";
import { cardNodePrefix, parseDualSenseCards, parseShortNodes, stereoProfile, type AudioCard, type NodeKind } from "../../electron/main/games/system";
import { NO_HDR_SYSTEM } from "../../src/desktop/games/hdrSetup";
import { asLinux } from "../support/platform";

asLinux();

const CARD = "alsa_card.usb-Sony_Interactive_Entertainment_DualSense_Wireless_Controller_143A9AFFD9F9-00";
const SPEAKER = "HiFi (Mic, Speaker)";
const STEREO_MIC = "HiFi (Headphones, Headset)";
const STEREO = "HiFi (Headphones, Mic)";
const avail = (on: boolean | null) => (on === null ? "availability unknown" : on ? "available" : "not available");

// `pactl list cards` on the owner's machine (2026-10-15, C locale, read-only),
// properties cut; the active profile and the jack's ports filled in.
const cardsText = (active: string, headphones: boolean | null, headsetMic: boolean | null) => `Card #12
	Name: alsa_card.pci-0000_00_1f.3
	Profiles:
		HiFi: Default (sinks: 1, sources: 1, priority: 8200, available: yes)
	Active Profile: HiFi
Card #540
	Name: ${CARD}
	Driver: alsa
	Owner Module: n/a
	Properties:
		api.acp.auto-profile = "false"
	Profiles:
		off: Off (sinks: 0, sources: 0, priority: 0, available: yes)
		HiFi (Mic, Speaker): Default (Mic, Speaker) (sinks: 1, sources: 1, priority: 8200, available: yes)
		HiFi (Headset, Speaker): Default (Headset, Speaker) (sinks: 1, sources: 1, priority: 8200, available: no)
		HiFi (Headphones, Mic): Default (Headphones, Mic) (sinks: 1, sources: 1, priority: 8200, available: no)
		HiFi (Headphones, Headset): Default (Headphones, Headset) (sinks: 1, sources: 1, priority: 8200, available: no)
		pro-audio: Pro Audio (sinks: 1, sources: 1, priority: 1, available: yes)
	Active Profile: ${active}
	Ports:
		[Out] Speaker: Internal Mono Speaker (type: Speaker, priority: 100, latency offset: 0 usec, availability unknown)
			Properties:
				port.type = "speaker"
			Part of profile(s): HiFi (Mic, Speaker), HiFi (Headset, Speaker)
		[In] Mic: Internal Microphone (type: Mic, priority: 100, latency offset: 0 usec, availability unknown)
			Part of profile(s): HiFi (Mic, Speaker), HiFi (Headphones, Mic)
		[In] Headset: Headset Microphone (type: Headset, priority: 100, latency offset: 0 usec, ${headsetMic === null ? "availability unknown" : `availability group: Headset Mic, ${avail(headsetMic)}`})
			Part of profile(s): HiFi (Headset, Speaker), HiFi (Headphones, Headset)
		[Out] Headphones: 3.5mm Headphones (type: Headphones, priority: 100, latency offset: 0 usec, ${headphones === null ? "availability unknown" : `availability group: Headphone, ${avail(headphones)}`})
			Part of profile(s): HiFi (Headphones, Mic), HiFi (Headphones, Headset)
`;

const nodeName = (kind: NodeKind, profile: string) => {
  const dev = kind === "sink" ? (profile.includes("Headphones") ? "Headphones" : "Speaker") : profile.includes("Headset)") ? "Headset" : "Mic";
  return `${cardNodePrefix(CARD, kind)}HiFi__${dev}__${kind}`;
};

// A fake pactl: one DualSense card whose jack the test plugs and unplugs.
function fakePactl(start: { active?: string; headphones?: boolean | null; headsetMic?: boolean | null; defaults?: "controller" | "pc" } = {}) {
  const s = {
    active: start.active ?? SPEAKER,
    headphones: start.headphones === undefined ? false : start.headphones,
    headsetMic: start.headsetMic === undefined ? false : start.headsetMic,
    present: true,
    failSet: false,
  };
  const defaults: Record<NodeKind, string> = {
    sink: start.defaults === "pc" ? "alsa_output.pci-0000_00_1f.3.analog-stereo" : nodeName("sink", s.active),
    source: start.defaults === "pc" ? "alsa_input.pci-0000_00_1f.3.analog-stereo" : nodeName("source", s.active),
  };
  const sets: string[] = [];
  const layer: PactlLayer = {
    cards: async () => (s.present ? parseDualSenseCards(cardsText(s.active, s.headphones, s.headsetMic)) : []),
    setProfile: async (card, profile) => {
      if (s.failSet) throw new Error("Failure: No such entity");
      expect(card).toBe(CARD);
      sets.push(profile);
      s.active = profile;
    },
    defaultNode: async (kind) => defaults[kind],
    listNodes: async (kind) => ["alsa_output.pci-0000_00_1f.3.analog-stereo", nodeName(kind, s.active)].filter((n) => n.startsWith(kind === "sink" ? "alsa_output" : "alsa_input")),
    setDefault: async (kind, name) => {
      defaults[kind] = name;
    },
  };
  return { s, sets, defaults, layer };
}

function fakeEvents() {
  const e = { change: () => undefined as void, end: () => undefined as void, starts: 0, stops: 0 };
  const events: CardEvents = (onChange, onEnd) => {
    e.starts++;
    e.change = onChange;
    e.end = onEnd;
    return () => {
      e.stops++;
    };
  };
  return { e, events };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

function watcher(p: ReturnType<typeof fakePactl>) {
  const { e, events } = fakeEvents();
  const switched: Switched[] = [];
  const w = new HeadsetProfile((s) => switched.push(s), p.layer, events, 5, 1);
  return { w, e, switched };
}

describe("reading the jack from pactl", () => {
  it("parses the profiles and the jack's ports; the switch back from pro-audio is jack-aware", () => {
    const [unplugged] = parseDualSenseCards(cardsText("pro-audio", false, false));
    expect(unplugged).toMatchObject({ name: CARD, activeProfile: "pro-audio", headphones: false, headsetMic: false, hifiProfile: SPEAKER });
    expect(unplugged.profiles).toEqual(["off", SPEAKER, "HiFi (Headset, Speaker)", STEREO, STEREO_MIC, "pro-audio"]);
    expect(parseDualSenseCards(cardsText("pro-audio", true, true))[0].hifiProfile).toBe(STEREO_MIC);
    expect(parseDualSenseCards(cardsText("pro-audio", true, false))[0].hifiProfile).toBe(STEREO);
    // Older kernels: no jack controls, so not known.
    expect(parseDualSenseCards(cardsText(SPEAKER, null, null))[0]).toMatchObject({ headphones: null, headsetMic: null, hifiProfile: SPEAKER });
  });

  it("picks the stereo profile with the headset's microphone only when it has one", () => {
    const profiles = ["off", SPEAKER, STEREO, STEREO_MIC];
    expect(stereoProfile({ profiles, headsetMic: true })).toBe(STEREO_MIC);
    expect(stereoProfile({ profiles, headsetMic: false })).toBe(STEREO);
    expect(stereoProfile({ profiles: ["off", SPEAKER], headsetMic: true })).toBeNull();
  });

  it("reads node names from pactl's short lists, monitors left out", () => {
    expect(parseShortNodes(`562\t${nodeName("sink", SPEAKER)}\tPipeWire\tfloat32le 1ch 48000Hz\tSUSPENDED\n562\t${nodeName("sink", SPEAKER)}.monitor\tPipeWire\tx\tSUSPENDED\n`)).toEqual([
      nodeName("sink", SPEAKER),
    ]);
  });
});

describe("the profile follows the headset jack", () => {
  let w: HeadsetProfile | null = null;
  afterEach(() => w?.stop());

  it("plug: stereo (with the headset's mic), the default output and input move along; unplug: back", async () => {
    const p = fakePactl();
    const t = watcher(p);
    w = t.w;
    w.start();
    await settle();
    expect(p.sets).toEqual([]); // speaker, nothing plugged: left alone

    p.s.headphones = p.s.headsetMic = true;
    t.e.change();
    await settle();
    expect(p.sets).toEqual([STEREO_MIC]);
    expect(t.switched).toEqual([{ card: CARD, from: SPEAKER, to: STEREO_MIC, plugged: true }]);
    expect(p.defaults).toEqual({ sink: nodeName("sink", STEREO_MIC), source: nodeName("source", STEREO_MIC) });

    p.s.headphones = p.s.headsetMic = false;
    t.e.change();
    await settle();
    expect(p.sets).toEqual([STEREO_MIC, SPEAKER]);
    expect(t.switched[1]).toEqual({ card: CARD, from: STEREO_MIC, to: SPEAKER, plugged: false });
    expect(p.defaults).toEqual({ sink: nodeName("sink", SPEAKER), source: nodeName("source", SPEAKER) });
  });

  it("headphones without a microphone: stereo with the controller's mic; the mic showing up a moment later upgrades it", async () => {
    const p = fakePactl({ defaults: "pc" });
    const t = watcher(p);
    w = t.w;
    w.start();
    await settle();
    p.s.headphones = true;
    t.e.change();
    await settle();
    expect(p.sets).toEqual([STEREO]);
    p.s.headsetMic = true;
    t.e.change();
    await settle();
    expect(p.sets).toEqual([STEREO, STEREO_MIC]);
    // The PC's own output was the default: it stays.
    expect(p.defaults.sink).toBe("alsa_output.pci-0000_00_1f.3.analog-stereo");
    // Unplug: back to where it started.
    p.s.headphones = p.s.headsetMic = false;
    t.e.change();
    await settle();
    expect(p.s.active).toBe(SPEAKER);
  });

  it("never over pro-audio, off, or the player's own pick (until the next unplug)", async () => {
    for (const active of ["pro-audio", "off"]) {
      const p = fakePactl({ active });
      const t = watcher(p);
      t.w.start();
      await settle();
      p.s.headphones = true;
      t.e.change();
      await settle();
      expect(p.sets).toEqual([]);
      t.w.stop();
    }

    const p = fakePactl();
    const t = watcher(p);
    w = t.w;
    w.start();
    await settle();
    p.s.headphones = true;
    t.e.change();
    await settle();
    expect(p.s.active).toBe(STEREO);
    // The player picks the speaker by hand while the headset is in: left so.
    p.s.active = SPEAKER;
    t.e.change();
    await settle();
    expect(p.s.active).toBe(SPEAKER);
    // Unplug: nothing to put back (it isn't ours); the next plug switches again.
    p.s.headphones = false;
    t.e.change();
    await settle();
    p.s.headphones = true;
    t.e.change();
    await settle();
    expect(p.sets).toEqual([STEREO, STEREO]);
    // Unplugged after the player changed to another stereo profile: not switched back.
    p.s.active = STEREO_MIC;
    t.e.change();
    await settle();
    p.s.headphones = false;
    t.e.change();
    await settle();
    expect(p.s.active).toBe(STEREO_MIC);
  });

  it("a card appearing with the headset in: stereo from its default speaker profile, not from one the player set", async () => {
    const p = fakePactl({ headphones: true, headsetMic: true });
    const t = watcher(p);
    w = t.w;
    w.start();
    await settle();
    expect(p.s.active).toBe(STEREO_MIC);
    t.w.stop();

    const q = fakePactl({ active: "HiFi (Headset, Speaker)", headphones: true, headsetMic: true });
    const u = watcher(q);
    w = u.w;
    w.start();
    await settle();
    expect(q.sets).toEqual([]);
  });

  it("Undo: the speaker profile back, and left alone until the next unplug", async () => {
    const p = fakePactl();
    const t = watcher(p);
    w = t.w;
    w.start();
    await settle();
    p.s.headphones = true;
    t.e.change();
    await settle();
    expect(await w.undo()).toBe(true);
    expect(p.s.active).toBe(SPEAKER);
    expect(p.defaults.sink).toBe(nodeName("sink", SPEAKER));
    t.e.change();
    await settle();
    expect(p.s.active).toBe(SPEAKER);
    // Nothing left to undo.
    expect(await w.undo()).toBe(false);
    // Unplug and plug again: stereo again.
    p.s.headphones = false;
    t.e.change();
    await settle();
    p.s.headphones = true;
    t.e.change();
    await settle();
    expect(p.s.active).toBe(STEREO);
    // The profile changed since: Undo refuses.
    p.s.active = STEREO_MIC;
    expect(await w.undo()).toBe(false);
    expect(p.s.active).toBe(STEREO_MIC);
  });

  it("older kernels: the live input's headset bit stands in for the jack", async () => {
    const p = fakePactl({ headphones: null, headsetMic: null });
    const t = watcher(p);
    w = t.w;
    w.start();
    await settle();
    w.setHint(false);
    await settle();
    w.setHint(true);
    await settle();
    expect(p.s.active).toBe(STEREO);
    w.setHint(null); // no live input: not known, nothing changes
    await settle();
    expect(p.s.active).toBe(STEREO);
    w.setHint(false);
    await settle();
    expect(p.s.active).toBe(SPEAKER);
  });

  it("a failed switch is logged and not retried until the next plug; the card gone is forgotten", async () => {
    const p = fakePactl();
    const t = watcher(p);
    w = t.w;
    w.start();
    await settle();
    p.s.failSet = true;
    p.s.headphones = true;
    t.e.change();
    await settle();
    expect(p.s.active).toBe(SPEAKER);
    p.s.failSet = false;
    t.e.change();
    await settle();
    expect(p.sets).toEqual([]);
    p.s.headphones = false;
    t.e.change();
    await settle();
    p.s.headphones = true;
    t.e.change();
    await settle();
    expect(p.sets).toEqual([STEREO]);
  });

  it("stopped (the setting off): the events stop and nothing switches; the profile stays as it is", async () => {
    const p = fakePactl();
    const t = watcher(p);
    t.w.start();
    await settle();
    p.s.headphones = true;
    t.e.change();
    await settle();
    t.w.stop();
    expect(t.e.stops).toBe(1);
    expect(t.w.running).toBe(false);
    p.s.headphones = false;
    t.e.change();
    await settle();
    expect(p.s.active).toBe(STEREO);
  });
});

describe("the Games fix's switch back from pro-audio: a restore point with Undo", () => {
  let home: string;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "ds5-headset-")));
    process.env.HOME = home;
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const control: LauncherControl = { running: () => new Set(), gameRunning: () => false, plan: () => null, close: async () => "closed", reopen: async () => true };
  const service = (p: ReturnType<typeof fakePactl>) =>
    new GamesService({
      userData: join(home, "userdata"),
      allowed: () => true,
      fetchManifest: () => Promise.reject(new Error("offline")),
      download: () => Promise.reject(new Error("offline")),
      onProtonProgress: () => undefined,
      notDetected: () => new Set(),
      hdrMarked: () => new Set(),
      launchers: control,
      probes: { audioCards: () => p.layer.cards() as Promise<AudioCard[]>, hdr: async () => NO_HDR_SYSTEM, setProfile: p.layer.setProfile },
    });

  it("with a headset in it switches to stereo; Undo puts pro-audio back; unplugged controller: refused", async () => {
    const p = fakePactl({ active: "pro-audio", headphones: true, headsetMic: true });
    const s = service(p);
    const fix = (await s.scan()).system.fixes.find((f) => f.kind === "audio-hifi")!;
    expect(fix.label).toMatchObject({ key: "label.audioProfile", params: { profile: STEREO_MIC } });
    const r = await s.apply([fix.id], []);
    expect(r.applied).toEqual([{ id: fix.id, ok: true, message: undefined }]);
    expect(p.s.active).toBe(STEREO_MIC);
    expect(s.listBackups()).toMatchObject([{ id: r.backupId, changes: [{ key: "label.audioProfile" }], files: [], restored: false }]);

    p.s.present = false;
    expect(await s.undo(r.backupId!, [])).toEqual({ ok: false, noController: true });
    expect(s.listBackups()[0].restored).toBe(false);
    p.s.present = true;
    expect(await s.undo(r.backupId!, [])).toEqual({ ok: true, restored: [] });
    expect(p.s.active).toBe("pro-audio");
    expect(s.listBackups()[0].restored).toBe(true);
  });
});
