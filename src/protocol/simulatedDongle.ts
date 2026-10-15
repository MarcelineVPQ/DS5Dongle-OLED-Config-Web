// In-memory stand-in for the dongle's pico command reports, following the
// firmware's rules in src/cmd.cpp: every 0xF6 SET bumps the sequence, deferred
// functions report PENDING until the main loop runs them, a second deferred
// function while any one is pending is BUSY, and reboot/BOOTSEL make the device
// vanish. One implementation for both uses: the integration tests (in place of
// real hardware) and dev builds' "Simulated dongle" (Developer card), e.g. in
// the Windows VM without passing the real dongle through. `live: true` adds
// what the app shows (moving input, diagnostics, a real-looking version).
import { IDENTITY_BYTES, OLED_PAD_BUTTONS, OLED_PAD_MAX_HOLD_MS, type OledPadButton } from "./bridgeClient";
import {
  CONFIG_BODY_SIZE,
  CONFIG_BODY_SIZE_SPLIT,
  CONFIG_BODY_SIZE_V13,
  CONFIG_BODY_SIZE_V16,
  CONFIG_BODY_SIZE_V17,
  DEFAULT_CONFIG,
  decodeConfigBody,
  encodeConfigBody,
  FEATURE_REPORT_PAYLOAD_SIZE,
  type ConfigBody,
} from "./config";
import { CURVE_BYTES, DEFAULT_CURVES, encodeCurve, strictCurve } from "./stickCurve";
import { DeviceGoneError, ReportStalledError, type Ds5Transport } from "./transport";
import { drawBattery, drawPad, kBattTextX, kBattY, kEtaX, packedCanvas } from "../oled/statusPad";
import { SCREEN_NAMES } from "../oled/screenNames";
import { type SimBoard, SimOledScreens } from "../oled/simScreens";
import { CTRL_FIRMWARE_BYTES, CTRL_HEADER_BYTES, CTRL_INFO_REPORT, CTRL_MAX_PAGES, CTRL_PAGE_BYTES, CTRL_PAGE_REPLY_BYTES, CTRL_SEL, CTRL_TEST, telemetryPages } from "./controllerInfo";

const DEFERRED = new Set([0x02, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0e]);
const RESULT = { ok: 0, pending: 1, invalid: 2, failed: 3, busy: 4 } as const;
// The firmware's OLED brightness levels (SH1107 contrast, oled.cpp kBrightLevels).
const OLED_BRIGHT_LEVELS = [0xff, 0x7f, 0x3f, 0x10] as const;
// Per stage (firmware perf.h order): average ns, worst case µs.
const SIM_TIMINGS: [number, number][] = [
  [48000, 1900], // main loop
  [12000, 900], // Bluetooth
  [6000, 420], // USB
  [9000, 380], // audio
  [4000, 230], // input & commands
  [15000, 1500], // OLED
  [2600000, 4300], // core1 speaker frame
  [900000, 1700], // core1 mic frame
];

export interface SimulatedDongleOptions {
  protoMajor?: number;
  protoMinor?: number; // default 6
  // How many identity reads a deferred command stays PENDING for.
  pendingPolls?: number;
  saveFails?: boolean;
  // For the app (not the tests): input that moves on its own, live diagnostics,
  // and this firmware version string.
  live?: boolean;
  // Live mode with the controller put down instead of moving: "still" = the
  // report never changes; "noise" = as a real DualSense resting on a desk
  // (the report counter and motion clock advance, the gyro and accelerometer
  // jitter by a few counts, sticks and triggers stay put). For measuring
  // what an idle Controller page costs.
  rest?: "still" | "noise";
  // 0xF5 core1 health: core1 couldn't create the speaker encoder (issue #15).
  speakerEncoderFailed?: boolean;
  // 0xF5 core1 health: core1 couldn't create the mic decoder.
  micDecoderFailed?: boolean;
  // 0xF5 core1 health: core1 stopped during start-up at this stage (0..8,
  // firmware audio.cpp g_c1_stage): its loop count stays 0, as in issue #15.
  core1StuckStage?: number;
  // 0xF5 as older firmware sent it: "none" = before 0.9.4 (60 bytes, no
  // health), "cut" = 0.9.4 to 0.9.5-dev.5 (68 bytes wanted, cut to 63: the
  // flags' low byte at [60], no layout bit). Default: the 63-byte layout.
  audioCountersLegacy?: "none" | "cut";
  version?: string;
  // BOOTSEL (0xF6 0x08) hands the board to its bootloader: the simulated
  // board (simulatedBoard.ts) then shows up as an RP2350 in BOOTSEL. Without
  // it the device just vanishes (the tests' fake).
  onBootsel?: () => void;
  // Protocol 1.12 controller info: the controller firmware's update version
  // (the counters need > 1106, Edge > 374; by default a little older than
  // Sony's latest, 6.20 / 2.15, so the card shows "newer available" in dev),
  // and whether it answers test commands.
  controllerUpdateVersion?: number;
  controllerAnswers?: boolean;
}

// A plausible, made-up controller (no real controller's data): report 0x20
// as the dongle passes it on (selector 0x01), counters block, battery voltage.
function simFirmware(updateVersion: number): Uint8Array {
  const out = new Uint8Array(CTRL_FIRMWARE_BYTES);
  const v = new DataView(out.buffer);
  out[0] = 1;
  out.set(
    // loop: NOT-WORTH — dev/test fake only; 11 chars per controller info read
    [..."Jun 13 2024"].map((c) => c.charCodeAt(0)),
    1,
  );
  out.set(
    // loop: NOT-WORTH — dev/test fake only; 8 chars per controller info read
    [..."10:22:31"].map((c) => c.charCodeAt(0)),
    12,
  );
  v.setUint16(20, 3, true); // fw type
  v.setUint16(22, 0x44, true); // sw series
  v.setUint32(24, 0x00000313, true); // hw info
  v.setUint32(28, 0x01000025, true); // main fw 1.0.37
  v.setUint16(44, updateVersion, true);
  v.setUint32(48, 0x01000003, true); // SBL 1.0.3
  v.setUint32(52, 0x00340006, true); // DSP 0034_0006
  v.setUint32(56, 0x01000007, true); // MCU DSP 1.0.7
  return out;
}

