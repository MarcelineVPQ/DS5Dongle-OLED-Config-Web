import {
  ConfigBody,
  FEATURE_REPORT_PAYLOAD_SIZE,
  decodeConfigBody,
  encodeConfigBody,
} from "./config";
import {
  RemapState,
  decodeRemapFromConfigReport,
  encodeRemapSet,
} from "./remap";

export const SONY_VENDOR_ID = 0x054c;
export const SUPPORTED_PRODUCT_IDS = [0x0ce6, 0x0df2] as const;

const REPORT_SET_CONFIG = 0xf6;
const REPORT_GET_CONFIG = 0xf7;
const REPORT_GET_VERSION = 0xf8;
const REPORT_GET_RSSI    = 0xf9;
const REPORT_GET_SLOTS   = 0xfa;
const REPORT_GET_DIAG    = 0xfb;
const REPORT_GET_CPU     = 0xfc;
const CMD_UPDATE_CONFIG = 0x01;
const CMD_SAVE_TO_FLASH = 0x02;
const CMD_RECONNECT_USB = 0x03;

export interface HidReportProbe {
  id: number;
  name: string;
  declared: boolean;   // present in the device's parsed HID report descriptor
  ok?: boolean;        // receiveFeatureReport resolved
  byteLength?: number; // payload size on success
  error?: string;      // "<ErrorName>: <message>" on failure
}

export interface HidDiagnostics {
  productId: number;
  declaredFeatureIds: number[];
  declaredInputIds: number[];
  probes: HidReportProbe[];
}

// Bitpacked DS5 adaptive-trigger effect params (per dualsensectl's
// reverse-engineering). Mirrors src/oled.cpp send_trigger_effect() in
// the firmware byte-for-byte. The caller applies the same {mode, params}
// to both R2 and L2 in the SetStateData payload.
function buildTriggerEffect(preset: number): { mode: number; params: Uint8Array } {
  const params = new Uint8Array(9);
  let mode = 0x05; // OFF

  switch (preset) {
    case 0: // Off
      mode = 0x05;
      break;
    case 1: { // Feedback — all 10 zones at max strength 8
      mode = 0x21;
      const active = 0x03FF;
      let strength = 0;
      for (let i = 0; i < 10; i++) strength |= 7 << (3 * i);
      params[0] = active & 0xFF;
      params[1] = (active >> 8) & 0xFF;
      params[2] = strength & 0xFF;
      params[3] = (strength >> 8) & 0xFF;
      params[4] = (strength >> 16) & 0xFF;
      params[5] = (strength >> 24) & 0xFF;
      break;
    }
    case 2: { // Weapon — snap between positions 3 and 5, force 8
      mode = 0x25;
      const startStop = (1 << 3) | (1 << 5);
      params[0] = startStop & 0xFF;
      params[1] = (startStop >> 8) & 0xFF;
      params[2] = 7; // force = strength - 1
      break;
    }
    case 3: { // Vibration — all zones, amplitude 8, frequency 30 Hz
      mode = 0x26;
      const active = 0x03FF;
      let strength = 0;
      for (let i = 0; i < 10; i++) strength |= 7 << (3 * i);
      params[0] = active & 0xFF;
      params[1] = (active >> 8) & 0xFF;
      params[2] = strength & 0xFF;
      params[3] = (strength >> 8) & 0xFF;
      params[4] = (strength >> 16) & 0xFF;
      params[5] = (strength >> 24) & 0xFF;
      params[8] = 30;
      break;
    }
    case 4: { // Bow — drawing resistance + snap at position 6
      mode = 0x22;
      const startStop = (1 << 2) | (1 << 6);
      const forcePair = 7 | (7 << 3); // strength=8, snap=8
      params[0] = startStop & 0xFF;
      params[1] = (startStop >> 8) & 0xFF;
      params[2] = forcePair;
      break;
    }
    case 5: { // Galloping
      mode = 0x23;
      const startStop = (1 << 0) | (1 << 9);
      const ratio = (5 & 0x07) | ((1 & 0x07) << 3);
      params[0] = startStop & 0xFF;
      params[1] = (startStop >> 8) & 0xFF;
      params[2] = ratio;
      params[3] = 5; // frequency
      break;
    }
    case 6: { // Machine gun
      mode = 0x27;
      const startStop = (1 << 1) | (1 << 8);
      const forcePair = 7 | (7 << 3);
      params[0] = startStop & 0xFF;
      params[1] = (startStop >> 8) & 0xFF;
      params[2] = forcePair;
      params[3] = 20; // frequency
      params[4] = 0;  // period
      break;
    }
  }

  return { mode, params };
}

export class Ds5BridgeHidClient {
  constructor(public readonly device: HIDDevice) {}

  static isSupportedDevice(device: HIDDevice): boolean {
    return device.vendorId === SONY_VENDOR_ID && SUPPORTED_PRODUCT_IDS.includes(device.productId as 0x0ce6 | 0x0df2);
  }

