// Where a settings section's values come from and where its edits go: the
// dongle draft (DesktopApp applies it to the dongle's RAM). A game's profile
// is edited in the controller view, so the sections edit the draft only.
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { fieldIssue, type ConfigBody } from "../../protocol/config";

export type SectionProps = { bridge: UseDs5BridgeResult };

export function useFields({ bridge }: SectionProps) {
  const patch = (p: Partial<ConfigBody>) => {
    for (const k of Object.keys(p) as Array<keyof ConfigBody>) bridge.setDraftField(k, p[k] as ConfigBody[typeof k]);
  };
  return {
    d: bridge.draft,
    patch,
    set: <K extends keyof ConfigBody>(k: K, v: ConfigBody[K]) => bridge.setDraftField(k, v),
    issue: (field: keyof ConfigBody) => Boolean(fieldIssue(bridge.issues, field)),
  };
}
