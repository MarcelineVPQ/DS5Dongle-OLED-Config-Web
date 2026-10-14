// The settings sections' adapter for a game profile (the game page's "All
// settings"): they show the profile's values (else the normal ones) and are
// checked like the live draft, and an edit goes to the profile draft, never
// to the dongle.
import { fieldIssue, validateConfig, type ConfigBody } from "../../protocol/config";
import { PROFILE_FIELDS, type ProfileSettings } from "../games/library";
import type { SectionFields } from "../pages/sectionFields";
import { PROFILE_GROUPS, gameGroups, profileConfig, upgradeProfile } from "./profileValues";

const PROFILE_KEYS = new Set<string>(PROFILE_FIELDS);

// `base` fills what a profile can't hold (only so the config is whole).
export function profileFields(base: ConfigBody, normal: ProfileSettings, draft: ProfileSettings, onChange: (s: ProfileSettings) => void): SectionFields {
  const d = profileConfig(base, normal, draft);
  const issues = validateConfig(d);
  const own = new Set<string>(gameGroups(draft, normal));
  let next = upgradeProfile(draft); // several edits before the next render add up
  return {
    d,
    patch: (p) => {
      next = { ...next, ...Object.fromEntries(Object.entries(p).filter(([k]) => PROFILE_KEYS.has(k))) };
      onChange(next);
    },
    issue: (f) => Boolean(fieldIssue(issues, f)),
    normal: (f) => {
      // loop: NOT-WORTH — N = 12 profile groups; per field lookup when a game page control renders
      const group = PROFILE_GROUPS.find((g) => (g.fields as readonly string[]).includes(f));
      return !!group && !own.has(group.id);
    },
  };
}
