// About: the open text in the main view (the guide, a changelog, the
// roadmap or the credits) and its sections in the panel. The open section
// lists its text's chapters; a click scrolls the main view there. Nothing
// here polls: the texts are bundled.
import { useEffect, useMemo, useState } from "react";
import { appVersionLabel } from "../appVersion";
import { BookOpen, Bug, Code, Cpu, Flag, Github, Globe, Heart, Layers, ScrollText, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import changelog from "../../../CHANGELOG.md?raw";
import guide from "../../../docs/GUIDE.md?raw";
import protonChangelog from "../../../docs/PROTON_CHANGELOG.md?raw";
// The firmware repo's CHANGELOG.md, bundled at build time (firmwareChangelog.config.ts).
import firmwareChangelog from "@firmware-changelog?raw";
import Markdown, { markdownHeadings, plainHeading, scrollToHeading } from "../Markdown";
import diceIcon from "../assets/42ps-dice.png";
import ComingSoon from "../about/ComingSoon";
import { ISSUES_URL, ROADMAP_COLUMNS } from "../about/roadmap";
import { Section, SplitView } from "../accordion/Section";
import { pinScope, useAccordion } from "../accordion/useAccordion";
import type { SectionId } from "../accordion/sections";
import { TOUR_ENABLED, startTour } from "../tour/Tour";
import { protonApplies } from "../games/platform";

export type AboutTab = SectionId<"about">;

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
    // settings-gate: not-settings — the studio's credit card in About's text, not a settings card
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

// Each section: its icon, title key and text (Coming soon is the roadmap board).
const TEXTS: Record<AboutTab, { icon: LucideIcon; title: string; text: string | null }> = {
  guide: { icon: BookOpen, title: "desktop.about.guide", text: guide },
  changes: { icon: ScrollText, title: "desktop.about.changes", text: changelog },
  firmware: { icon: Cpu, title: "desktop.about.firmware", text: firmwareChangelog },
  proton: { icon: Layers, title: "desktop.about.proton", text: protonChangelog },
  roadmap: { icon: Flag, title: "desktop.about.roadmapTab", text: null },
  credits: { icon: Heart, title: "desktop.about.credits", text: CREDITS },
};

// The newest version a changelog lists ("0.9.5-dev.11" from "[0.9.5-dev.11] - date").
const newest = (headings: string[]) => headings.find((h) => !/^unreleased$/i.test(h))?.split(" ")[0] ?? null; // loop: NOT-WORTH — stops at the first released heading

export default function AboutPage({ whatsNew = null, onSeen }: { whatsNew?: string | null; onSeen?: () => void }) {
  const { t } = useTranslation();
  // Our DualSense Proton runs Windows games on Linux: its section shows where
  // the Games page's Proton section does (Linux only).
  // loop: NOT-WORTH — N = 6 sections; About's render
  const ids = (Object.keys(TEXTS) as AboutTab[]).filter((id) => id !== "proton" || protonApplies());
  const acc = useAccordion("about", pinScope("about"), whatsNew ? "changes" : null);
  // cache: OK — key=the bundled texts (fixed per build); invalidated=never (bundled); bound=6 lists
  const headings = useMemo(
    // loop: NOT-WORTH — N = 6 texts, once per mount
    () => Object.fromEntries(Object.entries(TEXTS).map(([id, x]) => [id, x.text ? markdownHeadings(x.text) : []])) as Record<AboutTab, string[]>,
    [],
  );
  // The main view shows the open section's text (an unpinned one first), and
  // keeps the last one shown while all are folded.
  // loop: NOT-WORTH — N = 6 sections; About's render
  const openNow = ids.find((id) => acc.isOpen(id) && !acc.isPinned(id)) ?? ids.find((id) => acc.isOpen(id));
  const [doc, setDoc] = useState<AboutTab>(openNow ?? "guide");
  const [at, setAt] = useState<string | null>(null); // the chapter last clicked
  // A section opened: its text shows (set while rendering, React's pattern for state that follows other state).
  const [lastOpen, setLastOpen] = useState(openNow);
  if (openNow !== lastOpen) {
    setLastOpen(openNow);
    if (openNow) {
      setDoc(openNow);
      setAt(null);
    }
  }
  // App changes seen: the "Updated to" notice and the dot go.
  // lifetime: OK — acquires nothing (marks the new version seen)
  useEffect(() => {
    if (doc === "changes" && whatsNew) onSeen?.();
  }, [doc, whatsNew, onSeen]);

  const statuses: Record<AboutTab, string | null> = {
    guide: t("desktop.accordion.chapters", { count: headings.guide.length }),
    changes: newest(headings.changes),
    firmware: newest(headings.firmware),
    proton: newest(headings.proton),
    // loop: NOT-WORTH — N = 4 columns; About's render
    roadmap: ROADMAP_COLUMNS.map((c) => t(`desktop.about.roadmap.column.${c}`)).join(" · "),
    credits: t("desktop.about.production"),
  };
  // Chapters: the text's headings, or Coming soon's columns.
  // loop: NOT-WORTH — N = 4 columns; only while Coming soon is open
  const chapters = (id: AboutTab) => (id === "roadmap" ? ROADMAP_COLUMNS.map((c) => t(`desktop.about.roadmap.column.${c}`)) : headings[id]);
  const go = (id: AboutTab, chapter: string) => {
    setDoc(id);
    setAt(chapter);
    // After the text for that section is shown.
    // lifetime: OK — fires once (scrolls after the next paint)
    requestAnimationFrame(() => scrollToHeading(document.querySelector(".dk-about-text"), (h) => plainHeading(h).startsWith(chapter)));
  };

  const text = TEXTS[doc].text;
  const main = (
    <article className="dk-about-text">
      <span className="dk-subhead">{t(TEXTS[doc].title)}</span>
      {window.desktop && <p className="dk-hint">{t("desktop.about.version", { version: appVersionLabel(), defaultValue: "You're running version {{version}}." })}</p>}
      {doc === "credits" && <StudioCard />}
      {doc === "roadmap" ? (
        <ComingSoon />
      ) : (
        text && (
          <div className="dk-card dk-doc">
            <Markdown text={text} />
          </div>
        )
      )}
    </article>
  );

  return (
    <SplitView page="about" main={main} mainKey={doc} title={t("desktop.nav.about", "About")} sub={`DS5 Dongle OLED Edition${window.desktop ? ` · ${appVersionLabel()}` : ""}`} state={acc}>
      {/* loop: NOT-WORTH — N = 6 sections; About's render */}
      {ids.map((id) => (
        <Section key={id} id={id} icon={TEXTS[id].icon} title={t(TEXTS[id].title)} status={statuses[id]} task={id === "changes" && whatsNew ? t("desktop.about.updated", { version: whatsNew }) : null}>
          {() => (
            <>
              <nav className="dk-chapters" aria-label={t(TEXTS[id].title)}>
                {/* loop: NOT-WORTH — N = one text's chapters (≤ ~100); only while its section is open */}
                {chapters(id).map((c) => (
                  <button type="button" key={c} className={`dk-chapter${doc === id && at === c ? " on" : ""}`} aria-current={doc === id && at === c ? "location" : undefined} onClick={() => go(id, c)}>
                    {c}
                  </button>
                ))}
              </nav>
              {id === "guide" && TOUR_ENABLED && (
                <>
                  <p className="dk-hint">{t("desktop.tour.helpHint")}</p>
                  <div className="dk-row-btns">
                    <button type="button" className="dk-btn" onClick={startTour}>
                      {t("desktop.tour.replay")}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </Section>
      ))}
    </SplitView>
  );
}
