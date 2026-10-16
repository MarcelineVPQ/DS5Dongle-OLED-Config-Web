// Every accordion page and its sections, in order: the one registry deep
// links are typed against (revealSection(page, id) only takes an id listed
// here) and the inventory test checks the pages against. Every page is on
// the accordion (main view left, sections right). The accordion holds
// settings and actions only; readouts and info are main-view blocks
// (MAIN_BLOCKS, MainBlock.tsx), gated by tools/list_settings.mjs.
export const SECTIONS = {
  app: ["language", "appearance", "accessibility", "startup", "graphics", "updates", "privacy", "dismissed", "developer"],
  about: ["guide", "changes", "firmware", "proton", "roadmap", "credits"],
  controller: ["lightbar", "triggers", "haptics", "speaker", "mic", "buttons", "sticks", "slots"],
  dongle: ["firmware", "device", "power", "oled", "usb"],
  games: ["launchers", "proton", "recommended", "history"],
  game: ["profile", "setup", "compatibility", "hdr", "report", "notes"],
} as const;

// The readouts in each page's main view (MainBlock.tsx): deep links to them
// (revealBlock) are typed against this list, like the sections'.
export const MAIN_BLOCKS = {
  controller: ["info"],
  dongle: ["diagnostics"],
  games: ["computer"],
  game: ["support", "details"],
} as const;

export type AccordionPage = keyof typeof SECTIONS;
export type BlockPage = keyof typeof MAIN_BLOCKS;
export type BlockId<P extends BlockPage> = (typeof MAIN_BLOCKS)[P][number];
export type SectionId<P extends AccordionPage> = (typeof SECTIONS)[P][number];
