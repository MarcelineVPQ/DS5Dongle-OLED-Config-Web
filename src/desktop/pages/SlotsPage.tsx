import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { usePoll } from "../usePoll";

function formatMac(addr: Uint8Array): string {
  return [...addr].map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
}

export default function SlotsPage({ bridge }: { bridge: UseDs5BridgeResult }) {
  const { t } = useTranslation();
  const client = bridge.client;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const live = usePoll(
    async () => {
      if (!client) return null;
      const [slots, identity] = await Promise.all([client.readSlots(), client.identity()]);
      return { slots, identity };
    },
    1500,
    Boolean(client) && !busy,
  );

  const act = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setConfirmWipe(false);
    }
  };

  const v = live.value;
  return (
    <div className="dk-grid">
      <section className="dk-card" style={{ gridColumn: "1 / -1" }}>
        <h2>{t("desktop.slots.title", "Pairing slots")}</h2>
        <p className="dk-hint">
          {t(
            "desktop.slots.hint",
            "Each slot remembers one controller. Switching disconnects the current controller; press PS on the one in the new slot. To pair a new controller into an empty slot, switch to it and hold Create + PS.",
          )}
        </p>
        {error && <div className="dk-notice error">{error}</div>}
        <table className="dk-table slots">
          <colgroup>
            <col className="slot" />
            <col />
            <col className="acts" />
          </colgroup>
          <thead>
            <tr>
              <th>{t("desktop.slots.slot", "Slot")}</th>
              <th>{t("desktop.slots.controller", "Controller")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3].map((i) => {
              const active = v?.identity.currentSlot === i;
              const occupied = v?.slots.occupied[i] ?? false;
              return (
                <tr key={i}>
                  <td>{i}</td>
                  <td className="dk-mono">{v ? (occupied ? formatMac(v.slots.addrs[i]) : t("desktop.slots.empty", "Empty")) : "—"}</td>
                  <td>
                    <div className="acts-cell">
                      {active ? (
                        <span className="dk-chip ok">{t("desktop.slots.active", "Active")}</span>
                      ) : (
                        <button type="button" className="dk-btn" disabled={!client || busy} onClick={() => void act(() => client!.switchSlot(i))}>
                          {t("desktop.slots.switch", "Switch to")}
                        </button>
                      )}
                      <button type="button" className="dk-btn danger" disabled={!client || busy || !occupied} onClick={() => void act(() => client!.forgetSlot(i))}>
                        {t("desktop.slots.forget", "Forget")}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="dk-ctl" style={{ justifyContent: "flex-end", padding: "8px 0 4px" }}>
          {confirmWipe ? (
            <>
              <span className="dk-bad">{t("desktop.slots.wipeConfirm", "Forget all four controllers?")}</span>
              <button type="button" className="dk-btn" onClick={() => setConfirmWipe(false)}>
                {t("desktop.common.cancel", "Cancel")}
              </button>
              <button type="button" className="dk-btn danger" disabled={busy} onClick={() => void act(() => client!.wipeSlots())}>
                {t("desktop.slots.wipe", "Forget all")}
              </button>
            </>
          ) : (
            <button type="button" className="dk-btn danger" disabled={!client || busy} onClick={() => setConfirmWipe(true)}>
              {t("desktop.slots.wipe", "Forget all")}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