function simTelemetry(edge: boolean): Uint8Array {
  const block = new Uint8Array(telemetryPages(edge) * CTRL_PAGE_BYTES);
  const d = new DataView(block.buffer, 1); // [0] is the block's status byte; serials stay zero
  const u32 = (o: number, x: number) => d.setUint32(o, x, true);
  const u16 = (o: number, x: number) => d.setUint16(o, x, true);
  u32(21, 412345); // played, s
  u32(25, 160200); // charging
  u32(29, 52011); // haptics
  u32(33, 30120);
  u32(37, 41877); // triggers L / R
  u16(41, 212); // charge cycles
  u16(55, 240); // charger connects
  u16(60, 180); // full charges
  u16(62, 12);
  u16(64, 3);
  u16(66, 96); // USB connects
  u16(68, 1204); // Bluetooth connects
  u16(70, 7); // Bluetooth timeouts
  const buttons = edge ? [86, 90, 94, 98, 102, 106, 110, 114, 118, 134, 154, 158, 162, 166] : [110, 114, 118, 122, 126, 130, 134, 138, 142, 146, 150, 154, 158, 162, 170, 174, 178, 182, 186];
  // loop: NOT-WORTH — dev/test fake only; telemetry pages are read rarely
  buttons.forEach((o, i) => u32(o, 1000 + ((i * 7919) % 60000)));
  if (edge) {
    // loop: NOT-WORTH — dev/test fake only; telemetry pages are read rarely
    [122, 126, 130, 138, 142, 146].forEach((o, i) => u32(o, 4000 + i * 900));
    // loop: NOT-WORTH — dev/test fake only; telemetry pages are read rarely
    [170, 174, 178].forEach((o, i) => u16(o + 2, 300 + i * 40)); // mute, paddles
    u32(199, 88000);
    u32(205, 91000);
    u32(211, 2400);
    u32(236, 120000);
    u32(242, 99000);
    u32(248, 3100);
  } else {
    u32(86, 101000);
    u32(92, 98000);
    u32(98, 143000);
    u32(104, 120500);
  }
  return block;
}

export class SimulatedDongle implements Ds5Transport {
  readonly label = "Simulation";
  private readonly started = Date.now();
  isOpen = false;
  gone = false;
  config: Uint8Array = encodeConfigBody(DEFAULT_CONFIG);
  flashConfig: Uint8Array = this.config.slice();
  remap = Array.from({ length: 16 }, (_, i) => i);
  flashRemap = this.remap.slice();
  remapTemporary = false; // protocol 1.8
  extra = [0xff, 0xff, 0xff, 0xff]; // protocol 1.9: Edge Fn L/R, paddle L/R
  flashExtra = [0xff, 0xff, 0xff, 0xff];
  // Calibration bodies (18 bytes) per pairing slot: identity sticks, triggers 0..255, gyro 0.
  calibration = Array.from({ length: 4 }, () => new Uint8Array([0, 0, 0, 128, 0, 0, 0, 128, 0, 255, 0, 255, 0, 0, 0, 0, 0, 0]));
  // Stick curves (protocol 1.10): the saved pair per slot (9 bytes each, like
  // the firmware's flash), and a temporary pair for one slot.
  curves = Array.from({ length: 4 }, () => DEFAULT_CURVES.map((c) => encodeCurve(c)));
  tempCurves: { slot: number; pair: number[][] } | null = null;
  remapRevision = 0;
  slots = [true, false, false, false];
  currentSlot = 0;
  lastTrigger = -1;
  lastGripTest = -1; // 0 left, 1 right, 2 both
  gripTests = 0; // grip test (0x0E) commands run (not counting stops)
  lastGripTenths = -1; // its duration in tenths (5 = 0.5 s, all before protocol 1.15)
  gripStops = 0; // 0x0E [side, 0] stops (protocol 1.15)
  // The OLED as the firmware's handle_buttons() leaves it (protocol 1.18
  // presses KEY0 / KEY1): the screen the mirror reports (live: Status first,
  // as at boot; tests: screen 2) and the brightness level (kBrightLevels).
  oledScreen: number;
  oledBright = 0;
  oledKeyPresses: [key: number, long: boolean][] = [];
  // Protocol 1.19 (0xF6 0x19): the screens that react to controller buttons
  // (Settings, Slots, Lightbar, Trigger Test, Diagnostics), as the firmware's.
  readonly oledScreens = new SimOledScreens();
  // The narrator byte after the config body (protocol 1.3): 0xFF off, 1..7.
  narrator = 0xff;
  private get minor() {
    return this.opts.protoMinor ?? 6;
  }
  private get split() {
    return this.minor >= 6;
  }
  flashNarrator = 0xff;
  // The PC sleep options (protocol 1.14, identity [47]): controller off on
  // sleep (bit 0, default on), PS wakes the PC (bit 1, default off).
  powerFlags = 0x01;
  // The PC's mic level as the controller's VolumeMic (protocol 1.16, identity
  // [48]); 0x40 until a PC sets one, as on the firmware.
  pcMicLevel = 0x40;
  // Right grip haptics strength after the narrator (protocol 1.6), float LE.
  rightGain = new Uint8Array(new Float32Array([1]).buffer);
  // The bytes after the right grip, as the firmware's defaults: the seven of
  // protocol 1.13 (trigger reduction ... status pin mode), 1.16's mic level
  // and 1.17's echo cancellation (a body only as long as the simulated
  // protocol's is read or written).
  tail = encodeConfigBody(DEFAULT_CONFIG, true, true, true, true).slice(CONFIG_BODY_SIZE_SPLIT);
  flashTail = this.tail.slice();
  private get v13() {
    return this.minor >= 13;
  }
  private get v16() {
    return this.minor >= 16;
  }
  private get v17() {
    return this.minor >= 17;
  }
  // Config_body's size at this protocol (identity [6]).
  private get bodySize() {
    return this.v17 ? CONFIG_BODY_SIZE_V17 : this.v16 ? CONFIG_BODY_SIZE_V16 : this.v13 ? CONFIG_BODY_SIZE_V13 : this.split ? CONFIG_BODY_SIZE_SPLIT : CONFIG_BODY_SIZE + 1;
  }
  said: [number, number][] = [];
  playerLeds = 0x04; // player 1
  controllerConnected = true; // identity [18]; tests turn it off (board on USB, no controller)
  edge = false;
  colorwayCode = "02"; // Cosmic Red
  // Raw controller input report (0xF0); tests set bytes to simulate presses.
  input = (() => {
    const b = new Uint8Array(63);
    b.set([128, 128, 128, 128], 0);
    b[7] = 0x08; // d-pad released
    b[52] = 0x08; // 80 % battery
    return b;
  })();
  sets: Uint8Array[] = [];
  // Protocol 1.12: the test command the firmware is running for the app.
  ctrlTest = { state: 0, dev: 0, action: 0, pages: 0, request: 0, polls: 0, block: new Uint8Array(CTRL_MAX_PAGES * CTRL_PAGE_BYTES) };

