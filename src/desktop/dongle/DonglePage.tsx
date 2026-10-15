// The Pico 2 W page: the OLED Edition's screen as its centerpiece (OledHero:
// the module named, the mirror with KEY0 / KEY1, what the screen is doing and
// its specs; the console's Log tab beside the mirror), then dials and
// Diagnostics (a main-view block: readouts don't go in the accordion) as the
// main view, its accordion at the right: Firmware, Restart & reset, Power &
// sleep, OLED screen, USB & status pin. The dials and Diagnostics read the
// board live, once a second, while the page is shown and the window is on
// screen (DongleDashboard.tsx); a folded section renders nothing.
import { useTranslation } from "react-i18next";
import { Activity, Download, Monitor, Power, RotateCcw, Usb } from "lucide-react";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { FEATURES3, supportsFeature3, type BridgeIdentity } from "../../protocol/bridgeClient";
import { STATUS_GPIO_OFF } from "../../protocol/config";
import { shortVersion } from "../../update/manifest";
import { named, onOff } from "../accordion/status";
import { Section, SectionGroup, SplitView } from "../accordion/Section";
import { pinScope, useAccordion } from "../accordion/useAccordion";
import { MainBlock, revealBlock, useMainBlock } from "../accordion/MainBlock";
import { useProfileTarget } from "../library/libraryContext";
import { hardwareName } from "../hardwareName";
import { formatUptime } from "../format";
import Notice from "../Notice";
import { useNoticeTasks } from "../notices";
import { BOARD_PROBLEM_BLOCK, FIRMWARE_UPDATE_SECTION } from "../openTasks";
import FirmwareSection, { DeviceSection } from "../pages/FirmwarePage";
import { DisplaySection, PcSleepSection, PowerSection, StatusPinSection, UsbSection } from "../pages/SettingsPage";
import type { FirmwareUpdate } from "../useUpdates";
import DongleConsole, { supportsOledMirror, type OledFrameState } from "./DongleConsole";
import OledHero from "./OledHero";
import { DiagnosticsBody, PicoGauges, useDongleTelemetry } from "./DongleDashboard";

const minutesOrNever = (t: (k: string, o?: Record<string, unknown>) => string, n: number) => (n ? t("desktop.dash.minutes", { n }) : t("desktop.dash.never"));

interface Props {
  bridge: UseDs5BridgeResult;
  fw: FirmwareUpdate;
  identity: BridgeIdentity | null; // as shown (a developer preview may stand in)
  controllerOn: boolean;
  oled: OledFrameState; // the OLED mirror (ControllerView's one poll)
  rssi: number | null;
  panelRef?: (el: HTMLElement | null) => void;
}

