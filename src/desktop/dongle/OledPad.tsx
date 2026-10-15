// The controller buttons the OLED screens react to (protocol 1.19, 0xF6
// 0x19), beside the mirror: R1, the directional buttons and △ ○ ✕ □, drawn
// with Zacksly's button glyphs (src/assets/glyphs, CC BY 3.0). Only the
// board's screen sees these presses; games never do. A click is a tap; a
// press held is sent with its held time once let go (Settings' Reset / Wipe
// need △ 2 s, Slots' forget □ 1.5 s: a bar fills over that time). Space /
// Enter work the same way. A button the current screen doesn't use is
// disabled and its tooltip says so; older firmware: all disabled with the
// update tooltip.
// Idle cost: nothing (no timers; the hold bar is a CSS animation only while held).
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import HoldButton from "./HoldButton";
import { OLED_PAD_MAX_HOLD_MS, type OledFrame, type OledPadButton } from "../../protocol/bridgeClient";
import { SCREEN, SCREEN_NAMES, SETTINGS_HOLD_MS, SLOTS_WIPE_HOLD_MS } from "../../oled/screenNames";
import { causeText } from "../shownError";
import triangleGlyph from "../../assets/glyphs/triangle.svg?url";
import circleGlyph from "../../assets/glyphs/circle.svg?url";
import crossGlyph from "../../assets/glyphs/cross.svg?url";
import squareGlyph from "../../assets/glyphs/square.svg?url";
import upGlyph from "../../assets/glyphs/dpad-up.svg?url";
import downGlyph from "../../assets/glyphs/dpad-down.svg?url";
import leftGlyph from "../../assets/glyphs/dpad-left.svg?url";
import rightGlyph from "../../assets/glyphs/dpad-right.svg?url";
import r1Glyph from "../../assets/glyphs/r1.svg?url";

export interface OledPadProps {
  supported: boolean; // the firmware takes controller buttons from the app (1.19)
  press: ((button: OledPadButton, holdMs: number) => Promise<void>) | null; // null: no board
  controllerOn: boolean; // Lightbar and Trigger Test act on the controller
}

const GLYPH: Record<OledPadButton, string> = {
  up: upGlyph,
  down: downGlyph,
  left: leftGlyph,
  right: rightGlyph,
  triangle: triangleGlyph,
  circle: circleGlyph,
  cross: crossGlyph,
  square: squareGlyph,
  r1: r1Glyph,
};
// The live drawing's part names (desktop.live.part), Sony's terms.
const PART: Record<OledPadButton, string> = {
  up: "dpad-up",
  down: "dpad-down",
  left: "dpad-left",
  right: "dpad-right",
  triangle: "triangle",
  circle: "circle",
  cross: "cross",
  square: "square",
  r1: "r1",
};
const FAV: Partial<Record<OledPadButton, number>> = { triangle: 0, circle: 1, cross: 2, square: 3 };

// What a button does on a screen (firmware oled.cpp *_handle_input): the
// action's text key and its hold time, or null when the screen ignores it.
type Action = { key: string; n?: number; holdMs?: number; needsController?: boolean };
export function padAction(screen: number, button: OledPadButton): Action | null {
  if (screen === SCREEN.settings) {
    if (button === "triangle") return { key: "settings.triangle", holdMs: SETTINGS_HOLD_MS };
    if (button === "up" || button === "down" || button === "left" || button === "right") return { key: `settings.${button}` };
  } else if (screen === SCREEN.slots) {
    if (button === "up" || button === "down" || button === "triangle") return { key: `slots.${button}` };
    if (button === "square") return { key: "slots.square", holdMs: SLOTS_WIPE_HOLD_MS };
  } else if (screen === SCREEN.diag) {
    if (button === "up" || button === "down") return { key: `diag.${button}` };
  } else if (screen === SCREEN.lightbar) {
    if (button === "r1") return { key: "lightbar.r1", needsController: true };
    if (FAV[button] !== undefined) return { key: "lightbar.fav", n: FAV[button], needsController: true };
  } else if (screen === SCREEN.triggers && button === "triangle") return { key: "triggers.triangle", needsController: true };
  return null;
}

