// The firmware's OLED screens that react to controller buttons, for the
// simulated board (protocol 1.19, 0xF6 0x19): what each press does and the
// text each screen shows, after src/oled.cpp (settings_handle_input,
// slots_handle_input, lightbar_handle_input, triggers_handle_input,
// diag_handle_input). A press lands at once here; the firmware holds it for
// the asked time (src/oled_vpad.h), which only matters for the holds below.
import type { OledPadButton } from "../protocol/bridgeClient";
import { type ConfigBody, DEFAULT_CONFIG } from "../protocol/config";
import { SCREEN, SETTINGS_HOLD_MS, SLOTS_WIPE_HOLD_MS } from "./screenNames";

const TRIGGER_PRESETS = ["Off", "Feedback", "Weapon", "Vibration", "Bow", "Gallop", "Machine"];
const LB_MODES = ["[LIVE]", "[FAV0]", "[FAV1]", "[FAV2]", "[FAV3]", "[BREA]", "[RAIN]", "[FADE]", "[HOST]"];
const DIAG_ROWS = 14; // firmware kNumDiagRows
const DIAG_VISIBLE = 5;
const POWER_SLEEP_CONTROLLER_OFF = 0x01;
const POWER_PS_WAKES_PC = 0x02;

type NumField = { [K in keyof ConfigBody]: ConfigBody[K] extends number ? K : never }[keyof ConfigBody];
type BoolField = { [K in keyof ConfigBody]: ConfigBody[K] extends boolean ? K : never }[keyof ConfigBody];
// One row of the firmware's kSetItems (labels and ranges as on the panel).
type Item =
  | { label: string; num: NumField; lo: number; hi: number; step: number; wrap?: boolean; names?: readonly string[]; unit?: string; fmt?: "off0" | "game0" | "pc0" | "reduce" | "gain" | "db" }
  | { label: string; bool: BoolField; names?: readonly string[] }
  | { label: string; power: number }
  | { label: string; action: "reset" | "wipe"; hint: string };
const DISABLED = ["on", "off"] as const;
export const SETTINGS_ITEMS: readonly Item[] = [
  { label: "Hap Gain", num: "hapticsGain", lo: 1, hi: 6, step: 0.5, fmt: "gain" },
  { label: "Spk Vol", num: "speakerVolume", lo: -100, hi: 12, step: 5, unit: "dB", fmt: "db" },
  { label: "Inact", num: "inactiveTime", lo: 10, hi: 60, step: 5, unit: "min" },
  { label: "InactDC", bool: "disableInactiveDisconnect", names: DISABLED },
  { label: "Pico LED", bool: "disablePicoLed", names: DISABLED },
  { label: "Poll", num: "pollingRateMode", lo: 0, hi: 2, step: 1, wrap: true, names: ["250Hz", "500Hz", "RT"] },
  { label: "AudBuf", num: "audioBufferLength", lo: 16, hi: 128, step: 4 },
  { label: "Ctrl", num: "controllerMode", lo: 0, hi: 2, step: 1, wrap: true, names: ["DS5", "DSE", "Auto"] },
  { label: "AutoHap", num: "autoHapticsEnable", lo: 0, hi: 3, step: 1, wrap: true, names: ["Off", "Fallback", "Mix", "Replace"] },
  { label: "AH Gain", num: "autoHapticsGain", lo: 0, hi: 200, step: 10, unit: "%" },
  { label: "AH LP", num: "autoHapticsLowpass", lo: 0, hi: 3, step: 1, wrap: true, names: ["80Hz", "160Hz", "250Hz", "400Hz"] },
  { label: "ScrDim", num: "screenDimTimeout", lo: 0, hi: 250, step: 1, unit: "min", fmt: "off0" },
  { label: "ScrOff", num: "screenOffTimeout", lo: 0, hi: 250, step: 1, unit: "min", fmt: "off0" },
  { label: "BT Mic", bool: "btMicEnable" },
  { label: "CtrlWake", bool: "controllerWakesDisplay" },
  { label: "TrigEff", num: "triggerReduce", lo: 0, hi: 10, step: 1, fmt: "reduce" },
  { label: "SpkBoost", num: "speakerGain", lo: 0, hi: 7, step: 1, fmt: "game0" },
  { label: "VolLock", bool: "lockVolume" },
  { label: "SPK Out", num: "speakerSelect", lo: 0, hi: 3, step: 1, wrap: true, names: ["Auto", "SPK", "Hset", "off"] },
  { label: "Mic In", num: "micSelect", lo: 0, hi: 2, step: 1, wrap: true, names: ["Auto", "Int", "Hset"] },
  { label: "Mic Lvl", num: "micLevel", lo: 0, hi: 64, step: 4, fmt: "pc0" },
  { label: "Echo Cancel", bool: "micEchoCancel" },
  { label: "Sleep CtrlOff", power: POWER_SLEEP_CONTROLLER_OFF },
  { label: "PS Wakes PC", power: POWER_PS_WAKES_PC },
  { label: "Reset to defaults", action: "reset", hint: "Hold Tri 2s = RESET" },
  { label: "Wipe all slots", action: "wipe", hint: "Hold Tri 2s = WIPE" },
];