  private seq = 0;
  private lastFunc = 0;
  private lastResult: number = RESULT.ok;
  private hostGen = 0;
  private pending: { func: number; arg: number; arg2?: number; polls: number } | null = null;
  private core1Loops = 1234;

  constructor(private readonly opts: SimulatedDongleOptions = {}) {
    this.oledScreen = opts.live ? 0 : 2;
  }

  // Live mode: the firmware's Status screen, packed like the firmware's
  // (128 x 64, row-major, 16 bytes a row, MSB = leftmost pixel): the text
  // drawn with the browser's canvas, the battery row and the controller glyph
  // with the firmware's own geometry (src/oled/statusPad.ts, from oled_pad.h)
  // and the moving input. Never real dongle data: no Bluetooth address.
  // Another screen (after a KEY press): its name, so the mirror visibly moves.
  private liveScreen(): Uint8Array | null {
    if (typeof OffscreenCanvas === "undefined") return null;
    const status = this.oledScreen === 0;
    const input = this.liveInput();
    const pct = Math.min(100, (input[52] & 0x0f) * 10);
    const state = input[52] >> 4;
    const mark = state === 1 ? "+" : state === 2 ? "*" : state >= 0xa ? "!" : " ";
    const screen = status ? null : this.oledScreens.lines(this.oledScreen, this.simBoard);
    // The text only changes with the screen, the battery and the version:
    // drawn once per change, not per mirror read (the mirror reads 10 a
    // second, and drawing text with the canvas and reading it back cost the
    // Pico 2 W page ~1 % of a core; the real board costs the app nothing).
    const key = JSON.stringify([this.oledScreen, screen, status && [pct, mark, state === 1, this.opts.version]]);
    let text = this.screenText?.key === key ? this.screenText.bits : null;
    if (!text) {
      text = this.drawScreenText(status, screen, pct, mark, state);
      if (!text) return null;
      this.screenText = { key, bits: text };
    }
    const out = text.slice();
    if (!status) return out;
    const fb = packedCanvas(out);
    drawBattery(fb, pct);
    drawPad(fb, input, this.edge);
    return out;
  }
  // cache: OK — key=the screen, its rows, the battery text and the version; invalidated=any of them changes; bound=1 entry (1 KB)
  private screenText: { key: string; bits: Uint8Array } | null = null;

