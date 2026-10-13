// About → Coming soon: the public face of docs/BACKLOG.md. BACKLOG.md is
// internal (paths, names, hosts, notes for agents) and never ships; this file
// is the curated, user-facing copy of its rows. Keep the two in sync: when a
// backlog row is added, changes status or ships, change its entry here in the
// same commit (and drop "next" entries once they're in a stable release).
//
// Left out on purpose: developer and test tooling, servers and hosting,
// telemetry (no wording about it until it exists), secrets, and anything a
// user never sees. No dates, no promises. The text stays English like the
// Guide and the changelog; the board's labels are translated.

/** Where suggestions and bug reports go (About's Report an issue, Coming soon). */
export const ISSUES_URL = "https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition/issues";

/** next: done, in the next stable release (already in Development builds). */
export type RoadmapColumn = "next" | "progress" | "planned" | "ideas";
export type RoadmapArea = "controller" | "buttons" | "audio" | "games" | "dongle" | "app" | "community";
/** Only where it matters; no platform means every platform. */
export type RoadmapPlatform = "linux" | "windows";

export interface RoadmapItem {
  title: string;
  text: string;
  column: RoadmapColumn;
  areas: RoadmapArea[];
  platform?: RoadmapPlatform;
  /** High priority in the backlog. */
  high?: boolean;
}

export const ROADMAP_COLUMNS: RoadmapColumn[] = ["next", "progress", "planned", "ideas"];