  static async requestDevice(): Promise<Ds5BridgeHidClient> {
    const hid = getHid();
    const devices = await hid.requestDevice({
      filters: SUPPORTED_PRODUCT_IDS.map((productId) => ({
        vendorId: SONY_VENDOR_ID,
        productId,
      })),
    });

    const device = devices.find(Ds5BridgeHidClient.isSupportedDevice);
    if (!device) {
      throw new Error("No DS5 Bridge device was selected");
    }

    return new Ds5BridgeHidClient(device);
  }

  static async authorizedDevices(): Promise<HIDDevice[]> {
    const devices = await getHid().getDevices();
    return devices.filter(Ds5BridgeHidClient.isSupportedDevice);
  }

  async open(): Promise<void> {
    if (!this.device.opened) {
      await this.device.open();
    }
  }

  async close(): Promise<void> {
    if (this.device.opened) {
      await this.device.close();
    }
  }

  async readConfig(): Promise<ConfigBody> {
    await this.open();
    const report = await this.device.receiveFeatureReport(REPORT_GET_CONFIG);
    return decodeConfigBody(report);
  }

  async applyConfig(config: ConfigBody): Promise<void> {
    await this.open();
    const body = encodeConfigBody(config);
    const report = commandReport(CMD_UPDATE_CONFIG);
    report.set(body, 1);
    await this.device.sendFeatureReport(REPORT_SET_CONFIG, report);
  }

  async saveToFlash(): Promise<void> {
    await this.open();
    await this.device.sendFeatureReport(REPORT_SET_CONFIG, commandReport(CMD_SAVE_TO_FLASH));
  }

  // Button remap rides the same 0xF6/0xF7 reports. Read returns null on older
  // firmware that doesn't append the remap block to its 0xF7 response.
  async readRemap(): Promise<RemapState | null> {
    await this.open();
    const report = await this.device.receiveFeatureReport(REPORT_GET_CONFIG);
    return decodeRemapFromConfigReport(report);
  }

  // Write + persist a remap table. The firmware saves it to its own flash
  // sector immediately (no separate save-to-flash step) and bumps the revision.
  async applyRemap(table: number[]): Promise<void> {
    await this.open();
    await this.device.sendFeatureReport(REPORT_SET_CONFIG, encodeRemapSet(table));
  }

  async reconnectUsb(): Promise<void> {
    await this.open();
    await this.device.sendFeatureReport(REPORT_SET_CONFIG, commandReport(CMD_RECONNECT_USB));
  }

  async readFirmwareVersion(): Promise<string> {
    await this.open();
    const report = await this.device.receiveFeatureReport(REPORT_GET_VERSION);
    const bytes = new Uint8Array(report.buffer, report.byteOffset + 1, report.byteLength - 1);
    let end = bytes.indexOf(0);
    if (end < 0) end = bytes.length;
    return new TextDecoder("ascii").decode(bytes.subarray(0, end));
  }

  async readRssi(): Promise<number> {
    await this.open();
    const report = await this.device.receiveFeatureReport(REPORT_GET_RSSI);
    if (report.byteLength < 2) return 0;
    const v = report.getUint8(1);
    return v >= 128 ? v - 256 : v; // int8
  }

  // 28-byte slots payload: 4 x bd_addr (6 bytes each) + 4 x occupied flag.
  async readSlotsRaw(): Promise<{ addrs: Uint8Array[]; occupied: boolean[] }> {
    await this.open();
    const report = await this.device.receiveFeatureReport(REPORT_GET_SLOTS);
    const data = new Uint8Array(report.buffer, report.byteOffset + 1, 28);
    const addrs: Uint8Array[] = [];
    for (let i = 0; i < 4; i++) {
      addrs.push(data.slice(i * 6, i * 6 + 6));
    }
    const occupied = [data[24] === 1, data[25] === 1, data[26] === 1, data[27] === 1];
    return { addrs, occupied };
  }

  // 18-byte diagnostics payload (see firmware src/cmd.cpp).
  async readDiagRaw(): Promise<{
    uptimeSeconds: number; usbFrames: number; btPackets: number;
    peakSpeaker: number;  peakHaptic: number; hciErrors: number;
  }> {
    await this.open();
    const report = await this.device.receiveFeatureReport(REPORT_GET_DIAG);
    const view = new DataView(report.buffer, report.byteOffset + 1, 18);
    return {
      uptimeSeconds: view.getUint32(0, true),
      usbFrames:     view.getUint32(4, true),
      btPackets:     view.getUint32(8, true),
      peakSpeaker:   view.getUint8(12),
      peakHaptic:    view.getUint8(13),
      hciErrors:     view.getUint32(14, true),
    };
  }

