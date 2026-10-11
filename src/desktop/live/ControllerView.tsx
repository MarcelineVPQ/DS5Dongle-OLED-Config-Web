// The one screen: the live controller on the left, the selected part's
// settings on the right, the controller's status under it. Everything about
// the controller and the dongle is configured from here.
import { PanelRightOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { playerNumber } from "../../protocol/bridgeClient";
import { signalQuality } from "../format";
import { usePoll } from "../usePoll";
import { supportsLiveInput, useLiveInput, useLiveLightbar } from "../useLiveInput";
import type { FirmwareUpdate } from "../useUpdates";
import { colorway } from "./colorways";
import LiveController from "./LiveController";
import LiveData from "./LiveData";
import LiveStrip from "./LiveStrip";
import PartPanel, { type PanelView } from "./PartPanel";
import Tour from "../tour/Tour";
import { REMAP_INDEX, type PartId } from "./parts";
import { useRemap } from "./useRemap";

const PANEL_KEY = "ds5.panelHidden";

interface Props {
  bridge: UseDs5BridgeResult;
  fw: FirmwareUpdate;
  view: PanelView;
  onView: (view: PanelView) => void;
  advancedOpen: boolean;
}

export default function ControllerView({ bridge, fw, view, onView, advancedOpen }: Props) {
  const { t } = useTranslation();
  const client = bridge.client;
  const status = usePoll(
    async () => {
      if (!client) return null;
      const [identity, rssi] = await Promise.all([client.identity(), client.readRssi()]);
      return { identity, rssi };
    },
    1000,
    Boolean(client),
  ).value;
  const id = status?.identity;
  const on = Boolean(id?.controllerConnected);
  const look = colorway(id?.colorwayCode ?? null);
  const modelName = id?.model === "edge" ? "DualSense Edge" : "DualSense";
  const liveCapable = supportsLiveInput(bridge.identity);
  const input = useLiveInput(client, on && liveCapable);
  const liveLightbar = useLiveLightbar(client, on && liveCapable);
  const remap = useRemap(client);

  const remapped = useMemo(() => {
    const set = new Set<PartId>();
    for (const [part, index] of Object.entries(REMAP_INDEX)) if (remap.device[index!] !== index) set.add(part as PartId);
    return set;
  }, [remap.device]);

  const selected = typeof view === "object" ? view.part : null;

  // The settings panel can be hidden on the start view, so the controller
  // gets the whole width; opening any part (or "Settings") brings it back.
  const [panelHidden, setPanelHidden] = useState(() => {
    try {
      return window.localStorage.getItem(PANEL_KEY) === "1";
    } catch {
      return false;
    }
  });
  const hidePanel = (hide: boolean) => {
    setPanelHidden(hide);
    try {
      window.localStorage.setItem(PANEL_KEY, hide ? "1" : "0");
    } catch {
      // storage blocked: lasts for this session
    }
  };
  const collapsed = panelHidden && view === "overview";

  return (
    <div className={`live-view${collapsed ? " collapsed" : ""}`}>
      <div className="live-stage">
        {collapsed && (
          <button type="button" className="dk-btn live-show-panel" onClick={() => hidePanel(false)}>
            <PanelRightOpen size={14} aria-hidden="true" /> {t("desktop.live.showPanel", "Settings")}
          </button>
        )}
        <LiveController
          input={input}
          lightbar={on ? (liveLightbar ?? id?.lightbar ?? null) : null}
          playerLeds={on ? (id?.playerLeds ?? 0) : 0}
          colors={on ? (look?.colors ?? null) : null}
          selected={selected}
          remapped={remapped}
          onSelect={(part) => onView({ part })}
        />
        {on && id?.model && (
          <div className="live-model">
            {modelName}
            {look ? ` · ${look.name}` : ""}
            <span className="dk-good"> · {t("desktop.overview.connected", "Connected")}</span>
          </div>
        )}
        {on && id?.model === "edge" && (
          <div className="live-edge" aria-label={t("desktop.live.edgeButtons")}>
            {(
              [
                ["backLeft", t("desktop.live.backLeft")],
                ["fnLeft", "Fn L"],
                ["fnRight", "Fn R"],
                ["backRight", t("desktop.live.backRight")],
              ] as const
            ).map(([key, label]) => (
              <span key={key} className={`dk-chip${input?.[key] ? " ok" : ""}`}>
                {label}
              </span>
            ))}
          </div>
        )}
        {on && id && liveCapable && <LiveStrip input={input} id={id} rssi={status?.rssi ?? null} />}
        {on && liveCapable && input && <LiveData input={input} rssi={status?.rssi ?? null} />}
        {!(on && id && liveCapable) && (
          <div className="live-status">
            <span className={on ? "dk-good" : ""}>
              <strong>{id ? (on ? t("desktop.overview.connected", "Connected") : t("desktop.overview.notConnected", "Not connected (press PS)")) : "—"}</strong>
            </span>
            <span>
              {t("desktop.controller.battery", "Battery")}{" "}
              <strong>
                {on && id?.battery !== null && id?.battery !== undefined ? `${id.battery}%` : "—"}
                {on && id?.charging ? ` · ${t("desktop.controller.charging", "charging")}` : ""}
              </strong>
            </span>
            <span>
              {t("desktop.overview.signal", "Signal")} <strong>{on && status ? t(`desktop.overview.signalQ.${signalQuality(status.rssi)}`, signalQuality(status.rssi)) : "—"}</strong>
            </span>
            {on && id && playerNumber(id.playerLeds) && (
              <span>
                {t("desktop.live.player", "Player")} <strong>{playerNumber(id.playerLeds)}</strong>
              </span>
            )}
            <span>
              {t("desktop.overview.slot", "Pairing slot")} <strong>{id ? id.currentSlot : "—"}</strong>
            </span>
          </div>
        )}
        {!on && id && <p className="dk-hint live-hint">{t("desktop.controller.pairHint")}</p>}
        {on && !liveCapable && <p className="dk-hint live-hint">{t("desktop.live.needsFirmware", "Update the dongle's firmware to see the controller move live.")}</p>}
        {on && liveCapable && !selected && view === "overview" && <p className="dk-hint live-hint">{t("desktop.live.pickHint")}</p>}
      </div>
      <Tour input={input} view={view} onView={onView} ready={on && liveCapable} />
      {!collapsed && (
        <aside className="live-panel">
          <PartPanel
            view={view}
            bridge={bridge}
            fw={fw}
            input={input}
            remap={remap}
            advancedOpen={advancedOpen}
            onClose={() => onView("overview")}
            onOpen={(part) => onView({ part })}
            onHide={() => hidePanel(true)}
          />
        </aside>
      )}
    </div>
  );
}
