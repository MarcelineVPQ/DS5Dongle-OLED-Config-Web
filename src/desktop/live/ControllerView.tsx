// The one screen: the live controller on the left, the selected part's
// settings on the right, the controller's status under it. Everything about
// the controller and the dongle is configured from here.
import DongleConsole from "../dongle/DongleConsole";
import DongleDashboard from "../dongle/DongleDashboard";
import { hasColorwayColor } from "./controllerAccent";
import { useDevPreview, useShownIdentity } from "../devPreview";
import { REGULAR_GLASS } from "../glass/variants";
import { useGlass } from "../glass/useGlass";
import { GLASS_KEY } from "../glass/glassPref";
import { useFlagPref } from "../storage";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { IDENTITY_FEATURES, playerNumber } from "../../protocol/bridgeClient";
import { signalQuality } from "../format";
import { usePoll } from "../usePoll";
import { supportsLiveInput, useLiveInput, useLiveLightbar } from "../useLiveInput";
import type { FirmwareUpdate } from "../useUpdates";
import { colorway } from "./colorways";
import LiveController from "./LiveController";
import LiveData from "./LiveData";
import LiveStrip from "./LiveStrip";
import { say } from "../narrator";
import PartPanel, { type PanelView } from "./PartPanel";
import Tour, { TOUR_EVENT } from "../tour/Tour";
import { REMAP_INDEX, type PartId } from "./parts";
import { useRemap } from "./useRemap";

const PANEL_KEY = "ds5.panelHidden";
// The rail's Controller item, clicked while already on the controller: show or
// hide the settings panel (the panel's own hide button does the same).
export const PANEL_TOGGLE_EVENT = "ds5:toggle-panel";

interface Props {
  bridge: UseDs5BridgeResult;
  fw: FirmwareUpdate;
  view: PanelView;
  onView: (view: PanelView) => void;
}

