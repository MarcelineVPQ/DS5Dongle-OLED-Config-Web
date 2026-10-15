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
  // In the next build (shipped in a Development build, or merged for the next one)
  {
    column: "next",
    title: "Quicker second start on Windows",
    text: "The app installs for your Windows user (no admin rights), opens in about a second, shows its window right away when started again, and leaves no copies in Temp.",
    areas: ["app"],
    platform: "windows",
  },
  { column: "next", title: "Lighter game check on Windows", text: "Noticing which game is running costs almost no CPU while the app is in the tray.", areas: ["app", "games"], platform: "windows" },
  { column: "next", title: "Desktop accent color on Windows", text: "The Desktop accent color follows the Windows accent color, also when you change it.", areas: ["app"], platform: "windows" },
  { column: "next", title: "Lighter on your PC", text: "The app uses almost no CPU while minimized or in the tray, and less while you watch it.", areas: ["app"], high: true },
  {
    column: "next",
    title: "Notifications in the app",
    text: "Short messages for what just happened, at the bottom right: changes saved, copied, a game's profile on or off, a controller connected. They close by themselves, wait while you point at them, and have a × to close.",
    areas: ["app"],
  },
  { column: "next", title: "Our own color picker", text: "A color picker in the app's look, with hex and R/G/B fields, recent colors and full keyboard use.", areas: ["app"], high: true },
  {
    column: "next",
    title: "Rate how your DualSense works",
    text: "A game's page asks how well your DualSense works in that game, inside DualSense support, and each star says what it means.",
    areas: ["games"],
  },
  { column: "next", title: "Your controller's colors", text: "Pick colors for the shell, the black parts, buttons, sticks and outlines of the drawing.", areas: ["controller"] },
  {
    column: "next",
    title: "Cooler, in-spec Pico 2 W",
    text: "The firmware runs the Pico 2 W at its rated speed and voltage instead of overclocked, as upstream does, and sets up its flash at boot, which fixes the speaker and haptics never starting on some boards.",
    areas: ["dongle"],
    high: true,
  },
  {
    column: "next",
    title: "DualSense Edge fixes",
    text: "The Edge is recognized more reliably, and in DS5 mode Sony's PlayStation Accessories app no longer offers a firmware update that fails.",
    areas: ["controller"],
  },
  {
    column: "next",
    title: "Edge profiles in PlayStation Accessories",
    text: "Sony's PlayStation Accessories app sees a DualSense Edge's own profiles through {{device}}, and a profile you save there shows right away.",
    areas: ["controller"],
  },
  {
    column: "next",
    title: "DualSense V2 reconnects",
    text: "Newer DualSense controllers (V2) that failed to reconnect, or made {{device}} restart over and over, connect normally: the firmware is built with the newer Pico SDK and USB stack.",
    areas: ["controller", "dongle"],
  },
  {
    column: "next",
    title: "Lighter haptic feedback processing",
    text: "{{device, capitalize}} turns games' haptic feedback into the controller's format with less work, with exactly the same feel.",
    areas: ["audio", "dongle"],
  },
  {
    column: "next",
    title: "Quicker OLED buttons, Fallback haptics come back",
    text: "Quick taps on {{device}}'s OLED screens are no longer missed, and Audio Auto Haptics' Fallback mode starts again after a game's own haptic feedback stops.",
    areas: ["dongle", "audio"],
  },
  {
    column: "next",
    title: "Sony's names for everything",
    text: "The app uses Sony's own names for the controller's parts and settings in every language, the haptic feedback test plays for 3 seconds, and buttons that wait show their progress.",
    areas: ["app"],
  },
  { column: "next", title: "Your board by its name", text: "Buttons, hints and messages name your board (for example Save to the Pico 2 W), in every language.", areas: ["app", "dongle"] },
  { column: "next", title: "Mic muted and headset indicators", text: "The live controller says when the mic is muted and when headphones are plugged in.", areas: ["controller", "audio"] },
  {
    column: "next",
    title: "Is your controller's firmware up to date?",
    text: "Controller info says whether Sony has newer firmware for your DualSense or Edge, and how to update it with Sony's own tools.",
    areas: ["controller"],
  },
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
    high: true,
  },
  {
    column: "next",
    title: "A whole tune for the speaker test",
    text: "The speaker test plays a folk tune, about a minute and a quarter, and keeps playing while you look at other pages.",
    areas: ["audio"],
  },
  {
    column: "next",
    title: "Trigger strength and more audio settings",
    text: "Weaker adaptive triggers in 10 steps (per game too), a speaker boost, a volume lock games can't override, which mic and output the controller uses, and a status pin for an LED. The mute button's light follows the mic.",
    areas: ["controller", "audio", "dongle"],
  },
  {
    column: "next",
    title: "Microphone level",
    text: "Set the controller's own mic level next to the Mic Test and watch its meter follow, the same on every system, per game too; at 0 it follows the PC's level as before.",
    areas: ["audio", "controller"],
  },
  {
    column: "next",
    title: "Mic echo cancellation",
    text: "The controller's own echo cancellation is on, so voice chat and the Mic Test no longer hear the PC's sound come back; a switch next to Microphone level turns it off, per game too.",
    areas: ["audio", "controller"],
  },
  {
    column: "next",
    title: "Controller off when the PC sleeps",
    text: "The controller turns off once the PC sleeps, and the PS button can wake the PC (both under {{deviceName}} in the app and on {{device}}'s own Settings screen).",
    areas: ["dongle", "controller"],
  },
  { column: "next", title: "Faster firmware for {{device}}", text: "The OLED screen and the speaker's audio take less of {{device}}'s time.", areas: ["dongle"] },
  { column: "next", title: "Better OLED status screen", text: "A symmetric controller on the OLED's Status screen, with Create and Options, and a version line that fits.", areas: ["dongle"] },
  {
    column: "next",
    title: "Your board's specs",
    text: "{{deviceName}}'s page lists the board's chip, memory and wireless chip, and names the screen add-on, the Waveshare Pico-OLED-1.3, with its specs.",
    areas: ["dongle"],
  },
  {
    column: "next",
    title: "Update checks only when you allow them",
    text: "With Check for updates automatically off, the app goes online for updates only when you press Check for updates, and a firmware update installs exactly the version it showed you.",
    areas: ["app", "dongle"],
    high: true,
  },
  {
    column: "next",
    title: "No restart during a firmware update",
    text: "While {{device}}'s firmware is being written, the app waits to restart or quit, so an app update can't leave {{device}} half-written.",
    areas: ["app", "dongle"],
    high: true,
  },
  {
    column: "next",
    title: "Play keeps the launcher in the background",
    text: "Play on a game's page starts the game with Steam or Heroic staying in the tray when they weren't open, instead of opening their whole window.",
    areas: ["games"],
  },
  {
    column: "next",
    title: "XInput games find the controller",
    text: "Games that only know Xbox controllers (Ghostrunner, Control) get the controller as a standard gamepad: Games sets the Proton option for them, and closes and reopens the launcher when it has to.",
    areas: ["games"],
    platform: "linux",
  },
  {
    column: "next",
    title: "Ray Tracing in more games",
    text: "Games that start in DirectX 11 and only offer Ray Tracing in DirectX 12 (Ghostrunner, Ghostrunner 2) get the game's own -dx12 flag: Games adds it to the launcher's arguments, with Undo.",
    areas: ["games"],
  },
  {
    column: "next",
    title: "HDR for games",
    text: "Games with HDR get it on Linux: Games runs them inside gamescope with HDR, on our DualSense Proton, and shows a checklist of what HDR needs.",
    areas: ["games"],
    platform: "linux",
  },

  {
    column: "next",
    title: "Proton changes",
    text: "A Proton changes tab in About lists what each build of our DualSense Proton changes on top of GE-Proton, and its known limits.",
    areas: ["games", "app"],
    platform: "linux",
  },
  {
    column: "next",
    title: "Right controls on the standard-gamepad route",
    text: "Games that get the controller as a standard gamepad (Ghostrunner) see the right buttons, sticks and triggers and can make it rumble, with the newest build of our DualSense Proton.",
    areas: ["games", "controller"],
    platform: "linux",
  },
  {
    column: "next",
    title: "Launchers stay open",
    text: "Steam and Heroic reopened by the app after a Games change, and games you start with Play, keep running when the app restarts, updates or quits.",
    areas: ["games", "app"],
  },
  {
    column: "next",
    title: "Launcher check on every OS",
    text: "Games knows whether a launcher is installed on Windows and macOS too, so a game page says when a launcher link can't open instead of assuming it can.",
    areas: ["games"],
  },
  {
    column: "next",
    title: "Full headset mic and volume",
    text: "Games → This computer finds the controller's mic level and volume left low by the system and sets them to full, with Undo.",
    areas: ["audio", "app"],
    platform: "linux",
    high: true,
  },
  {
    column: "next",
    title: "Full pairing slots say so",
    text: "With all four slots taken, Pairing slots and the board's OLED say to forget one before a new controller can pair, instead of the controller just blinking.",
    areas: ["dongle"],
  },

  // In progress
  {
    column: "progress",
    title: "More controller colors",
    text: "Colors for finer parts (touch pad, directional buttons, PS button, Edge back buttons), saved per controller, and the special editions' own colors.",
    areas: ["controller"],
  },

  // Planned
  { column: "planned", title: "Community game database", text: "See and share ratings, feedback and settings for games, per controller, with no account.", areas: ["games", "community"], high: true },
  {
    column: "planned",
    title: "One Update button",
    text: "One update for the app and {{device}}'s firmware: the app updates first, then installs its matching firmware by itself.",
    areas: ["app", "dongle"],
  },
  {
    column: "planned",
    title: "The board's OLED settings in the app",
    text: "Every setting from {{device}}'s OLED Settings screen in the app too, with the app's own controls.",
    areas: ["dongle", "app"],
  },
  {
    column: "planned",
    title: "OLED screens in Sony's words",
    text: "{{device, capitalize}}'s OLED screens use Sony's names (light bar, touch pad, haptic feedback…) where they fit.",
    areas: ["dongle"],
  },
  {
    column: "planned",
    title: "Bluetooth rests when idle",
    text: "{{device, capitalize}} stops searching for controllers all the time while none is connected: less radio use and heat.",
    areas: ["dongle"],
  },
  { column: "planned", title: "Per-trigger resistance strength", text: "Make each trigger's adaptive resistance stronger or weaker than the game sets it.", areas: ["controller"] },
  { column: "planned", title: "Trigger Lab", text: "Build your own trigger effects for L2 and R2, save them as sets, and use them in games.", areas: ["controller"] },
  { column: "planned", title: "Per-controller settings", text: "Each paired controller keeps its own haptic feedback, light bar, button assignments and speaker settings.", areas: ["controller"] },
  { column: "planned", title: "Edge on-controller profiles", text: "Read, edit and switch the profiles stored on a DualSense Edge.", areas: ["controller"] },
  { column: "planned", title: "Limited-edition looks", text: "Show a limited-edition controller's colors on the drawing; one edition first, to try it.", areas: ["controller"] },
  {
    column: "planned",
    title: "More controller tests",
    text: "Player and mute LED tests, vibration per motor, an audio file played as haptic feedback or on the speaker, and live mic listening.",
    areas: ["controller", "audio"],
  },
  { column: "planned", title: "Diagnostics in the app", text: "Run {{device}}'s checks in the app, see pass or fail for each, and copy the results into a GitHub issue.", areas: ["dongle", "app"] },
  { column: "planned", title: "Share button layouts", text: "Share your saved button layouts and use other players' layouts.", areas: ["buttons", "community"] },
  { column: "planned", title: "DLSS and Reflex on NVIDIA", text: "A per-game fix in Games that turns on DLSS and Reflex for NVIDIA graphics cards.", areas: ["games"], platform: "linux" },
  {
    column: "planned",
    title: "PlayStation button prompts",
    text: "PlayStation buttons instead of Xbox ones in games that get the controller as a standard gamepad, where the game allows it.",
    areas: ["games"],
    platform: "linux",
  },
  { column: "planned", title: "Gyro aiming outside Steam", text: "Gyroscope aiming for Heroic and Lutris games, as Steam Input gives Steam games.", areas: ["games", "controller"] },
  { column: "planned", title: "Anti-cheat warnings", text: "A game's page says up front when its anti-cheat blocks Linux.", areas: ["games"], platform: "linux" },
  { column: "planned", title: "GameMode switch", text: "Turn on Feral GameMode for a game with one switch, with Undo.", areas: ["games"], platform: "linux" },
  {
    column: "planned",
    title: "Easier DualSense Proton upgrades",
    text: "Games installs a new build of our DualSense Proton and moves your games to it, with Undo.",
    areas: ["games"],
    platform: "linux",
  },
  { column: "planned", title: "Games on macOS", text: "The Games area on macOS too: your Steam, Heroic, Epic and GOG Galaxy games and the game that's running.", areas: ["games"] },
  { column: "planned", title: "Heroic games on Windows and macOS", text: "Games finds your Heroic games on Windows and macOS too.", areas: ["games"] },
  {
    column: "planned",
    title: "Controller buttons as keyboard keys",
    text: "Make a controller button or combo press a keyboard key, like F5 to quicksave, with no extra software.",
    areas: ["buttons"],
  },
  {
    column: "planned",
    title: "OLED mirror in HDR",
    text: "On an HDR display, the app's copy of {{device}}'s OLED screen shows true black and the panel's real brightness.",
    areas: ["dongle"],
  },
  { column: "next", title: "Whole narrator lines", text: "{{device, capitalize}}'s spoken lines on the controller's speaker play without missing pieces.", areas: ["audio", "dongle"] },
  { column: "planned", title: "Speaker buffer that can't break up", text: "The speaker's audio buffer can't be set so low that the sound garbles.", areas: ["audio", "dongle"] },
  {
    column: "planned",
    title: "Launchers close cleanly",
    text: "When the app closes Heroic or Steam to save a Games change, they close without crashing.",
    areas: ["games"],
    platform: "linux",
    high: true,
  },
  {
    column: "next",
    title: "Full speaker volume after a headset unplug",
    text: "The controller's speaker keeps its full volume after you plug in and unplug a headset.",
    areas: ["audio", "dongle"],
    high: true,
  },
  {
    column: "next",
    title: "Headset sound in both ears",
    text: "A headset on the controller plays in both ears even when Linux's default sound profile sends mono.",
    areas: ["audio", "dongle"],
    platform: "linux",
    high: true,
  },
  {
    column: "planned",
    title: "Stereo when headphones go in",
    text: "Plug headphones into the controller and its sound switches to stereo; unplug them and the speaker comes back. Undo and your own choice always win.",
    areas: ["audio", "app"],
    platform: "linux",
    high: true,
  },
  { column: "next", title: "Headphones up to full volume", text: "Headphones on the controller reach the controller's full headphone volume.", areas: ["audio", "dongle"] },
  { column: "planned", title: "Clearer highs on speaker and headset", text: "Cleaner treble on the speaker and headset, from a better sample-rate step in {{device}}.", areas: ["audio", "dongle"] },
  { column: "planned", title: "Steady mic delay", text: "Your voice reaches the PC with the same short delay all session, even after a Bluetooth hiccup.", areas: ["audio", "dongle"] },
  { column: "planned", title: "Less headset delay", text: "Game sound reaches a headset on the controller about 10 ms sooner.", areas: ["audio", "dongle"] },
  { column: "planned", title: "Speaker plays both channels", text: "The controller's speaker plays the left and right channels, not only the right.", areas: ["audio", "dongle"] },
  {
    column: "planned",
    title: "Stereo setup on Windows",
    text: "The guide shows how to set the controller to Stereo on Windows, so surround games don't buzz the grips.",
    areas: ["audio"],
    platform: "windows",
  },
  { column: "planned", title: "Self-update on macOS", text: "The app downloads and installs its updates on macOS too.", areas: ["app"] },
  { column: "planned", title: "Desktop shortcut on Linux", text: "Create desktop shortcut on Linux too, not only on Windows.", areas: ["app"] },
  { column: "planned", title: "Start minimized on macOS", text: "Started with your Mac, the app opens hidden in the menu bar.", areas: ["app"] },
  {
    column: "planned",
    title: "Match desktop everywhere",
    text: "The Match desktop theme follows accent color changes right away on macOS, and takes more of the system's colors on macOS and Windows.",
    areas: ["app"],
  },
  { column: "planned", title: "Menu bar icon on macOS", text: "The menu bar icon follows light and dark menu bars on macOS.", areas: ["app"] },
  { column: "planned", title: "Clearer message when {{device}} is busy", text: "Say that another app is using {{device}}, instead of a raw USB error.", areas: ["dongle"] },

  { column: "planned", title: "Guide in every language", text: "The Guide translated into all the app's languages.", areas: ["app"] },
  { column: "planned", title: "A new welcome tour", text: "A short tour of the app, rebuilt for the current layout.", areas: ["app"] },

  // Ideas
  {
    column: "ideas",
    title: "Other controllers",
    text: "Game profiles and button layouts for controllers that don't go through {{device}}, or more Bluetooth controllers on {{device}}.",
    areas: ["controller"],
    high: true,
  },
  { column: "planned", title: "Printed colorways", text: "Controllers with a print, like Grey Camouflage, drawn with their real pattern instead of a flat color.", areas: ["controller"] },
  {
    column: "planned",
    title: "3D audio for the headset",
    text: "Surround games heard in 3D on a headset plugged into the controller: Windows Sonic on Windows, a virtual surround output on Linux.",
    areas: ["audio"],
  },
  {
    column: "planned",
    title: "Live controller widget",
    text: "A small always-on-top window (or a KDE widget) with your controller moving live: buttons, sticks, triggers and the light bar, plus battery and signal.",
    areas: ["controller", "app"],
  },

  {
    column: "planned",
    title: "Desktop notifications",
    text: "Battery low, charging complete, controller lost mid-game and updates, even while the app is in the tray. Each one can be turned off.",
    areas: ["app"],
  },
  { column: "planned", title: "Share a profile", text: "Turn a game profile or button layout into a short code a friend can paste in.", areas: ["buttons", "community"] },
  { column: "planned", title: "Thank-you wall", text: "The people who build and test the app, named in About.", areas: ["community"] },
  { column: "planned", title: "What's new", text: "A short summary of what changed after each update, and a link to the community.", areas: ["app", "community"] },
  { column: "planned", title: "More games in the background", text: "The game-art background shows your whole library, not just the last few games you played.", areas: ["games", "app"] },
  { column: "planned", title: "Pick any Proton version", text: "Choose which installed Proton a game runs with, right on its game page, with Undo.", areas: ["games"] },
  { column: "planned", title: "Game logs for bug reports", text: "Tick a box on a game's page and the next Play records a log, showing what happened with your controller.", areas: ["games"] },
  {
    column: "planned",
    title: "Clear message when new firmware won't start",
    text: "If the board comes back still waiting for firmware after an update, the app says so and offers to install again.",
    areas: ["dongle"],
  },
  { column: "planned", title: "Collapse all and clear pins", text: "A small menu at the top of every settings panel: fold every section at once, or clear your pinned sections.", areas: ["app"] },
  {
    column: "ideas",
    title: "Back up and restore your settings",
    text: "Save everything the app keeps (settings, game profiles, ratings, notes, layouts) to one file and bring it back on another PC.",
    areas: ["app"],
  },
  {
    column: "ideas",
    title: "Quick controls",
    text: "The everyday levels (haptic feedback, speaker, microphone, light bar) as sliders together in one place on the Controller page.",
    areas: ["controller"],
  },
  { column: "planned", title: "Share your OLED", text: "Save what the OLED shows as a crisp picture or a short animation, ready for Discord or your own posts.", areas: ["dongle"] },
  { column: "ideas", title: "Lock the rail collapsed", text: "A small lock in the rail's corner keeps the rail small, icons only, so it no longer opens when you point at it.", areas: ["app"] },
  { column: "ideas", title: "What the app stands for", text: "A short page in About about how the app is built: light on your PC, private, signed updates, free for everyone.", areas: ["app"] },
  { column: "ideas", title: "Controller plugins", text: "A way for others to add support for their own controllers to the app.", areas: ["controller", "community"] },
  { column: "ideas", title: "In-game overlay", text: "A small overlay over games: pop-ups like battery low or profile switched, and optionally your button presses.", areas: ["app"] },
  { column: "ideas", title: "Controller switcher in the side bar", text: "Your paired controllers listed under Controller, one click to switch.", areas: ["controller", "app"] },
  { column: "ideas", title: "Simpler layout and wording", text: "Shorter labels, fewer clicks to common things, and pairing slots that are easy to find.", areas: ["app"] },
  { column: "progress", title: "Settings that unfold in place", text: "The settings panel's sections open and close in place, with small icons, instead of switching pages.", areas: ["app"] },
  { column: "progress", title: "KEY0 and KEY1 in the app", text: "Press {{device}}'s OLED keys from the live screen on its page.", areas: ["dongle"] },
  { column: "ideas", title: "Compact layout", text: "A Compact choice in Appearance: tighter spacing so more fits on small screens.", areas: ["app"] },
  { column: "ideas", title: "Overview at a glance", text: "One screen with the connection and audio status, quick tests and quick sliders.", areas: ["app"] },
  { column: "ideas", title: "Low / Medium / High presets", text: "Quick preset buttons under strength sliders.", areas: ["app"] },
  { column: "ideas", title: "Tips on each page", text: "A small Tips card explaining each page's conventions.", areas: ["app"] },
  { column: "ideas", title: "All button assignments at a glance", text: "Every button's assignment shown around the controller drawing at once.", areas: ["buttons"] },
  { column: "ideas", title: "Button combos", text: "Run actions like vibration intensity up or down from a button combo, in every game.", areas: ["buttons"] },
  { column: "ideas", title: "Stick curves in layouts", text: "Custom stick curve points per game, and curves saved in button layouts.", areas: ["controller", "buttons"] },
  { column: "ideas", title: "Light bar modes as favorites", text: "Save rainbow, breathing and other light bar modes as favorites.", areas: ["controller"] },
  { column: "ideas", title: "Play stats", text: "What you did in each game session from the controller's own counters: button presses, trigger time, stick wear.", areas: ["controller", "games"] },
  {
    column: "ideas",
    title: "Power saving with headphones",
    text: "Optionally lower haptic feedback, trigger effects and the light bar while headphones are plugged in, to save battery.",
    areas: ["audio"],
  },
  { column: "ideas", title: "Act as a DualShock 4 or Xbox controller", text: "{{device, capitalize}} shows up as another controller for games that only support those.", areas: ["dongle"] },
  {
    column: "ideas",
    title: "No driver setup on Windows",
    text: "Talk to {{device}} in a way Windows supports out of the box, so the USB driver repair is never needed.",
    areas: ["dongle"],
    platform: "windows",
  },
  { column: "ideas", title: "OLED boot animation", text: "A short animated logo on {{device}}'s screen while it starts.", areas: ["dongle"] },
  { column: "ideas", title: "BOOTSEL button shortcuts", text: "Press the Pico's BOOTSEL button in a pattern to restart it for flashing without unplugging.", areas: ["dongle"] },
  { column: "ideas", title: "Wipe {{device}}'s flash", text: "Erase the Pico completely for a clean start.", areas: ["dongle"] },
  { column: "ideas", title: "Clearer pairing slot tile", text: 'Say "No player set" instead of a bare dash.', areas: ["dongle"] },
  { column: "ideas", title: "Brighter colors from game art", text: "Pick a more vivid color from a game's art for its page.", areas: ["games"] },
  { column: "ideas", title: "Square covers in tall windows", text: "Use a game's square or portrait cover when the window is tall and narrow.", areas: ["games"] },
  {
    column: "ideas",
    title: "No board needed (experiment)",
    text: "Look into doing {{device}}'s work on the PC itself, with the PC's own Bluetooth, so games and the app see the same device.",
    areas: ["dongle"],
  },
  { column: "ideas", title: "Lifelike controller drawing", text: "The controller drawn with real materials and light: matte shell, glossy buttons, rubber sticks.", areas: ["controller"] },
];
