import { useEffect, useState } from "react";
import { Bug, Code, Github, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import changelog from "../../../CHANGELOG.md?raw";
import readme from "../../../README.md?raw";
import Markdown from "../Markdown";
import diceIcon from "../assets/42ps-dice.png";

export type AboutTab = "changes" | "firmware" | "guide" | "credits";

const CREDITS = `
### Built on

Firmware: [DS5 Dongle OLED Edition](https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition), a fork of [awalol/DS5Dongle](https://github.com/awalol/DS5Dongle) (MIT). The original web config tool is [awalol/ds5dongle-config-web](https://github.com/awalol/ds5dongle-config-web).

The clean controller speaker and Bluetooth mic are [awalol](https://github.com/awalol/DS5Dongle)'s work upstream: the audio path that runs from RAM, the packed audio reports and the mic decoding (and finding the bit that turns the mic on).

Thanks to [loteran/DS5Dongle](https://github.com/loteran/DS5Dongle) (audio fixes and the Audio Auto Haptics DSP) and [zurce/DS5Dongle-OLED](https://github.com/zurce/DS5Dongle-OLED) (multi-slot pairing).

### Third-party assets and code

| What | Credit |
|---|---|
| Live controller art | DualSense art from the Gamepad Asset Pack by AL2009man, MIT, modified (recolored, parts tagged). [github.com/AL2009man/Gamepad-Asset-Pack](https://github.com/AL2009man/Gamepad-Asset-Pack) |
| Tray icon and web tool art | "PS5 Button Icons and Controls" by Zacksly, CC BY 3.0, modified. [zacksly.itch.io](https://zacksly.itch.io) |
| PICOBOOT flasher | picoflash by Piers Finlayson, MIT |
| Fonts | Space Grotesk, DM Sans, JetBrains Mono, SIL Open Font License |
| Icons | Lucide, ISC |
| Runtime | Electron, React, i18next, zod, react-markdown (MIT) |

DualSense and PlayStation are trademarks of Sony Interactive Entertainment. This project is not affiliated with Sony.
`;

const STUDIO_LINKS = [
  { href: "https://42pixelstudios.com/", icon: Globe, label: "42pixelstudios.com" },
  { href: "https://github.com/MarcelineVPQ", icon: Github, label: "github.com/MarcelineVPQ" },
  { href: "https://github.com/MarcelineVPQ/DS5Dongle-OLED-Config-Web", icon: Code, labelKey: "desktop.about.source", fallback: "Source code (MIT)" },
  { href: "https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition/issues", icon: Bug, labelKey: "desktop.about.issues", fallback: "Report an issue" },
] as const;

function StudioCard() {
  const { t } = useTranslation();
  return (
    <section className="dk-card dk-studio">
      <img className="dk-studio-logo" src={diceIcon} alt="" width={112} height={82} />
      <div className="dk-studio-text">
        <span className="dk-studio-eyebrow">{t("desktop.about.production", "A 42 Pixel Studios production")}</span>
        <h2 className="dk-studio-title">DS5 Dongle OLED Edition Configurator</h2>
        <p className="dk-studio-by">
          {t("desktop.about.developedBy", "Developed by")} <strong>Marcy Kuhn</strong>
          {window.desktop && <span className="dk-studio-version"> · v{window.desktop.appVersion}</span>}
        </p>
        <div className="dk-studio-links">
          {STUDIO_LINKS.map((l) => (
            <a key={l.href} className="dk-btn" href={l.href} target="_blank" rel="noreferrer noopener">
              <l.icon size={14} aria-hidden="true" />
              {"label" in l ? l.label : t(l.labelKey, l.fallback)}
            </a>
          ))}
        </div>
        <small className="dk-studio-copy">© {new Date().getFullYear()} 42 Pixel Studios — a Marcy Kuhn production.</small>
      </div>
    </section>
  );
}

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
      {tab === "credits" && <StudioCard />}
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
