import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { adcToCelsius, formatUptime } from "../format";
import { usePoll } from "../usePoll";
import type { FirmwareUpdate } from "../useUpdates";
import DiagnosticsPage from "./DiagnosticsPage";
import FirmwarePage from "./FirmwarePage";
import SettingsCards from "./SettingsPage";

// The dongle itself: its display, power and USB behavior, firmware and updates.
// Diagnostics and internals stay folded away under Advanced.
export default function DonglePage({ bridge, fw, advancedOpen }: { bridge: UseDs5BridgeResult; fw: FirmwareUpdate; advancedOpen: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="dk-stack">
      <SettingsCards bridge={bridge} group="dongle" />
      <FirmwarePage bridge={bridge} fw={fw} />
      <details className="dk-card dk-advanced" open={advancedOpen}>
        <summary>{t("desktop.dongle.advanced", "Advanced")}</summary>
        <DongleInternals bridge={bridge} />
        <DiagnosticsPage bridge={bridge} />
      </details>
    </div>
  );
}

function DongleInternals({ bridge }: { bridge: UseDs5BridgeResult }) {
  const { t } = useTranslation();
  const client = bridge.client;
  const v = usePoll(
    async () => {
      if (!client) return null;
      const [diag, cpu] = await Promise.all([client.readDiag(), client.readCpu()]);
      return { diag, cpu };
    },
    2000,
    Boolean(client),
  ).value;
  return (
    <dl className="dk-kv">
      <dt>{t("desktop.overview.protocol", "Protocol")}</dt>
      <dd className="dk-mono">{bridge.identity ? `${bridge.identity.protoMajor}.${bridge.identity.protoMinor}` : "—"}</dd>
      <dt>{t("desktop.overview.uptime", "Uptime")}</dt>
      <dd>{v ? formatUptime(v.diag.uptimeSeconds) : "—"}</dd>
      <dt>{t("desktop.overview.cpu", "CPU")}</dt>
      <dd>{v ? `${Math.round(v.cpu.measuredKhz / 1000)} MHz · ${adcToCelsius(v.cpu.tempRaw).toFixed(1)} °C` : "—"}</dd>
    </dl>
  );
}
