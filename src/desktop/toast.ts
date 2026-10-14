// The app's one toast queue (docs/BACKLOG.md "Toast system"): short-lived
// confirmations and events ("All changes saved on the Pico 2 W", "Copied",
// "Controller connected"). Never for an error or a task that needs the user:
// those stay in a notice (shownError.ts) or the page's own status line, which
// don't go away by themselves.
//
// `showToast(key)` works from anywhere (like showError): the text is looked up
// in the user's language when it's shown. `Toasts.tsx` draws the stack at the
// bottom right and runs the timers (paused while hovered, focused or hidden).
import i18n from "../i18n";
import { isWindowShown } from "./useWindowShown";
import { reducedMotionNow } from "./motion";
import { captionShows, readingTime, sayInPassing } from "./narrator";
import { externalStore } from "./externalStore";

export type ToastAction = { labelKey: string; run: () => void };
export type Toast = {
  id: number;
  text: string;
  action?: ToastAction;
  // How long it stays on screen while nobody hovers or focuses it.
  durationMs: number;
  // Bumped when the same text is shown again: its timer starts over (no duplicate).
  shownAt: number;
  // Fading out (removed after LEAVE_MS; at once with reduced motion).
  leaving: boolean;
};

export const TOAST_MS = 5000;
export const TOAST_ACTION_MS = 8000;
// After a hover or focus leaves, a toast stays at least this long.
export const TOAST_RESUME_MS = 2000;
export const TOAST_LEAVE_MS = 160;
export const TOAST_MAX = 3;

// cache: OK — key=none (the stack on screen); invalidated=each show, dismiss and removal; bound=TOAST_MAX (3) toasts, plus ones fading out
const stack = externalStore<readonly Toast[]>([]);
let nextId = 1;
let stamp = 0;
const publish = stack.set;

// Show a toast. While the window is hidden (tray, minimized) nothing is
// queued: an event nobody saw is stale by the time the window comes back.
export function showToast(key: string, opts: { vars?: Record<string, string>; action?: ToastAction; durationMs?: number } = {}): void {
  if (!isWindowShown()) return;
  const text = i18n.t(key, opts.vars);
  stamp += 1;
  // loop: NOT-WORTH — N ≤ TOAST_MAX (3) toasts; once per toast shown
  const same = stack.get().find((t) => t.text === text && !t.leaving);
  if (same) {
    publish(stack.get().map((t) => (t === same ? { ...t, shownAt: stamp } : t))); // loop: NOT-WORTH — N ≤ 3; per toast shown
    return;
  }
  const toast: Toast = { id: nextId++, text, action: opts.action, durationMs: opts.durationMs ?? readingTime(text, opts.action ? TOAST_ACTION_MS : TOAST_MS), shownAt: stamp, leaving: false };
  // The oldest goes when the stack is full.
  const kept = stack.get().filter((t) => !t.leaving); // loop: NOT-WORTH — N ≤ 3; per toast shown
  publish([...kept.slice(Math.max(0, kept.length - (TOAST_MAX - 1))), toast]);
}

// An event the narrator has a line for: she says it, and the toast shows
// only when her caption doesn't (one of the two on screen, never both).
export function announce(key: string, line: string | null, opts: { vars?: Record<string, string> } = {}): void {
  const captioned = line !== null && captionShows(line);
  if (line !== null) sayInPassing(line);
  if (!captioned) showToast(key, opts);
}

// Close a toast (its ×, its action, or its time up): it fades, then goes.
export function dismissToast(id: number): void {
  // loop: NOT-WORTH — N ≤ 3 toasts; per dismiss
  if (!stack.get().some((t) => t.id === id && !t.leaving)) return;
  if (reducedMotionNow()) return removeToast(id);
  publish(stack.get().map((t) => (t.id === id ? { ...t, leaving: true } : t))); // loop: NOT-WORTH — N ≤ 3; per dismiss
  // lifetime: OK — fires once (removes the faded toast)
  setTimeout(() => removeToast(id), TOAST_LEAVE_MS);
}

function removeToast(id: number): void {
  // loop: NOT-WORTH — N ≤ 3 toasts; per removal
  if (stack.get().some((t) => t.id === id)) publish(stack.get().filter((t) => t.id !== id));
}

// Tests: start from an empty stack.
export function clearToasts(): void {
  publish([]);
}

export const useToasts = (): readonly Toast[] => stack.use();