  // Send a DS5 adaptive-trigger preset to the connected controller via
  // the dongle. Mirrors src/oled.cpp send_trigger_effect() so the web
  // preview's Trigger Test screen drives the same physical haptic feel
  // as cycling KEY1 on the OLED. Pushes DS5 USB output report 0x02
  // (SetStateData, 47 bytes); the dongle forwards it to the paired
  // DualSense over BT. Same effect applied to both L2 and R2.
  async sendTriggerPreset(preset: number): Promise<void> {
    await this.open();
    const data = new Uint8Array(47);
    data[0] = 0x0C; // valid_flag0: RIGHT_TRIGGER_MOTOR_ENABLE | LEFT_TRIGGER_MOTOR_ENABLE
    const { mode, params } = buildTriggerEffect(preset);
    data[10] = mode;
    for (let i = 0; i < 9; i++) data[11 + i] = params[i];
    data[21] = mode;
    for (let i = 0; i < 9; i++) data[22 + i] = params[i];
    await this.device.sendReport(0x02, data);
  }

  // NOTE: there is intentionally no readCpuRaw(). The firmware exposes
  // CPU/Clock telemetry on feature report 0xFC, but Chrome WebHID rejects
  // any report ID not declared in the HID descriptor, and declaring the
  // OLED Edition vendor reports breaks DualSense enumeration on Windows
  // (verified twice on real hardware — see CHANGELOG). The CPU preview
  // therefore uses representative mock values. REPORT_GET_CPU is kept only
  // so the diagnostic below can probe and document the failure.

  // Read-only diagnostic: which feature report IDs did Chrome parse from the
  // device's HID report descriptor, and what happens when we actually try to
  // GET each of the OLED Edition vendor reports. Pure reads (no sendReport),
  // so it is side-effect free on the firmware. Used to find out *why* the
  // slots/diag/cpu telemetry reads don't return data, instead of guessing.
  async diagnoseFeatureReports(): Promise<HidDiagnostics> {
    await this.open();

    const declaredFeatureIds = new Set<number>();
    const declaredInputIds = new Set<number>();
    const collect = (cols: HIDCollectionInfo[] | undefined) => {
      for (const c of cols ?? []) {
        for (const r of c.featureReports ?? []) {
          if (typeof r.reportId === "number") declaredFeatureIds.add(r.reportId);
        }
        for (const r of c.inputReports ?? []) {
          if (typeof r.reportId === "number") declaredInputIds.add(r.reportId);
        }
        collect(c.children);
      }
    };
    collect(this.device.collections);

    const probeIds: Array<{ id: number; name: string }> = [
      { id: REPORT_GET_CONFIG, name: "config (known-good)" },
      { id: REPORT_GET_VERSION, name: "version" },
      { id: REPORT_GET_RSSI, name: "rssi" },
      { id: REPORT_GET_SLOTS, name: "slots" },
      { id: REPORT_GET_DIAG, name: "diagnostics" },
      { id: REPORT_GET_CPU, name: "cpu/clock" },
    ];

    const probes: HidReportProbe[] = [];
    for (const { id, name } of probeIds) {
      const declared = declaredFeatureIds.has(id);
      try {
        const report = await this.device.receiveFeatureReport(id);
        probes.push({
          id, name, declared, ok: true,
          byteLength: report.byteLength,
        });
      } catch (e) {
        const err = e as { name?: string; message?: string };
        probes.push({
          id, name, declared, ok: false,
          error: `${err.name ?? "Error"}: ${err.message ?? String(e)}`,
        });
      }
    }

    return {
      productId: this.device.productId,
      declaredFeatureIds: [...declaredFeatureIds].sort((a, b) => a - b),
      declaredInputIds: [...declaredInputIds].sort((a, b) => a - b),
      probes,
    };
  }

  // Subscribe to the device's HID input report stream. Callback fires for
  // each input report with the raw payload (report ID stripped by WebHID).
  // Returns an unsubscribe function.
  onInputReport(cb: (data: Uint8Array, reportId: number) => void): () => void {
    const handler = (ev: HIDInputReportEvent) => {
      const data = new Uint8Array(ev.data.buffer, ev.data.byteOffset, ev.data.byteLength);
      cb(data, ev.reportId);
    };
    this.device.addEventListener("inputreport", handler);
    return () => this.device.removeEventListener("inputreport", handler);
  }
}

export function webHidAvailable(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.hid);
}

export function getDeviceLabel(device: HIDDevice | null): string {
  if (!device) {
    return "No device";
  }

  const productId = device.productId.toString(16).padStart(4, "0").toUpperCase();
  return `${device.productName || "DS5 Bridge"} · 054C:${productId}`;
}

function getHid(): HID {
  if (!navigator.hid) {
    throw new Error("WebHID is not available in this browser");
  }

  return navigator.hid;
}

function commandReport(command: number): Uint8Array<ArrayBuffer> {
  const report = new Uint8Array(new ArrayBuffer(FEATURE_REPORT_PAYLOAD_SIZE));
  report[0] = command;
  return report;
}
