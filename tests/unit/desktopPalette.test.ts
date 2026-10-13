import { describe, expect, it } from "vitest";
import { contrast, ensureContrast, hsvToRgb, mix, paletteToCssVars, parseKdeGlobals, rgbToHsv, type Rgb } from "../../src/desktop/theme/desktopPalette";

// A trimmed copy of a real kdeglobals (Breeze Dark with a pink accent).
const KDE_DARK = `
[Colors:Button]
BackgroundNormal=41,44,48
ForegroundNormal=252,252,252

[Colors:Selection]
BackgroundNormal=169,47,115

[Colors:View]
BackgroundNormal=20,22,24
ForegroundInactive=161,169,177
ForegroundNormal=252,252,252

[Colors:Window]
BackgroundNormal=32,35,38
ForegroundInactive=161,169,177
ForegroundNormal=252,252,252

[General]
AccentColor=233,58,154
ColorSchemeHash=abc
`;

const rgbOf = (s: string): Rgb => s.match(/\d+/g)!.map(Number) as Rgb;

describe("parseKdeGlobals", () => {
  it("reads the window, view, button colors and the accent", () => {
    const p = parseKdeGlobals(KDE_DARK)!;
    expect(p).toMatchObject({ source: "kde", isDark: true, accent: [233, 58, 154], window: [32, 35, 38], view: [20, 22, 24], button: [41, 44, 48] });
  });

  it("falls back to the selection color when there is no accent", () => {
    const p = parseKdeGlobals(KDE_DARK.replace("AccentColor=233,58,154", ""))!;
    expect(p.accent).toEqual([169, 47, 115]);
  });

  it("detects a light scheme", () => {
    const light = KDE_DARK.replace(/BackgroundNormal=32,35,38/, "BackgroundNormal=239,240,241").replace(/ForegroundNormal=252,252,252/g, "ForegroundNormal=35,38,41");
    expect(parseKdeGlobals(light)!.isDark).toBe(false);
  });

  it("returns null without a usable scheme", () => {
    expect(parseKdeGlobals("[General]\nfoo=bar\n")).toBeNull();
    expect(parseKdeGlobals("[Colors:Window]\nBackgroundNormal=999,1,1\nForegroundNormal=1,1,1\n")).toBeNull();
  });
});

describe("contrast safety", () => {
  it("lifts a too-dim color to the target contrast, keeping it if already fine", () => {
    const bg: Rgb = [20, 22, 24];
    expect(contrast(ensureContrast([60, 60, 60], bg, 4.5), bg)).toBeGreaterThanOrEqual(4.5);
    expect(ensureContrast([250, 250, 250], bg, 4.5)).toEqual([250, 250, 250]);
  });

  it("keeps every text token readable for the KDE scheme", () => {
    const vars = paletteToCssVars(parseKdeGlobals(KDE_DARK)!);
    const panel = rgbOf(vars["--bg-panel"]);
    expect(contrast(rgbOf(vars["--text-strong"]), panel)).toBeGreaterThanOrEqual(7);
    expect(contrast(rgbOf(vars["--text-muted"]), panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgbOf(vars["--dk-sel-text"]), rgbOf(vars["--dk-sel-bg"]))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgbOf(vars["--dk-on-accent"]), rgbOf(vars["--dk-accent"]))).toBeGreaterThanOrEqual(3);
  });

  it("Match desktop: accent and selection text read on the page, panel, inset and button too", () => {
    // A mid-grey accent that reads on the dark panel but not on a lighter button.
    const kde = { ...parseKdeGlobals(KDE_DARK)!, accent: [110, 110, 110] as Rgb, button: [70, 72, 76] as Rgb };
    const vars = paletteToCssVars(kde);
    const grounds = [kde.view!, kde.window!, mix(kde.window!, kde.view!, 0.5), kde.button];
    for (const g of grounds) {
      expect(contrast(rgbOf(vars["--dk-accent-text"]), g)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(rgbOf(vars["--dk-sel-text"]), g)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("converts RGB <-> HSV both ways", () => {
    expect(rgbToHsv([255, 0, 0])).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv([0, 0, 255]).h).toBe(240);
    expect(rgbToHsv([128, 128, 128]).s).toBe(0);
    for (const c of [
      [236, 72, 153],
      [12, 200, 90],
      [1, 2, 3],
      [255, 255, 255],
    ] as Rgb[])
      expect(hsvToRgb(rgbToHsv(c))).toEqual(c);
    expect(hsvToRgb({ h: 480, s: 1, v: 1 })).toEqual([0, 255, 0]); // turned past 360
    expect(hsvToRgb({ h: -120, s: 1, v: 1 })).toEqual([0, 0, 255]);
  });

  it("an accent-only palette sets the accent tokens but not the backgrounds", () => {
    const vars = paletteToCssVars({ source: "accent", isDark: false, accent: [0, 120, 212] });
    expect(vars["--dk-accent"]).toBe("rgb(0, 120, 212)");
    expect(vars["--bg-page"]).toBeUndefined();
  });

  it("never overrides the status colors", () => {
    const vars = paletteToCssVars(parseKdeGlobals(KDE_DARK)!);
    for (const key of Object.keys(vars)) expect(key).not.toMatch(/success|error|warn|chip-ok/);
  });
});
