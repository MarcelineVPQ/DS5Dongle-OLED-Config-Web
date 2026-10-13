import { useTranslation } from "react-i18next";
import { useFields, type SectionProps } from "./sectionFields";
import { hexToRgb, rgbToHex, Row } from "../controls";
import ColorPicker from "../colorPicker/ColorPicker";

export const LIGHTBAR_MODES = [
  { value: 8, key: "host", label: "Game controls it" },
  { value: 1, key: "fav0", label: "FAV0" },
  { value: 2, key: "fav1", label: "FAV1" },
  { value: 3, key: "fav2", label: "FAV2" },
  { value: 4, key: "fav3", label: "FAV3" },
  { value: 5, key: "breathing", label: "Breathing" },
  { value: 6, key: "rainbow", label: "Rainbow" },
  { value: 7, key: "fade", label: "Fade" },
  { value: 0, key: "live", label: "Tilt color" },
] as const;

// The live panel's lightbar sections; the game page shows them with a game
// profile's draft (`fields`).
export default function LightbarPage(props: SectionProps) {
  const { t } = useTranslation();
  const { d, set, patch, mark } = useFields(props);

  const setFav = (i: number, hex: string) => {
    const [r, g, b] = hexToRgb(hex);
    const at = (arr: number[], v: number) => arr.map((x, j) => (j === i ? v : x));
    patch({ lbFavR: at(d.lbFavR, r), lbFavG: at(d.lbFavG, g), lbFavB: at(d.lbFavB, b) });
  };

  return (
    <div className="dk-grid">
      <section className="dk-card">
        <h2>
          {t("desktop.lightbar.mode", "Mode")} {mark("lightbarMode")}
        </h2>
        <div className="dk-presets">
          {LIGHTBAR_MODES.map((m) => (
            <button type="button" key={m.value} className={`dk-btn${d.lightbarMode === m.value ? " on" : ""}`} aria-pressed={d.lightbarMode === m.value} onClick={() => set("lightbarMode", m.value)}>
              {t(`desktop.lightbar.modes.${m.key}`, m.label)}
            </button>
          ))}
        </div>
        <p className="dk-hint">{t("desktop.lightbar.hint", "While charging, {{device}} shows an amber pulse in every mode.")}</p>
      </section>
      <section className="dk-card">
        <h2>
          {t("desktop.lightbar.favorites", "Favorite colors")} {mark("lbFavR")}
        </h2>
        {[0, 1, 2, 3].map((i) => (
          <Row key={i} label={t("desktop.lightbar.favN", { n: i, defaultValue: `FAV${i}` })}>
            <span className="dk-mono">{rgbToHex([d.lbFavR[i], d.lbFavG[i], d.lbFavB[i]]).toUpperCase()}</span>
            <ColorPicker label={`FAV${i}`} value={rgbToHex([d.lbFavR[i], d.lbFavG[i], d.lbFavB[i]])} onChange={(hex) => setFav(i, hex)} />
          </Row>
        ))}
      </section>
    </div>
  );
}
