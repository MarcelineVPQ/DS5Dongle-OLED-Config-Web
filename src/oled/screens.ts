// 10 screen render functions. Each takes (fb, state) and writes to a 128x64
// framebuffer. Layouts mirror src/oled.cpp's render_screen_X() in the
// firmware repo so the emulator looks like the physical OLED.

import {
  FB_W,
  drawBatteryIcon,
  drawIcon,
  drawText,
  fbClear,
  px,
  rectFilled,
  rectOutline,
} from "./canvas";
import { ICON_LINK_OFF, ICON_LINK_ON } from "./icons";
import { EmulatorState, LIGHTBAR_MODE_NAMES, TRIGGER_PRESET_NAMES, formatBdAddr } from "./state";

// ===== 0: Status =====
export function renderStatus(fb: Uint8Array, s: EmulatorState): void {
  fbClear(fb);
  drawText(fb, 0, 0, "DS5 Bridge v0.5.4");
  drawIcon(fb, 120, 0, s.isConnected ? ICON_LINK_ON : ICON_LINK_OFF, 8, 8);

  if (!s.isConnected && !s.isDemoMode) {
    drawText(fb, 0, 18, "Waiting for DS5...");
    drawText(fb, 0, 27, "Hold Create + PS");
    drawText(fb, 0, 36, "until lightbar pulses");
    return;
  }

  drawText(fb, 0, 9, s.bdAddr);

  // Battery
  const marker =
    s.input.batteryState === 0x1 ? "+" :
    s.input.batteryState === 0x2 ? "*" :
    s.input.batteryState >= 0xA ? "!" : " ";
  drawText(fb, 0, 18, `${pad3(s.input.batteryPct)}%${marker}`);
  drawBatteryIcon(fb, 30, 18, s.input.batteryPct);

  // Sticks (32x32 boxes)
  rectOutline(fb, 0, 30, 32, 32);
  const lx = 2 + Math.round((s.input.leftStick.x * 27) / 255);
  const ly = 32 + Math.round((s.input.leftStick.y * 27) / 255);
  px(fb, lx, ly, true); px(fb, lx + 1, ly, true);
  px(fb, lx, ly + 1, true); px(fb, lx + 1, ly + 1, true);

  rectOutline(fb, 96, 30, 32, 32);
  const rx = 98 + Math.round((s.input.rightStick.x * 27) / 255);
  const ry = 32 + Math.round((s.input.rightStick.y * 27) / 255);
  px(fb, rx, ry, true); px(fb, rx + 1, ry, true);
  px(fb, rx, ry + 1, true); px(fb, rx + 1, ry + 1, true);

  // L1 / R1 / Triggers + face buttons in the middle
  if (s.input.l1) rectFilled(fb, 36, 30, 18, 7); else rectOutline(fb, 36, 30, 18, 7);
  drawText(fb, 39, 31, "L1");
  if (s.input.r1) rectFilled(fb, 74, 30, 18, 7); else rectOutline(fb, 74, 30, 18, 7);
  drawText(fb, 77, 31, "R1");

  // L2 / R2 trigger fill bars
  const l2 = Math.round((s.input.triggerLeft * 16) / 255);
  rectOutline(fb, 36, 40, 18, 5);
  if (l2 > 0) rectFilled(fb, 37, 41, l2, 3);
  const r2 = Math.round((s.input.triggerRight * 16) / 255);
  rectOutline(fb, 74, 40, 18, 5);
  if (r2 > 0) rectFilled(fb, 75, 41, r2, 3);

  // Face buttons (compact glyphs)
  const fy = 48;
  drawText(fb, 60, fy,     s.input.triangle ? "T" : "t");
  drawText(fb, 60, fy + 8, s.input.cross    ? "X" : "x");
  drawText(fb, 54, fy + 4, s.input.square   ? "S" : "s");
  drawText(fb, 66, fy + 4, s.input.circle   ? "O" : "o");
}

// ===== 1: Slots =====
export function renderSlots(fb: Uint8Array, s: EmulatorState): void {
  fbClear(fb);
  const active = s.config.currentSlot;
  drawText(fb, 0, 0, `Slots         [s${active} ${s.isConnected ? "ON" : "--"}]`);

  for (let i = 0; i < 4; i++) {
    const cur = i === active ? ">" : " ";
    const mark = i === active ? "*" : " ";
    let line: string;
    if (s.slots.occupied[i]) {
      line = `${cur}${i}${mark} ${formatBdAddr(s.slots.addrs[i])}`;
    } else {
      line = `${cur}${i}${mark} (empty)`;
    }
    drawText(fb, 0, 9 + i * 9, line);
  }

  drawText(fb, 0, 56, "Tri=switch Sq hold=wipe");
}