// What the screens act on: the simulated board's config, slots and flash.
export interface SimBoard {
  body(): ConfigBody; // the settings in RAM
  powerFlags(): number;
  save(body: ConfigBody, power: number): boolean; // set + save to flash
  slots(): boolean[];
  currentSlot(): number;
  setSlot(slot: number): boolean;
  forgetSlot(slot: number): boolean;
  wipeSlots(): boolean;
  previewTrigger(preset: number): void;
}

export class SimOledScreens {
  // Settings (firmware settings_local / settings_sel / settings_dirty).
  sel = 0;
  dirty = false;
  private local: ConfigBody | null = null;
  private power = 0;
  status = "";
  // Slots, Diagnostics, Lightbar, Trigger Test.
  slotsCursor = -1;
  slotsStatus = "";
  diagScroll = 0;
  lbMode = 8; // HOST, the firmware's default
  // cache: NOT-WORTH — key=none (favorites saved, for the screen and tests); invalidated=never; bound=one entry per simulated press (dev/test fake only)
  lbSaved: number[] = []; // favorites saved by △ ○ ✕ □ (0..3), newest last
  trigPreset = 0;
  // cache: NOT-WORTH — key=none (every press, for tests); invalidated=never; bound=one entry per simulated press (dev/test fake only)
  presses: [OledPadButton, number][] = [];

  // The configurator changed the config (sync_host_config_changes): drop the snapshot.
  hostChanged(): void {
    this.local = null;
    this.dirty = false;
  }

  private settings(board: SimBoard) {
    if (!this.local) {
      this.local = { ...board.body() };
      this.power = board.powerFlags();
    }
    return this.local;
  }

  // One press on `screen`, held holdMs. connected = a controller is linked
  // (Lightbar and Trigger Test need one; the others take the app's presses
  // without it).
  press(screen: number, button: OledPadButton, holdMs: number, board: SimBoard, connected = true): void {
    this.presses.push([button, holdMs]);
    if (screen === SCREEN.settings) this.settingsPress(button, holdMs, board);
    else if (screen === SCREEN.slots) this.slotsPress(button, holdMs, board);
    else if (screen === SCREEN.diag) {
      if (button === "up") this.diagScroll = Math.max(0, this.diagScroll - 1);
      if (button === "down") this.diagScroll = Math.min(DIAG_ROWS - DIAG_VISIBLE, this.diagScroll + 1);
    } else if (screen === SCREEN.lightbar && connected) {
      if (button === "r1") this.lbMode = (this.lbMode + 1) % LB_MODES.length;
      const fav = (["triangle", "circle", "cross", "square"] as const).indexOf(button as "triangle");
      if (fav >= 0) this.lbSaved.push(fav);
    } else if (screen === SCREEN.triggers && connected && button === "triangle") {
      this.trigPreset = (this.trigPreset + 1) % TRIGGER_PRESETS.length;
      board.previewTrigger(this.trigPreset);
    }
  }

  private settingsPress(button: OledPadButton, holdMs: number, board: SimBoard): void {
    const local = this.settings(board);
    const n = SETTINGS_ITEMS.length;
    if (button === "up") this.sel = (this.sel - 1 + n) % n;
    else if (button === "down") this.sel = (this.sel + 1) % n;
    else if (button === "left" || button === "right") this.adjust(local, button === "right" ? 1 : -1);
    else if (button === "triangle") {
      const it = SETTINGS_ITEMS[this.sel];
      if ("action" in it) {
        if (holdMs < SETTINGS_HOLD_MS) return; // let go too soon: nothing
        if (it.action === "reset") {
          if (board.save({ ...DEFAULT_CONFIG, currentSlot: local.currentSlot }, 0x01)) {
            this.local = null;
            this.dirty = false;
            this.status = "Reset!";
          } else this.status = "Reset FAIL";
        } else this.status = board.wipeSlots() ? "Slots wiped!" : "Wipe FAIL";
        return;
      }
      const saved = board.save(local, this.power);
      this.status = saved ? "Saved!" : "Save FAIL";
      if (saved) this.dirty = false;
    }
  }

  private adjust(local: ConfigBody, delta: number): void {
    const it = SETTINGS_ITEMS[this.sel];
    this.dirty = true;
    if ("action" in it) return;
    if ("power" in it) {
      this.power ^= it.power;
      return;
    }
    if ("bool" in it) {
      local[it.bool] = !local[it.bool];
      return;
    }
    const step = (v: number) => {
      let x = it.fmt === "db" ? (delta > 0 ? Math.floor(v / it.step) * it.step + it.step : Math.ceil(v / it.step) * it.step - it.step) : v + delta * it.step;
      if (it.wrap) x = x < it.lo ? it.hi : x > it.hi ? it.lo : x;
      else x = Math.max(it.lo, Math.min(it.hi, x));
      return Math.round(x * 10) / 10;
    };
    local[it.num] = step(local[it.num]) as never;
    if (it.fmt === "gain") local.hapticsGainRight = step(local.hapticsGainRight);
  }

