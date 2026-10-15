// The firmware's OLED screens, in its order (src/oled.cpp, kNumScreens), for
// naming the screen the dongle mirror (0xEF) reports.
export const SCREEN_NAMES = ["Status", "Slots", "Lightbar", "Trigger Test", "Gyro Tilt", "Touchpad", "Diagnostics", "CPU/Clock", "RSSI", "VU Meters", "Settings"] as const;
// The screens that react to controller buttons (oled.cpp kScreen*), and the
// holds they know (protocol 1.19 presses them from the app).
export const SCREEN = { status: 0, slots: 1, lightbar: 2, triggers: 3, diag: 6, settings: 10 } as const;
export const SETTINGS_HOLD_MS = 2000; // firmware kResetHoldUs: Reset to defaults / Wipe all slots
export const SLOTS_WIPE_HOLD_MS = 1500; // firmware kSlotsWipeHoldUs
