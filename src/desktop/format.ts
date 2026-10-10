// RP2350 die temperature from the raw 12-bit ADC (datasheet: 27 °C at 0.706 V,
// -1.721 mV/°C, 3.3 V reference).
export function adcToCelsius(raw: number): number {
  const volts = (raw * 3.3) / 4096;
  return 27 - (volts - 0.706) / 0.001721;
}

export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Classic Bluetooth's HCI Read RSSI is not dBm: it is how far the link sits
// from the receiver's "golden" power range, so 0 means ideal and more negative
// means weaker.
export function signalQuality(rssi: number): "excellent" | "good" | "fair" | "weak" {
  if (rssi >= -5) return "excellent";
  if (rssi >= -15) return "good";
  if (rssi >= -25) return "fair";
  return "weak";
}
