// Gate: the app names the connected board ("Pico 2 W", or "your board" when
// it can't tell), never "dongle" (the owner's own slang). Every string gets the
// name from the {{device…}} variables (src/i18n/deviceForms.ts), so the word
// can't come back in any locale, and each locale only uses the variables its
// language defines.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
  "desktop.library.staleFix", // "DS5 Dongle {{version}}", the release name
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
