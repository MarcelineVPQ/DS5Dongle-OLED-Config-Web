import { useEffect, useState } from "react";
import { causeText } from "../shownError";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { allSlotsTaken } from "../../protocol/bridgeClient";
import { usePoll } from "../usePoll";
import { BusyButton } from "../controls";
import { noteSlotOccupancy, useFakeSlots } from "../devPreview";
import { COLORWAYS } from "../live/colorways";
import { writePref } from "../storage";
import { readPrefJson } from "../persistedPref";
import { salvageRecord } from "../../persisted";
import { z } from "zod";
import { useLibrary } from "../library/libraryContext";
import Notice from "../Notice";

// Which controller each pairing slot holds, remembered by its Bluetooth
// address whenever it connects (the dongle only stores the address).
export const SLOT_MEMORY_KEY = "ds5.slotControllers";
const RememberedSlot = z.strictObject({ model: z.enum(["dualsense", "edge"]), colorway: z.string().max(8) });
type Remembered = Record<string, z.infer<typeof RememberedSlot>>;
// A damaged memory keeps the slots that still read, and the notice says so
// (readPrefJson, batch E1); a slot it forgot shows without its model until
// that controller connects again.
export function readMemory(): Remembered {
  return readPrefJson(SLOT_MEMORY_KEY, {
    kind: "slotControllers",
    salvage: (data) =>
      salvageRecord(data, z.string().max(17), (v) => {
        // error: NOT-WORTH — a slot entry that doesn't fit is left out and counted as lost (the notice says so)
        const slot = RememberedSlot.safeParse(v);
        return slot.success ? { value: slot.data, lost: false } : null;
      }),
    fallback: () => ({}),
  });
}

function formatMac(addr: Uint8Array): string {
  // loop: HOT-PATH-OK — N = 6 address bytes x ≤ 4 slots; re-render per 1.5 s slot poll
  return [...addr].map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
}

// The Pairing slots section's body (Controller page); its slot poll runs only while it's open.
export default function SlotsPage({ bridge }: { bridge: UseDs5BridgeResult }) {
  const { t } = useTranslation();
  const client = bridge.client;
  // Not client.switchSlot: a game's profile mustn't be saved into flash by the switch.
  const { switchSlot } = useLibrary();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  // Only the slots: the current slot comes from the connection hook's
  // identity poll (the app's one identity poll).
  // lifetime: OK — usePoll stops on unmount, while hidden and while busy
  const live = usePoll(
    async () => {
      if (!client) return null;
      return { slots: await client.readSlots() };
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
      // error: SHOWN — desktop.errors.boardFailed (a slot switch / forget / wipe whose save failed; firmware error pass)
      setError(causeText(cause));
    } finally {
      setBusy(false);
      setConfirmWipe(false);
    }
  };

  const v = live.value;
  const fake = useFakeSlots();
  const fakeSlot = fake.shown?.slot ?? null;
  // The pretend controllers fill the empty slots this poll reads.
  // lifetime: OK — acquires nothing (hands the slot occupancy to the developer preview)
  useEffect(() => {
    if (v) noteSlotOccupancy(v.slots.occupied);
  }, [v]);
  // Remember the connected controller against its slot's address.
  // Read fresh each render (the panel re-renders with every poll).
  const memory = readMemory();
  const id = bridge.identity;
  const here = id && v && v.slots.occupied[id.currentSlot] ? formatMac(v.slots.addrs[id.currentSlot]) : null;
  // lifetime: OK — acquires nothing (writes the slot memory pref)
  useEffect(() => {
    if (!here || !id?.model || !id.colorwayCode || fakeSlot !== null) return;
    const known = memory[here];
    if (known && known.model === id.model && known.colorway === id.colorwayCode) return;
    writePref(SLOT_MEMORY_KEY, JSON.stringify({ ...memory, [here]: { model: id.model, colorway: id.colorwayCode } }));
  }, [here, id?.model, id?.colorwayCode, fakeSlot, memory]);
  const describe = (c: { model: "dualsense" | "edge"; colorway: string } | undefined) =>
    c ? `${t(c.model === "edge" ? "desktop.slots.edge" : "desktop.slots.dualsense")} · ${COLORWAYS[c.colorway]?.name ?? c.colorway}` : null;
  return (
    <>
      {/* hint: MUST-SHOW — a warning: switching disconnects the controller, and how to pair one */}
      <p className="dk-hint">
        {t(
          "desktop.slots.hint",
          "Each slot remembers one controller. Switching disconnects the current controller; press PS on the one in the new slot. To pair a new controller into an empty slot, switch to it and hold Create + PS.",
        )}
      </p>
      {error && (
        <Notice error onDismiss={() => setError(null)}>
          {error}
        </Notice>
      )}
      {/* Real occupancy only: the pretend controllers fill free slots in the table, not on the board. */}
      {v && allSlotsTaken(v.slots) && (
        <Notice role="status" closable>
          {t("desktop.slots.allTaken", { total: v.slots.occupied.length })}
        </Notice>
      )}
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
          {/* loop: HOT-PATH-OK — N = 4 slots; re-render per 1.5 s slot poll */}
          {[0, 1, 2, 3].map((i) => {
            const fakeHere = fake.placed[i];
            const active = fakeSlot !== null ? fakeSlot === i : id?.currentSlot === i;
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
                      <BusyButton
                        className="dk-btn"
                        disabled={!client || busy}
                        onClick={() =>
                          // A pretend controller, or back from one to the real slot: shown only, nothing sent.
                          fakeHere ? fake.switchTo(fakeHere) : fakeSlot !== null && id?.currentSlot === i ? fake.switchTo(null) : act(() => switchSlot(i))
                        }
                      >
                        {t("desktop.slots.switch", "Switch to")}
                      </BusyButton>
                    )}
                    <BusyButton className="dk-btn danger" disabled={!client || busy || !occupied || !!fakeHere} onClick={() => act(() => client!.forgetSlot(i))}>
                      {t("desktop.slots.forget", "Forget")}
                    </BusyButton>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="dk-row-btns dk-row-btns-end">
        {confirmWipe ? (
          <>
            <span className="dk-bad">{t("desktop.slots.wipeConfirm", "Forget all four controllers?")}</span>
            <button type="button" className="dk-btn" onClick={() => setConfirmWipe(false)}>
              {t("desktop.common.cancel", "Cancel")}
            </button>
            <BusyButton className="dk-btn danger" disabled={busy} onClick={() => act(() => client!.wipeSlots())}>
              {t("desktop.slots.wipe", "Forget all")}
            </BusyButton>
          </>
        ) : (
          <button type="button" className="dk-btn danger" disabled={!client || busy} onClick={() => setConfirmWipe(true)}>
            {t("desktop.slots.wipe", "Forget all")}
          </button>
        )}
      </div>
    </>
  );
}
