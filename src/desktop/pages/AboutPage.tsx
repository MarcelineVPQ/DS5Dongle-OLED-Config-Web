import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import changelog from "../../../CHANGELOG.md?raw";
import readme from "../../../README.md?raw";
import Markdown from "../Markdown";

export type AboutTab = "changes" | "firmware" | "guide" | "credits";

const CREDITS = `
### DS5 Dongle OLED Edition Configurator

MIT License. Source: [github.com/MarcelineVPQ/DS5Dongle-OLED-Config-Web](https://github.com/MarcelineVPQ/DS5Dongle-OLED-Config-Web)

Firmware: [DS5 Dongle OLED Edition](https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition), a fork of [awalol/DS5Dongle](https://github.com/awalol/DS5Dongle) (MIT). The original web config tool is [awalol/ds5dongle-config-web](https://github.com/awalol/ds5dongle-config-web).

Thanks to [loteran/DS5Dongle](https://github.com/loteran/DS5Dongle) (audio fixes and the Audio Auto Haptics DSP) and [zurce/DS5Dongle-OLED](https://github.com/zurce/DS5Dongle-OLED) (multi-slot pairing).

### Third-party assets and code

| | |
|---|---|
| Controller art and button glyphs | "PS5 Button Icons and Controls" by Zacksly, CC BY 3.0, modified. [zacksly.itch.io](https://zacksly.itch.io) |
| PICOBOOT flasher | picoflash by Piers Finlayson, MIT |
| Fonts | Space Grotesk, DM Sans, JetBrains Mono, SIL Open Font License |
| Icons | Lucide, ISC |
| Runtime | Electron, React, i18next, zod, react-markdown (MIT) |

DualSense and PlayStation are trademarks of Sony Interactive Entertainment. This project is not affiliated with Sony.
`;

export default function AboutPage({ initialTab = "changes" }: { initialTab?: AboutTab }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<AboutTab>(initialTab);
  const [firmware, setFirmware] = useState<string | null>(null);
  const [firmwareError, setFirmwareError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== "firmware" || firmware || !window.desktop) return;
    window.desktop
      .firmwareChangelog()
      .then(setFirmware)
      .catch((cause) => setFirmwareError(cause instanceof Error ? cause.message : String(cause)));
  }, [tab, firmware]);

  const tabs: Array<{ id: AboutTab; label: string }> = [
    { id: "changes", label: t("desktop.about.changes", "What's new") },
    { id: "firmware", label: t("desktop.about.firmware", "Firmware changes") },
    { id: "guide", label: t("desktop.about.guide", "Guide") },
    { id: "credits", label: t("desktop.about.credits", "Credits") },
  ];

  return (
    <div className="dk-stack">
      <div className="dk-seg" role="tablist" aria-label={t("desktop.nav.about", "About")} style={{ alignSelf: "flex-start" }}>
        {tabs.map((x) => (
          <button type="button" role="tab" key={x.id} className={tab === x.id ? "on" : ""} aria-selected={tab === x.id} onClick={() => setTab(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      <section className="dk-card">
        {window.desktop && tab === "changes" && <p className="dk-hint">{t("desktop.about.version", { version: window.desktop.appVersion, defaultValue: "You're running version {{version}}." })}</p>}
        {tab === "changes" && <Markdown text={changelog} />}
        {tab === "firmware" &&
          (firmwareError ? <p className="dk-bad">{firmwareError}</p> : firmware ? <Markdown text={firmware} /> : <p className="dk-hint">{t("desktop.about.loading", "Loading…")}</p>)}
        {tab === "guide" && <Markdown text={readme} />}
        {tab === "credits" && <Markdown text={CREDITS} />}
      </section>
    </div>
  );
}
