// Gyro as mouse (protocol 1.24, [58] bit 5; docs/design/button-layouts-2026-11.md
// §2.6): the Gyroscope section's group for the layout in the editor. Off / On
// / With a button (flags bit 2: only while a Gyro target holds or switches it
// on), the mouse or the right stick, yaw or roll, two speeds (plain 1–255
// multipliers, §4.6), invert, steadiness. A draft of the layout like any edit.
// Idle cost: none (static controls).
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { emptyButtonPart, withGyro, type ButtonGyro } from "../../protocol/buttons";
import { Segmented, Slider, Toggle } from "../controls";
import { SectionGroup } from "../accordion/Section";
import { KeysReconnect } from "./ButtonEditor";
import { useBoardDrafts } from "./boardDrafts";

// Starting values (tunable, the firmware's §3.2 / §4.6: no one has measured them).
const GYRO_DEFAULT: ButtonGyro = { mode: 1, axis: 0, flags: 0, speedH: 64, speedV: 64, steadiness: 8 };
const NEEDS_BUTTON = 0x04;

export function GyroMouse({ bridge }: { bridge: UseDs5BridgeResult }) {
  const { t } = useTranslation();
  const { layout: editor } = useBoardDrafts();
  const set = editor.layout;
  const part = set.buttons ?? emptyButtonPart();
  const g = part.gyro;
  const put = (gyro: ButtonGyro | null) => editor.edit({ ...set, buttons: withGyro(part, gyro) });
  const change = (c: Partial<ButtonGyro>) => {
    if (g) put({ ...g, ...c });
  };
  const mode = !g ? "off" : g.flags & NEEDS_BUTTON ? "button" : "on";
  return (
    <SectionGroup title={t("desktop.gyroMouse.title")}>
      <Segmented
        label={t("desktop.gyroMouse.mode")}
        value={mode}
        options={[
          { value: "off", label: t("desktop.gyroMouse.modes.off") },
          { value: "on", label: t("desktop.gyroMouse.modes.on") },
          { value: "button", label: t("desktop.gyroMouse.modes.button") },
        ]}
        onChange={(m) => {
          if (m === "off") return put(null);
          const base = g ?? GYRO_DEFAULT;
          put({ ...base, flags: m === "button" ? base.flags | NEEDS_BUTTON : base.flags & ~NEEDS_BUTTON });
        }}
      />
      {g && (
        <>
          {mode === "button" && <p className="dk-hint">{t("desktop.gyroMouse.buttonHint")}</p>}
          <Segmented
            label={t("desktop.gyroMouse.use")}
            value={g.mode}
            options={[
              { value: 1, label: t("desktop.gyroMouse.uses.mouse") },
              { value: 2, label: t("desktop.gyroMouse.uses.stick") },
            ]}
            onChange={(m) => change({ mode: m })}
          />
          <Segmented
            label={t("desktop.gyroMouse.axis")}
            value={g.axis}
            options={[
              { value: 0, label: t("desktop.gyroMouse.axes.yaw") },
              { value: 1, label: t("desktop.gyroMouse.axes.roll") },
            ]}
            onChange={(axis) => change({ axis })}
          />
          <Slider label={t("desktop.gyroMouse.speedH")} value={g.speedH} min={1} max={255} step={1} onChange={(speedH) => change({ speedH })} />
          <Slider label={t("desktop.gyroMouse.speedV")} value={g.speedV} min={1} max={255} step={1} onChange={(speedV) => change({ speedV })} />
          <Toggle label={t("desktop.gyroMouse.invertH")} value={(g.flags & 0x01) !== 0} onChange={(v) => change({ flags: v ? g.flags | 0x01 : g.flags & ~0x01 })} />
          <Toggle label={t("desktop.gyroMouse.invertV")} value={(g.flags & 0x02) !== 0} onChange={(v) => change({ flags: v ? g.flags | 0x02 : g.flags & ~0x02 })} />
          <Slider
            label={t("desktop.gyroMouse.steadiness")}
            info={t("desktop.gyroMouse.steadinessInfo")}
            value={g.steadiness}
            min={0}
            max={255}
            step={1}
            onChange={(steadiness) => change({ steadiness })}
          />
          {g.mode === 1 && <KeysReconnect bridge={bridge} />}
        </>
      )}
    </SectionGroup>
  );
}
