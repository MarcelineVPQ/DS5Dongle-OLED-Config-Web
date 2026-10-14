import { DeviceGoneError, MAX_REPORT_PAYLOAD, ReportStalledError, maxGetLength, type Ds5Transport } from "./transport";

export const SONY_VENDOR_ID = 0x054c;
export const DONGLE_PRODUCT_IDS = [0x0ce6, 0x0df2] as const;
const VENDOR_CLASS = 0xff;
const REQ_GET = 0x01;
const REQ_SET = 0x02;

export function webUsbAvailable(): boolean {
  return typeof navigator !== "undefined" && "usb" in navigator && navigator.usb !== undefined;
}

export function isDongle(device: USBDevice): boolean {
  return device.vendorId === SONY_VENDOR_ID && (DONGLE_PRODUCT_IDS as readonly number[]).includes(device.productId);
}

// The configurator interface number, or -1 when the firmware doesn't have it
// (or the device is a real controller plugged in over USB).
export function configuratorInterface(device: USBDevice): number {
  const config = device.configuration ?? device.configurations[0];
  // loop: HOT-PATH-OK — N = 2-4 interfaces x 1-2 alternates
  const itf = config?.interfaces.find((i) => i.alternates.some((a) => a.interfaceClass === VENDOR_CLASS));
  return itf?.interfaceNumber ?? -1;
}

export class WebUsbTransport implements Ds5Transport {
  private interfaceNumber = -1;
  // Control transfers are serialized so a background poll can't land between a
  // SET and the identity read that confirms it.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(public readonly device: USBDevice) {}

  // Devices this origin may already open without a prompt (desktop: granted by
  // the main process; browser: previously picked by the user).
  static async findPermitted(): Promise<USBDevice | undefined> {
    if (!webUsbAvailable()) return undefined;
    const devices = await navigator.usb.getDevices();
    // loop: HOT-PATH-OK — N = permitted USB devices, 1-2
    return devices.find((d) => isDongle(d) && configuratorInterface(d) >= 0);
  }

  // Browser: shows the device chooser (needs a user gesture). Desktop: the main
  // process answers with the dongle automatically.
  static async request(): Promise<USBDevice> {
    return navigator.usb.requestDevice({
      filters: DONGLE_PRODUCT_IDS.map((productId) => ({ vendorId: SONY_VENDOR_ID, productId, classCode: VENDOR_CLASS })),
    });
  }

  get label(): string {
    const pid = this.device.productId.toString(16).padStart(4, "0").toUpperCase();
    return `${this.device.productName || "DS5 Dongle"} · 054C:${pid}`;
  }

  get isOpen(): boolean {
    return this.device.opened && this.interfaceNumber >= 0;
  }

  async open(): Promise<void> {
    if (this.isOpen) return;
    const itf = configuratorInterface(this.device);
    if (itf < 0) throw new Error("Your board's firmware has no configurator interface. Update the firmware first.");
    if (!this.device.opened) await this.device.open();
    if (this.device.configuration === null) await this.device.selectConfiguration(1);
    await this.device.claimInterface(itf);
    this.interfaceNumber = itf;
  }

  async close(): Promise<void> {
    const itf = this.interfaceNumber;
    this.interfaceNumber = -1;
    if (!this.device.opened) return;
    try {
      if (itf >= 0) await this.device.releaseInterface(itf);
      await this.device.close();
    } catch {
      // Already gone.
    }
  }

  getReport(reportId: number, length: number): Promise<Uint8Array> {
    return this.enqueue(async () => {
      const result = await this.transfer(reportId, () => this.device.controlTransferIn(this.setup(REQ_GET, reportId), Math.min(length, maxGetLength(reportId))));
      if (result.status === "stall") throw new ReportStalledError(reportId);
      const data = result.data;
      return data ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(0);
    });
  }

  setReport(reportId: number, payload: Uint8Array): Promise<void> {
    if (payload.length < 1 || payload.length > MAX_REPORT_PAYLOAD) {
      return Promise.reject(new RangeError(`Report payload must be 1-${MAX_REPORT_PAYLOAD} bytes`));
    }
    return this.enqueue(async () => {
      const result = await this.transfer(reportId, () => this.device.controlTransferOut(this.setup(REQ_SET, reportId), payload as Uint8Array<ArrayBuffer>));
      if (result.status === "stall") throw new ReportStalledError(reportId);
    });
  }

  private setup(request: number, reportId: number): USBControlTransferParameters {
    return { requestType: "vendor", recipient: "interface", request, value: reportId, index: this.interfaceNumber };
  }

  private async transfer<T>(reportId: number, run: () => Promise<T>): Promise<T> {
    try {
      // Inside the try: reopening a device that has just left the bus (reboot,
      // BOOTSEL) must also surface as DeviceGoneError, not a raw DOMException.
      if (!this.isOpen) await this.open();
      return await run();
    } catch (cause) {
      if (!this.device.opened || (cause instanceof DOMException && (cause.name === "NotFoundError" || cause.name === "NetworkError"))) {
        this.interfaceNumber = -1;
        throw new DeviceGoneError();
      }
      throw cause instanceof Error ? cause : new Error(`Transfer for report 0x${reportId.toString(16)} failed`);
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
