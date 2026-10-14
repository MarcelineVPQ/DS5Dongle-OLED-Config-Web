// Where a settings section's values come from and where its edits go: the
// dongle draft (DesktopApp applies it to the dongle's RAM). `fields` (a game
// profile's draft) has no caller since the game page's "All settings" list
// went (a game's profile is edited in the controller view); its removal is a
// BACKLOG row.
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { fieldIssue, type ConfigBody } from "../../protocol/config";

export interface SectionFields {
  d: ConfigBody;
  patch: (p: Partial<ConfigBody>) => void;
  issue: (field: keyof ConfigBody) => boolean;
  // Profiles only: the value shown is the normal setting, not the game's own.
  normal?: (field: keyof ConfigBody) => boolean;
}

// Without `fields`, a section edits the live draft.
export type SectionProps = { bridge: UseDs5BridgeResult; fields?: SectionFields };

export function bridgeFields(bridge: UseDs5BridgeResult): SectionFields {
  return {
    d: bridge.draft,
    patch: (p) => {
      for (const k of Object.keys(p) as Array<keyof ConfigBody>) bridge.setDraftField(k, p[k] as ConfigBody[typeof k]);
    },
    issue: (f) => Boolean(fieldIssue(bridge.issues, f)),
  };
}

export function useFields({ bridge, fields }: SectionProps) {
  const { t } = useTranslation();
  const f = fields ?? bridgeFields(bridge);
  const normal = (field: keyof ConfigBody) => !!f.normal?.(field);
  return {
    d: f.d,
    patch: f.patch,
    set: <K extends keyof ConfigBody>(k: K, v: ConfigBody[K]) => f.patch({ [k]: v } as Partial<ConfigBody>),
    issue: f.issue,
    // Live edits (not a profile): actions that act on the controller now,
    // like the grip test, belong only there.
    live: !fields,
    // A control's sub line, marked when it shows the normal setting.
    // loop: NOT-WORTH — N = 2 strings
    sub: (field: keyof ConfigBody, base?: string) => (normal(field) ? [t("desktop.profile.normalSub"), base].filter(Boolean).join(" · ") : base),
    // The same mark for a section whose controls have no sub line.
    mark: (field: keyof ConfigBody) => (normal(field) ? <span className="dk-chip">{t("desktop.profile.normalSub")}</span> : null),
  };
}
