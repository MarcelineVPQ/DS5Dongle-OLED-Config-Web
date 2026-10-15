// Linux: the controller's sound follows the headset jack, like a laptop's.
// The DualSense's UCM puts the speaker (mono, one channel) and the headphones
// (stereo) in separate profiles, and WirePlumber picks a profile only when the
// card appears (api.acp.auto-profile is off), so with a headset plugged in
// the game still plays on the mono speaker profile: one ear, or both with the
// same mono sound. While the setting is on (headsetStereo, on by default),
// plugging a headset into the controller switches the card to
// "HiFi (Headphones, Headset)" (or "(Headphones, Mic)" for headphones without
// a microphone), and unplugging it switches back to the profile it had.
//
// Only the player's own session tools: `pactl` (PipeWire's Pulse server),
// never a system file, never a password prompt. It never switches over
// pro-audio (the Games fix owns it), "off", or a profile the player picked by
// hand while the headset was in (until the next unplug). The default output
// and input move to the new nodes when they were the controller's.
//
// No polling: one `pactl subscribe` child, filtered to card events (a jack
// plug changes the card's port availability). The jack comes from the
// kernel's jack controls (6.17+); without them, the live input's headset bit
// from the page (setHint) stands in.
import { spawn } from "node:child_process";
import { errorText, logged } from "../../../src/errorText";
import { cardNodePrefix, defaultNode, dualSenseCards, isProAudio, isSpeakerProfile, listNodes, setCardProfile, setDefaultNode, stereoProfile, type AudioCard, type NodeKind } from "./system";

/** What the watcher reads and changes, through `pactl` (tests pass a fake). */
export interface PactlLayer {
  cards(): Promise<AudioCard[]>;
  setProfile(card: string, profile: string): Promise<void>;
  defaultNode(kind: NodeKind): Promise<string>;
  listNodes(kind: NodeKind): Promise<string[]>;
  setDefault(kind: NodeKind, name: string): Promise<void>;
}

export const pactlLayer: PactlLayer = { cards: dualSenseCards, setProfile: setCardProfile, defaultNode, listNodes, setDefault: setDefaultNode };

/** Calls onChange when a sound card may have changed and onEnd when the
 * stream of events stops; returns its stop. */
export type CardEvents = (onChange: () => void, onEnd: () => void) => () => void;

