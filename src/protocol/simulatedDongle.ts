// In-memory stand-in for the dongle's pico command reports, following the
// firmware's rules in src/cmd.cpp: every 0xF6 SET bumps the sequence, deferred
// functions report PENDING until the main loop runs them, a second deferred
// function while any one is pending is BUSY, and reboot/BOOTSEL make the device
// vanish. One implementation for both uses: the integration tests (in place of
// real hardware) and dev builds' "Simulated dongle" (Developer card), e.g. in
// the Windows VM without passing the real dongle through. `live: true` adds
// what the app shows (moving input, diagnostics, a real-looking version).
import { CONFIG_BODY_SIZE, CONFIG_BODY_SIZE_SPLIT, DEFAULT_CONFIG, encodeConfigBody } from "./config";
import { DeviceGoneError, ReportStalledError, type Ds5Transport } from "./transport";

const DEFERRED = new Set([0x02, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0e]);
const RESULT = { ok: 0, pending: 1, invalid: 2, failed: 3, busy: 4 } as const;

export interface SimulatedDongleOptions {
  protoMajor?: number;
  protoMinor?: number; // default 6
  // How many identity reads a deferred command stays PENDING for.
  pendingPolls?: number;
  saveFails?: boolean;
  // For the app (not the tests): input that moves on its own, live diagnostics,
  // and this firmware version string.
  live?: boolean;
  version?: string;
}

export class SimulatedDongle implements Ds5Transport {
  readonly label = "Simulated dongle";
  private readonly started = Date.now();
  isOpen = false;
  gone = false;
  config: Uint8Array = encodeConfigBody(DEFAULT_CONFIG);
  flashConfig: Uint8Array = this.config.slice();
  remap = Array.from({ length: 16 }, (_, i) => i);
  // Calibration bodies (18 bytes) per pairing slot: identity sticks, triggers 0..255, gyro 0.
  calibration = Array.from({ length: 4 }, () => new Uint8Array([0, 0, 0, 128, 0, 0, 0, 128, 0, 255, 0, 255, 0, 0, 0, 0, 0, 0]));
  remapRevision = 0;
  slots = [true, false, false, false];
  currentSlot = 0;
  lastTrigger = -1;
  lastGripTest = -1; // 0 left, 1 right, 2 both
  // The narrator byte after the config body (protocol 1.3): 0xFF off, 1..7.
  narrator = 0xff;
  private get split() {
    return (this.opts.protoMinor ?? 6) >= 6;
  }
  flashNarrator = 0xff;
  // Right grip haptics strength after the narrator (protocol 1.6), float LE.
  rightGain = new Uint8Array(new Float32Array([1]).buffer);
  said: [number, number][] = [];
  playerLeds = 0x04; // player 1
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

  private seq = 0;
  private lastFunc = 0;
  private lastResult: number = RESULT.ok;
  private hostGen = 0;
  private pending: { func: number; arg: number; polls: number } | null = null;

  constructor(private readonly opts: SimulatedDongleOptions = {}) {}

