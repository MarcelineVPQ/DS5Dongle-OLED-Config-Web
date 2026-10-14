// Every accordion page and its sections, in order: the one registry deep
// links are typed against (revealSection(page, id) only takes an id listed
// here) and the inventory test checks the pages against. The pages not on
// the accordion yet (MIGRATED) keep their ids here so their links can be
// written now; their sections come with steps 3 and 4.
export const SECTIONS = {
  app: ["language", "appearance", "accessibility", "startup", "graphics", "updates", "privacy", "dismissed", "developer"],
  about: ["guide", "changes", "firmware", "proton", "roadmap", "credits"],
  controller: ["lightbar", "triggers", "haptics", "speaker", "mic", "buttons", "sticks", "slots", "info"],
  dongle: ["firmware", "device", "power", "oled", "usb", "diagnostics"],
  games: ["launchers", "proton", "computer", "recommended", "history"],
  game: ["profile", "setup", "hdr", "compatibility", "support", "notes", "details"],
} as const;

export type AccordionPage = keyof typeof SECTIONS;
export type SectionId<P extends AccordionPage> = (typeof SECTIONS)[P][number];

// The pages built on Section/Row so far (the settings gate's whitelist
// shrinks as this grows: tools/list_settings.mjs).
export const MIGRATED: readonly AccordionPage[] = ["app", "about", "controller", "dongle"];
