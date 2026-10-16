// The live pages: the controller drawing (or, on the Pico 2 W page, the
// board's console and dials) as the main view on the left, the page's
// accordion on the right (SplitView). The Controller page's sections are in
// PartPanel.tsx, the Pico 2 W page's in dongle/DonglePage.tsx; App settings
// shows its own sections next to the same drawing, so a theme or color change
// shows on it live. Everything about the controller and the dongle is
// configured from here.
import { supportsOledMirror, useOledFrame } from "../dongle/DongleConsole";
import { knob, useKnob } from "../lookKnobs";
import HdrGlow from "./HdrGlow";
import DonglePage from "../dongle/DonglePage";
import { hasColorwayColor } from "./controllerAccent";
import { useDevPreview, useShownIdentity } from "../devPreview";
import { REGULAR_GLASS } from "../glass/variants";
import { useGlass } from "../glass/useGlass";
import { GLASS_KEY } from "../glass/glassPref";
import { useFlagPref } from "../storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { playerNumber } from "../../protocol/bridgeClient";
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
import ControllerInfo, { controllerInfoStatus, useControllerInfo } from "./ControllerInfo";
import { MainBlock, useMainBlock } from "../accordion/MainBlock";
import { Info } from "lucide-react";
import LiveStrip from "./LiveStrip";
import ControllerSections from "./PartPanel";
import Tour, { TOUR_EVENT } from "../tour/Tour";
import { REMAP_INDEX, type PartId, REMAP_ONLY, partForRemapIndex, EDGE_REMAP_ROWS } from "./parts";
import { PANEL_HIDDEN_KEY, SplitView } from "../accordion/Section";
import { pinScope, revealSection, useAccordion } from "../accordion/useAccordion";
import { SECTIONS, type SectionId } from "../accordion/sections";
import AppSettingsPage from "../pages/AppSettingsPage";
import Notice from "../Notice";
import { useRemap } from "./useRemap";
import { useLibrary, useProfileTarget } from "../library/libraryContext";
import { logged } from "../../errorText";

// Which page: the Controller page, the Pico 2 W page or App settings.
export type PanelView = "overview" | "dongle" | "app";

// The section a click on a part of the drawing opens.
export function sectionForPart(part: PartId): SectionId<"controller"> {
  if (part === "lightbar") return "lightbar";
  if (part === "l2" || part === "r2") return "triggers";
  if (part === "body") return "haptics";
  if (part === "speaker") return "speaker";
  if (part === "mute") return "mic";
  if (part === "ps") return "slots";
  if (part === "stick-l" || part === "stick-r") return "sticks";
  return "buttons"; // the remap-only buttons, the touch pad, the Edge's Fn buttons and paddles
}

interface Props {
  bridge: UseDs5BridgeResult;
  fw: FirmwareUpdate;
  view: PanelView;
  // App settings: a click on the drawing goes to the Controller page.
  onView: (view: PanelView) => void;
}

