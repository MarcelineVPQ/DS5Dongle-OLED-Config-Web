// How the configurator reaches the dongle's pico command reports (0xF1-0xFE).
//
// The dongle's gamepad HID descriptor is byte-identical to a real DualSense, so
// these reports are not declared there and WebHID / Windows HID refuse them.
// Firmware built with ENABLE_COMPANION_VENDOR adds a control-only vendor-class
// USB interface that carries them instead (firmware src/vendor_itf.h). WebUSB
// reaches it in Chromium browsers and in the Electron app alike.

import { keyedText } from "../errorText";

export interface Ds5Transport {
  readonly label: string;
  readonly isOpen: boolean;
  // The board's USB serial number (per board, from its flash chip's unique
  // ID), when it reports one: tells the same board coming back from another.
  readonly serial?: string | null;
  open(): Promise<void>;
  close(): Promise<void>;
  // GET a report. Resolves to the payload WITHOUT the report-id byte.
  getReport(reportId: number, length: number): Promise<Uint8Array>;
  // SET a report. For 0xF6, payload[0] is the function id.
  setReport(reportId: number, payload: Uint8Array): Promise<void>;
}

// A transfer failed because the device left the bus (reboot, BOOTSEL, unplug).
// The messages are keyed text (src/errorText.ts): causeText says them in the user's language.
export class DeviceGoneError extends Error {
  constructor(message = keyedText("desktop.errors.usb.gone")) {
    super(message);
    this.name = "DeviceGoneError";
  }
}

// The firmware refused the request (USB STALL): unknown report, or a firmware
// too old to have it.
export class ReportStalledError extends Error {
  constructor(public readonly reportId: number) {
    super(keyedText("desktop.errors.board.stalled", { report: `0x${reportId.toString(16).toUpperCase()}` }));
    this.name = "ReportStalledError";
  }
}

export const MAX_REPORT_PAYLOAD = 63;
// The one longer reply: the OLED screen mirror (0xEF, protocol 1.4), a 4-byte
// header + the 128x64 image, in a single control transfer.
export const OLED_MIRROR_REPORT = 0xef;
export const OLED_MIRROR_BYTES = 4 + (128 * 64) / 8;
export const maxGetLength = (reportId: number) => (reportId === OLED_MIRROR_REPORT ? OLED_MIRROR_BYTES : MAX_REPORT_PAYLOAD);