// ===== 2: Lightbar Color Picker =====
export function renderLightbar(fb: Uint8Array, s: EmulatorState): void {
  fbClear(fb);
  const modeLabel = LIGHTBAR_MODE_NAMES[s.lightbarMode];
  drawText(fb, 0, 0, `Lightbar  [${modeLabel}]`);

  const [r, g, b] = s.lightbarRgb;
  drawText(fb, 0, 9, `R:${pad3(r)} G:${pad3(g)} B:${pad3(b)}`);

  // Three RGB bars
  const bar = (y: number, label: string, value: number) => {
    drawText(fb, 0, y, label);
    rectOutline(fb, 12, y, 100, 7);
    const fill = Math.round((value * 96) / 255);
    if (fill > 0) rectFilled(fb, 14, y + 2, fill, 3);
  };
  bar(20, "R", r);
  bar(30, "G", g);
  bar(40, "B", b);

  drawText(fb, 0, 50, "Sv: T=0 C=1 X=2 S=3");
  drawText(fb, 0, 56, "K0=next K1=cycle");
}

// ===== 3: Trigger Test =====
export function renderTriggers(fb: Uint8Array, s: EmulatorState): void {
  fbClear(fb);
  drawText(fb, 0, 0, "Trigger Test");
  drawText(fb, 0, 9, `Mode: ${TRIGGER_PRESET_NAMES[s.triggerPreset]}`);
  drawText(fb, 0, 18, `L2:${pad3(s.input.triggerLeft)}   R2:${pad3(s.input.triggerRight)}`);

  // Vertical-ish fill bars
  rectOutline(fb, 8, 30, 50, 8);
  const lf = Math.round((s.input.triggerLeft * 46) / 255);
  if (lf > 0) rectFilled(fb, 10, 32, lf, 4);
  rectOutline(fb, 70, 30, 50, 8);
  const rf = Math.round((s.input.triggerRight * 46) / 255);
  if (rf > 0) rectFilled(fb, 72, 32, rf, 4);

  drawText(fb, 5, 40, "(L2 pull)");
  drawText(fb, 68, 40, "(R2 pull)");

  drawText(fb, 0, 56, "K0=next K1=cycle");
}

// ===== 4: Gyro Tilt =====
export function renderGyro(fb: Uint8Array, s: EmulatorState): void {
  fbClear(fb);
  drawText(fb, 0, 0, "Gyro Tilt");
  drawText(fb, 0, 9, `X${pad5s(s.input.accelX)} Y${pad5s(s.input.accelY)} Z${pad5s(s.input.accelZ)}`);

  // 40x40 crosshair box centered horizontally below
  const bx = 44, by = 18, bs = 40;
  rectOutline(fb, bx, by, bs, bs);
  // Cross at center
  for (let i = 1; i < bs - 1; i++) {
    px(fb, bx + i, by + bs / 2, true);
    px(fb, bx + bs / 2, by + i, true);
  }
  // Map accelX/accelY to a dot in the box (clamp ±2g ≈ ±8000 raw)
  const clamp = (v: number) => Math.max(-1, Math.min(1, v / 8000));
  const dx = bx + Math.round((bs / 2) + clamp(s.input.accelX) * ((bs - 4) / 2));
  const dy = by + Math.round((bs / 2) + clamp(s.input.accelY) * ((bs - 4) / 2));
  rectFilled(fb, dx, dy, 2, 2);
}

// ===== 5: Touchpad =====
export function renderTouchpad(fb: Uint8Array, s: EmulatorState): void {
  fbClear(fb);
  drawText(fb, 0, 0, "Touchpad");
  rectOutline(fb, 4, 12, 120, 30);
  let active = 0;
  for (const f of s.input.fingers) {
    if (!f.touching) continue;
    active++;
    let sx = 5 + Math.round((f.x * 114) / 1919);
    let sy = 13 + Math.round((f.y * 26) / 1079);
    if (sx < 5) sx = 5;
    if (sx > 122) sx = 122;
    if (sy < 13) sy = 13;
    if (sy > 39) sy = 39;
    rectFilled(fb, sx - 1, sy - 1, 3, 3);
  }
  drawText(fb, 0, 47, `Fingers: ${active}`);
  drawText(fb, 0, 56, "K0=next K1=back");
}

