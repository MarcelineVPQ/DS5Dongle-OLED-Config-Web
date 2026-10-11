// DualSense colorways by the code in the controller's factory serial (the
// dongle reads it once per connection; identity bytes 27-28). Codes from the
// community-maintained maps in dualshock-tools and daidr/dualsense-tester.
//
// Colors: the six with AL2009man art (Gamepad-Asset-Pack Theme SVGs) use that
// art's exact colors; the other plain colorways use close flat approximations.
// Special editions have printed artwork, so they keep the theme colors and
// only show their name.

export interface ColorwayColors {
  body: string;
  cap: string; // face buttons, d-pad
  dark: string; // center, triggers, bumpers
  stick: string;
  line: string; // outlines and symbols
}

export interface Colorway {
  name: string;
  colors?: ColorwayColors;
}

const DARK = "#171b20";
const STICK = "#333333";
const plain = (body: string, cap: string, line: string, dark = DARK): ColorwayColors => ({ body, cap, dark, stick: STICK, line });

export const COLORWAYS: Record<string, Colorway> = {
  "00": { name: "White", colors: plain("#ebeef0", "#e1e3e6", "#707373") },
  "01": { name: "Midnight Black", colors: plain("#232529", "#19191b", "#5d5d5d") },
  "02": { name: "Cosmic Red", colors: plain("#aa1450", "#a51249", "#ffbfbf") },
  "03": { name: "Nova Pink", colors: plain("#d94e9a", "#cd4e91", "#92235f") },
  "04": { name: "Galactic Purple", colors: plain("#493199", "#402787", "#1f174d") },
  "05": { name: "Starlight Blue", colors: plain("#6dbaf0", "#82bdf2", "#668ec0") },
  // Approximations (no art in the pack).
  "06": { name: "Grey Camouflage", colors: plain("#7b8086", "#6f747a", "#3b3f44") },
  "07": { name: "Volcanic Red", colors: plain("#8f1d24", "#86191f", "#e8a3a7") },
  "08": { name: "Sterling Silver", colors: plain("#b9bdc3", "#aeb2b8", "#5c6066") },
  "09": { name: "Cobalt Blue", colors: plain("#2443a8", "#1f3b96", "#a9b8ec") },
  "10": { name: "Chroma Teal", colors: plain("#2aa39c", "#25958e", "#0f4f4b") },
  "11": { name: "Chroma Indigo", colors: plain("#3b3c9c", "#34358d", "#b9baf0") },
  "12": { name: "Chroma Pearl", colors: plain("#e9e5ee", "#dfdae6", "#77727f") },
  "13": { name: "HyperPop Techno Red" },
  "14": { name: "HyperPop Remix Green" },
  "15": { name: "HyperPop Rhythm Blue" },
  "30": { name: "30th Anniversary" },
  Z1: { name: "God of War Ragnarök" },
  Z2: { name: "Marvel's Spider-Man 2" },
  Z3: { name: "Astro Bot" },
  Z4: { name: "Fortnite" },
  Z6: { name: "The Last of Us" },
  Z7: { name: "Ghost of Yōtei" },
  ZA: { name: "God of War 20th Anniversary" },
  ZB: { name: "Icon Blue" },
  ZD: { name: "Marathon" },
  ZE: { name: "Genshin Impact" },
  ZF: { name: "007 First Light" },
};

export function colorway(code: string | null): Colorway | null {
  return code ? (COLORWAYS[code] ?? null) : null;
}
