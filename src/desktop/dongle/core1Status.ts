import type { TFunction } from "i18next";
import { CORE1_MIC_FAILED, CORE1_SPEAKER_FAILED, CORE1_STAGE_RUNNING, type AudioCounters } from "../../protocol/bridgeClient";

// The Dongle page's "Core1 stopped" notice. With the firmware's start-up stage
// (0xF5 [60] bits 3..6, issue #15) it names the step core1 stopped in, plus
// the free heap at core1 start when the firmware knew it; older firmware gets
// the plain notice.
export function core1StoppedText(t: TFunction, c: AudioCounters): string {
  if (c.core1Stage === undefined || c.core1Stage > CORE1_STAGE_RUNNING) return t("desktop.diag.core1Frozen");
  const text = t("desktop.diag.core1StoppedAt", { step: t(`desktop.diag.core1Step.${c.core1Stage}`), stage: c.core1Stage });
  return c.core1FreeHeap === undefined ? text : `${text} ${t("desktop.diag.core1FreeHeap", { kb: Math.round(c.core1FreeHeap / 1024) })}`;
}

// The board's audio problems from its 0xF5 counters: one notice each on the
// Pico page, and the rail's dot on it while any is there (notices.ts).
// `reason` keys a dismissal: a different problem shows again.
export const BOARD_PROBLEM_ID = "board-audio";
export interface BoardProblem {
  // error: SHOWN — desktop.diag.core1StoppedAt / .speakerEncoderFailed / .micDecoderFailed: a notice on the Pico page and the rail's dot on it
  reason: string;
  text: string;
}
export function boardProblems(t: TFunction, c: AudioCounters, core1Alive: boolean): BoardProblem[] {
  const kb = Math.round((c.core1FreeHeap ?? 0) / 1024);
  const flags = c.core1Flags ?? 0;
  const out: BoardProblem[] = [];
  if (!core1Alive) out.push({ reason: `core1-stopped:${c.core1Stage ?? "?"}`, text: core1StoppedText(t, c) });
  if (flags & CORE1_SPEAKER_FAILED) out.push({ reason: "speaker-encoder", text: t("desktop.diag.speakerEncoderFailed", { kb }) });
  if (flags & CORE1_MIC_FAILED) out.push({ reason: "mic-decoder", text: t("desktop.diag.micDecoderFailed", { kb }) });
  return out;
}

// What boardProblems' answer is made of, as one string: two reads with the
// same key give the same problems and texts (the free heap counts only while
// a problem shows it). null alive = not known yet.
export function boardProblemsKey(c: AudioCounters, core1Alive: boolean | null): string {
  const failed = (c.core1Flags ?? 0) & (CORE1_SPEAKER_FAILED | CORE1_MIC_FAILED);
  if (core1Alive !== false && !failed) return String(core1Alive);
  const kb = c.core1FreeHeap === undefined ? "?" : Math.round(c.core1FreeHeap / 1024);
  return `${String(core1Alive)}|${c.core1Stage ?? "?"}|${failed}|${kb}`;
}
