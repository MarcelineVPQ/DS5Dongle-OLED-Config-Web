import { useEffect, useState } from "react";
import { errorText } from "../../errorText";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { usePoll } from "../usePoll";
import { FAKE_SLOTS, useFakeSlots } from "../devPreview";
import { COLORWAYS } from "../live/colorways";
import { readPref, writePref } from "../storage";

// Which controller each pairing slot holds, remembered by its Bluetooth
// address whenever it connects (the dongle only stores the address).
const SLOT_MEMORY_KEY = "ds5.slotControllers";
type Remembered = Record<string, { model: "dualsense" | "edge"; colorway: string }>;
function readMemory(): Remembered {
  try {
    return JSON.parse(readPref(SLOT_MEMORY_KEY) ?? "{}") as Remembered;
  } catch {
    return {};
  }
}

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
      setError(errorText(cause));
    } finally {
      setBusy(false);
      setConfirmWipe(false);
    }
  };

  const v = live.value;
  const fake = useFakeSlots();
  // Remember the connected controller against its slot's address.
  // Read fresh each render (the panel re-renders with every poll).
  const memory = readMemory();
  const id = v?.identity;
  const here = id && v.slots.occupied[id.currentSlot] ? formatMac(v.slots.addrs[id.currentSlot]) : null;
  useEffect(() => {
    if (!here || !id?.model || !id.colorwayCode || fake.slot !== null) return;
    const known = memory[here];
    if (known && known.model === id.model && known.colorway === id.colorwayCode) return;
    writePref(SLOT_MEMORY_KEY, JSON.stringify({ ...memory, [here]: { model: id.model, colorway: id.colorwayCode } }));
  }, [here, id?.model, id?.colorwayCode, fake.slot, memory]);
  const describe = (c: { model: "dualsense" | "edge"; colorway: string } | undefined) =>
    c ? `${t(c.model === "edge" ? "desktop.slots.edge" : "desktop.slots.dualsense")} · ${COLORWAYS[c.colorway]?.name ?? c.colorway}` : null;
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
              const fakeHere = fake.on && !(v?.slots.occupied[i] ?? false) ? FAKE_SLOTS[i] : undefined;
              const active = fake.slot !== null ? fake.slot === i : v?.identity.currentSlot === i;
              const occupied = (v?.slots.occupied[i] ?? false) || !!fakeHere;
              const mac = v && v.slots.occupied[i] ? formatMac(v.slots.addrs[i]) : null;
              const name = fakeHere ? `${describe(fakeHere)} (${t("desktop.slots.pretend")})` : mac ? describe(memory[mac]) : null;
              return (
                <tr key={i}>
                  <td>{i}</td>
                  <td title={mac ?? undefined}>{v ? (occupied ? (name ?? <span className="dk-mono">{mac}</span>) : t("desktop.slots.empty", "Empty")) : "—"}</td>
                  <td>
                    <div className="acts-cell">
                      {active ? (
                        <span className="dk-chip ok">{t("desktop.slots.active", "Active")}</span>
                      ) : (
                        <button
                          type="button"
                          className="dk-btn"
                          disabled={!client || busy}
                          onClick={() =>
                            // A pretend controller, or back from one to the real slot: shown only, nothing sent.
                            fakeHere ? fake.switchTo(i) : fake.slot !== null && v?.identity.currentSlot === i ? fake.switchTo(null) : void act(() => client!.switchSlot(i))
                          }
                        >
                          {t("desktop.slots.switch", "Switch to")}
                        </button>
                      )}
                      <button type="button" className="dk-btn danger" disabled={!client || busy || !occupied || !!fakeHere} onClick={() => void act(() => client!.forgetSlot(i))}>
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
