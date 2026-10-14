// Linux: keeps the controller's volume and microphone level at full while the
// app runs, for a player who applied the Games fix "Turn the controller's
// volume and microphone level up to full" (the controllerVolumeFull setting).
// The saved state (system.ts saveCardState) already makes the system's own
// restore bring them back full; this covers the cases it can't: the password
// prompt was cancelled, or something saved lower levels since.
//
// No polling: a sound card appearing or going creates or removes its control
// node in /dev/snd (inotify through fs.watch). udev's `alsactl restore` for
// the new card runs during udev's rule processing, before the desktop session
// is given access to the node, so the check waits until things settle and
// tries again a few times while the card can't be opened yet.
import { watch } from "node:fs";
import { errorText, logged } from "../../../src/errorText";
import { amixerLayer, raiseLowDualSenseMixers, type MixerLayer } from "./system";

/** Something that calls back when a sound card may have appeared; returns its stop. */
export type CardEvents = (onChange: () => void) => () => void;

export const devSndEvents: CardEvents = (onChange) => {
  // lifetime: OK — closed by the returned stop (VolumeKeeper.stop: the setting turned off, or quit)
  const watcher = watch("/dev/snd", (_event, file) => {
    if (file && /^controlC\d+$/.test(String(file))) onChange();
  });
  return () => watcher.close();
};

const SETTLE_MS = 1500;
const TRIES = 4;

export class VolumeKeeper {
  private stopEvents: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tries = 0;

  constructor(
    private readonly onRaised: () => void, // the page's notice: "Controller volume restored to full"
    private readonly layer: MixerLayer = amixerLayer,
    private readonly events: CardEvents = devSndEvents,
    private readonly settleMs = SETTLE_MS,
  ) {}

  get running(): boolean {
    return this.stopEvents !== null;
  }

  /** Watch for cards, and check the ones already there (the app just started,
   * or the fix was just applied). */
  start(): void {
    if (this.stopEvents) return;
    try {
      this.stopEvents = this.events(() => this.schedule());
    } catch (cause) {
      // error: LOGGED-OK — no /dev/snd to watch (no sound cards): nothing to keep; the Games page still shows low levels with its fix
      console.warn("[volume] can't watch for sound cards:", errorText(cause));
      return;
    }
    this.schedule();
  }

  stop(): void {
    this.stopEvents?.();
    this.stopEvents = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // Each event pushes the check back: a card's nodes come in a burst.
  private schedule(): void {
    this.tries = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(this.runCheck, this.settleMs); // lifetime: OK — one-shot, cleared by the next event or stop()
  }

  private readonly runCheck = (): void => void this.check().catch(logged("checking the controller volume (check() catches its own errors)"));

  private async check(): Promise<void> {
    this.timer = null;
    try {
      if ((await raiseLowDualSenseMixers(this.layer)) > 0) this.onRaised();
    } catch (cause) {
      // error: LOGGED-OK — retried a few times below, then logged: background, not a user action (the Games page offers the fix again)
      // The card isn't open to this user yet (udev still at work), or it went
      // away: try again a little later, a few times.
      if (this.stopEvents && ++this.tries < TRIES) {
        this.timer = setTimeout(this.runCheck, this.settleMs); // lifetime: OK — one-shot retry, cleared by the next event or stop()
        return;
      }
      // error: LOGGED-OK — background, not a user action: the levels stay low and the Games page offers the fix again with what happened
      console.warn("[volume] couldn't set the controller's volume to full:", errorText(cause));
    }
  }
}
