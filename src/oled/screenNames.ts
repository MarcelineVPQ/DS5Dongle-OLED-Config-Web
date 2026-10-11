// The firmware's OLED screens, in its order (src/oled.cpp, kNumScreens), for
// naming the screen the dongle mirror (0xEF) reports.
export const SCREEN_NAMES = ["Status", "Slots", "Lightbar", "Trigger Test", "Gyro Tilt", "Touchpad", "Diagnostics", "CPU/Clock", "RSSI", "VU Meters", "Settings"] as const;
