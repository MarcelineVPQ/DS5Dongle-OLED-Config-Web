// Live from the board (protocol 1.24, [58] bit 3; the firmware's
// docs/TENSION_BUTTONS.md §6.4): what the board really sent and the PC really
// fetched, not what the app expects. One poll (GET 0xE8, 30 a second) runs
// only while Button assignments is open and the window shown (usePoll pauses
// while hidden); an unchanged reply keeps the last object, so nothing
// re-renders. Shown twice from that one reading: the chip beside the drawing
// and the section's live line.
//
// Idle cost: 0 frames a second (nothing changes). During a hold the ring
// fills by one CSS animation in 10 steps (≤ 10 repaints a second, also on the
// CPU fallback), started with the time left from the board's own timer; after
// release the chip fades by one CSS animation. Hidden: no polls, nothing drawn.
//
// Keys and mouse pause ([58] bit 4, §5.5): while the window has the focus and
// the Controller page is shown, a key from the board would land in this app,
// so the app asks the board once a second to pause them for 2 s; the board
// ends the pause by itself when the asking stops.
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { FEATURES5, type Ds5BridgeClient } from "../../protocol/bridgeClient";
import { sameLiveTruth, type ButtonPart, type LiveTruth } from "../../protocol/buttons";
import { usePoll } from "../usePoll";
import { useWindowFocused } from "../useWindowShown";
import { layerName, sourceName, targetName } from "./buttonWords";

// error: SHOWN — desktop.errors.board.timeout and the other keyed board errors (causeText, usePoll) in Live from the board's line (LiveLine)
export function useLiveTruth(client: Ds5BridgeClient | null, enabled: boolean): { truth: LiveTruth | null; error: string | null } {
  // cache: OK — key=none (the last reading); invalidated=every poll (replaced when it differs); bound=1 entry
  const last = useRef<LiveTruth | null>(null);
  // lifetime: OK — usePoll stops when Button assignments closes, on unmount and while hidden
  const { value, error } = usePoll(
    async () => {
      const next = await client!.readLiveTruth();
      if (!sameLiveTruth(last.current, next)) last.current = next;
      return last.current;
    },
    33,
    enabled && !!client && client.has5(FEATURES5.liveTruth),
  );
  return { truth: value, error };
}

export function useKeysMousePause(client: Ds5BridgeClient | null, enabled: boolean): void {
  const focused = useWindowFocused();
  // lifetime: OK — usePoll stops on blur, when the page goes, on unmount and while hidden; the board ends the pause itself 2 s later
  usePoll(() => client!.pauseKeysMouse(2), 1000, enabled && focused && !!client);
}

// The sentence: "Cross ✕ → Base · Hold → PC got Triangle", or with keys and
// mouse paused "… → would send F5".
export function liveSentence(t: ReturnType<typeof useTranslation>["t"], truth: LiveTruth, part: ButtonPart): string | null {
  const ev = truth.last;
  if (!ev) return null;
  const vars = {
    from: sourceName(t, ev.source),
    layer: layerName(t, part, ev.layer),
    type: t(`desktop.buttons.live.type.${ev.type}`),
    to: ev.target.kind === 0 && ev.target.a === 0 ? t("desktop.buttons.live.nothing") : targetName(t, part, ev.target),
  };
  return t(truth.paused ? "desktop.buttons.live.wouldSend" : "desktop.buttons.live.line", vars);
}

// The hold ring: fills from the board's held / needs time, in 10 steps.
function HoldRing({ truth }: { truth: LiveTruth }) {
  const ev = truth.last;
  if (!ev || ev.phase !== "deciding" || ev.needsMs === 0) return null;
  const left = Math.max(0, ev.needsMs - ev.heldMs);
  const from = Math.min(1, ev.heldMs / ev.needsMs);
  return <span key={`${ev.source}-${ev.needsMs}`} className="bt-ring" aria-hidden="true" style={{ animationDuration: `${left}ms`, ["--from" as string]: from }} />;
}

// The section's live line (page rule 5, Q2: the meter of its own settings).
// error: SHOWN — desktop.errors.board.timeout and the other keyed board errors (causeText, usePoll) in Live from the board's line (LiveLine)
export function LiveLine({ truth, error, part, connected }: { truth: LiveTruth | null; error: string | null; part: ButtonPart; connected: boolean }) {
  const { t } = useTranslation();
  const line = truth ? liveSentence(t, truth, part) : null;
  return (
    <>
      {error && <p className="dk-hint invalid">{error}</p>}
      <p className="dk-mono bt-live" role="status" aria-live="polite">
        {!connected ? t("desktop.buttons.live.noController") : (line ?? t("desktop.buttons.live.idle"))}
        {truth && <HoldRing truth={truth} />}
      </p>
      {truth?.paused && <p className="dk-hint">{t("desktop.buttons.warn.paused")}</p>}
    </>
  );
}

// The chip beside the drawing: the same sentence in the layer's colour; it
// stays 1.5 s after release, then fades.
export function LiveChip({ truth, part }: { truth: LiveTruth | null; part: ButtonPart }) {
  const { t } = useTranslation();
  const ev = truth?.last;
  if (!truth || !ev) return null;
  const colour = ev.layer > 0 ? (part.layers[ev.layer - 1]?.colour ?? 0) : null;
  return (
    <div key={`${ev.source}-${ev.type}-${ev.layer}`} className={`bt-chip${ev.phase === "released" ? " gone" : ""}${colour !== null ? ` layer-c${colour}` : ""}`} aria-hidden="true">
      {liveSentence(t, truth, part)}
      <HoldRing truth={truth} />
    </div>
  );
}
