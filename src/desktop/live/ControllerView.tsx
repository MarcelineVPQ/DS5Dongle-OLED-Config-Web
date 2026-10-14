// The one screen: the live controller on the left, the selected part's
// settings on the right, the controller's status under it. Everything about
// the controller and the dongle is configured from here.
import DongleConsole, { supportsOledMirror, useOledFrame } from "../dongle/DongleConsole";
import { knob, useKnob } from "../lookKnobs";
import HdrGlow from "./HdrGlow";
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
import { type ControllerFirmware, chargeState, identityChargeState, playerLightWiring } from "../../protocol/controllerInfo";
import { signalQuality } from "../format";
import { usePoll } from "../usePoll";
import { useWindowShown } from "../useWindowShown";
import { supportsLiveInput, useLiveInput, useLiveLightbar } from "../useLiveInput";
import type { FirmwareUpdate } from "../useUpdates";
import { colorway } from "./colorways";
import { useControllerColors } from "./customColors";
import LiveController from "./LiveController";
import LiveData from "./LiveData";
import ControllerInfo from "./ControllerInfo";
import LiveStrip from "./LiveStrip";
import { say } from "../narrator";
import PartPanel, { type PanelView } from "./PartPanel";
import Tour, { TOUR_EVENT } from "../tour/Tour";
import { REMAP_INDEX, type PartId, REMAP_ONLY, partForRemapIndex, EDGE_REMAP_ROWS } from "./parts";
import { useRemap } from "./useRemap";
import { useLibrary, useProfileTarget } from "../library/libraryContext";

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
  // The identity comes from the connection hook's poll (one for the app);
  // the signal strength is read here, only while the window is on screen.
  const rssi = usePoll(() => client!.readRssi(), 1000, Boolean(client)).value;
  const status = bridge.identity ? { identity: bridge.identity, rssi } : null;
  const id = useShownIdentity(status?.identity);
  const preview = useDevPreview().active;
  const on = Boolean(id?.controllerConnected);
  const look = colorway(id?.colorwayCode ?? null, id?.model ?? null);
  // Its colors, with the player's own on top (App settings).
  const lookColors = useControllerColors(id?.colorwayCode ?? null, id?.model ?? null);
  // Its player lights' wiring, from the firmware report the Controller info card reads.
  const [ctrlFirmware, setCtrlFirmware] = useState<ControllerFirmware | null>(null);
  const playerWiring = playerLightWiring(on ? ctrlFirmware?.hwInfo : null);
  const modelName = id?.model === "edge" ? "DualSense Edge" : "DualSense";
  const liveCapable = supportsLiveInput(bridge.identity);
  // The drawing's live input isn't shown on the Dongle page: no polling there.
  const dongleView = view === "dongle";
  const input = useLiveInput(client, on && liveCapable && !dongleView);
  const liveLightbar = useLiveLightbar(client, on && liveCapable && !dongleView);
  // The controller's power, decided once for the tile, Controller info and the
  // status line: from the live input (with its cable bit) when polled, else
  // from the identity's charge flags.
  const batteryPct = input ? Math.min(100, input.batteryPct) : null;
  const power = !on ? null : input ? chargeState(input.batteryState, batteryPct, input.usbPower) : id ? identityChargeState(id) : null;
  // The OLED mirror, shared by the console and the dashboard (one poll).
  // Only while the window is on screen.
  const shown = useWindowShown();
  const oled = useOledFrame(client, shown && dongleView && supportsOledMirror(bridge.identity));
  // "There you are." when a controller connects while the app is open (not
  // for one that was already there at start).
  const wasOn = useRef<boolean | null>(null);
  useEffect(() => {
    if (!id) return;
    // The dongle says its own "Connected" when it has the narrator.
    if (wasOn.current === false && on && !(id.features & IDENTITY_FEATURES.narrator)) void say("app_controller");
    wasOn.current = on;
  }, [on, id]);
  const { appliedStamp, library, setButtonsDraft } = useLibrary();
  const remap = useRemap(client, bridge.identity?.remapTemporary ?? null, appliedStamp);
  // A game's profile on: button changes are part of what "Save to profile" saves.
  const profileKey = useProfileTarget()?.gameKey;
  const inProfile = !!(profileKey && library.games[profileKey]?.profile);
  const { dirty: remapDirty, draft: remapDraft, extraDraft, extraDevice, revert: remapRevert } = remap;
  useEffect(() => {
    setButtonsDraft(inProfile && remapDirty ? { table: remapDraft, ...(extraDevice ? { extra: extraDraft } : {}), revert: remapRevert } : null);
  }, [setButtonsDraft, inProfile, remapDirty, remapDraft, extraDraft, extraDevice, remapRevert]);
  useEffect(() => () => setButtonsDraft(null), [setButtonsDraft]);

  const remapped = useMemo(() => {
    const set = new Set<PartId>();
    // loop: HOT-PATH-OK — N = 16 remap slots, useMemo on the device table
    for (const [part, index] of Object.entries(REMAP_INDEX)) if (remap.device[index!] !== index) set.add(part as PartId);
    return set;
  }, [remap.device]);

  // The Buttons list's focused button (from the drawing or a row) and the
  // row under the pointer: both light up on the drawing.
  const [buttonFocus, setButtonFocus] = useState<number | null>(null);
  const [buttonHover, setButtonHover] = useState<number | null>(null);
  const openButtons = (index: number | null) => {
    setButtonFocus(index);
    onView("buttons");
  };
  const listPart = (i: number | null) => (i === null ? null : partForRemapIndex(i));
  const selected = typeof view === "object" ? view.part : view === "buttons" ? (listPart(buttonHover) ?? listPart(buttonFocus)) : null;
  // A click on the drawing: in the Buttons list a button just gets focused
  // there (no jump away); a remap-only button opens the list at its row.
  const pickPart = (part: PartId) => {
    const index = REMAP_INDEX[part];
    // The Edge's Fn buttons and paddles live in the Buttons list too (firmware with protocol 1.9).
    const edgeRow = remap.extraDevice ? EDGE_REMAP_ROWS.indexOf(part) : -1;
    if (edgeRow >= 0) openButtons(16 + edgeRow);
    else if (index !== undefined && (view === "buttons" || REMAP_ONLY.has(part))) openButtons(index);
    else onView({ part });
  };

  // The settings panel can be hidden on the start view, so the controller
  // gets the whole width; opening any part (or "Settings") brings it back.
  const [panelHidden, hidePanel] = useFlagPref(PANEL_KEY);
  const collapsed = panelHidden && view === "overview";
  // The model title fits the gap between the drawing's triggers (~46% of its
  // width; a bold cap is ~0.6 em), measured from the drawing as drawn.
  const heroRef = useRef<HTMLDivElement>(null);
  // HDR lighting: on in settings (the app started in scRGB), an HDR display,
  // and WebGPU; otherwise the normal glow only.
  const [hdrSetting, setHdrSetting] = useState(false);
  useEffect(() => {
    void window.desktop?.getSettings().then((s) => setHdrSetting(s.hdrLighting && s.hardwareAcceleration));
  }, []);
  const [hdrNits] = useKnob(knob("hdrNits"));
  // The drawing shown (LiveController), which the HDR glow follows too.
  const shownModel = on ? (id?.model ?? null) : null;
  const hdr = hdrSetting && on && matchMedia("(dynamic-range: high)").matches && "gpu" in navigator;
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
  }, [hidePanel]);
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
            <DongleConsole client={client} identity={id ?? bridge.identity} controllerOn={on} frame={oled} />
            <DongleDashboard bridge={bridge} frame={oled.frame} rssi={status?.rssi ?? null} />
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
                model={shownModel}
                input={input}
                lightbar={on ? (liveLightbar ?? id?.lightbar ?? null) : null}
                playerLeds={on ? (id?.playerLeds ?? 0) : 0}
                playerWiring={playerWiring}
                colors={on ? lookColors : null}
                selected={selected}
                remapped={remapped}
                onSelect={pickPart}
              />
              {hdr && <HdrGlow hero={heroRef} model={shownModel} nits={hdrNits} />}
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
            <div className="live-readouts">
              {on && id && liveCapable && (
                <LiveStrip
                  id={id}
                  power={power}
                  playerWiring={playerWiring}
                  rssi={status?.rssi ?? null}
                  lightbarMode={bridge.config?.lightbarMode ?? null}
                  lightbar={liveLightbar ?? id.lightbar}
                  onLightbar={() => onView({ part: "lightbar" })}
                />
              )}
              {on && liveCapable && input && <LiveData input={input} rssi={status?.rssi ?? null} edge={id?.model === "edge"} />}
              {on && liveCapable && <ControllerInfo bridge={bridge} batteryPct={batteryPct} power={input ? power : null} onFirmware={setCtrlFirmware} />}
            </div>
            {!(on && id && liveCapable) && (
              <div className="live-status">
                <span className={on ? "dk-good" : ""}>
                  <strong>{id ? (on ? t("desktop.overview.connected", "Connected") : t("desktop.overview.notConnected", "Not connected (press the PS button)")) : "—"}</strong>
                </span>
                <span>
                  {t("desktop.controller.battery", "Battery")}{" "}
                  <strong>
                    {on && id?.battery !== null && id?.battery !== undefined ? `${id.battery}%` : "—"}
                    {power === "charging" || power === "pluggedIn" || power === "full" ? ` · ${t(`desktop.ctrlInfo.chargeState.${power}`)}` : ""}
                  </strong>
                </span>
                <span>
                  {t("desktop.overview.signal", "Signal")}{" "}
                  <strong>{on && status && status.rssi !== null ? t(`desktop.overview.signalQ.${signalQuality(status.rssi)}`, signalQuality(status.rssi)) : "—"}</strong>
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
            {on && !liveCapable && <p className="dk-hint live-hint">{t("desktop.live.needsFirmware", "Update {{device}}'s firmware to see the controller move live.")}</p>}
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
            onOpen={pickPart}
            onCalibrate={() => onView("calibration")}
            onButtons={(index) => openButtons(index ?? null)}
            buttonFocus={buttonFocus}
            edge={id?.model === "edge"}
            onButtonFocus={setButtonFocus}
            onButtonHover={setButtonHover}
            onHide={() => hidePanel(true)}
          />
        </aside>
      )}
    </div>
  );
}
