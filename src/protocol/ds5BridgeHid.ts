import {
  ConfigBody,
  FEATURE_REPORT_PAYLOAD_SIZE,
  decodeConfigBody,
  encodeConfigBody,
} from "./config";

export const SONY_VENDOR_ID = 0x054c;
export const SUPPORTED_PRODUCT_IDS = [0x0ce6, 0x0df2] as const;

const REPORT_SET_CONFIG = 0xf6;
const REPORT_GET_CONFIG = 0xf7;
const REPORT_GET_VERSION = 0xf8;
const REPORT_GET_RSSI    = 0xf9;
const REPORT_GET_SLOTS   = 0xfa;
const REPORT_GET_DIAG    = 0xfb;
const CMD_UPDATE_CONFIG = 0x01;
const CMD_SAVE_TO_FLASH = 0x02;
const CMD_RECONNECT_USB = 0x03;

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