  // Live mode: a Status-like OLED screen, drawn with the browser's canvas and
  // packed like the firmware's (128 x 64, row-major, 16 bytes a row, MSB =
  // leftmost pixel). Never real dongle data: no Bluetooth address.
  private liveScreen(): Uint8Array | null {
    if (typeof OffscreenCanvas === "undefined") return null;
    const c = new OffscreenCanvas(128, 64);
    const g = c.getContext("2d");
    if (!g) return null;
    g.fillStyle = "#000"; // theme-exempt: OLED pixels off/on, not a UI color
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = "#fff"; // theme-exempt: OLED pixels off/on, not a UI color
    g.font = "bold 9px monospace";
    g.textBaseline = "top";
    g.fillText("DS5 Bridge (simulated)", 0, 0);
    g.font = "8px monospace";
    g.fillText((this.opts.version ?? "").slice(0, 25), 0, 11);
    g.fillRect(0, 24, 60, 10);
    g.clearRect(1, 25, 58, 8);
    g.fillRect(2, 26, 44, 6); // 80 %
    g.fillRect(60, 27, 2, 4);
    g.font = "bold 10px monospace";
    g.fillText("80%", 70, 24);
    g.font = "8px monospace";
    g.fillText(`${this.edge ? "DualSense Edge" : "DualSense"} · slot ${this.currentSlot}`, 0, 40);
    g.fillText(`frame ${this.seq & 0xffff}`, 0, 52);
    const px = g.getImageData(0, 0, 128, 64).data;
    const out = new Uint8Array(1024);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) if (px[(y * 128 + x) * 4] > 127) out[y * 16 + (x >> 3)] |= 0x80 >> (x & 7);
    return out;
  }

  // Live mode: sticks circle slowly, triggers breathe, battery steady.
  private liveInput(): Uint8Array {
    const t = (Date.now() - this.started) / 1000;
    const b = this.input.slice();
    const axis = (v: number) => Math.round(128 + 60 * v);
    b[0] = axis(Math.cos(t * 0.8));
    b[1] = axis(Math.sin(t * 0.8));
    b[2] = axis(Math.cos(t * 0.5 + 1));
    b[3] = axis(Math.sin(t * 0.5 + 1));
    b[4] = Math.round(127.5 + 127.5 * Math.sin(t * 0.6)); // L2
    b[5] = Math.round(127.5 + 127.5 * Math.sin(t * 0.6 + Math.PI)); // R2
    return b;
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
    switch (reportId) {
      case 0xf0:
        return (this.opts.live ? this.liveInput() : this.input).slice(0, length);
      case 0xee:
        return new Uint8Array([this.currentSlot, ...this.calibration[this.currentSlot]]).slice(0, length);
      case 0xef: {
        // OLED mirror: screen on, full contrast. Live: a Status-like screen
        // drawn here; tests: screen 2 and a stripe pattern.
        const out = new Uint8Array(4 + 1024);
        const live = this.opts.live ? this.liveScreen() : null;
        out.set([0, live ? 0 : 2, 0xff, this.seq & 0xff]);
        if (live) out.set(live, 4);
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
        // from 1.6), then the remap block only when the request has room for it.
        const body = this.split ? CONFIG_BODY_SIZE_SPLIT : CONFIG_BODY_SIZE + 1;
        const out = new Uint8Array(body + 21);
        out.set(this.config, 0);
        out[CONFIG_BODY_SIZE] = this.narrator;
        if (this.split) out.set(this.rightGain, CONFIG_BODY_SIZE + 1);
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
        if (!this.opts.live) throw new ReportStalledError(reportId);
        // 320 MHz at 1.20 V (vreg code 13), about 42 °C.
        const out = new Uint8Array(11);
        const v = new DataView(out.buffer);
        v.setUint32(0, 320000, true);
        v.setUint32(4, 320000, true);
        out[8] = 13;
        v.setUint16(9, 844, true);
        return out.subarray(0, length);
      }
      case 0xfa: {
        const out = new Uint8Array(28);
        this.slots.forEach((occupied, i) => {
          if (occupied) out.set([0x14, 0x3a, 0x9a, 0xff, 0xd9, i], i * 6);
          out[24 + i] = occupied ? 1 : 0;
        });
        return out;
      }
      case 0xf5: {
        const out = new Uint8Array(60);
        new DataView(out.buffer).setUint32(5 * 4, 1234, true); // core1 loops
        return out;
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
      this.hostGen++;
    } else if (func === 0x0d) {
      if (payload[1] !== 0x43 || payload[2] !== 0x4c || payload[3] !== 2 || payload[4] > 3 || payload.length < 23) this.lastResult = RESULT.invalid;
      else this.calibration[payload[4]] = payload.slice(5, 23);
    } else if (func === 0x10) {
      if (payload[1] !== 0x52 || payload[2] !== 0x4d || payload.length < 20) this.lastResult = RESULT.invalid;
      else {
        this.remap = [...payload.subarray(4, 20)];
        this.remapRevision++;
      }
    } else if ((func === 0x04 || func === 0x05) && arg > 3) {
      this.lastResult = RESULT.invalid;
    } else if (func === 0x0e && arg > 2) {
      this.lastResult = RESULT.invalid;
    } else if (func === 0x0a && arg > 6) {
      this.lastResult = RESULT.invalid;
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

  // The firmware's cmd_task(): runs the pending command after a few polls.
  private tick(): void {
    if (!this.pending) return;
    if (this.pending.polls-- > 0) return;
    const { func, arg } = this.pending;
    this.pending = null;
    this.lastFunc = func; // reported under its own id
    this.lastResult = RESULT.ok;
    if (func === 0x02) {
      if (this.opts.saveFails) this.lastResult = RESULT.failed;
      else this.flashConfig = this.config.slice();
    } else if (func === 0x04) {
      this.currentSlot = arg;
      this.flashConfig = this.config.slice(); // bt_set_slot() saves the config
      this.hostGen++;
    } else if (func === 0x05) this.slots[arg] = false;
    else if (func === 0x06) this.slots = [false, false, false, false];
    // Reboot / BOOTSEL leave the bus; the app's simulation just restarts on reboot.
    else if (func === 0x07 && this.opts.live) this.hostGen++;
    else if (func === 0x07 || func === 0x08) this.gone = true;
    else if (func === 0x09) {
      this.config = encodeConfigBody(DEFAULT_CONFIG);
      this.flashConfig = this.config.slice();
      this.hostGen++;
    } else if (func === 0x0a) this.lastTrigger = arg;
    else if (func === 0x0e) this.lastGripTest = arg;
    else if (func === 0x0b) {
      this.narrator = arg;
      this.flashNarrator = arg; // saved on its own, nothing else
    }
  }

  private identity(): Uint8Array {
    const minor = this.opts.protoMinor ?? 6;
    const out = new Uint8Array(minor >= 7 ? 46 : 30);
    out.set([0x44, 0x53, 0x35, 0x4f, this.opts.protoMajor ?? 1, this.opts.protoMinor ?? 6, this.split ? CONFIG_BODY_SIZE_SPLIT : CONFIG_BODY_SIZE + 1, 0xff]);
    const view = new DataView(out.buffer);
    view.setUint16(8, this.seq, true);
    out[10] = this.lastFunc;
    out[11] = this.lastResult;
    view.setUint32(12, this.hostGen, true);
    out[16] = 4;
    out[17] = this.currentSlot;
    out[18] = 1;
    out[19] = this.config.some((b, i) => b !== this.flashConfig[i]) ? 0x01 : 0; // unsaved settings
    out[24] = 8; // 80 % battery
    out[25] = this.playerLeds;
    out[26] = this.edge ? 1 : 0;
    out.set(
      [...this.colorwayCode].map((c) => c.charCodeAt(0)),
      27,
    );
    out[29] = this.split ? 0x01 | 0x02 | 0x04 : 0x01 | 0x02; // FEATURES2: OLED mirror, calibration, grip test (1.6)
    if (minor >= 7) {
      out[29] |= 0x08; // board name (1.7)
      out.set(
        [..."Pico 2 W"].map((c) => c.charCodeAt(0)),
        30,
      );
    }
    return out;
  }

  // Lets a test simulate another program sending a command in between.
  bumpSequenceExternally(): void {
    this.seq = (this.seq + 1) & 0xffff;
  }
}