export default function DonglePage({ bridge, fw, identity, controllerOn, oled, rssi, panelRef }: Props) {
  const { t } = useTranslation();
  // loop: NOT-WORTH — N ≤ ~6 open tasks; the page's render
  const tasks = useNoticeTasks().tasks.filter((x) => x.place === "dongle");
  // loop: NOT-WORTH — N ≤ ~3 board tasks; the page's render
  const fwTask = tasks.find((x) => x.section === FIRMWARE_UPDATE_SECTION)?.text ?? null;
  // loop: NOT-WORTH — N ≤ ~3 board tasks; the page's render
  const boardTask = tasks.find((x) => x.section === BOARD_PROBLEM_BLOCK)?.text ?? null;
  const acc = useAccordion("dongle", pinScope("dongle"), fwTask ? "firmware" : null);
  const diagnostics = useMainBlock("dongle", BOARD_PROBLEM_BLOCK);
  const telemetry = useDongleTelemetry(bridge, oled, rssi);
  const target = useProfileTarget();
  const s = telemetry.sample;
  const d = bridge.draft;
  const v13 = supportsFeature3(bridge.identity, 13, FEATURES3.configTail);
  const installed = bridge.firmwareVersion;

  const main = (
    <div className="live-stage dongle-main">
      <OledHero frame={oled.frame} capable={supportsOledMirror(identity)} redraws={s?.rated && s.oled ? s.oled.fps : null}>
        <DongleConsole
          client={bridge.client}
          identity={identity}
          controllerOn={controllerOn}
          frame={oled}
          keys={{ supported: false, press: null }} // the key-press protocol: next commit
        />
      </OledHero>
      <PicoGauges bridge={bridge} telemetry={telemetry} onDiagnostics={() => revealBlock("dongle", BOARD_PROBLEM_BLOCK)} />
      <MainBlock
        state={diagnostics}
        icon={Activity}
        title={t("desktop.sections.diagnostics")}
        task={boardTask}
        actions={bridge.client && telemetry.error && <span className="dk-bad">{telemetry.error}</span>}
      >
        <DiagnosticsBody bridge={bridge} telemetry={telemetry} />
      </MainBlock>
    </div>
  );
  return (
    <SplitView
      page="dongle"
      main={main}
      title={hardwareName(bridge.identity)}
      sub={`DS5 Dongle OLED Edition${installed ? ` · ${shortVersion(installed)}` : ""}`}
      // The board-wide settings aren't part of a game's profile: said while one is on, since the save bar then saves to the profile.
      top={target && <Notice closable>{t("desktop.editing.dongleNote", { title: target.title })}</Notice>}
      state={acc}
      panelRef={panelRef}
    >
      <Section
        id="firmware"
        icon={Download}
        title={t("desktop.sections.firmware")}
        status={installed ? `${shortVersion(installed)} · ${fw.available ? t("desktop.firmware.update", { version: shortVersion(fw.latest?.version) }) : t("desktop.firmware.upToDate")}` : null}
        task={fwTask}
      >
        {() => <FirmwareSection bridge={bridge} fw={fw} />}
      </Section>
      <Section id="device" icon={RotateCcw} title={t("desktop.sections.device")} status={s ? named(t, t("desktop.dash.uptime"), formatUptime(s.uptime)) : null}>
        {() => <DeviceSection bridge={bridge} />}
      </Section>
      <Section
        id="power"
        icon={Power}
        title={t("desktop.sections.power")}
        status={[
          d.disableInactiveDisconnect ? onOff(t, t("desktop.settings.idleDisconnect"), false) : named(t, t("behavior.inactiveTimeLabel"), minutesOrNever(t, d.inactiveTime)),
          onOff(t, t("desktop.settings.picoLed"), !d.disablePicoLed),
        ].join(" · ")}
      >
        {() => (
          <>
            <PowerSection bridge={bridge} />
            <SectionGroup title={t("desktop.settings.pcSleep")}>
              <PcSleepSection bridge={bridge} />
            </SectionGroup>
          </>
        )}
      </Section>
      <Section
        id="oled"
        icon={Monitor}
        title={t("desktop.sections.oled")}
        status={[["100%", "50%", "25%", "6%"][d.screenBrightness & 3], named(t, t("behavior.screenDimTimeoutLabel"), minutesOrNever(t, d.screenDimTimeout))].join(" · ")}
      >
        {() => <DisplaySection bridge={bridge} />}
      </Section>
      <Section
        id="usb"
        icon={Usb}
        title={t("desktop.sections.usb")}
        // loop: NOT-WORTH — N = 3 parts of one status line
        status={[
          ["250 Hz", "500 Hz", "1 kHz"][d.pollingRateMode] ?? "",
          named(t, t("behavior.controllerModeLabel"), ["DS5", "Edge", "Auto"][d.controllerMode] ?? ""),
          v13 ? named(t, t("desktop.settings.statusPin"), d.statusGpioPin === STATUS_GPIO_OFF ? t("desktop.settings.statusPinOff") : `GP${d.statusGpioPin}`) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        {() => (
          <>
            <UsbSection bridge={bridge} />
            <SectionGroup title={t("desktop.settings.statusPin")}>
              <StatusPinSection bridge={bridge} />
            </SectionGroup>
          </>
        )}
      </Section>
    </SplitView>
  );
}