  private slotsPress(button: OledPadButton, holdMs: number, board: SimBoard): void {
    if (this.slotsCursor < 0) this.slotsCursor = board.currentSlot();
    if (button === "up") this.slotsCursor = (this.slotsCursor + 3) % 4;
    else if (button === "down") this.slotsCursor = (this.slotsCursor + 1) % 4;
    else if (button === "triangle" && this.slotsCursor !== board.currentSlot()) this.slotsStatus = board.setSlot(this.slotsCursor) ? "Switched!" : "Save FAIL";
    else if (button === "square" && holdMs >= SLOTS_WIPE_HOLD_MS) this.slotsStatus = board.forgetSlot(this.slotsCursor) ? "Wiped!" : "Wipe FAIL";
  }

  private formatItem(i: number, board: SimBoard): string {
    const it = SETTINGS_ITEMS[i];
    const cur = i === this.sel ? ">" : " ";
    if ("action" in it) return `${cur} ${it.label}`;
    const local = this.settings(board);
    let value: string;
    if ("power" in it) value = this.power & it.power ? "on" : "off";
    else if ("bool" in it) value = (it.names ?? ["off", "on"])[local[it.bool] ? 1 : 0];
    else {
      const v = local[it.num];
      if (it.fmt === "gain") {
        const r = local.hapticsGainRight;
        if (r !== v) return `${cur} Hap L${v.toFixed(1)} R${r.toFixed(1)}`;
        value = `${v.toFixed(1)}x`;
      } else if (it.fmt === "db") value = `${v >= 0 ? "+" : ""}${Math.trunc(v)}dB`;
      else if (it.names) value = it.names[v % (it.hi + 1)];
      else if (v === 0 && it.fmt && it.fmt !== "reduce") value = it.fmt === "off0" ? "off" : it.fmt === "pc0" ? "PC" : "game";
      else value = `${it.fmt === "reduce" ? "-" : ""}${v}${it.unit ?? ""}`;
    }
    return `${cur} ${it.label} ${value}`;
  }

  // The screen's title, five rows and footer, as the firmware draws them;
  // null for a screen without controller input (the simulation names it).
  lines(screen: number, board: SimBoard): { title: string; rows: string[]; footer: string } | null {
    if (screen === SCREEN.settings) {
      const top = Math.max(0, this.sel - 4);
      // loop: NOT-WORTH — dev/test fake only; N = 5 rows per simulated mirror read
      const rows = [0, 1, 2, 3, 4].filter((i) => top + i < SETTINGS_ITEMS.length).map((i) => this.formatItem(top + i, board));
      const it = SETTINGS_ITEMS[this.sel];
      return { title: `Settings ${this.dirty ? "(*)" : "   "}`, rows, footer: this.status || ("hint" in it ? it.hint : "DP nav/adj  Tri=save") };
    }
    if (screen === SCREEN.slots) {
      if (this.slotsCursor < 0) this.slotsCursor = board.currentSlot();
      const active = board.currentSlot();
      // loop: NOT-WORTH — dev/test fake only; N = 4 slots per simulated mirror read
      const rows = board.slots().map((used, i) => `${i === this.slotsCursor ? ">" : " "}${i}${i === active ? "*" : " "}${used ? "(paired)" : " (empty)"}`);
      return { title: `Slots        [s${active} ON]`, rows, footer: this.slotsStatus || "Tri=use  Hold Sq=wipe" };
    }
    if (screen === SCREEN.diag) {
      // loop: NOT-WORTH — dev/test fake only; N = 5 rows per simulated mirror read
      const rows = [0, 1, 2, 3, 4].map((i) => `Row ${this.diagScroll + i + 1} (simulated)`);
      return { title: "Diagnostics", rows, footer: `${this.diagScroll > 0 ? "^ " : "  "}${this.diagScroll + DIAG_VISIBLE < DIAG_ROWS ? "v" : ""}` };
    }
    if (screen === SCREEN.lightbar) {
      const fav = this.lbSaved.at(-1);
      return { title: `Lightbar      ${LB_MODES[this.lbMode]}`, rows: ["", "", "", "Sv:T=0 C=1 X=2 S=3", fav === undefined ? "" : `Saved FAV${fav}`], footer: "R1=mode" };
    }
    if (screen === SCREEN.triggers) return { title: "Trigger Test", rows: [`Mode: ${TRIGGER_PRESETS[this.trigPreset]}`], footer: "Tri=cycle" };
    return null;
  }
}