export default function ControllerView({ bridge, fw, view, onView }: Props) {
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
  const id = useShownIdentity(status?.identity);
  const preview = useDevPreview().active;
  const on = Boolean(id?.controllerConnected);
  const look = colorway(id?.colorwayCode ?? null);
  const modelName = id?.model === "edge" ? "DualSense Edge" : "DualSense";
  const liveCapable = supportsLiveInput(bridge.identity);
  const input = useLiveInput(client, on && liveCapable);
  const liveLightbar = useLiveLightbar(client, on && liveCapable);
  // "There you are." when a controller connects while the app is open (not
  // for one that was already there at start).
  const wasOn = useRef<boolean | null>(null);
  useEffect(() => {
    if (!id) return;
    // The dongle says its own "Connected" when it has the narrator.
    if (wasOn.current === false && on && !(id.features & IDENTITY_FEATURES.narrator)) void say("app_controller");
    wasOn.current = on;
  }, [on, id]);
  const remap = useRemap(client);

  const remapped = useMemo(() => {
    const set = new Set<PartId>();
    for (const [part, index] of Object.entries(REMAP_INDEX)) if (remap.device[index!] !== index) set.add(part as PartId);
    return set;
  }, [remap.device]);

  const selected = typeof view === "object" ? view.part : null;

  // The settings panel can be hidden on the start view, so the controller
  // gets the whole width; opening any part (or "Settings") brings it back.
  const [panelHidden, hidePanel] = useFlagPref(PANEL_KEY);
  const collapsed = panelHidden && view === "overview";
  // The model title fits the gap between the drawing's triggers (~46% of its
  // width; a bold cap is ~0.6 em), measured from the drawing as drawn.
  const heroRef = useRef<HTMLDivElement>(null);
  const [ctlWidth, setCtlWidth] = useState(800);
  useEffect(() => {
    const ctl = heroRef.current?.querySelector(".live-ctl");
    if (!ctl) return;
    // The art is scaled to fit its box (aspect kept), so the drawn width is
    // the smaller of the box width and its height times the art's aspect.
    const vb = ctl.querySelector("svg")?.viewBox.baseVal;
    const aspect = vb && vb.height ? vb.width / vb.height : 1.8;
    const ro = new ResizeObserver(([e]) => setCtlWidth(Math.min(e.contentRect.width, e.contentRect.height * aspect)));
    ro.observe(ctl);
    return () => ro.disconnect();
  }, [on]);
  const titleSize = Math.round(Math.max(28, Math.min(132, ctlWidth * 0.105, (ctlWidth * 0.46) / (0.6 * modelName.length))));
  // Glass style: the settings panel is an inspector, the regular variant
  // (more frost, for text); its cards stay standard surfaces.
  const [glass] = useFlagPref(GLASS_KEY);
  const panelGlass = useGlass(glass && !collapsed, REGULAR_GLASS);

  // The tour points at the settings list, so it brings the panel back.
  useEffect(() => {
    const show = () => hidePanel(false);
    window.addEventListener(TOUR_EVENT, show);
    return () => window.removeEventListener(TOUR_EVENT, show);
  }, []);
  useEffect(() => {
    const toggle = () => {
      if (collapsed) hidePanel(false);
      else {
        hidePanel(true);
        onView("overview");
      }
    };
    window.addEventListener(PANEL_TOGGLE_EVENT, toggle);
    return () => window.removeEventListener(PANEL_TOGGLE_EVENT, toggle);
  });

  return (
    <div className={`live-view${collapsed ? " collapsed" : ""}`}>
      <div className="live-stage">
        {view === "dongle" ? (
          <>
            <DongleConsole client={client} identity={id ?? bridge.identity} controllerOn={on} />
            <DongleDashboard bridge={bridge} />
          </>
        ) : (
          <>
            {/* Magazine-cover title: the model in big caps behind the drawing,
                which overlaps its lower part; "Model:" small above it. */}
            <div ref={heroRef} className={`live-hero${on && id?.model ? " titled" : ""}`} style={{ ["--title-size" as string]: `${titleSize}px` }}>
              {on && id?.model && (
                <div className="live-title" aria-hidden="true">
                  <span className="live-title-label">
                    {t("desktop.live.modelLabel")}
                    {preview && <span className="live-preview-badge">{t("desktop.dev.previewBadge")}</span>}
                  </span>
                  <span className="live-title-name">{modelName}</span>
                </div>
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
            </div>
            {on && id?.model && (
              <div className="live-specs">
                {look && (
                  <span className="live-spec">
                    <span className="live-title-label">{t("desktop.live.colorLabel")}</span>
                    <span className={`live-spec-value${hasColorwayColor(id?.colorwayCode ?? null) ? " accent" : ""}`}>{look.name}</span>
                  </span>
                )}
                <span className="live-spec">
                  <span className="live-title-label">{t("desktop.live.statusLabel")}</span>
                  <span className="live-spec-value">
                    <span className="live-spec-dot" aria-hidden="true" />
                    {t("desktop.overview.connected", "Connected")}
                  </span>
                </span>
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
            <div className="live-readouts">
              {on && id && liveCapable && (
                <LiveStrip
                  id={id}
                  rssi={status?.rssi ?? null}
                  lightbarMode={bridge.config?.lightbarMode ?? null}
                  lightbar={liveLightbar ?? id.lightbar}
                  onLightbar={() => onView({ part: "lightbar" })}
                />
              )}
              {on && liveCapable && input && <LiveData input={input} rssi={status?.rssi ?? null} />}
            </div>
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
          </>
        )}
      </div>
      <Tour client={client} input={input} view={view} onView={onView} ready={on && liveCapable} />
      {!collapsed && (
        <aside className="live-panel" ref={panelGlass}>
          <PartPanel
            view={view}
            bridge={bridge}
            fw={fw}
            input={input}
            remap={remap}
            onClose={() => onView("overview")}
            onOpen={(part) => onView({ part })}
            onCalibrate={() => onView("calibration")}
            onHide={() => hidePanel(true)}
          />
        </aside>
      )}
    </div>
  );
}
