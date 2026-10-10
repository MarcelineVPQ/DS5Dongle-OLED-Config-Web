// USB devices the renderer may open through WebUSB. Everything else is denied.
//   054C:0CE6 / 054C:0DF2  the dongle (DS5 / DS5 Edge mode); only its vendor-class
//                          configurator interface is usable from WebUSB, because
//                          Chromium blocks the HID and audio classes.
//   2E8A:000F              RP2350 BOOTSEL (PICOBOOT) for firmware updates.
export interface UsbIds {
  vendorId: number;
  productId: number;
}

export const ALLOWED_USB_DEVICES: readonly UsbIds[] = [
  { vendorId: 0x054c, productId: 0x0ce6 },
  { vendorId: 0x054c, productId: 0x0df2 },
  { vendorId: 0x2e8a, productId: 0x000f },
];

export function isAllowedUsbDevice(device: Partial<UsbIds> | undefined): boolean {
  if (!device) return false;
  return ALLOWED_USB_DEVICES.some((d) => d.vendorId === device.vendorId && d.productId === device.productId);
}