export default function ControllerView({ bridge, fw, view, onView }: Props) {
  const { t } = useTranslation();
  const client = bridge.client;
  // The identity comes from the connection hook's poll (one for the app);
  // the signal strength is read here, only while the window is on screen.
  // lifetime: OK — usePoll stops on unmount, without a client and while hidden
  const rssi = usePoll(() => client!.readRssi(), 1000, Boolean(client)).value;
  const status = bridge.identity ? { identity: bridge.identity, rssi } : null;
  const id = useShownIdentity(status?.identity);
  const preview = useDevPreview().active;
  const on = Boolean(id?.controllerConnected);
  const look = colorway(id?.colorwayCode ?? null, id?.model ?? null);
  // Its colors, with the player's own on top (App settings).
  const lookColors = useControllerColors(id?.colorwayCode ?? null, id?.model ?? null);
  // Its player lights' wiring, from the firmware report Controller info reads
  // (once per connection, kept here: the block's status and task need it closed too).
  const [ctrlFirmware, setCtrlFirmware] = useState<ControllerFirmware | null>(null);
  const info = useControllerInfo(bridge, setCtrlFirmware);
  const playerWiring = playerLightWiring(on ? ctrlFirmware?.hwInfo : null);
  const modelName = id?.model === "edge" ? "DualSense Edge" : "DualSense";
  const liveCapable = supportsLiveInput(bridge.identity);
  // The drawing's live input isn't shown on the Pico 2 W page: no polling there.
  const dongleView = view === "dongle";
  const input = useLiveInput(client, on && liveCapable && !dongleView);
  // Linux, where the kernel doesn't report the controller's jack: the live
  // input's headset bit stands in for the stereo headset profile (headsetProfile.ts).
  const headphones = input ? input.headphones : null;
  // lifetime: OK — acquires nothing (one message per change; "not known" again at unmount)
  useEffect(() => {
    if (window.desktop?.platform !== "linux") return;
    window.desktop.setHeadsetHint(headphones);
    return () => window.desktop?.setHeadsetHint(null);
  }, [headphones]);
  const liveLightbar = useLiveLightbar(client, on && liveCapable && !dongleView);
  // The controller's power, decided once for the tile, Controller info and the
  // status line: from the live input (with its cable bit) when polled, else
  // from the identity's charge flags.
  const batteryPct = input ? Math.min(100, input.batteryPct) : null;
  const power = !on ? null : input ? chargeState(input.batteryState, batteryPct, input.usbPower) : id ? identityChargeState(id) : null;
  // The OLED mirror, shared by the console and the dashboard (one poll).
  // Only while the window is on screen.
  const shown = useWindowShown();
  // A controller gone: the next connection pulses the status dot again.
  // lifetime: OK — acquires nothing (resets the dot's pulse on disconnect)
  useEffect(() => {
    if (!on) resetConnectedDot();
  }, [on]);
  const oled = useOledFrame(client, shown && dongleView && supportsOledMirror(bridge.identity));
  const { appliedStamp, library, setButtonsDraft } = useLibrary();
  const remap = useRemap(client, bridge.identity?.remapTemporary ?? null, appliedStamp);
  // A game's profile on: button changes are part of what "Save to profile" saves.
  const profileKey = useProfileTarget()?.gameKey;
  const inProfile = !!(profileKey && library.games[profileKey]?.profile);
  const { dirty: remapDirty, draft: remapDraft, extraDraft, extraDevice, revert: remapRevert } = remap;
  // lifetime: OK — acquires nothing (hands the button draft to the library)
  useEffect(() => {
    setButtonsDraft(inProfile && remapDirty ? { table: remapDraft, ...(extraDevice ? { extra: extraDraft } : {}), revert: remapRevert } : null);
  }, [setButtonsDraft, inProfile, remapDirty, remapDraft, extraDraft, extraDevice, remapRevert]);
  // lifetime: OK — cleanup: clears the button draft on unmount
  useEffect(() => () => setButtonsDraft(null), [setButtonsDraft]);

  const remapped = useMemo(() => {
    const set = new Set<PartId>();
    // loop: HOT-PATH-OK — N = 16 remap slots, useMemo on the device table
    for (const [part, index] of Object.entries(REMAP_INDEX)) if (remap.device[index!] !== index) set.add(part as PartId);
    return set;
  }, [remap.device]);

  // The accordion: pins per board and pairing slot.
  const acc = useAccordion("controller", pinScope("controller", bridge.identity?.boardName ?? null, bridge.identity?.currentSlot ?? null));
  // Controller info: a readout, so a block in the main view under the drawing (not the accordion).
  const infoBlock = useMainBlock("controller", "info");
  const infoStatus = controllerInfoStatus(t, info, batteryPct);
  // The Buttons list's focused button (from the drawing or a row) and the
  // row under the pointer: both light up on the drawing.
  const [buttonFocus, setButtonFocus] = useState<number | null>(null);
  const [buttonHover, setButtonHover] = useState<number | null>(null);
  // The part clicked last: lit while its section is open.
  const [picked, setPicked] = useState<PartId | null>(null);
  const listPart = (i: number | null) => (i === null ? null : partForRemapIndex(i));
  const buttonsOpen = view === "overview" && acc.isOpen("buttons");
  const selected = buttonsOpen ? (listPart(buttonHover) ?? listPart(buttonFocus)) : picked && view === "overview" && acc.isOpen(sectionForPart(picked)) ? picked : null;
  // A click on the drawing opens its section; a button opens Button
  // assignments at its row (with the list open already, the row just gets
  // the focus: no jump away).
  const pickPart = (part: PartId) => {
    const index = REMAP_INDEX[part];
    // The Edge's Fn buttons and paddles live in the Buttons list too (firmware with protocol 1.9).
    const edgeRow = remap.extraDevice ? EDGE_REMAP_ROWS.indexOf(part) : -1;
    const row = edgeRow >= 0 ? 16 + edgeRow : index !== undefined && (buttonsOpen || REMAP_ONLY.has(part)) ? index : null;
    const section = row !== null ? "buttons" : sectionForPart(part);
    if (view === "app") {
      // App settings: to the Controller page's section.
      revealSection("controller", section, row !== null ? `btn-${row}` : undefined);
      onView("overview");
      return;
    }
    setPicked(part);
    if (row !== null) {
      setButtonFocus(row);
      if (!buttonsOpen) acc.reveal("buttons", `btn-${row}`);
    } else acc.reveal(section);
  };

  // The settings panel can be hidden, so the controller gets the whole width.
  const [panelHidden, hidePanel] = useFlagPref(PANEL_HIDDEN_KEY("controller"));
  // The model title fits the gap between the drawing's triggers (~46% of its
  // width; a bold cap is ~0.6 em), measured from the drawing as drawn.
  const heroRef = useRef<HTMLDivElement>(null);
  // HDR lighting: on in settings (the app started in scRGB), an HDR display,
  // and WebGPU; otherwise the normal glow only.
  const [hdrSetting, setHdrSetting] = useState(false);
  // lifetime: OK — acquires nothing (one settings read; a late answer only sets state)
  useEffect(() => {
    window.desktop
      ?.getSettings()
      .then((s) => setHdrSetting(s.hdrLighting && s.hardwareAcceleration))
      .catch(logged("reading the HDR lighting setting (the normal glow stays)"));
  }, []);
  const [hdrNits] = useKnob(knob("hdrNits"));
  // The drawing shown (LiveController), which the HDR glow follows too.
  const shownModel = on ? (id?.model ?? null) : null;
  const hdr = hdrSetting && on && matchMedia("(dynamic-range: high)").matches && "gpu" in navigator;
  const [ctlWidth, setCtlWidth] = useState(800);
  // lifetime: OK — cleanup: disconnects the ResizeObserver
  useEffect(() => {
    const ctl = heroRef.current?.querySelector(".live-ctl");
    if (!ctl) return;
    // The art is scaled to fit its box (aspect kept), so the drawn width is
    // the smaller of the box width and its height times the art's aspect.
    const vb = ctl.querySelector("svg")?.viewBox.baseVal;
    const aspect = vb && vb.height ? vb.width / vb.height : 1.8;
    // lifetime: OK — disconnected in the effect cleanup (unmount, controller on/off)
    const ro = new ResizeObserver(([e]) => setCtlWidth(Math.min(e.contentRect.width, e.contentRect.height * aspect)));
    ro.observe(ctl);
    return () => ro.disconnect();
  }, [on]);
  const titleSize = Math.round(Math.max(28, Math.min(132, ctlWidth * 0.105, (ctlWidth * 0.46) / (0.6 * modelName.length))));
  // Glass style: the settings panel is an inspector, the regular variant
  // (more frost, for text); its cards stay standard surfaces.
  const [glass] = useFlagPref(GLASS_KEY);
  const panelGlass = useGlass(glass && !(panelHidden && view === "overview"), REGULAR_GLASS);

  // The tour points at the settings list, so it brings the panel back.
  // lifetime: OK — cleanup: removes the tour listener
  useEffect(() => {
    const show = () => hidePanel(false);
    // lifetime: OK — removed in the effect cleanup
    window.addEventListener(TOUR_EVENT, show);
    return () => window.removeEventListener(TOUR_EVENT, show);
  }, [hidePanel]);
  // The Tour's view: the open section.
  // loop: NOT-WORTH — N = 9 sections; per render (a Set lookup each)
  const openSection = SECTIONS.controller.find((x) => acc.isOpen(x)) ?? null;
  const reveal = acc.reveal;
  const tourView = useCallback(
    (section: string | null) => {
      if (section) reveal(section);
    },
    [reveal],
  );
  const target = useProfileTarget();

  if (view === "dongle") return <DonglePage bridge={bridge} fw={fw} identity={id ?? bridge.identity} controllerOn={on} oled={oled} rssi={status?.rssi ?? null} panelRef={panelGlass} />;

  const main = (
    <div className="live-stage">
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
      {/* The drawing's own hints, right under it (IA audit C3): how to connect, why it doesn't move, what a click does. */}
      {/* hint: MUST-SHOW — the empty state: how to connect the controller now */}
      {!on && id && <p className="dk-hint live-hint">{t("desktop.controller.pairHint")}</p>}
      {/* hint: MUST-SHOW — why the drawing doesn't move: what to update */}
      {on && !liveCapable && <p className="dk-hint live-hint">{t("desktop.live.needsFirmware", "Update {{device}}'s firmware to see the controller move live.")}</p>}
      {/* Kept in place (only hidden) while a part is picked, so what's below doesn't jump. */}
      {on && liveCapable && view === "overview" && (
        <p className={`dk-hint live-hint${selected ? " live-hint-idle" : ""}`} aria-hidden={selected ? true : undefined}>
          {t("desktop.live.pickHint")}
        </p>
      )}
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
              <ConnectedDot />
              {t("desktop.overview.connected", "Connected")}
            </span>
          </span>
        </div>
      )}
      {/* App settings shows the drawing and its color / status line only: the preview of
          a theme or color change. None of the tiles or data cards react to an app setting
          (IA audit A1). */}
      {view !== "app" && (
        <div className="live-readouts">
          {on && id && liveCapable && (
            <LiveStrip
              id={id}
              power={power}
              playerWiring={playerWiring}
              rssi={status?.rssi ?? null}
              lightbarMode={bridge.config?.lightbarMode ?? null}
              lightbar={liveLightbar ?? id.lightbar}
              onLightbar={() => pickPart("lightbar")}
            />
          )}
          {on && liveCapable && input && <LiveData input={input} rssi={status?.rssi ?? null} edge={id?.model === "edge"} />}
        </div>
      )}
      {view !== "app" && !(on && id && liveCapable) && (
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
      {view === "overview" && client && (
        <MainBlock state={infoBlock} icon={Info} title={t("desktop.ctrlInfo.title")} status={infoStatus.status} task={infoStatus.task}>
          <ControllerInfo data={info} batteryPct={batteryPct} power={input ? power : null} />
        </MainBlock>
      )}
    </div>
  );
  if (view === "app") return <AppSettingsPage bridge={bridge} fw={fw} main={main} panelRef={panelGlass} />;
  const slot = id?.currentSlot;
  return (
    <>
      <SplitView
        page="controller"
        main={main}
        title={on && id?.model ? (look ? `${look.name} ${modelName}` : modelName) : t("desktop.live.overview")}
        sub={slot !== undefined ? t("desktop.panelSub.controller", { slot }) : undefined}
        top={
          target && (
            <Notice role="status" closable>
              {t("desktop.editing.title", { title: target.title })}
            </Notice>
          )
        }
        state={acc}
        panelRef={panelGlass}
      >
        <ControllerSections
          bridge={bridge}
          input={input}
          remap={remap}
          buttonFocus={buttonFocus}
          onButtonFocus={setButtonFocus}
          onButtonHover={setButtonHover}
          edge={id?.model === "edge"}
          trigger={picked === "l2" ? "l2" : "r2"}
        />
      </SplitView>
      <Tour client={client} input={input} view={openSection} onView={tourView} ready={on && liveCapable} />
    </>
  );
}

// The status dot pulses three times when the controller connects (the app
// starting with one connected, or a reconnect), then stays steady; coming
// back to the page doesn't pulse it again (desktop.css .live-spec-dot.pulse).
// cache: OK — key=none (the current connection's pulse played); invalidated=reset when the controller disconnects (ControllerView); bound=1 flag
let dotPulsed = false;
export const resetConnectedDot = (): void => {
  dotPulsed = false;
};
export function ConnectedDot() {
  const [pulse] = useState(() => !dotPulsed);
  // lifetime: OK — acquires nothing (marks this connection's pulse as played)
  useEffect(() => {
    dotPulsed = true;
  }, []);
  return <span className={`live-spec-dot${pulse ? " pulse" : ""}`} aria-hidden="true" />;
}
