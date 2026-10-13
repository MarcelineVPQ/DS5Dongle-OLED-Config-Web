import type { TFunction } from "i18next";
import { CORE1_STAGE_RUNNING, type AudioCounters } from "../../protocol/bridgeClient";

// The Dongle page's "Core1 stopped" notice. With the firmware's start-up stage
// (0xF5 [60] bits 3..6, issue #15) it names the step core1 stopped in, plus
// the free heap at core1 start when the firmware knew it; older firmware gets
// the plain notice.
export function core1StoppedText(t: TFunction, c: AudioCounters): string {
  if (c.core1Stage === undefined || c.core1Stage > CORE1_STAGE_RUNNING) return t("desktop.diag.core1Frozen");
  const text = t("desktop.diag.core1StoppedAt", { step: t(`desktop.diag.core1Step.${c.core1Stage}`), stage: c.core1Stage });
  return c.core1FreeHeap === undefined ? text : `${text} ${t("desktop.diag.core1FreeHeap", { kb: Math.round(c.core1FreeHeap / 1024) })}`;
}
