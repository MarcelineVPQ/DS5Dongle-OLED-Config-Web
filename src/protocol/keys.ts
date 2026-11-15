// Keyboard keys as the board sends them (protocol 1.24, the firmware's
// docs/TENSION_BUTTONS.md §3.4 target kind 2): HID keyboard usages (USB HID
// Usage Tables, Keyboard/Keypad page 0x07), with the US name of each key and
// the browser's KeyboardEvent.code for it, so "Press a key" can take the key
// pressed. The names are the US layout's (the browser's keyboard layout map
// is not used: not verified in Electron on every OS).

export type KeyGroup = "letters" | "digits" | "function" | "navigation" | "editing" | "keypad";
export interface KeyInfo {
  usage: number;
  name: string;
  code: string; // KeyboardEvent.code
  group: KeyGroup;
}

const letters: KeyInfo[] = Array.from({ length: 26 }, (_, i) => {
  const c = String.fromCharCode(65 + i);
  return { usage: 0x04 + i, name: c, code: `Key${c}`, group: "letters" };
});
const digits: KeyInfo[] = Array.from({ length: 10 }, (_, i) => {
  const d = String((i + 1) % 10);
  return { usage: 0x1e + i, name: d, code: `Digit${d}`, group: "digits" };
});
const fkeys: KeyInfo[] = [
  ...Array.from({ length: 12 }, (_, i) => ({ usage: 0x3a + i, name: `F${i + 1}`, code: `F${i + 1}`, group: "function" as const })),
  ...Array.from({ length: 12 }, (_, i) => ({ usage: 0x68 + i, name: `F${i + 13}`, code: `F${i + 13}`, group: "function" as const })),
];
const k = (usage: number, name: string, code: string, group: KeyGroup): KeyInfo => ({ usage, name, code, group });

export const KEYS: readonly KeyInfo[] = [
  ...letters,
  ...digits,
  ...fkeys,
  k(0x28, "Enter", "Enter", "editing"),
  k(0x29, "Esc", "Escape", "editing"),
  k(0x2a, "Backspace", "Backspace", "editing"),
  k(0x2b, "Tab", "Tab", "editing"),
  k(0x2c, "Space", "Space", "editing"),
  k(0x2d, "-", "Minus", "editing"),
  k(0x2e, "=", "Equal", "editing"),
  k(0x2f, "[", "BracketLeft", "editing"),
  k(0x30, "]", "BracketRight", "editing"),
  k(0x31, "\\", "Backslash", "editing"),
  k(0x33, ";", "Semicolon", "editing"),
  k(0x34, "'", "Quote", "editing"),
  k(0x35, "`", "Backquote", "editing"),
  k(0x36, ",", "Comma", "editing"),
  k(0x37, ".", "Period", "editing"),
  k(0x38, "/", "Slash", "editing"),
  k(0x39, "Caps Lock", "CapsLock", "editing"),
  k(0x64, "\\ (ISO)", "IntlBackslash", "editing"),
  k(0x46, "Print Screen", "PrintScreen", "navigation"),
  k(0x47, "Scroll Lock", "ScrollLock", "navigation"),
  k(0x48, "Pause", "Pause", "navigation"),
  k(0x49, "Insert", "Insert", "navigation"),
  k(0x4a, "Home", "Home", "navigation"),
  k(0x4b, "Page Up", "PageUp", "navigation"),
  k(0x4c, "Delete", "Delete", "navigation"),
  k(0x4d, "End", "End", "navigation"),
  k(0x4e, "Page Down", "PageDown", "navigation"),
  k(0x4f, "→", "ArrowRight", "navigation"),
  k(0x50, "←", "ArrowLeft", "navigation"),
  k(0x51, "↓", "ArrowDown", "navigation"),
  k(0x52, "↑", "ArrowUp", "navigation"),
  k(0x65, "Menu", "ContextMenu", "navigation"),
  k(0x53, "Num Lock", "NumLock", "keypad"),
  k(0x54, "Num /", "NumpadDivide", "keypad"),
  k(0x55, "Num *", "NumpadMultiply", "keypad"),
  k(0x56, "Num -", "NumpadSubtract", "keypad"),
  k(0x57, "Num +", "NumpadAdd", "keypad"),
  k(0x58, "Num Enter", "NumpadEnter", "keypad"),
  ...Array.from({ length: 9 }, (_, i) => k(0x59 + i, `Num ${i + 1}`, `Numpad${i + 1}`, "keypad")),
  k(0x62, "Num 0", "Numpad0", "keypad"),
  k(0x63, "Num .", "NumpadDecimal", "keypad"),
  k(0x67, "Num =", "NumpadEqual", "keypad"),
];
export const KEY_GROUPS: readonly KeyGroup[] = ["letters", "digits", "function", "navigation", "editing", "keypad"];

// loop: NOT-WORTH — N ≈ 110 keys, once at load
const BY_USAGE: ReadonlyMap<number, KeyInfo> = new Map(KEYS.map((x) => [x.usage, x]));
// loop: NOT-WORTH — N ≈ 110 keys, once at load
const BY_CODE: ReadonlyMap<string, KeyInfo> = new Map(KEYS.map((x) => [x.code, x]));

// A usage the table doesn't name (a newer app's, 0x74..0xA4) still reads.
export const keyName = (usage: number) => BY_USAGE.get(usage)?.name ?? `0x${usage.toString(16).toUpperCase().padStart(2, "0")}`;
export const keyForCode = (code: string): KeyInfo | undefined => BY_CODE.get(code);

// Modifier bits (§3.4: bit0 Left Ctrl, 1 Left Shift, 2 Left Alt, 3 Left GUI, 4..7 the right ones).
export const MOD = { ctrl: 0x01, shift: 0x02, alt: 0x04, gui: 0x08 } as const;
export type ModKey = keyof typeof MOD;
export const MOD_KEYS: readonly ModKey[] = ["ctrl", "shift", "alt", "gui"];
// The modifier keys themselves: pressed alone they are a modifiers-only target (a = 0).
export const MOD_CODES: Readonly<Record<string, number>> = {
  ControlLeft: 0x01,
  ShiftLeft: 0x02,
  AltLeft: 0x04,
  MetaLeft: 0x08,
  ControlRight: 0x10,
  ShiftRight: 0x20,
  AltRight: 0x40,
  MetaRight: 0x80,
};
// Right-hand modifiers folded onto the left ones (the picker shows four switches).
export const leftMods = (mask: number) => (mask & 0x0f) | (mask >> 4);
// The mask of a key press's held modifiers.
export const heldMods = (e: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }) =>
  (e.ctrlKey ? MOD.ctrl : 0) | (e.shiftKey ? MOD.shift : 0) | (e.altKey ? MOD.alt : 0) | (e.metaKey ? MOD.gui : 0);
