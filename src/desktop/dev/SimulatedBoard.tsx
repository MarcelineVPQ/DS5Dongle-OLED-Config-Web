// Developer card → Simulated board (dev builds only, under "Simulate the
// board"): what the simulated Pico is doing (running its firmware, in
// BOOTSEL, a blank Pico, or off USB), and how its next firmware update goes
// (a failure to see the app's error paths, the writing speed). The app's
// whole update flow (firmware card → Update → progress → waiting → done) and
// the setup screen's first install run against it (protocol/simulatedBoard.ts).
import { useTranslation } from "react-i18next";
import { Row } from "../controls";
import { SIM_EXTRA_COUNTS, SIM_EXTRA_KEY, useSimulatedBoard, type SimBoardShown } from "../devPreview";
import { usePref, writePref } from "../storage";
import { SIM_BOARD_FAULTS, SIM_FLASH_SPEEDS, type SimBoardFault, type SimFlashSpeed } from "../../protocol/simulatedBoard";

const STATES: SimBoardShown[] = ["dongle", "bootsel", "blank", "away"];

export default function SimulatedBoard() {
  const { t } = useTranslation();
  const sim = useSimulatedBoard();
  const [extra] = usePref<string>(SIM_EXTRA_KEY, "0", SIM_EXTRA_COUNTS);
  if (!sim.board) return null;
  return (
    <>
      <Row label={t("desktop.dev.simBoard")} info={t("desktop.dev.simBoardHint")}>
        <select className="dk-select" aria-label={t("desktop.dev.simBoard")} value={sim.state} onChange={(e) => sim.set(e.target.value as SimBoardShown)}>
          {/* loop: HOT-PATH-OK — N = 4 states, Developer card only */}
          {STATES.map((s) => (
            <option key={s} value={s}>
              {t(`desktop.dev.simBoardState.${s}`, { version: sim.version ?? "" })}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t("desktop.dev.simExtra")} sub={t("desktop.dev.restartsPage")} info={t("desktop.dev.simExtraHint")}>
        <select
          className="dk-select"
          aria-label={t("desktop.dev.simExtra")}
          value={extra}
          onChange={(e) => {
            writePref(SIM_EXTRA_KEY, e.target.value);
            location.reload(); // the board stack lists them from the next start
          }}
        >
          {/* loop: HOT-PATH-OK — N = 20 counts, Developer card only */}
          {SIM_EXTRA_COUNTS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t("desktop.dev.simFault")} sub={t("desktop.dev.simFaultHint")}>
        <select className="dk-select" aria-label={t("desktop.dev.simFault")} value={sim.fault} onChange={(e) => sim.setFault(e.target.value as SimBoardFault)}>
          {/* loop: HOT-PATH-OK — N = 6 failures, Developer card only */}
          {SIM_BOARD_FAULTS.map((f) => (
            <option key={f} value={f}>
              {t(`desktop.dev.simFaults.${f || "none"}`)}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t("desktop.dev.simSpeed")}>
        <select className="dk-select" aria-label={t("desktop.dev.simSpeed")} value={sim.speed} onChange={(e) => sim.setSpeed(e.target.value as SimFlashSpeed)}>
          {/* loop: HOT-PATH-OK — N = 3 speeds, Developer card only */}
          {(Object.keys(SIM_FLASH_SPEEDS) as SimFlashSpeed[]).map((s) => (
            <option key={s} value={s}>
              {t(`desktop.dev.simSpeeds.${s}`)}
            </option>
          ))}
        </select>
      </Row>
    </>
  );
}