// Laid out like the controller: R1 on top, the directional buttons, then △ ○ ✕ □ as a diamond.
const DPAD: [OledPadButton, string][] = [
  ["up", "n"],
  ["left", "w"],
  ["right", "e"],
  ["down", "s"],
];
const FACE: [OledPadButton, string][] = [
  ["triangle", "n"],
  ["square", "w"],
  ["circle", "e"],
  ["cross", "s"],
];

export default function OledPad({ supported, press, controllerOn, frame }: OledPadProps & { frame: OledFrame | null }) {
  const { t } = useTranslation();
  const [held, setHeld] = useState<OledPadButton | null>(null);
  // error: SHOWN — english: the pad's tooltip and red outline until the next press (board errors are English, batch E3)
  const [error, setError] = useState<string | null>(null);
  // cache: OK — key=none (the button held now and since when); invalidated=each release / cancel; bound=1 entry
  const downAt = useRef<{ button: OledPadButton; at: number } | null>(null);
  const screen = frame ? frame.screen : null;
  const screenName = screen === null ? "—" : (SCREEN_NAMES[screen] ?? "?");
  const tp = (k: string, o?: Record<string, unknown>) => t(`desktop.dongleConsole.pad.${k}`, o);

  const state = (button: OledPadButton) => {
    const name = t(`desktop.live.part.${PART[button]}`);
    if (!supported) return { usable: false, tip: `${name}: ${tp("needsFirmware")}` };
    if (!press || screen === null) return { usable: false, tip: `${name}: ${tp("noScreen")}` };
    const a = padAction(screen, button);
    if (!a) return { usable: false, tip: `${name}: ${tp("unused", { screen: screenName })}` };
    if (a.needsController && !controllerOn) return { usable: false, tip: `${name}: ${tp("needsController", { screen: screenName })}` };
    const text = tp(`act.${a.key}`, { n: a.n, s: a.holdMs ? a.holdMs / 1000 : 0 });
    return { usable: true, tip: `${name} · ${screenName}: ${error ?? text}`, holdMs: a.holdMs };
  };

  const down = (button: OledPadButton, at: number) => {
    if (downAt.current || !state(button).usable) return;
    downAt.current = { button, at };
    setHeld(button);
  };
  const up = (button: OledPadButton, at: number) => {
    const d = downAt.current;
    if (!d || d.button !== button || !press) return;
    downAt.current = null;
    setHeld(null);
    // A quick click is a tap (0); a longer press is held as long on the board.
    const ms = at - d.at < 250 ? 0 : Math.min(OLED_PAD_MAX_HOLD_MS, Math.round(at - d.at));
    setError(null);
    // error: SHOWN — english: the pad's tooltip and red outline until the next press (board errors are English, batch E3)
    press(button, ms).catch((cause: unknown) => setError(causeText(cause)));
  };
  const cancel = () => {
    downAt.current = null;
    setHeld(null);
  };

  const key = (button: OledPadButton, place: string) => {
    const s = state(button);
    return (
      <HoldButton
        key={button}
        className={`dpad-btn dpad-${place}${held === button ? " held" : ""}${s.holdMs ? " holdable" : ""}${error ? " bad" : ""}`}
        style={s.holdMs ? ({ "--hold-ms": `${s.holdMs}ms` } as React.CSSProperties) : undefined}
        aria-disabled={!s.usable}
        aria-label={t(`desktop.live.part.${PART[button]}`)}
        title={s.tip}
        data-button={button}
        onDown={(at) => down(button, at)}
        onUp={(at) => up(button, at)}
        onCancel={cancel}
      >
        <span className="dpad-glyph" aria-hidden="true" style={{ maskImage: `url("${GLYPH[button]}")`, WebkitMaskImage: `url("${GLYPH[button]}")` }} />
      </HoldButton>
    );
  };

  return (
    <div className="dpad" role="group" aria-label={tp("title")} title={tp("info")}>
      <div className="dpad-row">{key("r1", "r1")}</div>
      {/* loop: HOT-PATH-OK — N = 4 directional buttons per render */}
      <div className="dpad-cluster dpad-dirs">{DPAD.map(([b, p]) => key(b, p))}</div>
      {/* loop: HOT-PATH-OK — N = 4 face buttons per render */}
      <div className="dpad-cluster">{FACE.map(([b, p]) => key(b, p))}</div>
    </div>
  );
}
