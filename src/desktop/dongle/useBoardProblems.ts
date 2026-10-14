// The board's audio problems for the rail's dot on its page (notices.ts):
// one 0xF5 read every 10 s while the window is on screen (usePoll pauses it
// while hidden). Core1 counts as stopped when its loop count didn't move
// between two reads. The Pico page reads the same counters every second for
// its own notices.
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import type { AudioCounters, Ds5BridgeClient } from "../../protocol/bridgeClient";
import { usePoll } from "../usePoll";
import { boardProblems, type BoardProblem } from "./core1Status";

const HEALTH_POLL_MS = 10_000;

// null while not known (no board, older firmware, no read yet).
export function useBoardProblems(bridge: UseDs5BridgeResult): BoardProblem[] | null {
  const { t } = useTranslation();
  const client = bridge.client;
  // cache: OK — key=the board client; invalidated=each read, a new client starts over; bound=1 entry
  const prev = useRef<{ client: Ds5BridgeClient; loops: number } | null>(null);
  // lifetime: OK — usePoll: 10 s, stops when hidden, without a board, or on unmount
  // error: NOT-WORTH — an unanswered read leaves the dot unknown; the Pico page shows its own read errors next to its readouts
  const { value } = usePoll(
    async (): Promise<{ counters: AudioCounters; alive: boolean | null }> => {
      const counters = await client!.readAudioCounters();
      const p = prev.current;
      // The first read of a board can't tell yet (null: not known).
      const alive = !p || p.client !== client ? null : counters.core1Loops !== p.loops;
      prev.current = { client: client!, loops: counters.core1Loops };
      return { counters, alive };
    },
    HEALTH_POLL_MS,
    Boolean(client),
  );
  return value && value.alive !== null ? boardProblems(t, value.counters, value.alive) : null;
}
