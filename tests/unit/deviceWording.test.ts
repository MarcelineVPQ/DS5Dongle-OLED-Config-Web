// Gate: the app names the connected board ("Pico 2 W", or "your board" when
// it can't tell), never "dongle" (the owner's own slang). Every string gets the
// name from the {{device…}} variables (src/i18n/deviceForms.ts), so the word
// can't come back in any locale, and each locale only uses the variables its
// language defines.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { firstChapters, NEWEST_BUDGET } from "../../src/desktop/Markdown";
import i18n, { setDeviceBoard } from "../../src/i18n";
import { DEVICE_FORMS } from "../../src/i18n/deviceForms";

const dir = new URL("../../src/i18n/locales/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

function strings(node: unknown, prefix = ""): [string, string][] {
  if (typeof node === "string") return [[prefix.slice(0, -1), node]];
  if (!node || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([k, v]) => strings(v, `${prefix}${k}.`));
}
const load = (file: string) => strings(JSON.parse(readFileSync(new URL(file, dir), "utf8")));

// "Dongle" and how the locales used to translate it.
const DONGLE = /dongle|ドングル|接收器|适配器|加密狗|empfänger|adaptador|adaptateur|receptor|レシーバー/i;

// The product's own name, which keeps the word (branding, not slang).
const PRODUCT_NAME = /DS5 ?Dongle/g;
const PRODUCT_NAME_KEYS = new Set([
  "__comment", // the repository URL
  "desktop.settings.psWakesPcSub", // "DS5 Dongle Wake Keyboard", the USB name the firmware gives itself
]);

const lngOf = (file: string) => file.replace(".json", "").split("-")[0];

describe("board wording", () => {
  it.each(files)("%s never says dongle", (file) => {
    const hits = load(file)
      .map(([key, value]) => [key, PRODUCT_NAME_KEYS.has(key) ? value.replace(PRODUCT_NAME, "") : value] as const)
      .filter(([, value]) => DONGLE.test(value))
      .map(([key]) => key);
    expect(hits).toEqual([]);
  });

  it.each(files)("%s only uses the board variables its language defines", (file) => {
    const forms = DEVICE_FORMS[lngOf(file)];
    expect(forms, `DEVICE_FORMS.${lngOf(file)}`).toBeDefined();
    const unknown = load(file).flatMap(([key, value]) =>
      [...value.matchAll(/\{\{\s*(device\w*)/g)]
        .map((m) => m[1])
        .filter((v) => !(v in forms))
        .map((v) => `${key}: ${v}`),
    );
    expect(unknown).toEqual([]);
  });

  it("every language has the label and running-text forms", () => {
    for (const [lng, forms] of Object.entries(DEVICE_FORMS)) {
      expect(Object.keys(forms), lng).toEqual(expect.arrayContaining(["deviceName", "device"]));
      for (const [named] of Object.values(forms)) expect(named, lng).toContain("{{name}}");
    }
  });

  it("fills in the board's name, else your board", async () => {
    await i18n.changeLanguage("en");
    setDeviceBoard(null);
    expect(i18n.t("desktop.bar.save")).toBe("Save to your board");
    expect(i18n.t("desktop.status.connected")).toBe("Your board connected");
    expect(i18n.t("desktop.curves.readFailed")).toBe("Your board didn't answer with its curves.");
    setDeviceBoard("Pico 2 W");
    expect(i18n.t("desktop.bar.save")).toBe("Save to the Pico 2 W");
    expect(i18n.t("desktop.curves.readFailed")).toBe("The Pico 2 W didn't answer with its curves.");
    expect(i18n.t("desktop.status.connected")).toBe("Pico 2 W connected");
    await i18n.changeLanguage("de");
    expect(i18n.t("desktop.bar.save")).toBe("Auf dem Pico 2 W speichern");
    setDeviceBoard(null);
    expect(i18n.t("desktop.bar.save")).toBe("Auf deinem Board speichern");
    await i18n.changeLanguage("en");
  });
});

// The documents the app shows (About bundles the guide and the three
// changelogs; the update banner shows a release's CHANGELOG notes) and the
// public README say "board" too. A changelog is checked where it is shown by
// default: [Unreleased], the newest release (the update banner's notes) and
// whatever About opens on (NEWEST_BUDGET). Older releases are the historical
// record, written before the rule; they stay as written and show only on
// request. Link targets, URLs and the product's own name don't count.
describe("board wording in the documents the app shows", () => {
  const repo = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const shownByDefault = (md: string) => {
    const opened = firstChapters(md, NEWEST_BUDGET)?.text ?? md;
    // loop: test fixture
    const heads = [...md.matchAll(/^## /gm)].map((m) => m.index);
    const top = md.slice(0, heads[/^## \[Unreleased\]/m.test(md) ? 2 : 1] ?? md.length);
    return opened.length > top.length ? opened : top;
  };
  const bare = (name: string, text: string) =>
    text.split("\n").flatMap((line, i) => {
      const visible = line
        .replace(/\]\([^)]*\)/g, "]")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/DS5 ?Dongle/gi, "");
      return /dongle/i.test(visible) ? [`${name}:${i + 1}: ${line.trim().slice(0, 120)}`] : [];
    });

  it.each([
    ["docs/GUIDE.md", (t: string) => t],
    ["README.md", (t: string) => t],
    ["CHANGELOG.md", shownByDefault],
    ["docs/PROTON_CHANGELOG.md", shownByDefault],
  ])("%s never says dongle", (file, part) => {
    expect(bare(file, part(repo(file)))).toEqual([]);
  });

  const fwLog = process.env.DS5_FIRMWARE_REPO ? join(process.env.DS5_FIRMWARE_REPO, "CHANGELOG.md") : null;
  // Skipped only when no firmware checkout is named (CI names one; a checkout next to this one may be on any branch).
  it.skipIf(!fwLog)("the firmware's CHANGELOG.md (About → Firmware changes) never says dongle where it is shown by default", () => {
    expect(bare("firmware CHANGELOG.md", shownByDefault(readFileSync(fwLog!, "utf8")))).toEqual([]);
  });
});
