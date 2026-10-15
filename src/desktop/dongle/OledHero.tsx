// The Pico 2 W page's centerpiece: the OLED Edition's screen. A heading that
// names the module (Waveshare Pico-OLED-1.3 · 1.3″ · 128 × 64 · SH1107), the
// live mirror with its KEY0 / KEY1 (the console, passed in as children), and
// beside it (below it in a narrow window) what the screen is doing now and
// the module's specs. Readouts only: the screen's settings are the
// accordion's "OLED screen" section.
// Live: the mirror's own poll (useOledFrame) and the page's 1 s sample (the
// redraw rate); nothing of its own.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { OledFrame } from "../../protocol/bridgeClient";
import { SCREEN_NAMES } from "../../oled/screenNames";
import { OLED_MODULE } from "./boardSpecs";

// The product's name: a name, never translated (and the one place "Dongle" is shown).
const EDITION = "DS5 Dongle OLED Edition";

interface Props {
  frame: OledFrame | null; // null: no mirror (older firmware, no board yet)
  capable: boolean; // the firmware mirrors its screen (protocol 1.4)
  redraws: number | null; // changed pictures per second (the 1 s sample), null until two reads
  children: ReactNode; // the console (mirror + log)
}

export default function OledHero({ frame, capable, redraws, children }: Props) {
  const { t } = useTranslation();
  const td = (k: string, o?: Record<string, unknown>) => t(`desktop.dash.${k}`, o);
  const f = capable ? frame : null;
  const pct = f ? Math.round((f.contrast / 255) * 100) : null;
  return (
    <section className="oled-hero" aria-labelledby="oled-hero-h">
      <header className="oled-hero-head">
        <span className="oled-hero-edition">{EDITION}</span>
        <h3 id="oled-hero-h">{OLED_MODULE.name}</h3>
        <span className="oled-hero-sub">
          {OLED_MODULE.size} · {OLED_MODULE.resolution} · {OLED_MODULE.controller}
        </span>
      </header>
      <div className="oled-hero-body">
        <div className="oled-hero-screen">{children}</div>
        <aside className="oled-hero-side">
          <div className="dash-card oled-stats">
            <h4>{t("desktop.dongleConsole.live")}</h4>
            <div className="oled-stat oled-stat-big">
              <span>{td("brightness")}</span>
              <b>{pct === null ? "—" : `${pct}%`}</b>
              <i className="oled-stat-bar" style={{ "--level": pct === null ? 0 : pct / 100 } as React.CSSProperties} />
            </div>
            <div className="oled-stat">
              <span>{td("oledState")}</span>
              <b>{f ? td(`power.${f.power}`) : capable ? "—" : td("noMirror")}</b>
            </div>
            <div className="oled-stat">
              <span>{td("oledScreen")}</span>
              <b>{f ? `${f.screen + 1}/${SCREEN_NAMES.length} · ${SCREEN_NAMES[f.screen] ?? "?"}` : "—"}</b>
            </div>
            {/* A redraw rate needs two reads. */}
            <div className="oled-stat">
              <span>{td("oledFps")}</span>
              <b>{f && redraws !== null ? `${redraws} /s` : "—"}</b>
            </div>
            <div className="oled-stat">
              <span>{td("oledFrame")}</span>
              <b>{f ? String(f.seq) : "—"}</b>
            </div>
          </div>
          <div className="dash-card oled-specs">
            <h4>{td("specs.title")}</h4>
            <dl className="dk-kv">
              <dt>{td("specs.model")}</dt>
              <dd>{OLED_MODULE.name}</dd>
              <dt>{td("specs.size")}</dt>
              <dd>{OLED_MODULE.size}</dd>
              <dt>{td("specs.resolution")}</dt>
              <dd>{OLED_MODULE.resolution}</dd>
              <dt>{td("specs.controller")}</dt>
              <dd>{OLED_MODULE.controller}</dd>
              <dt>{td("specs.interface")}</dt>
              <dd>{OLED_MODULE.interface}</dd>
              <dt>{td("specs.keys")}</dt>
              <dd>{OLED_MODULE.keys}</dd>
            </dl>
            {/* The firmware drives the pins blind: it can't tell whether the module is fitted. */}
            <p className="dk-hint">{td("specs.notDetected")}</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
