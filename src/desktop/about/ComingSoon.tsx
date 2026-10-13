import { useTranslation } from "react-i18next";
import { deviceText } from "../hardwareName";
import { ISSUES_URL, ROADMAP, ROADMAP_COLUMNS } from "./roadmap";

/** About → Coming soon: the public roadmap (roadmap.ts) as a read-only board. */
export default function ComingSoon() {
  const { t } = useTranslation();
  return (
    <div className="dk-roadmap">
      <p className="dk-hint">
        {t("desktop.about.roadmap.intro", "These are plans, not promises: they can change, and none has a date.")}{" "}
        <a href={ISSUES_URL} target="_blank" rel="noreferrer noopener">
          {t("desktop.about.roadmap.suggest", "Suggestions are welcome on GitHub.")}
        </a>
      </p>
      <div className="dk-roadmap-board">
        {ROADMAP_COLUMNS.map((column) => {
          const items = ROADMAP.filter((x) => x.column === column);
          const heading = t(`desktop.about.roadmap.column.${column}`);
          return (
            <section key={column} className="dk-roadmap-col" aria-label={heading}>
              <h2>
                {heading} <span className="dk-roadmap-count">{items.length}</span>
              </h2>
              {items.map((x) => (
                <article key={x.title} className="dk-card">
                  <h3>{deviceText(x.title)}</h3>
                  <p>{deviceText(x.text)}</p>
                  <div className="dk-roadmap-tags">
                    {x.high && (
                      <span className="dk-chip warn">
                        <span className="dot" aria-hidden="true" />
                        {t("desktop.about.roadmap.high", "High priority")}
                      </span>
                    )}
                    {x.areas.map((a) => (
                      <span key={a} className="dk-chip">
                        {t(`desktop.about.roadmap.area.${a}`)}
                      </span>
                    ))}
                    {x.platform && <span className="dk-chip">{t(`desktop.about.roadmap.platform.${x.platform}`)}</span>}
                  </div>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
