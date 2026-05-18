interface HIDDeviceFilter {
  vendorId?: number;
  productId?: number;
  usagePage?: number;
  usage?: number;
}

interface HIDDeviceRequestOptions {
  filters: HIDDeviceFilter[];
  exclusionFilters?: HIDDeviceFilter[];
}

interface HIDConnectionEvent extends Event {
  readonly device: HIDDevice;
}

interface HIDInputReportEvent extends Event {
  readonly device: HIDDevice;
  readonly reportId: number;
  readonly data: DataView;
}

interface HIDReportInfo {
  readonly reportId?: number;
}

interface HIDCollectionInfo {
  readonly usagePage?: number;
  readonly usage?: number;
  readonly inputReports?: HIDReportInfo[];
  readonly outputReports?: HIDReportInfo[];
  readonly featureReports?: HIDReportInfo[];
  readonly children?: HIDCollectionInfo[];
}

interface HIDDevice extends EventTarget {
  readonly opened: boolean;
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  readonly collections: HIDCollectionInfo[];
  open(): Promise<void>;
  close(): Promise<void>;
  forget?(): Promise<void>;
  receiveFeatureReport(reportId: number): Promise<DataView>;
  sendFeatureReport(reportId: number, data: BufferSource): Promise<void>;
  addEventListener(
    type: "inputreport",
    listener: (this: HIDDevice, ev: HIDInputReportEvent) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: "inputreport",
    listener: (this: HIDDevice, ev: HIDInputReportEvent) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;
}

interface HID extends EventTarget {
  getDevices(): Promise<HIDDevice[]>;
  requestDevice(options: HIDDeviceRequestOptions): Promise<HIDDevice[]>;
  addEventListener(
    type: "connect" | "disconnect",
    listener: (this: HID, ev: HIDConnectionEvent) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: "connect" | "disconnect",
    listener: (this: HID, ev: HIDConnectionEvent) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;
}

interface Navigator {
  readonly hid?: HID;
}
