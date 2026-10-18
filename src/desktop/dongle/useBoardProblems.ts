// The board's audio problems for the rail's dot on its page (notices.ts):
// one 0xF5 read every 10 s while the window is on screen (usePoll pauses it
// while hidden). Core1 counts as stopped when its loop count didn't move
// between two reads. The Pico page reads the same counters every second for
// its own notices.
//
// The read hands back the same object while nothing the problems are made of
// changed (boardProblemsKey), so a read every 10 s doesn't re-render the
// whole app: this hook sits in DesktopApp, and a new value each read (the
// loop count always moves) re-rendered every page while idle (2026-10-18,
// the Windows memory creep).
import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import type { AudioCounters, Ds5BridgeClient } from "../../protocol/bridgeClient";
import { usePoll } from "../usePoll";
import { boardProblems, boardProblemsKey, type BoardProblem } from "./core1Status";

const HEALTH_POLL_MS = 10_000;

// null while not known (no board, older firmware, no read yet).
export function useBoardProblems(bridge: UseDs5BridgeResult): BoardProblem[] | null {
  const { t } = useTranslation();
  const client = bridge.client;
  // cache: OK — key=the board client; invalidated=each read, a new client starts over; bound=1 entry
  const prev = useRef<{ client: Ds5BridgeClient; loops: number; shown: Health | null } | null>(null);
  // lifetime: OK — usePoll: 10 s, stops when hidden, without a board, or on unmount
  // error: NOT-WORTH — an unanswered read leaves the dot unknown; the Pico page shows its own read errors next to its readouts
  const { value } = usePoll(
    async (): Promise<Health> => {
      const counters = await client!.readAudioCounters();
      const p = prev.current;
      // The first read of a board can't tell yet (null: not known).
      const alive = !p || p.client !== client ? null : counters.core1Loops !== p.loops;
      const last = p && p.client === client ? p.shown : null;
      const shown = last && boardProblemsKey(last.counters, last.alive) === boardProblemsKey(counters, alive) ? last : { counters, alive };
      prev.current = { client: client!, loops: counters.core1Loops, shown };
      return shown;
    },
    HEALTH_POLL_MS,
    Boolean(client),
  );
  return useMemo(() => (value && value.alive !== null ? boardProblems(t, value.counters, value.alive) : null), [value, t]);
}

interface Health {
  counters: AudioCounters;
  alive: boolean | null;
}
