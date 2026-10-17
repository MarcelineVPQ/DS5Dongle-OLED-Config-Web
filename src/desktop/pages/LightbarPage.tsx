import { useTranslation } from "react-i18next";
import { useFields, type SectionProps } from "./sectionFields";
import { hexToRgb, rgbToHex, Row } from "../controls";
import ColorPicker from "../colorPicker/ColorPicker";
import { SectionGroup } from "../accordion/Section";

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

// The Light bar section's rows (Controller page).
export default function LightbarPage(props: SectionProps) {
  const { t } = useTranslation();
  const { d, set, patch } = useFields(props);

  const setFav = (i: number, hex: string) => {
    const [r, g, b] = hexToRgb(hex);
    const at = (arr: number[], v: number) => arr.map((x, j) => (j === i ? v : x));
    patch({ lbFavR: at(d.lbFavR, r), lbFavG: at(d.lbFavG, g), lbFavB: at(d.lbFavB, b) });
  };

  return (
    <>
      <Row label={t("desktop.lightbar.mode", "Mode")} info={t("desktop.lightbar.hint", "While charging, {{device}} shows an amber pulse in every mode.")} stack>
        <div className="dk-presets">
          {/* loop: HOT-PATH-OK — N ≈ 9 lightbar modes; only while Light bar is open */}
          {LIGHTBAR_MODES.map((m) => (
            <button type="button" key={m.value} className={`dk-btn${d.lightbarMode === m.value ? " on" : ""}`} aria-pressed={d.lightbarMode === m.value} onClick={() => set("lightbarMode", m.value)}>
              {t(`desktop.lightbar.modes.${m.key}`, m.label)}
            </button>
          ))}
        </div>
      </Row>
      <SectionGroup title={t("desktop.lightbar.favorites", "Favorite colors")}>
        {/* loop: HOT-PATH-OK — N = 4 favorite slots; only while Light bar is open */}
        {[0, 1, 2, 3].map((i) => (
          <Row key={i} label={t("desktop.lightbar.favN", { n: i, defaultValue: `FAV${i}` })}>
            {/* The swatch is the value; its hex code is the small print (IA audit C12). */}
            <span className="dk-mono dk-hint">{rgbToHex([d.lbFavR[i], d.lbFavG[i], d.lbFavB[i]]).toUpperCase()}</span>
            <ColorPicker label={`FAV${i}`} value={rgbToHex([d.lbFavR[i], d.lbFavG[i], d.lbFavB[i]])} onChange={(hex) => setFav(i, hex)} />
          </Row>
        ))}
      </SectionGroup>
    </>
  );
}
