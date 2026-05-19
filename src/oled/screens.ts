// 10 screen render functions. Each takes (fb, state) and writes to a 128x64
// framebuffer. Layouts mirror src/oled.cpp's render_screen_X() in the
// firmware repo so the emulator looks like the physical OLED.

import {
  CONTENT_X,
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
// Mirrors src/oled.cpp render_screen() byte-for-byte. Left-half visuals
// are shifted right by CONTENT_X so the K1 chrome arrow ('<' at x=0,
// y=49) doesn't paint over the live stick dot.
export function renderStatus(fb: Uint8Array, s: EmulatorState): void {
  fbClear(fb);
  drawText(fb, CONTENT_X, 0, `DS5 Bridge ${s.firmwareVersionLabel}`);
  drawIcon(fb, 120, 0, s.isConnected || s.isDemoMode ? ICON_LINK_ON : ICON_LINK_OFF, 8, 8);

  if (!s.isConnected && !s.isDemoMode) {
    drawText(fb, CONTENT_X, 14, "Pair your DualSense:");
    drawText(fb, CONTENT_X, 26, "1. Hold Create + PS");
    drawText(fb, CONTENT_X, 36, "2. Wait for light bar");
    drawText(fb, CONTENT_X, 46, "   to flash blue");
    return;
  }

  drawText(fb, CONTENT_X, 9, s.bdAddr);

  // Battery: "%3d%%%c" pattern + battery icon shifted right of the chrome.
  const marker =
    s.input.batteryState === 0x1 ? "+" :
    s.input.batteryState === 0x2 ? "*" :
    s.input.batteryState >= 0xA ? "!" : " ";
  drawText(fb, CONTENT_X, 18, `${pad3(s.input.batteryPct)}%${marker}`);
  drawBatteryIcon(fb, 36, 18, s.input.batteryPct);

  // Left stick box shifted right by CONTENT_X.
  rectOutline(fb, CONTENT_X, 30, 32, 32);
  const lx = (CONTENT_X + 2) + Math.round((s.input.leftStick.x * 27) / 255);
  const ly = 32 + Math.round((s.input.leftStick.y * 27) / 255);
  rectFilled(fb, lx - 1, ly - 1, 3, 3);

  // Right stick box at (96, 30, 32, 32)
  rectOutline(fb, 96, 30, 32, 32);
  const rx = 98 + Math.round((s.input.rightStick.x * 27) / 255);
  const ry = 32 + Math.round((s.input.rightStick.y * 27) / 255);
  rectFilled(fb, rx - 1, ry - 1, 3, 3);

  // L2 vertical fill bar just right of the shifted left stick.
  rectOutline(fb, CONTENT_X + 32, 33, 4, 29);
  const l2_fill = Math.round((s.input.triggerLeft * 27) / 255);
  if (l2_fill > 0) rectFilled(fb, CONTENT_X + 33, 61 - l2_fill, 2, l2_fill);

  // R2 vertical fill bar at (92, 33, 4, 29) — fills from bottom up
  rectOutline(fb, 92, 33, 4, 29);
  const r2_fill = Math.round((s.input.triggerRight * 27) / 255);
  if (r2_fill > 0) rectFilled(fb, 93, 61 - r2_fill, 2, r2_fill);

  // D-pad indicator: 4 dots in + pattern. Center shifted right by 6 to
  // sit clear of the L2 column.
  const dp = s.input.dpad;
  const dp_n = dp === 7 || dp === 0 || dp === 1;
  const dp_e = dp === 1 || dp === 2 || dp === 3;
  const dp_s = dp === 3 || dp === 4 || dp === 5;
  const dp_w = dp === 5 || dp === 6 || dp === 7;
  const dcx = 52, dcy = 46;
  const dot = (dx: number, dy: number, on: boolean) => {
    if (on) rectFilled(fb, dcx + dx - 2, dcy + dy - 2, 5, 5);
    else    rectOutline(fb, dcx + dx - 2, dcy + dy - 2, 5, 5);
  };
  dot( 0, -7, dp_n);
  dot( 7,  0, dp_e);
  dot( 0,  7, dp_s);
  dot(-7,  0, dp_w);

  // Face buttons: 5x5 squares in diamond at (fcx=64+18, fcy=46)
  const fcx = 64 + 18;
  const fcy = 46;
  const sq = (dx: number, dy: number, on: boolean) => {
    if (on) rectFilled(fb, fcx + dx - 2, fcy + dy - 2, 5, 5);
    else    rectOutline(fb, fcx + dx - 2, fcy + dy - 2, 5, 5);
  };
  sq( 0, -8, s.input.triangle);
  sq( 8,  0, s.input.circle);
  sq( 0,  8, s.input.cross);
  sq(-8,  0, s.input.square);

  // L1 sized smaller to sit between the L2 column and the d-pad; R1 unchanged.
  if (s.input.l1) rectFilled(fb, 42, 30, 8, 3);  else rectOutline(fb, 42, 30, 8, 3);
  if (s.input.r1) rectFilled(fb, 80, 30, 12, 3); else rectOutline(fb, 80, 30, 12, 3);
}

// ===== 1: Slots =====
export function renderSlots(fb: Uint8Array, s: EmulatorState): void {
  fbClear(fb);
  const active = s.config.currentSlot;
  drawText(fb, CONTENT_X, 0, `Slots         [s${active} ${s.isConnected ? "ON" : "--"}]`);

  for (let i = 0; i < 4; i++) {
    const cur = i === active ? ">" : " ";
    const mark = i === active ? "*" : " ";
    let line: string;
    if (s.slots.occupied[i]) {
      line = `${cur}${i}${mark} ${formatBdAddr(s.slots.addrs[i])}`;
    } else {
      line = `${cur}${i}${mark} (empty)`;
    }
    drawText(fb, CONTENT_X, 9 + i * 9, line);
  }

  drawText(fb, CONTENT_X, 56, "Tri=switch Sq hold=wipe");
}

// ===== 2: Lightbar Color Picker =====
export function renderLightbar(fb: Uint8Array, s: EmulatorState): void {
  fbClear(fb);
  const modeLabel = LIGHTBAR_MODE_NAMES[s.lightbarMode];
  drawText(fb, CONTENT_X, 0, `Lightbar  [${modeLabel}]`);

  const [r, g, b] = s.lightbarRgb;
  drawText(fb, CONTENT_X, 9, `R:${pad3(r)} G:${pad3(g)} B:${pad3(b)}`);

  // Three RGB bars
  const bar = (y: number, label: string, value: number) => {
    drawText(fb, CONTENT_X, y, label);
    rectOutline(fb, CONTENT_X + 12, y, 94, 7);
    const fill = Math.round((value * 90) / 255);
    if (fill > 0) rectFilled(fb, CONTENT_X + 14, y + 2, fill, 3);
  };
  bar(20, "R", r);
  bar(30, "G", g);
  bar(40, "B", b);

  drawText(fb, CONTENT_X, 50, "Sv: T=0 C=1 X=2 S=3");
  drawText(fb, CONTENT_X, 56, "R1=mode");
}

// ===== 3: Trigger Test =====
export function renderTriggers(fb: Uint8Array, s: EmulatorState): void {
  fbClear(fb);
  drawText(fb, CONTENT_X, 0, "Trigger Test");
  drawText(fb, CONTENT_X, 9, `Mode: ${TRIGGER_PRESET_NAMES[s.triggerPreset]}`);
  drawText(fb, CONTENT_X, 18, `L2:${pad3(s.input.triggerLeft)}   R2:${pad3(s.input.triggerRight)}`);

  // Vertical-ish fill bars (shifted right of chrome strip)
  rectOutline(fb, CONTENT_X + 8, 30, 46, 8);
  const lf = Math.round((s.input.triggerLeft * 42) / 255);
  if (lf > 0) rectFilled(fb, CONTENT_X + 10, 32, lf, 4);
  rectOutline(fb, 74, 30, 46, 8);
  const rf = Math.round((s.input.triggerRight * 42) / 255);
  if (rf > 0) rectFilled(fb, 76, 32, rf, 4);

  drawText(fb, CONTENT_X + 5, 40, "(L2 pull)");
  drawText(fb, 72, 40, "(R2 pull)");

  drawText(fb, CONTENT_X, 56, "Tri=cycle");
}

// ===== 4: Gyro Tilt =====
export function renderGyro(fb: Uint8Array, s: EmulatorState): void {
  fbClear(fb);
  drawText(fb, CONTENT_X, 0, "Gyro Tilt");
  drawText(fb, CONTENT_X, 9, `X${pad5s(s.input.accelX)} Y${pad5s(s.input.accelY)} Z${pad5s(s.input.accelZ)}`);

  // 40x40 crosshair box (stays centered around x=44 — already clear of chrome).
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
  drawText(fb, CONTENT_X, 0, "Touchpad");
  rectOutline(fb, CONTENT_X + 2, 12, 116, 30);
  let active = 0;
  for (const f of s.input.fingers) {
    if (!f.touching) continue;
    active++;
    let sx = (CONTENT_X + 3) + Math.round((f.x * 110) / 1919);
    let sy = 13 + Math.round((f.y * 26) / 1079);
    if (sx < CONTENT_X + 3) sx = CONTENT_X + 3;
    if (sx > 122) sx = 122;
    if (sy < 13) sy = 13;
    if (sy > 39) sy = 39;
    rectFilled(fb, sx - 1, sy - 1, 3, 3);
  }
  drawText(fb, CONTENT_X, 47, `Fingers: ${active}`);
}

// ===== 6: Diagnostics =====
export function renderDiag(fb: Uint8Array, s: EmulatorState): void {
  fbClear(fb);
  drawText(fb, CONTENT_X, 0, "Diagnostics");
  const h = Math.floor(s.diag.uptimeSeconds / 3600);
  const m = Math.floor((s.diag.uptimeSeconds / 60) % 60);
  const sec = s.diag.uptimeSeconds % 60;
  drawText(fb, CONTENT_X, 9, `Up:${h}h ${pad2(m)}m ${pad2(sec)}s`);
  drawText(fb, CONTENT_X, 18, `USB aud ${s.diag.usbRate ?? 0}/s`);
  drawText(fb, CONTENT_X, 27, `BT 0x32 ${s.diag.btRate ?? 0}/s`);
  drawText(fb, CONTENT_X, 36, `HCI errs:  ${s.diag.hciErrors}`);
  drawText(fb, CONTENT_X, 45, `BT: ${s.isConnected || s.isDemoMode ? "connected" : "waiting"}`);
}

// ===== 7: CPU / Clock =====
// Mirrors src/oled.cpp render_screen_cpu(). Decimal formatting matches
// firmware per-field: freq tenths via truncation (firmware integer
// division (real_khz % 1000) / 100, web Math.floor); temp tenths via
// round-half-away-from-zero (firmware adds ±0.5f before casting to int,
// web does the same with Math.trunc).
export function renderCpu(fb: Uint8Array, s: EmulatorState): void {
  fbClear(fb);
  drawText(fb, CONTENT_X, 0, "CPU / Clock");

  const c = s.cpu;

  drawText(fb, CONTENT_X, 12, `Set : ${Math.floor(c.setFreqMhz)} MHz`);

  const rfWhole = Math.floor(c.realFreqMhz);
  const rfTenth = Math.floor((c.realFreqMhz - rfWhole) * 10);
  drawText(fb, CONTENT_X, 22, `Real: ${rfWhole}.${rfTenth} MHz`);

  const mv = Math.round(c.vcoreV * 1000);
  drawText(fb, CONTENT_X, 32, `Vcore: ${Math.floor(mv / 1000)}.${pad2(Math.floor((mv % 1000) / 10))} V`);

  const t10 = Math.trunc(c.tempC * 10 + (c.tempC >= 0 ? 0.5 : -0.5));
  const tWhole = Math.trunc(t10 / 10);
  const tFrac = Math.abs(t10) % 10;
  drawText(fb, CONTENT_X, 42, `Temp : ${tWhole}.${tFrac} C`);
}

// ===== 8: RSSI =====
export function renderRssi(fb: Uint8Array, s: EmulatorState): void {
  fbClear(fb);
  drawText(fb, CONTENT_X, 0, "BT Signal");
  drawText(fb, CONTENT_X, 12, `${s.rssi} dBm`);

  // Bar: -90 dBm = empty, 0 dBm = full
  const pct = Math.max(0, Math.min(100, ((s.rssi + 90) * 100) / 90));
  rectOutline(fb, CONTENT_X, 28, 122, 10);
  const fill = Math.round((pct * 118) / 100);
  if (fill > 0) rectFilled(fb, CONTENT_X + 2, 30, fill, 6);

  let label = "weak";
  if (s.rssi > -40) label = "excellent";
  else if (s.rssi > -55) label = "strong";
  else if (s.rssi > -70) label = "good";
  else if (s.rssi > -80) label = "fair";
  drawText(fb, CONTENT_X, 44, `Signal: ${label}`);
}

// ===== 9: VU Meters =====
export function renderVu(fb: Uint8Array, s: EmulatorState): void {
  fbClear(fb);
  drawText(fb, CONTENT_X, 0, "VU Meters");

  const meter = (y: number, label: string, value: number) => {
    drawText(fb, CONTENT_X, y, label);
    rectOutline(fb, 30, y, 96, 7);
    const fill = Math.round((value * 92) / 255);
    if (fill > 0) rectFilled(fb, 32, y + 2, fill, 3);
  };
  meter(14, "Spk", s.diag.peakSpeaker);
  meter(28, "Hap", s.diag.peakHaptic);
}

// ===== 10: Settings =====
// D-pad up/down on the connected DS5 moves the cursor; value-edits + save
// still happen via the dedicated Config tab on the website (not duplicated
// here). The cursor sits at x=CONTENT_X so each row's text starts at
// x=CONTENT_X+6 to leave space for the '>' glyph.
export function renderSettings(fb: Uint8Array, s: EmulatorState): void {
  fbClear(fb);
  drawText(fb, CONTENT_X, 0, "Settings");
  const c = s.config;
  const g = Math.round(c.hapticsGain * 10);
  const rows = [
    `Hap Gain ${Math.floor(g / 10)}.${g % 10}x`,
    `Spk Vol ${Math.round(c.speakerVolume)}dB`,
    `Inact ${c.inactiveTime}min`,
    `Poll ${["250Hz", "500Hz", "RT"][c.pollingRateMode % 3]}`,
    `AutoHap ${["Off", "Fallback", "Mix", "Replace"][c.autoHapticsEnable & 3]}`,
  ];
  rows.forEach((row, i) => {
    const y = 9 + i * 9;
    if (i === s.settingsSel) drawText(fb, CONTENT_X, y, ">");
    drawText(fb, CONTENT_X + 6, y, row);
  });
  drawText(fb, CONTENT_X, 56, "DP nav");
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
  renderCpu,       // 7
  renderRssi,      // 8
  renderVu,        // 9
  renderSettings,  // 10
];

// silence unused-import warning if FB_W stays unused at lint time
void FB_W;