export const pactlSubscribe: CardEvents = (onChange, onEnd) => {
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    onEnd();
  };
  // lifetime: OK — killed by the returned stop (HeadsetProfile.stop: the setting turned off, or quit); an end on its own is restarted by HeadsetProfile
  // error: LOGGED-OK — its "error" event is logged below, and an end calls onEnd (HeadsetProfile restarts it a few times)
  const child = spawn("pactl", ["subscribe"], { env: { ...process.env, LC_ALL: "C" }, stdio: ["ignore", "pipe", "ignore"] });
  let rest = "";
  // lifetime: OK — the child's own output stream, gone with the child
  child.stdout.on("data", (chunk: Buffer) => {
    const lines = (rest + chunk.toString("utf8")).split("\n");
    rest = lines.pop() ?? "";
    // loop: HOT-PATH-OK — the lines of one chunk of pactl events, a few; events come per stream or device change, not per frame
    if (lines.some((line) => / on card #\d+/.test(line))) onChange();
  });
  // lifetime: OK — fires once, when the child ends
  child.once("close", end);
  // lifetime: OK — fires once, when the child can't start or fails
  child.once("error", (cause) => {
    // error: LOGGED-OK — no pactl (no PipeWire/Pulse) or it failed: logged, and HeadsetProfile retries a few times, then stops; the speaker profile stays, as without the app
    logged("watching the controller's headset jack (pactl subscribe)")(cause);
    end();
  });
  return () => {
    ended = true;
    child.kill();
  };
};

/** A switch the watcher made: the page's notice (and its Undo) use it. */
export interface Switched {
  card: string;
  from: string;
  to: string;
  plugged: boolean; // true: to the stereo profile (headset in); false: back (headset out)
}

interface CardState {
  plugged: boolean | null; // the jack when last seen (null: not seen yet)
  ours: string | null; // the profile we switched to, while it's still active
  from: string | null; // the profile we switched from (put back on unplug)
  playerChoice: boolean; // the player picked a profile while the headset was in: hands off until the next unplug
}

const SETTLE_MS = 300; // a plug changes two ports (headphones, headset mic) in a burst
const RESTART_MS = 5000;
const MAX_QUICK_ENDS = 5; // pactl ending right after its start this often in a row: give up (logged)
const NODE_WAIT_MS = 100;
const NODE_TRIES = 20; // the new nodes appear within about 2 s of the switch

export class HeadsetProfile {
  private stopEvents: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private startedAt = 0;
  private quickEnds = 0;
  private hint: boolean | null = null;
  // cache: OK — key=card name; invalidated=a card gone from pactl's list is dropped on the next check, stop() clears all; bound=DualSense cards plugged in (1-2)
  private readonly state = new Map<string, CardState>();
  // cache: OK — key=none (the latest switch to stereo, for Undo, which re-reads the card and refuses if its profile changed); invalidated=a later switch, an unplug's switch back, Undo or stop(); bound=1 entry
  private last: Switched | null = null;
  private queue: Promise<unknown> = Promise.resolve(); // one check or Undo at a time

  constructor(
    private readonly onSwitched: (s: Switched) => void,
    private readonly layer: PactlLayer = pactlLayer,
    private readonly events: CardEvents = pactlSubscribe,
    private readonly settleMs = SETTLE_MS,
    private readonly nodeWaitMs = NODE_WAIT_MS,
  ) {}

  get running(): boolean {
    return this.stopEvents !== null;
  }

  /** Watch the jack, and check the cards already there (the app just started,
   * or the setting was just turned on). */
  start(): void {
    if (this.stopEvents) return;
    this.listen();
    this.schedule();
  }

  /** Stops watching. The profile stays as it is (no surprise switch when the
   * setting is turned off). */
  stop(): void {
    const stop = this.stopEvents;
    this.stopEvents = null;
    stop?.();
    if (this.timer) clearTimeout(this.timer);
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.timer = this.restartTimer = null;
    this.state.clear();
    this.last = null;
  }

  /** The page's live input: headphones in the controller's jack, or null
   * (not known: no live input). Used only where the kernel doesn't report
   * the jack. */
  setHint(headphones: boolean | null): void {
    if (headphones === this.hint) return;
    this.hint = headphones;
    if (this.stopEvents) this.schedule();
  }

  /** Undo the latest switch: the profile it switched from comes back, and the
   * watcher leaves the card alone until the headset is unplugged. false:
   * nothing to undo (the card is gone, or its profile changed since). */
  undo(): Promise<boolean> {
    return this.exclusive(async () => {
      const last = this.last;
      if (!last?.plugged) return false;
      const card = (await this.layer.cards()).find((c) => c.name === last.card);
      if (!card || card.activeProfile !== last.to || !card.profiles.includes(last.from)) return false;
      const st = this.cardState(card.name);
      st.ours = st.from = null;
      st.playerChoice = true; // back on the speaker with the headset in: the player's choice now, until the next unplug
      this.last = null;
      await this.switchTo(card, last.from);
      return true;
    });
  }

  private listen(): void {
    this.startedAt = Date.now();
    let mine: (() => void) | null = null;
    const onEnd = () => {
      if (this.stopEvents !== mine) return; // stopped on purpose, or an older child
      this.stopEvents = null;
      this.quickEnds = Date.now() - this.startedAt < RESTART_MS ? this.quickEnds + 1 : 0;
      if (this.quickEnds >= MAX_QUICK_ENDS) {
        // error: LOGGED-OK — background, not a user action: the speaker profile stays as without the app; the next start (or the setting turned on again) tries again
        console.warn("[headset] pactl keeps ending; the sound profile no longer follows the headset jack until the app restarts");
        return;
      }
      // PipeWire restarted (or the session's sound server did): listen again, and look then.
      // lifetime: OK — one-shot restart, cleared by stop()
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        if (this.stopEvents || this.quickEnds >= MAX_QUICK_ENDS) return;
        this.listen();
        this.schedule();
      }, RESTART_MS);
    };
    try {
      mine = this.events(() => this.schedule(), onEnd);
      this.stopEvents = mine;
    } catch (cause) {
      // error: LOGGED-OK — pactl couldn't be started: background, the speaker profile stays as without the app
      console.warn("[headset] can't watch the headset jack:", errorText(cause));
    }
  }

  // Each event pushes the check back: a plug changes two ports in a burst.
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(this.runCheck, this.settleMs); // lifetime: OK — one-shot, cleared by the next event or stop()
  }

  private readonly runCheck = (): void => {
    this.timer = null;
    void this.exclusive(() => this.check()).catch(logged("following the headset jack (check() catches its own errors)"));
  };

  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    // error: NOT-WORTH — runs after a failed earlier job too: one job's failure must not block the next (it already went to that job's caller)
    const next = this.queue.then(run, run);
    // error: NOT-WORTH — the queue's own copy; the caller gets `next` with the error
    this.queue = next.catch(() => undefined);
    return next;
  }

  private cardState(name: string): CardState {
    let st = this.state.get(name);
    if (!st) this.state.set(name, (st = { plugged: null, ours: null, from: null, playerChoice: false }));
    return st;
  }

  private async check(): Promise<void> {
    if (!this.stopEvents && !this.restartTimer) return; // stopped while waiting
    let cards: AudioCard[];
    try {
      cards = await this.layer.cards();
    } catch (cause) {
      // error: LOGGED-OK — background, not a user action: the next card event looks again
      console.warn("[headset] couldn't read the sound cards:", errorText(cause));
      return;
    }
    // loop: NOT-WORTH — the cards we followed, 1-2; per card event
    for (const name of [...this.state.keys()]) if (!cards.some((c) => c.name === name)) this.state.delete(name);
    // loop: SERIAL-REQUIRED — process order: one profile switch at a time (each moves the default nodes); 1-2 cards, per card event
    for (const card of cards) {
      try {
        await this.follow(card);
      } catch (cause) {
        // error: LOGGED-OK — background, not a user action: the profile stays as it was (the player can pick it in the system's sound settings); the next plug tries again
        console.warn(`[headset] couldn't switch ${card.name}'s profile:`, errorText(cause));
      }
    }
  }

  private async follow(card: AudioCard): Promise<void> {
    const st = this.cardState(card.name);
    const plugged = card.headphones ?? this.hint;
    if (plugged === null) return; // the jack isn't known
    const seen = st.plugged;
    st.plugged = plugged;
    const active = card.activeProfile;
    if (!plugged) {
      const back = st.ours !== null && active === st.ours ? st.from : null;
      st.ours = st.from = null;
      st.playerChoice = false;
      if (back && card.profiles.includes(back)) await this.switchTo(card, back, false, active);
      return;
    }
    // Headset in. A profile we didn't set while ours was active: the player's pick.
    if (st.ours !== null && active !== st.ours) {
      st.ours = st.from = null;
      st.playerChoice = true;
      return;
    }
    if (st.playerChoice || isProAudio(active) || active === "off") return;
    const target = stereoProfile(card);
    if (!target || target === active) return;
    if (st.ours !== null) {
      // Ours, and the headset's microphone showed up (or went) a moment later: the better stereo profile.
      st.ours = target;
      await this.switchTo(card, target, true, active, st.from ?? active);
      return;
    }
    if (!isSpeakerProfile(active)) return; // already a headphones profile
    // A plug we saw, or a card that just appeared with the headset in (on its
    // default speaker profile, not one the player set before).
    const plugNow = seen === false || (seen === null && active === speakerDefault(card));
    if (!plugNow) return;
    st.ours = target;
    st.from = active;
    try {
      await this.switchTo(card, target, true, active);
    } catch (cause) {
      st.ours = st.from = null;
      st.playerChoice = true; // don't try again until the next plug
      throw cause;
    }
  }

  // Switch, move the default output/input along, and report it.
  private async switchTo(card: AudioCard, to: string, plugged?: boolean, from = card.activeProfile, reportFrom = from): Promise<void> {
    const prefix = (kind: NodeKind) => cardNodePrefix(card.name, kind);
    const moving: NodeKind[] = [];
    // loop: SERIAL-REQUIRED — data dependency: both defaults are read before the switch replaces the nodes; N = 2
    for (const kind of ["sink", "source"] as const) {
      try {
        if ((await this.layer.defaultNode(kind)).startsWith(prefix(kind))) moving.push(kind);
      } catch (cause) {
        // error: LOGGED-OK — the default isn't known: it isn't moved (the system picks one, as without the app)
        logged(`reading the default ${kind}`)(cause);
      }
    }
    await this.layer.setProfile(card.name, to);
    if (plugged !== undefined) {
      const done = { card: card.name, from: reportFrom, to, plugged };
      this.last = plugged ? done : null; // Undo is for a switch to stereo only
      this.onSwitched(done);
    }
    // loop: SERIAL-REQUIRED — data dependency: each default waits for its new node; N ≤ 2
    for (const kind of moving) await this.moveDefault(kind, prefix(kind));
  }

  private async moveDefault(kind: NodeKind, prefix: string): Promise<void> {
    // loop: SERIAL-REQUIRED — retry/backoff with a deadline: the new node appears shortly after the switch (≤ 20 tries, 100 ms apart)
    for (let i = 0; i < NODE_TRIES; i++) {
      // loop: NOT-WORTH — the PC's sinks or sources, a handful; per try
      const node = (await this.layer.listNodes(kind)).find((n) => n.startsWith(prefix));
      if (node) return this.layer.setDefault(kind, node);
      await new Promise((resolve) => setTimeout(resolve, this.nodeWaitMs)); // lifetime: OK — one-shot wait inside this retry loop
    }
    // error: LOGGED-OK — the new node never appeared: the system keeps its own default (the controller's sound still plays when picked there)
    console.warn(`[headset] the controller's new ${kind} didn't appear; the default ${kind} wasn't moved`);
  }
}

// The card's default profile: the speaker with the controller's own mic.
const speakerDefault = (card: AudioCard): string | undefined => card.profiles.find((p) => isSpeakerProfile(p) && /\bMic\b/.test(p));
