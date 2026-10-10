import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { signalQuality } from "../format";
import { usePoll } from "../usePoll";
import LightbarPage from "./LightbarPage";
import SlotsPage from "./SlotsPage";

// Home page: the controller itself. Status, lightbar and pairing in one place.
// This is where the live controller view will go (final phase).
export default function ControllerPage({ bridge }: { bridge: UseDs5BridgeResult }) {
  const { t } = useTranslation();
  const client = bridge.client;
  const live = usePoll(
    async () => {
      if (!client) return null;
      const [identity, rssi] = await Promise.all([client.identity(), client.readRssi()]);
      return { identity, rssi };
    },
    1000,
    Boolean(client),
  ).value;
  const id = live?.identity;
  const on = Boolean(id?.controllerConnected);

  return (
    <div className="dk-stack">
      <section className="dk-card dk-status">
        <div>
          <span className="dk-status-label">{t("desktop.overview.status", "Status")}</span>
          <strong className={on ? "dk-good" : ""}>{id ? (on ? t("desktop.overview.connected", "Connected") : t("desktop.overview.notConnected", "Not connected (press PS)")) : "—"}</strong>
        </div>
        <div>
          <span className="dk-status-label">{t("desktop.controller.battery", "Battery")}</span>
          <strong>
            {on && id?.battery !== null && id?.battery !== undefined ? `${id.battery}%` : "—"}
            {on && id?.charging ? ` · ${t("desktop.controller.charging", "charging")}` : ""}
          </strong>
        </div>
        <div>
          <span className="dk-status-label">{t("desktop.overview.signal", "Signal")}</span>
          <strong>{on && live ? t(`desktop.overview.signalQ.${signalQuality(live.rssi)}`, signalQuality(live.rssi)) : "—"}</strong>
        </div>
        <div>
          <span className="dk-status-label">{t("desktop.overview.slot", "Pairing slot")}</span>
          <strong>{id ? id.currentSlot : "—"}</strong>
        </div>
        <div>
          <span className="dk-status-label">{t("desktop.nav.lightbar", "Lightbar")}</span>
          <span className="dk-swatch" style={{ background: on && id?.lightbar ? `rgb(${id.lightbar.join(",")})` : "transparent" }} />
        </div>
      </section>
      <LightbarPage bridge={bridge} />
      <SlotsPage bridge={bridge} />
    </div>
  );
}
