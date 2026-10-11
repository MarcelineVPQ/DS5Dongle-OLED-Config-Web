// In-memory stand-in for the dongle's pico command reports, following the
// firmware's rules in src/cmd.cpp: every 0xF6 SET bumps the sequence, deferred
// functions report PENDING until the main loop runs them, a second deferred
// function while any one is pending is BUSY, and reboot/BOOTSEL make the device
// vanish. Used by the integration tests in place of real hardware.
import { CONFIG_BODY_SIZE, CONFIG_BODY_SIZE_SPLIT, DEFAULT_CONFIG, encodeConfigBody } from "../../src/protocol/config";
import { DeviceGoneError, ReportStalledError, type Ds5Transport } from "../../src/protocol/transport";

const DEFERRED = new Set([0x02, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0e]);
const RESULT = { ok: 0, pending: 1, invalid: 2, failed: 3, busy: 4 } as const;

export interface FakeDongleOptions {
  protoMajor?: number;
  protoMinor?: number; // default 6
  // How many identity reads a deferred command stays PENDING for.
  pendingPolls?: number;
  saveFails?: boolean;
}

export class FakeDongle implements Ds5Transport {
  readonly label = "Fake dongle";
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

  constructor(private readonly opts: FakeDongleOptions = {}) {}

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
        return this.input.slice(0, length);
      case 0xee:
        return new Uint8Array([this.currentSlot, ...this.calibration[this.currentSlot]]).slice(0, length);
      case 0xef: {
        // OLED mirror: screen on, screen 2, full contrast, a test pattern.
        const out = new Uint8Array(4 + 1024);
        out.set([0, 2, 0xff, this.seq & 0xff]);
        for (let i = 0; i < 1024; i++) out[4 + i] = i % 2 ? 0xaa : 0x55;
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
        return new TextEncoder().encode("0.8.0-test");
      case 0xf9:
        return new Uint8Array([0xfb]); // -5
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
    const out = new Uint8Array(30);
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
    return out;
  }

  // Lets a test simulate another program sending a command in between.
  bumpSequenceExternally(): void {
    this.seq = (this.seq + 1) & 0xffff;
  }
}