  // The screen's text, packed (liveScreen's drawing without the moving parts).
  private drawScreenText(status: boolean, screen: ReturnType<SimulatedDongle["oledScreens"]["lines"]>, pct: number, mark: string, state: number): Uint8Array | null {
    const c = new OffscreenCanvas(128, 64);
    const g = c.getContext("2d");
    if (!g) return null;
    g.fillStyle = "#000"; // theme-exempt: OLED pixels off/on, not a UI color
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = "#fff"; // theme-exempt: OLED pixels off/on, not a UI color
    g.font = "8px monospace";
    g.textBaseline = "top";
    if (screen) {
      // A screen with controller input (1.19): its title, rows and footer at the firmware's places.
      g.fillText(screen.title, 6, 0);
      // loop: HOT-PATH-OK — dev/test fake only; N ≤ 5 rows per simulated mirror read
      screen.rows.forEach((row, i) => g.fillText(row, 6, 9 + i * 9));
      g.fillText(screen.footer, 6, 56);
    } else {
      g.fillText(status ? `DS5 B. ${(this.opts.version ?? "").replace("-oled-edition", "")}`.slice(0, 22) : (SCREEN_NAMES[this.oledScreen] ?? ""), 6, 1);
      g.fillText("(simulated)", 6, 10);
    }
    if (status) g.fillText(`${String(pct).padStart(3)}%${mark}`, kBattTextX, kBattY);
    if (status && state === 1) g.fillText("~--m", kEtaX, kBattY);
    const px = g.getImageData(0, 0, 128, 64).data;
    const out = new Uint8Array(1024);
    // loop: HOT-PATH-OK — dev/test fake only: 128x64 px per simulated OLED mirror read
    for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) if (px[(y * 128 + x) * 4] > 127) out[y * 16 + (x >> 3)] |= 0x80 >> (x & 7);
    return out;
  }

  // Live mode: sticks circle slowly, triggers breathe, battery steady, a
  // headset plugged in and the mic muted (so the drawing shows its marks).
  private liveInput(): Uint8Array {
    const t = (Date.now() - this.started) / 1000;
    const b = this.input.slice();
    b[53] |= 0x01 | 0x04;
    if (this.opts.rest === "still") return b;
    if (this.opts.rest === "noise") {
      const n = Math.floor(t * 250); // the controller's 250 Hz report clock
      b[6] = n & 0xff;
      new DataView(b.buffer).setUint32(27, Math.floor(t * 3e6) >>> 0, true);
      // loop: HOT-PATH-OK — dev/test fake only; N = 6 motion axes per read
      for (let axis = 0; axis < 6; axis++) new DataView(b.buffer).setInt16(15 + axis * 2, (axis === 4 ? 8000 : 0) + Math.round(Math.sin(n * (axis + 1.7)) * 2), true);
      return b;
    }
    const axis = (v: number) => Math.round(128 + 60 * v);
    b[0] = axis(Math.cos(t * 0.8));
    b[1] = axis(Math.sin(t * 0.8));
    b[2] = axis(Math.cos(t * 0.5 + 1));
    b[3] = axis(Math.sin(t * 0.5 + 1));
    b[4] = Math.round(127.5 + 127.5 * Math.sin(t * 0.6)); // L2
    b[5] = Math.round(127.5 + 127.5 * Math.sin(t * 0.6 + Math.PI)); // R2
    return b;
  }

  // Protocol 1.11 timings (0xFC [11..62]): plausible numbers at 150 MHz that
  // drift a little, with worst cases that build up after a reset (0xF6 0x15).
  timingsResetAt = Date.now();
  timerFallback = false;
  private timings(v: DataView): void {
    const t = (Date.now() - this.started) / 1000;
    const since = (Date.now() - this.timingsResetAt) / 1000;
    v.setUint8(11, 1 | (this.timerFallback ? 0x80 : 0));
    v.setUint8(12, SIM_TIMINGS.length);
    v.setUint16(13, Math.min(0xffff, Math.floor(since)), true);
    // loop: HOT-PATH-OK — dev/test fake only; N = 8 timing stages
    SIM_TIMINGS.forEach(([avgNs, maxUs], i) => {
      const wobble = 1 + 0.08 * Math.sin(t * 0.7 + i);
      const grown = Math.min(1, 0.25 + since / 40); // worst cases accumulate
      v.setUint32(15 + 6 * i, Math.round(avgNs * wobble), true);
      v.setUint16(19 + 6 * i, Math.min(0xffff, Math.round(maxUs * grown)), true);
    });
  }

  async open(): Promise<void> {
    if (this.gone) throw new DeviceGoneError();
    this.isOpen = true;
  }

  async close(): Promise<void> {
    this.isOpen = false;
  }

  async getReport(reportId: number, length: number): Promise<Uint8Array> {
    if (this.gone) throw new DeviceGoneError();
    if ((reportId & 0xff) === CTRL_INFO_REPORT && this.minor >= 12) return this.controllerInfo(reportId >> 8).subarray(0, length);
    switch (reportId) {
      case 0xf0:
        return (this.opts.live ? this.liveInput() : this.input).slice(0, length);
      case 0xee:
        return new Uint8Array([this.currentSlot, ...this.calibration[this.currentSlot]]).slice(0, length);
      case 0xef: {
        // OLED mirror: screen on, the KEY-chosen screen and brightness. Live: a Status-like screen
        // drawn here; tests: screen 2 and a stripe pattern.
        const out = new Uint8Array(4 + 1024);
        const live = this.opts.live ? this.liveScreen() : null;
        out.set([0, this.oledScreen, OLED_BRIGHT_LEVELS[this.oledBright], this.seq & 0xff]);
        if (live) out.set(live, 4);
        // loop: HOT-PATH-OK — dev/test fake only: 1024-byte test pattern
        else for (let i = 0; i < 1024; i++) out[4 + i] = i % 2 ? 0xaa : 0x55;
        return out.subarray(0, length);
      }
      case 0xf1:
        this.tick();
        // Reboot / BOOTSEL: the device is already off the bus, nothing answers.
        if (this.gone) throw new DeviceGoneError();
        return this.identity().subarray(0, length);
      case 0xf7: {
        // Like the firmware: the whole Config_body (38 bytes before 1.6, 42
        // from 1.6), then the remap block only when the request has room for
        // it. From 1.13 (49 bytes) a 63-byte GET keeps the 42-byte body + the
        // block at 42, and a shorter one gets the whole body (50 bytes from 1.16, 51 from 1.17).
        const body = this.split ? CONFIG_BODY_SIZE_SPLIT : CONFIG_BODY_SIZE + 1;
        const out = new Uint8Array(body + 21);
        out.set(this.config, 0);
        out[CONFIG_BODY_SIZE] = this.narrator;
        if (this.split) out.set(this.rightGain, CONFIG_BODY_SIZE + 1);
        if (this.v13 && length < out.length) {
          const whole = new Uint8Array(this.bodySize);
          whole.set(out.subarray(0, body), 0);
          whole.set(this.tail.subarray(0, this.bodySize - body), body);
          return whole.subarray(0, Math.min(length, whole.length));
        }
        out.set([0x52, 0x4d, 1, this.remapRevision & 0xff, this.remapRevision >> 8, ...this.remap], body);
        return out.subarray(0, length >= out.length ? out.length : Math.min(length, body));
      }
      case 0xf8:
        return new TextEncoder().encode(this.opts.version ?? "0.8.0-test");
      case 0xf9:
        return new Uint8Array([0xfb]); // -5
      case 0xfb: {
        if (!this.opts.live) throw new ReportStalledError(reportId);
        // Diagnostics: uptime, USB audio frames, Bluetooth packets, levels, no errors.
        const s = Math.floor((Date.now() - this.started) / 1000);
        const out = new Uint8Array(18);
        const v = new DataView(out.buffer);
        v.setUint32(0, s, true);
        v.setUint32(4, s * 1000, true);
        v.setUint32(8, s * 250, true);
        return out.subarray(0, length);
      }
      case 0xfc: {
        const timings = this.minor >= 11;
        if (!this.opts.live && !timings) throw new ReportStalledError(reportId);
        // 150 MHz at 1.10 V (vreg code 11, the stock setup since 0.9.5-dev.8), about 42 °C; protocol 1.11 adds
        // the timings when asked for 63 bytes (older firmware stops at 11).
        const out = new Uint8Array(timings && length >= FEATURE_REPORT_PAYLOAD_SIZE ? FEATURE_REPORT_PAYLOAD_SIZE : 11);
        const v = new DataView(out.buffer);
        v.setUint32(0, 150000, true);
        v.setUint32(4, 150000, true);
        out[8] = 11;
        v.setUint16(9, 844, true);
        if (out.length === FEATURE_REPORT_PAYLOAD_SIZE) this.timings(v);
        return out.subarray(0, length);
      }
      case 0xfa: {
        const out = new Uint8Array(28);
        // loop: HOT-PATH-OK — dev/test fake only; N = 4 slots
        this.slots.forEach((occupied, i) => {
          if (occupied) out.set([0x14, 0x3a, 0x9a, 0xff, 0xd9, i], i * 6);
          out[24 + i] = occupied ? 1 : 0;
        });
        return out;
      }
      case 0xec: {
        if (this.minor < 10) throw new ReportStalledError(reportId);
        const saved = this.curves[this.currentSlot];
        const tmp = this.tempCurves?.slot === this.currentSlot ? this.tempCurves.pair : null;
        return new Uint8Array([0x43, 0x56, 1, this.currentSlot, tmp ? 1 : 0, ...saved.flat(), ...(tmp ?? saved).flat()]).slice(0, length);
      }
      case 0xed: {
        if (this.minor < 9) throw new ReportStalledError(reportId);
        return new Uint8Array([0x52, 0x58, 1, this.remapRevision & 0xff, this.remapRevision >> 8, ...this.extra]);
      }
      case 0xf5: {
        // 15 u32 counters, then core1's health: [60] flags | stage << 3 | 0x80
        // (layout), [61..62] free heap at core1 start in KiB (firmware cmd.cpp).
        const legacy = this.opts.audioCountersLegacy;
        const out = new Uint8Array(legacy === "none" ? 60 : FEATURE_REPORT_PAYLOAD_SIZE);
        const v = new DataView(out.buffer);
        // Core1 keeps looping, so the dashboard's liveness check sees it move;
        // one stuck in start-up never loops.
        const stuck = this.opts.core1StuckStage;
        const stage = stuck === undefined ? 9 : stuck & 0x0f;
        if (stuck === undefined) {
          v.setUint32(5 * 4, this.core1Loops, true);
          this.core1Loops = (this.core1Loops + 97_000) >>> 0;
        }
        // Started (bit0) from stage 3, the free heap is read right after it.
        const flags = (stage >= 3 ? 0x01 : 0) | (this.opts.speakerEncoderFailed ? 0x02 : 0) | (this.opts.micDecoderFailed ? 0x04 : 0);
        if (legacy === "cut") out[60] = flags;
        else if (!legacy) {
          out[60] = flags | (stage << 3) | 0x80;
          if (stage >= 4) v.setUint16(61, this.opts.speakerEncoderFailed || this.opts.micDecoderFailed ? 12 : 184, true);
        }
        return out.slice(0, length);
      }
      default:
        throw new ReportStalledError(reportId);
    }
  }

  async setReport(reportId: number, payload: Uint8Array): Promise<void> {
    if (this.gone) throw new DeviceGoneError();
    if (reportId !== 0xf6) throw new ReportStalledError(reportId);
    this.sets.push(payload.slice());
    const func = payload[0];
    const arg = payload.length > 1 ? payload[1] : 0xff;
    this.seq = (this.seq + 1) & 0xffff;
    this.lastFunc = func;

    if (this.pending) {
      this.lastResult = RESULT.busy;
      return;
    }
    this.lastResult = RESULT.ok;
    if (func === 0x01) {
      this.config = payload.slice(1, 1 + CONFIG_BODY_SIZE);
      // 1.6: a longer body carries the right grip (the narrator byte is kept).
      if (this.split && payload.length >= 1 + CONFIG_BODY_SIZE_SPLIT) this.rightGain = payload.slice(1 + CONFIG_BODY_SIZE + 1, 1 + CONFIG_BODY_SIZE_SPLIT);
      // Older firmware copies whatever reaches byte 37 into the narrator.
      if (!this.split && payload.length > 1 + CONFIG_BODY_SIZE) this.narrator = payload[1 + CONFIG_BODY_SIZE];
      // 1.13: the seven bytes after the right grip, 1.16: and the mic level,
      // 1.17: and the echo cancellation; a
      // shorter body leaves the rest (the firmware copies what it was sent).
      if (this.v13 && payload.length >= 1 + CONFIG_BODY_SIZE_V13) {
        const end = Math.min(payload.length, 1 + this.bodySize);
        this.tail.set(payload.subarray(1 + CONFIG_BODY_SIZE_SPLIT, end));
      }
      this.hostGen++;
      this.oledScreens.hostChanged();
    } else if (func === 0x0d) {
      if (payload[1] !== 0x43 || payload[2] !== 0x4c || payload[3] !== 2 || payload[4] > 3 || payload.length < 23) this.lastResult = RESULT.invalid;
      else this.calibration[payload[4]] = payload.slice(5, 23);
    } else if (func === 0x10) {
      if (payload[1] !== 0x52 || payload[2] !== 0x4d || payload.length < 20) this.lastResult = RESULT.invalid;
      else {
        this.remap = [...payload.subarray(4, 20)];
        this.flashRemap = this.remap.slice();
        if (this.remapTemporary) this.extra = this.flashExtra.slice(); // as the firmware: a saved set ends a game's extras too
        this.remapTemporary = false;
        this.remapRevision++;
      }
    } else if (func === 0x11 && this.minor >= 8) {
      const table = [...payload.subarray(4, 20)];
      if (payload[1] !== 0x52 || payload[2] !== 0x4d || payload[3] !== 1 || payload.length < 20 || table.some((v) => v > 15 && v !== 0xff)) this.lastResult = RESULT.invalid;
      else {
        this.remap = table;
        this.remapTemporary = true;
        this.remapRevision++;
      }
    } else if (func === 0x13 && this.minor >= 9) {
      const e = [...payload.subarray(4, 8)];
      if (payload[1] !== 0x52 || payload[2] !== 0x58 || payload[3] !== 1 || payload.length < 9 || payload[8] > 1 || e.some((v) => v > 15 && v !== 0xfe && v !== 0xff)) this.lastResult = RESULT.invalid;
      else {
        this.extra = e;
        if (payload[8] === 1) this.remapTemporary = true;
        else this.flashExtra = e.slice();
        this.remapRevision++;
      }
    } else if (func === 0x14 && this.minor >= 10) {
      const pair = [0, 1].map((i) => [...payload.subarray(5 + i * CURVE_BYTES, 5 + (i + 1) * CURVE_BYTES)]);
      const temporary = payload[5 + 2 * CURVE_BYTES];
      // As the firmware: framing, slot, temporary flag, and each curve valid (type 0..5, custom points non-decreasing).
      const ok =
        payload.length >= 6 + 2 * CURVE_BYTES && payload[1] === 0x43 && payload[2] === 0x56 && payload[3] === 1 && payload[4] <= 3 && temporary <= 1 && pair.every((b) => strictCurve(b) !== null);
      if (!ok) this.lastResult = RESULT.invalid;
      else if (temporary === 1) this.tempCurves = { slot: payload[4], pair };
      else {
        this.tempCurves = null;
        this.curves[payload[4]] = pair;
      }
    } else if (func === 0x15 && this.minor >= 11) {
      this.timingsResetAt = Date.now(); // answered at once, like the firmware
    } else if (func === 0x16 && this.minor >= 12) {
      const [dev, action, pages] = [payload[1], payload[2], payload[3]];
      const ok =
        payload.length >= 4 &&
        ((dev === CTRL_TEST.telemetry.dev && action === CTRL_TEST.telemetry.action && pages >= 1 && pages <= CTRL_MAX_PAGES) ||
          (dev === CTRL_TEST.battery.dev && action === CTRL_TEST.battery.action && pages === 1));
      if (!ok) this.lastResult = RESULT.invalid;
      else if (this.ctrlTest.state === 1) this.lastResult = RESULT.busy;
      else this.ctrlTest = { state: 1, dev, action, pages, request: (this.ctrlTest.request + 1) & 0xff, polls: this.opts.pendingPolls ?? 1, block: new Uint8Array(CTRL_MAX_PAGES * CTRL_PAGE_BYTES) };
    } else if (func === 0x12 && this.minor >= 8) {
      this.tempCurves = null; // 1.10: a game's stick curves end too
      this.extra = this.flashExtra.slice();
      this.remap = this.flashRemap.slice();
      this.remapTemporary = false;
      this.remapRevision++;
    } else if ((func === 0x04 || func === 0x05) && arg > 3) {
      this.lastResult = RESULT.invalid;
    } else if (func === 0x0e) {
      // [side, tenths] (1.15; no duration byte = 0.5 s, 0 = stop, max 5 s).
      if (arg > 2) this.lastResult = RESULT.invalid;
      else {
        const arg2 = this.minor >= 15 && payload.length >= 3 ? Math.min(payload[2], 50) : 5;
        this.pending = { func, arg, arg2, polls: this.opts.pendingPolls ?? 1 };
        this.lastResult = RESULT.pending;
      }
    } else if (func === 0x19 && this.minor >= 19) {
      // 1.19 controller button for the OLED screens: [button, hold ms lo, hi] (deferred).
      const hold = (payload[2] ?? 0) | ((payload[3] ?? 0) << 8);
      if (payload.length < 2 || arg >= Object.keys(OLED_PAD_BUTTONS).length || hold > OLED_PAD_MAX_HOLD_MS) this.lastResult = RESULT.invalid;
      else {
        this.pending = { func, arg, arg2: hold, polls: this.opts.pendingPolls ?? 1 };
        this.lastResult = RESULT.pending;
      }
    } else if (func === 0x18 && this.minor >= 18) {
      // 1.18 remote KEY0 / KEY1 press: [key 0/1, press 0 short / 1 long] (deferred).
      if (payload.length < 3 || arg > 1 || payload[2] > 1) this.lastResult = RESULT.invalid;
      else {
        this.pending = { func, arg: arg | (payload[2] << 1), polls: this.opts.pendingPolls ?? 1 };
        this.lastResult = RESULT.pending;
      }
    } else if (func === 0x0a && arg > 6) {
      this.lastResult = RESULT.invalid;
    } else if (func === 0x17) {
      // 1.14 PC sleep options: two bits, saved on their own (deferred).
      if (this.minor < 14 || payload.length < 2 || (arg & ~0x03) !== 0) this.lastResult = RESULT.invalid;
      else {
        this.pending = { func, arg, polls: this.opts.pendingPolls ?? 1 };
        this.lastResult = RESULT.pending;
      }
    } else if (func === 0x0b && arg !== 0xff && (arg < 1 || arg > 7)) {
      this.lastResult = RESULT.invalid;
    } else if (func === 0x0c) {
      if (payload.length < 3 || arg > 5 || payload[2] > 6) this.lastResult = RESULT.invalid;
      else this.said.push([arg, payload[2]]);
    } else if (DEFERRED.has(func)) {
      this.pending = { func, arg, polls: this.opts.pendingPolls ?? 1 };
      this.lastResult = RESULT.pending;
    } else if (func !== 0x03) {
      this.lastResult = RESULT.invalid;
    }
  }

  // GET 0xEB: the header (which also advances a running test, like the
  // firmware's main loop), the controller's firmware, or a result page.
  private controllerInfo(selector: number): Uint8Array {
    const t = this.ctrlTest;
    if (selector === CTRL_SEL.header) {
      if (t.state === 1 && t.polls-- <= 0) {
        if (this.opts.controllerAnswers === false) t.state = 3;
        else {
          t.state = 2;
          if (t.dev === CTRL_TEST.battery.dev) {
            t.block[0] = 3868 & 0xff;
            t.block[1] = 3868 >> 8;
            t.pages = 1;
          } else {
            const b = simTelemetry(this.edge);
            t.block.set(b);
            t.pages = Math.min(t.pages, b.length / CTRL_PAGE_BYTES);
          }
        }
      }
      const out = new Uint8Array(CTRL_HEADER_BYTES);
      out.set([0x43, 0x48, 1, t.state, t.dev, t.action, t.state === 2 ? t.pages : 0, t.request, this.edge ? 1 : 0, 0x03]);
      new DataView(out.buffer).setUint32(10, 0x00000a1b, true); // BT patch
      return out;
    }
    if (selector === CTRL_SEL.firmware) return simFirmware(this.opts.controllerUpdateVersion ?? (this.edge ? 0x0215 : 0x0620));
    const p = selector - CTRL_SEL.page0;
    if (p < 0 || p >= CTRL_MAX_PAGES) return new Uint8Array(0);
    const out = new Uint8Array(CTRL_PAGE_REPLY_BYTES);
    out.set([p, t.state, t.request]);
    if (t.state === 2 && p < t.pages) out.set(t.block.subarray(p * CTRL_PAGE_BYTES, (p + 1) * CTRL_PAGE_BYTES), 3);
    return out;
  }

  // The firmware's cmd_task(): runs the pending command after a few polls.
  private tick(): void {
    if (!this.pending) return;
    if (this.pending.polls-- > 0) return;
    const { func, arg, arg2 } = this.pending;
    this.pending = null;
    this.lastFunc = func; // reported under its own id
    this.lastResult = RESULT.ok;
    if (func === 0x02) {
      if (this.opts.saveFails) this.lastResult = RESULT.failed;
      else {
        this.flashConfig = this.config.slice();
        this.flashTail = this.tail.slice();
      }
    } else if (func === 0x04) {
      this.currentSlot = arg;
      this.flashConfig = this.config.slice(); // bt_set_slot() saves the config
      this.flashTail = this.tail.slice();
      this.hostGen++;
    } else if (func === 0x05) this.slots[arg] = false;
    else if (func === 0x06) this.slots = [false, false, false, false];
    // Reboot / BOOTSEL leave the bus; the app's simulation just restarts on reboot.
    else if (func === 0x07 && this.opts.live) this.hostGen++;
    else if (func === 0x07) this.gone = true;
    else if (func === 0x08) {
      this.gone = true;
      this.opts.onBootsel?.();
    } else if (func === 0x09) {
      this.config = encodeConfigBody(DEFAULT_CONFIG);
      this.flashConfig = this.config.slice();
      this.tail = encodeConfigBody(DEFAULT_CONFIG, true, true, true, true).slice(CONFIG_BODY_SIZE_SPLIT);
      this.flashTail = this.tail.slice();
      this.powerFlags = 0x01;
      this.hostGen++;
    } else if (func === 0x0a) this.lastTrigger = arg;
    else if (func === 0x0e) {
      if (arg2 === 0) this.gripStops++;
      else {
        this.lastGripTest = arg;
        this.lastGripTenths = arg2 ?? 5;
        this.gripTests++;
      }
    } else if (func === 0x0b) {
      this.narrator = arg;
      this.flashNarrator = arg; // saved on its own, nothing else
    } else if (func === 0x17) {
      if (this.opts.saveFails) this.lastResult = RESULT.failed;
      else this.powerFlags = arg; // saved on its own, nothing else
    } else if (func === 0x18) this.pressKey(arg & 1, (arg & 2) !== 0);
    else if (func === 0x19) {
      // loop: NOT-WORTH — dev/test fake only; N = 9 button names, one press
      const button = (Object.keys(OLED_PAD_BUTTONS) as OledPadButton[]).find((b) => OLED_PAD_BUTTONS[b] === arg)!;
      this.oledScreens.press(this.oledScreen, button, arg2 ?? 0, this.simBoard);
    }
  }

  // The whole config body in RAM (config + narrator + right grip + tail).
  private body(): ConfigBody {
    const whole = new Uint8Array(CONFIG_BODY_SIZE_V17);
    whole.set(this.config, 0);
    whole[CONFIG_BODY_SIZE] = this.narrator;
    whole.set(this.rightGain, CONFIG_BODY_SIZE + 1);
    whole.set(this.tail, CONFIG_BODY_SIZE_SPLIT);
    return decodeConfigBody(whole);
  }

  // What the OLED screens act on (simScreens.ts), like the firmware's
  // set_config + config_save, bt_set_slot, bt_forget_slot, bt_wipe_all_slots.
  private readonly simBoard: SimBoard = {
    body: () => this.body(),
    powerFlags: () => this.powerFlags,
    save: (body, power) => {
      if (this.opts.saveFails) return false;
      const e = encodeConfigBody(body, true, true, true, true);
      this.config = e.slice(0, CONFIG_BODY_SIZE);
      this.rightGain = e.slice(CONFIG_BODY_SIZE + 1, CONFIG_BODY_SIZE_SPLIT);
      this.tail = e.slice(CONFIG_BODY_SIZE_SPLIT);
      this.powerFlags = power;
      this.flashConfig = this.config.slice();
      this.flashTail = this.tail.slice();
      return true;
    },
    slots: () => this.slots,
    currentSlot: () => this.currentSlot,
    setSlot: (slot) => {
      this.currentSlot = slot;
      return true;
    },
    forgetSlot: (slot) => {
      this.slots[slot] = false;
      return true;
    },
    wipeSlots: () => {
      this.slots = [false, false, false, false];
      return true;
    },
    previewTrigger: (preset) => {
      this.lastTrigger = preset;
    },
  };

  // What the firmware's handle_buttons() does with one press (oled_keys.h):
  // KEY0 (short or long) = next screen; KEY1 short = previous, long = next
  // brightness level. The firmware plays the press over ~0.06 s / ~1.6 s;
  // here it lands at once. Screens wrap like kNumScreens.
  private pressKey(key: number, long: boolean): void {
    this.oledKeyPresses.push([key, long]);
    const n = SCREEN_NAMES.length;
    if (key === 0) this.oledScreen = (this.oledScreen + 1) % n;
    else if (!long) this.oledScreen = (this.oledScreen - 1 + n) % n;
    else this.oledBright = (this.oledBright + 1) % OLED_BRIGHT_LEVELS.length;
  }

  private identity(): Uint8Array {
    const minor = this.minor;
    const out = new Uint8Array(minor >= 16 ? IDENTITY_BYTES : minor >= 14 ? 48 : minor >= 12 ? 47 : minor >= 7 ? 46 : 30);
    out.set([0x44, 0x53, 0x35, 0x4f, this.opts.protoMajor ?? 1, minor, this.bodySize, 0xff]);
    const view = new DataView(out.buffer);
    view.setUint16(8, this.seq, true);
    out[10] = this.lastFunc;
    out[11] = this.lastResult;
    view.setUint32(12, this.hostGen, true);
    out[16] = 4;
    out[17] = this.currentSlot;
    out[18] = this.controllerConnected ? 1 : 0;
    // loop: HOT-PATH-OK — dev/test fake only; N ≤ 50 config bytes, early exit
    out[19] = (this.config.some((b, i) => b !== this.flashConfig[i]) || this.tail.some((b, i) => b !== this.flashTail[i]) ? 0x01 : 0) | (this.remapTemporary ? 0x02 : 0) | (this.tempCurves ? 0x04 : 0); // unsaved settings, temporary remap (1.8), temporary curves (1.10)
    out[24] = 8; // 80 % battery
    out[25] = this.playerLeds;
    out[26] = this.edge ? 1 : 0;
    out.set(
      // loop: HOT-PATH-OK — dev/test fake only; N = 2 colorway chars
      [...this.colorwayCode].map((c) => c.charCodeAt(0)),
      27,
    );
    out[29] = this.split ? 0x01 | 0x02 | 0x04 : 0x01 | 0x02; // FEATURES2: OLED mirror, calibration, grip test (1.6)
    if (minor >= 7) {
      out[29] |= 0x08; // board name (1.7)
      if (minor >= 8) out[29] |= 0x10; // temporary remap (1.8)
      if (minor >= 9) out[29] |= 0x20; // Edge extra-button remap (1.9)
      if (minor >= 10) out[29] |= 0x40; // stick response curves (1.10)
      if (minor >= 11) out[29] |= 0x80; // per-stage timings in 0xFC, reset 0x15 (1.11)
      out.set(
        // loop: HOT-PATH-OK — dev/test fake only; N = 8 board-name chars
        [..."Pico 2 W"].map((c) => c.charCodeAt(0)),
        30,
      );
    }
    if (minor >= 12) out[46] = 0x01; // FEATURES3: controller info (1.12)
    if (minor >= 13) out[46] |= 0x02; // FEATURES3: the 1.13 config fields
    if (minor >= 14) {
      out[46] |= 0x04; // FEATURES3: PC sleep options (1.14)
      out[47] = this.powerFlags;
    }
    if (minor >= 15) out[46] |= 0x08; // FEATURES3: timed grip test (1.15)
    if (minor >= 16) {
      out[46] |= 0x10; // FEATURES3: the mic level (1.16)
      out[48] = this.pcMicLevel;
    }
    if (minor >= 17) out[46] |= 0x20; // FEATURES3: the mic echo cancellation (1.17)
    if (minor >= 18) out[46] |= 0x40; // FEATURES3: remote KEY0 / KEY1 presses (1.18)
    if (minor >= 19) out[46] |= 0x80; // FEATURES3: controller buttons for the OLED screens (1.19)
    return out;
  }

  // Lets a test simulate another program sending a command in between.
  bumpSequenceExternally(): void {
    this.seq = (this.seq + 1) & 0xffff;
  }
}
