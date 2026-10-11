import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { hexToRgb, rgbToHex, Row } from "../controls";

const MODES = [
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

export default function LightbarPage({ bridge }: { bridge: UseDs5BridgeResult }) {
  const { t } = useTranslation();
  const d = bridge.draft;

  const setFav = (i: number, hex: string) => {
    const [r, g, b] = hexToRgb(hex);
    const at = (arr: number[], v: number) => arr.map((x, j) => (j === i ? v : x));
    bridge.setDraftField("lbFavR", at(d.lbFavR, r));
    bridge.setDraftField("lbFavG", at(d.lbFavG, g));
    bridge.setDraftField("lbFavB", at(d.lbFavB, b));
  };

  return (
    <div className="dk-grid">
      <section className="dk-card">
        <h2>{t("desktop.lightbar.mode", "Mode")}</h2>
        <div className="dk-presets">
          {MODES.map((m) => (
            <button
              type="button"
              key={m.value}
              className={`dk-btn${d.lightbarMode === m.value ? " on" : ""}`}
              aria-pressed={d.lightbarMode === m.value}
              onClick={() => bridge.setDraftField("lightbarMode", m.value)}
            >
              {t(`desktop.lightbar.modes.${m.key}`, m.label)}
            </button>
          ))}
        </div>
        <p className="dk-hint">{t("desktop.lightbar.hint", "While charging, the dongle shows an amber pulse in every mode.")}</p>
      </section>
      <section className="dk-card">
        <h2>{t("desktop.lightbar.favorites", "Favorite colors")}</h2>
        {[0, 1, 2, 3].map((i) => (
          <Row key={i} label={t("desktop.lightbar.favN", { n: i, defaultValue: `FAV${i}` })}>
            <span className="dk-mono">{rgbToHex([d.lbFavR[i], d.lbFavG[i], d.lbFavB[i]]).toUpperCase()}</span>
            <input type="color" aria-label={`FAV${i}`} value={rgbToHex([d.lbFavR[i], d.lbFavG[i], d.lbFavB[i]])} onChange={(e) => setFav(i, e.currentTarget.value)} />
          </Row>
        ))}
      </section>
    </div>
  );
}
