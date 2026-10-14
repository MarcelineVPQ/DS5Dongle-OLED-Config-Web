import { useEffect, useState } from "react";
import { causeText } from "../shownError";
import { appVersionLabel } from "../appVersion";
import { Bug, Code, Github, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import changelog from "../../../CHANGELOG.md?raw";
import guide from "../../../docs/GUIDE.md?raw";
import protonChangelog from "../../../docs/PROTON_CHANGELOG.md?raw";
import Markdown from "../Markdown";
import diceIcon from "../assets/42ps-dice.png";
import ComingSoon from "../about/ComingSoon";
import { ISSUES_URL } from "../about/roadmap";
import { protonApplies } from "../games/platform";

export type AboutTab = "changes" | "firmware" | "proton" | "guide" | "roadmap" | "credits";

const CREDITS = `
### Built on

Firmware: [DS5 Dongle OLED Edition](https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition), a fork of [awalol/DS5Dongle](https://github.com/awalol/DS5Dongle) (MIT). The original web config tool is [awalol/ds5dongle-config-web](https://github.com/awalol/ds5dongle-config-web).

The clean controller speaker and Bluetooth mic are [awalol](https://github.com/awalol/DS5Dongle)'s work upstream: the audio path that runs from RAM, the packed audio reports and the mic decoding (and finding the bit that turns the mic on).

Thanks to [loteran/DS5Dongle](https://github.com/loteran/DS5Dongle) (audio fixes and the Audio Auto Haptics DSP) and [zurce/DS5Dongle-OLED](https://github.com/zurce/DS5Dongle-OLED) (multi-slot pairing).

### Third-party assets and code

| What | Credit |
|---|---|
| Live controller art | DualSense art from the Gamepad Asset Pack by AL2009man, MIT, modified (recolored, parts tagged). [github.com/AL2009man/Gamepad-Asset-Pack](https://github.com/AL2009man/Gamepad-Asset-Pack) |
| DualSense Edge art | From dualsense-tester by Xuezhou Dai (daidr), MIT, modified (Sony marks removed, parts tagged). [github.com/daidr/dualsense-tester](https://github.com/daidr/dualsense-tester) |
| Controller info layouts | The controller firmware report and lifetime-counter offsets (and how to read their unwritten values) follow dualsense-tester by Xuezhou Dai (daidr), MIT. [github.com/daidr/dualsense-tester](https://github.com/daidr/dualsense-tester) |
| Tray icon and web tool art | "PS5 Button Icons and Controls" by Zacksly, CC BY 3.0, modified. [zacksly.itch.io](https://zacksly.itch.io) |
| PICOBOOT flasher | picoflash by Piers Finlayson, MIT |
| Liquid glass technique | The displacement-map refraction follows Shu Ding's liquid-glass (MIT, [github.com/shuding/liquid-glass](https://github.com/shuding/liquid-glass)), with ideas from Max Rovensky's liquid-glass-react (MIT, [github.com/rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react)); our own implementation |
| Fonts | Space Grotesk, DM Sans, JetBrains Mono, SIL Open Font License |
| Icons | Lucide, ISC |
| Launcher marks | Steam, Heroic, Lutris, GOG and Epic marks from Simple Icons, CC0. [simpleicons.org](https://simpleicons.org) |
| Runtime | Electron, React, i18next, zod, react-markdown (MIT) |

DualSense and PlayStation are trademarks of Sony Interactive Entertainment. This project is not affiliated with Sony. Steam, Heroic, Lutris, GOG and Epic Games are trademarks of their owners, shown only to name the launcher; no affiliation.
`;

const STUDIO_LINKS = [
  { href: "https://42pixelstudios.com/", icon: Globe, label: "42pixelstudios.com" },
  { href: "https://github.com/MarcelineVPQ", icon: Github, label: "github.com/MarcelineVPQ" },
  { href: "https://github.com/MarcelineVPQ/DS5Dongle-OLED-Config-Web", icon: Code, labelKey: "desktop.about.source", fallback: "Source code (MIT)" },
  { href: ISSUES_URL, icon: Bug, labelKey: "desktop.about.issues", fallback: "Report an issue" },
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
          {window.desktop && <span className="dk-studio-version"> · v{appVersionLabel()}</span>}
        </p>
        <div className="dk-studio-links">
          {/* loop: HOT-PATH-OK — N ≈ 4 studio links; About page render */}
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

export default function AboutPage({ initialTab = "guide" }: { initialTab?: AboutTab }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<AboutTab>(initialTab);
  const [firmware, setFirmware] = useState<string | null>(null);
  const [firmwareError, setFirmwareError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== "firmware" || firmware || !window.desktop) return;
    window.desktop
      .firmwareChangelog()
      .then(setFirmware)
      // error: SHOWN — english: the firmware changes tab's error (main-process text, batch E3)
      .catch((cause) => setFirmwareError(causeText(cause)));
  }, [tab, firmware]);

  // Our DualSense Proton runs Windows games on Linux: its tab shows where the
  // Games page's Proton card does (Linux only).
  const tabs: Array<{ id: AboutTab; label: string }> = [
    { id: "guide", label: t("desktop.about.guide", "Guide") },
    { id: "changes", label: t("desktop.about.changes", "App changes") },
    { id: "firmware", label: t("desktop.about.firmware", "Firmware changes") },
    ...(protonApplies() ? [{ id: "proton" as const, label: t("desktop.about.proton", "Proton changes") }] : []),
    { id: "roadmap", label: t("desktop.about.roadmapTab", "Coming soon") },
    { id: "credits", label: t("desktop.about.credits", "Credits") },
  ];

  return (
    <div className="dk-stack">
      <div className="dk-seg" role="tablist" aria-label={t("desktop.nav.about", "About")} style={{ alignSelf: "flex-start" }}>
        {/* loop: HOT-PATH-OK — N ≈ 4 tabs; About page render */}
        {tabs.map((x) => (
          <button type="button" role="tab" key={x.id} className={tab === x.id ? "on" : ""} aria-selected={tab === x.id} onClick={() => setTab(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      {tab === "credits" && <StudioCard />}
      {tab === "roadmap" ? (
        <ComingSoon />
      ) : (
        <section className="dk-card">
          {window.desktop && tab === "changes" && <p className="dk-hint">{t("desktop.about.version", { version: appVersionLabel(), defaultValue: "You're running version {{version}}." })}</p>}
          {tab === "changes" && <Markdown text={changelog} />}
          {tab === "firmware" &&
            (firmwareError ? <p className="dk-bad">{firmwareError}</p> : firmware ? <Markdown text={firmware} /> : <p className="dk-hint">{t("desktop.about.loading", "Loading…")}</p>)}
          {tab === "proton" && <Markdown text={protonChangelog} />}
          {tab === "guide" && <Markdown text={guide} />}
          {tab === "credits" && <Markdown text={CREDITS} />}
        </section>
      )}
    </div>
  );
}