// ===== 6: Diagnostics =====
export function renderDiag(fb: Uint8Array, s: EmulatorState): void {
  fbClear(fb);
  drawText(fb, 0, 0, "Diagnostics");
  const h = Math.floor(s.diag.uptimeSeconds / 3600);
  const m = Math.floor((s.diag.uptimeSeconds / 60) % 60);
  const sec = s.diag.uptimeSeconds % 60;
  drawText(fb, 0, 9, `Up:${h}h ${pad2(m)}m ${pad2(sec)}s`);
  drawText(fb, 0, 18, `USB aud ${s.diag.usbRate ?? 0}/s`);
  drawText(fb, 0, 27, `BT 0x32 ${s.diag.btRate ?? 0}/s`);
  drawText(fb, 0, 36, `HCI errs:  ${s.diag.hciErrors}`);
  drawText(fb, 0, 45, `BT: ${s.isConnected || s.isDemoMode ? "connected" : "waiting"}`);
  drawText(fb, 0, 56, "K0=next K1=back");
}

// ===== 7: RSSI =====
export function renderRssi(fb: Uint8Array, s: EmulatorState): void {
  fbClear(fb);
  drawText(fb, 0, 0, "BT Signal");
  drawText(fb, 0, 12, `${s.rssi} dBm`);

  // Bar: -90 dBm = empty, 0 dBm = full
  const pct = Math.max(0, Math.min(100, ((s.rssi + 90) * 100) / 90));
  rectOutline(fb, 0, 28, 128, 10);
  const fill = Math.round((pct * 124) / 100);
  if (fill > 0) rectFilled(fb, 2, 30, fill, 6);

  let label = "weak";
  if (s.rssi > -40) label = "excellent";
  else if (s.rssi > -55) label = "strong";
  else if (s.rssi > -70) label = "good";
  else if (s.rssi > -80) label = "fair";
  drawText(fb, 0, 44, `Signal: ${label}`);

  drawText(fb, 0, 56, "K0=next K1=back");
}

// ===== 8: VU Meters =====
export function renderVu(fb: Uint8Array, s: EmulatorState): void {
  fbClear(fb);
  drawText(fb, 0, 0, "VU Meters");

  const meter = (y: number, label: string, value: number) => {
    drawText(fb, 0, y, label);
    rectOutline(fb, 30, y, 96, 7);
    const fill = Math.round((value * 92) / 255);
    if (fill > 0) rectFilled(fb, 32, y + 2, fill, 3);
  };
  meter(14, "Spk", s.diag.peakSpeaker);
  meter(28, "Hap", s.diag.peakHaptic);

  drawText(fb, 0, 56, "K0=next K1=back");
}

// ===== 9: Settings =====
export function renderSettings(fb: Uint8Array, s: EmulatorState): void {
  fbClear(fb);
  drawText(fb, 0, 0, "Settings");
  const c = s.config;
  const g = Math.round(c.hapticsGain * 10);
  drawText(fb, 0,  9,  `Hap Gain ${Math.floor(g / 10)}.${g % 10}x`);
  drawText(fb, 0,  18, `Spk Vol ${Math.round(c.speakerVolume)}dB`);
  drawText(fb, 0,  27, `Inact ${c.inactiveTime}min`);
  const pollNames = ["250Hz", "500Hz", "RT"];
  drawText(fb, 0,  36, `Poll ${pollNames[c.pollingRateMode % 3]}`);
  const autoNames = ["Off", "Fallback", "Mix", "Replace"];
  drawText(fb, 0,  45, `AutoHap ${autoNames[c.autoHapticsEnable & 3]}`);
  drawText(fb, 0,  56, "DP nav  Tri=save");
}

// Helpers
function pad2(n: number): string { return n.toString().padStart(2, "0"); }
function pad3(n: number): string { return n.toString().padStart(3, " "); }
function pad5s(n: number): string {
  const s = (n >= 0 ? "+" : "-") + Math.abs(n).toString();
  return s.padStart(5, " ");
}

// Index -> renderer
export type ScreenRenderer = (fb: Uint8Array, s: EmulatorState) => void;
export const SCREEN_RENDERERS: ScreenRenderer[] = [
  renderStatus,    // 0
  renderSlots,     // 1
  renderLightbar,  // 2
  renderTriggers,  // 3
  renderGyro,      // 4
  renderTouchpad,  // 5
  renderDiag,      // 6
  renderRssi,      // 7
  renderVu,        // 8
  renderSettings,  // 9
];

// silence unused-import warning if FB_W stays unused at lint time
void FB_W;
