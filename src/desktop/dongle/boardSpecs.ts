// What the board page says about the hardware: the board's specs (keyed by the
// board name the firmware reports) and the display add-on's.
//
// Board numbers: Raspberry Pi's Pico-series page,
// https://www.raspberrypi.com/documentation/microcontrollers/pico-series.html
// (Pico 2 W: RP2350, dual-core Arm Cortex-M33, 520 kB SRAM, 4 MB flash,
// Infineon CYW43439, Bluetooth 5.2, 802.11n 2.4 GHz; Pico W: RP2040, dual-core
// Cortex-M0+, 264 kB SRAM, 2 MB flash, same CYW43439). Checked 2026-10-13.

// The zone's title line uses the short names (2× Cortex-M33 · CYW43439); its ⓘ the makers' too.
export type BoardSpecs = { chip: string; core: string; coreMaker: string; sramKb: number; flashMb: number; wireless: string; wirelessMaker: string; bluetooth: string };

const BOARD_SPECS: Record<string, BoardSpecs> = {
  "Pico 2 W": { chip: "RP2350", core: "Cortex-M33", coreMaker: "Arm", sramKb: 520, flashMb: 4, wireless: "CYW43439", wirelessMaker: "Infineon", bluetooth: "5.2" },
  "Pico W": { chip: "RP2040", core: "Cortex-M0+", coreMaker: "Arm", sramKb: 264, flashMb: 2, wireless: "CYW43439", wirelessMaker: "Infineon", bluetooth: "5.2" },
};

/** The board's specs, or null for a board we have no table row for (its zone's title has no spec line). */
export const boardSpecs = (board: string | null | undefined): BoardSpecs | null => (board && BOARD_SPECS[board]) || null;

// The display add-on the firmware supports. The firmware can't tell whether it's
// attached (it drives the pins blind), so this names the supported module, not a
// detected one. Waveshare's wiki, https://www.waveshare.com/wiki/Pico-OLED-1.3:
// 1.3 inch, 64 × 128 pixels, SH1107 controller, 4-wire SPI (default) or I2C;
// the firmware uses SPI1 and the module's two keys, KEY0 / KEY1. Checked 2026-10-13.
// A future module changes this one object.
export const OLED_MODULE = {
  name: "Waveshare Pico-OLED-1.3",
  size: "1.3″",
  resolution: "128 × 64",
  controller: "SH1107",
  interface: "SPI",
  keys: "KEY0 / KEY1",
} as const;
