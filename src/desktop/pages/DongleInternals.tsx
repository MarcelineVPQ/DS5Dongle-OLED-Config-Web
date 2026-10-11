import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { adcToCelsius, formatUptime } from "../format";
import { usePoll } from "../usePoll";

// Dongle internals for the panel's Advanced section: protocol, uptime, CPU.
export function DongleInternals({ bridge }: { bridge: UseDs5BridgeResult }) {
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
