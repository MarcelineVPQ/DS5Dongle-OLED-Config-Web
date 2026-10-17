// Your report's test sheet: one row per controller feature, each a
// Pass / Fail / Not tested choice (the app's one segmented control: one
// button per result, its icon and its word, so the result never rests on
// color), a Fail's details as chips under its row (picked ones in the warning
// color, never a pass's green), a row the old checklist said both ways marked
// for a re-check, and what the game needed as a switch.
// The data is report.ts's sheet (machine IDs only); the words come from the
// locale (Sony's feature names, docs/GLOSSARY.md).
import { useTranslation } from "react-i18next";
import { Check, Minus, X } from "lucide-react";
import { Segmented, Toggle } from "../controls";
import { SectionGroup } from "../accordion/Section";
import { detailsOf, REPORT_FEATURES, REPORT_RESULTS, resultOf, setFlag, setResult, toggleDetail, type ReportResult, type ReportSheet as Sheet } from "../games/report";

const RESULT_ICON: Record<ReportResult, JSX.Element> = {
  pass: <Check size={12} strokeWidth={3} />,
  fail: <X size={12} strokeWidth={3} />,
  "not-tested": <Minus size={12} strokeWidth={3} />,
};

// `detectedFix`: the name of the fix Setup offers for a game that doesn't see
// the controller (Turn off Steam Input, the standard gamepad), shown under a
// Controller detected: Fail so the way out is visible here too.
export function ReportSheet({ sheet, onChange, detectedFix }: { sheet: Sheet; onChange: (next: Sheet) => void; detectedFix?: string }) {
  const { t } = useTranslation();
  // loop: HOT-PATH-OK — N = 3 results; Your report's render
  const options = REPORT_RESULTS.map((r) => ({ value: r, label: t(`desktop.library.result.${r}`), icon: RESULT_ICON[r] }));
  return (
    <>
      <SectionGroup title={t("desktop.library.sheetTitle")} info={t("desktop.library.sheetInfo")}>
        <div className="gp-sheet">
          {/* loop: HOT-PATH-OK — N = 7 features; Your report's render */}
          {REPORT_FEATURES.map((feature) => {
            const label = t(`desktop.library.reportFeature.${feature}`);
            const result = resultOf(sheet, feature);
            const now = sheet.results[feature];
            const picked = now?.result === "fail" && "details" in now ? (now.details ?? []) : [];
            const details = result === "fail" ? detailsOf(feature) : [];
            return (
              <div key={feature} className="gp-sheet-row" data-feature={feature} data-result={result}>
                <Segmented label={label} value={result} options={options} onChange={(r) => onChange(setResult(sheet, feature, r))} />
                {details.length > 0 && (
                  <div className="gp-details" role="group" aria-label={t("desktop.library.failDetails", { feature: label })}>
                    {/* loop: HOT-PATH-OK — N ≤ 2 details */}
                    {details.map((d) => {
                      const on = picked.includes(d);
                      return (
                        <button key={d} type="button" className="dk-chip warn" aria-pressed={on} onClick={() => onChange(toggleDetail(sheet, feature, d))}>
                          {on && <Check size={12} strokeWidth={3} aria-hidden="true" />}
                          {t(`desktop.library.detail.${d}`)}
                        </button>
                      );
                    })}
                  </div>
                )}
                {sheet.conflicts?.includes(feature) && <p className="dk-hint gp-conflict">⚠ {t("desktop.library.sheetConflict")}</p>}
                {/* hint: MUST-SHOW — a status: Setup has a fix for the Fail just marked */}
                {feature === "controller-detected" && result === "fail" && detectedFix && <p className="dk-hint">{t("desktop.library.sheetDetectedFix", { fix: detectedFix })}</p>}
              </div>
            );
          })}
        </div>
      </SectionGroup>
      <SectionGroup title={t("desktop.library.setupFlags")}>
        <Toggle label={t("desktop.library.flag.steam-input-off")} value={!!sheet.setup?.["steam-input-off"]} onChange={(on) => onChange(setFlag(sheet, "steam-input-off", on))} />
      </SectionGroup>
    </>
  );
}