export const ROADMAP: RoadmapItem[] = [
  // In the next build
  { column: "next", title: "Lighter on your PC", text: "The app uses almost no CPU while minimized or in the tray, and less while you watch it.", areas: ["app"], high: true },
  { column: "next", title: "Our own color picker", text: "A color picker in the app's look, with hex and R/G/B fields, recent colors and full keyboard use.", areas: ["app"], high: true },
  { column: "next", title: "Your controller's colors", text: "Pick colors for the shell, the black parts, buttons, sticks and outlines of the drawing.", areas: ["controller"] },
  { column: "next", title: "Mic muted and headset indicators", text: "The live controller says when the mic is muted and when headphones are plugged in.", areas: ["controller", "audio"] },

  // In progress
  {
    column: "progress",
    title: "More controller colors",
    text: "Colors for finer parts (touch pad, directional buttons, PS button, Edge back buttons), saved per controller, and the special editions' own colors.",
    areas: ["controller"],
  },

  {
    column: "progress",
    title: "Is your controller's firmware up to date?",
    text: "Controller info says whether Sony has newer firmware for your DualSense or Edge, and how to update it with Sony's own tools.",
    areas: ["controller"],
  },

  // Planned
  {
    column: "next",
    title: "Controller health and info",
    text: "Your controller's firmware versions, lifetime counters (charge cycles, play time, button presses) and battery voltage.",
    areas: ["controller"],
    high: true,
  },
  {
    column: "next",
    title: "Profiles hold every setting",
    text: "A game's profile keeps your whole setup, edited in the controller view and felt live while you edit.",
    areas: ["games"],
    platform: "linux",
    high: true,
  },
  {
    column: "planned",
    title: "Community game database",
    text: "See and share ratings, feedback and settings for games, per controller, with no account.",
    areas: ["games", "community"],
    platform: "linux",
    high: true,
  },
  { column: "planned", title: "Per-trigger resistance strength", text: "Make each trigger's adaptive resistance stronger or weaker than the game sets it.", areas: ["controller"] },
  { column: "planned", title: "Trigger Lab", text: "Build your own trigger effects for L2 and R2, save them as sets, and use them in games.", areas: ["controller"] },
  { column: "planned", title: "Per-controller settings", text: "Each paired controller keeps its own haptic feedback, light bar, button assignments and speaker settings.", areas: ["controller"] },
  { column: "planned", title: "Edge on-controller profiles", text: "Read, edit and switch the profiles stored on a DualSense Edge.", areas: ["controller"] },
  { column: "planned", title: "Limited-edition looks", text: "Show a limited-edition controller's colors on the drawing; one edition first, to try it.", areas: ["controller"] },
  { column: "next", title: "Louder speaker test", text: "The speaker test chime plays about as loud as games do.", areas: ["audio"] },
  {
    column: "planned",
    title: "More controller tests",
    text: "Player and mute LED tests, vibration per motor, an audio file played as haptic feedback or on the speaker, and live mic listening.",
    areas: ["controller", "audio"],
  },
  { column: "planned", title: "Diagnostics in the app", text: "Run the dongle's checks in the app, see pass or fail for each, and copy the results into a GitHub issue.", areas: ["dongle", "app"] },
  { column: "planned", title: "Share button layouts", text: "Share your saved button layouts and use other players' layouts.", areas: ["buttons", "community"] },
  { column: "next", title: "Faster dongle firmware", text: "The dongle's screen and the speaker's audio take less of the dongle's time.", areas: ["dongle"] },
  { column: "next", title: "Better OLED status screen", text: "A symmetric controller on the OLED's Status screen, with Create and Options, and a version line that fits.", areas: ["dongle"] },
  { column: "planned", title: "Clearer message when the dongle is busy", text: "Say that another app is using the dongle, instead of a raw USB error.", areas: ["dongle"], platform: "linux" },
  { column: "planned", title: "Desktop accent color on Windows", text: "Make the Desktop accent color follow the Windows accent color.", areas: ["app"], platform: "windows" },
  { column: "planned", title: "Guide in every language", text: "The Guide translated into all the app's languages.", areas: ["app"] },
  { column: "planned", title: "A new welcome tour", text: "A short tour of the app, rebuilt for the current layout.", areas: ["app"] },

  // Ideas
  {
    column: "ideas",
    title: "Other controllers",
    text: "Game profiles and button layouts for controllers that don't go through the dongle, or more Bluetooth controllers on the dongle.",
    areas: ["controller"],
    high: true,
  },
  { column: "ideas", title: "In-game overlay", text: "A small overlay over games: pop-ups like battery low or profile switched, and optionally your button presses.", areas: ["app"] },
  { column: "ideas", title: "Controller switcher in the side bar", text: "Your paired controllers listed under Controller, one click to switch.", areas: ["controller", "app"] },
  { column: "ideas", title: "Simpler layout and wording", text: "Shorter labels, fewer clicks to common things, and pairing slots that are easy to find.", areas: ["app"] },
  { column: "ideas", title: "Overview at a glance", text: "One screen with the connection and audio status, quick tests and quick sliders.", areas: ["app"] },
  { column: "ideas", title: "Low / Medium / High presets", text: "Quick preset buttons under strength sliders.", areas: ["app"] },
  { column: "ideas", title: "Tips on each page", text: "A small Tips card explaining each page's conventions.", areas: ["app"] },
  { column: "ideas", title: "All button assignments at a glance", text: "Every button's assignment shown around the controller drawing at once.", areas: ["buttons"] },
  { column: "ideas", title: "Button combos", text: "Run actions like vibration intensity up or down from a button combo, in every game.", areas: ["buttons"] },
  { column: "ideas", title: "Stick curves in layouts", text: "Custom stick curve points per game, and curves saved in button layouts.", areas: ["controller", "buttons"] },
  { column: "ideas", title: "Light bar modes as favorites", text: "Save rainbow, breathing and other light bar modes as favorites.", areas: ["controller"] },
  {
    column: "ideas",
    title: "Power saving with headphones",
    text: "Optionally lower haptic feedback, trigger effects and the light bar while headphones are plugged in, to save battery.",
    areas: ["audio"],
  },
  { column: "ideas", title: "Act as a DualShock 4 or Xbox controller", text: "The dongle shows up as another controller for games that only support those.", areas: ["dongle"] },
  {
    column: "ideas",
    title: "No driver setup on Windows",
    text: "Talk to the dongle in a way Windows supports out of the box, so the USB driver repair is never needed.",
    areas: ["dongle"],
    platform: "windows",
  },
  { column: "ideas", title: "BOOTSEL button shortcuts", text: "Press the Pico's BOOTSEL button in a pattern to restart it for flashing without unplugging.", areas: ["dongle"] },
  { column: "ideas", title: "Wipe the dongle's flash", text: "Erase the Pico completely for a clean start.", areas: ["dongle"] },
  { column: "ideas", title: "Clearer pairing slot tile", text: 'Say "No player set" instead of a bare dash.', areas: ["dongle"], platform: "windows" },
  { column: "ideas", title: "Brighter colors from game art", text: "Pick a more vivid color from a game's art for its page.", areas: ["games"], platform: "linux" },
  { column: "ideas", title: "Square covers in tall windows", text: "Use a game's square or portrait cover when the window is tall and narrow.", areas: ["games"], platform: "linux" },
];
