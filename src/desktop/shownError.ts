// The app's one notice for an action that failed and has no status line of its
// own (CLAUDE.md "Error pass": no silent failure). `promise.catch(shown(key))`
// puts the plain message, in the user's language, pinned at the top of the
// page (DesktopApp's ErrorNotice) until dismissed or the next one replaces it.
// tools/list_errors.mjs reads the key as the row's SHOWN verdict.
import i18n from "../i18n";
import { errorText, translateKeyed } from "../errorText";
import { BAD_REQUEST } from "./api";
import { CommandError } from "../protocol/bridgeClient";
import { externalStore } from "./externalStore";

const message = externalStore<string | null>(null);

export function showError(key: string, vars?: Record<string, string>): void {
  message.set(i18n.t(key, vars));
}

export function clearShownError(): void {
  message.set(null);
}

// An error's text for the page, in plain words: Electron's IPC wrapper
// ("Error invoking remote method '…': Error: ") taken off, and a request the
// main process refused as malformed (BAD_REQUEST, an app bug) said plainly.
// A board command's failure says what to do (a raw "Command 0x04 failed" did not).
// Text from the main process or the protocol code (keyed, src/errorText.ts),
// and a USB error from the browser, in the user's language.
export function causeText(cause: unknown): string {
  if (cause instanceof CommandError) return i18n.t(cause.result === "busy" ? "desktop.errors.boardBusy" : cause.result === "invalid" ? "desktop.errors.boardRejected" : "desktop.errors.boardFailed");
  if (cause instanceof DOMException && USB_ERRORS[cause.name]) return i18n.t(USB_ERRORS[cause.name], { detail: cause.message });
  const raw = errorText(cause);
  const text = raw.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "");
  return text === BAD_REQUEST || /^(Error invoking remote method '[^']*': )?ZodError/.test(raw) ? i18n.t("desktop.errors.badRequest") : shownText(text);
}

// WebUSB's errors (Chromium's English text) by kind; the text stays as the detail.
const USB_ERRORS: Record<string, string> = {
  NetworkError: "desktop.errors.usb.network",
  SecurityError: "desktop.errors.usb.security",
  NotFoundError: "desktop.errors.usb.gone",
  InvalidStateError: "desktop.errors.usb.state",
};

// A message the main process or the protocol code sent as keyed text (a
// result's message, a state's detail), in the user's language.
export const shownText = (text: string): string => translateKeyed(text, (key, params) => i18n.t(key, { ...params, interpolation: { escapeValue: false } }));

// A rejection handler that shows `key` (and logs the cause for a bug report).
export function shown(key: string, vars?: Record<string, string>): (cause: unknown) => void {
  return (cause) => {
    console.warn(`${key}:`, errorText(cause));
    showError(key, vars);
  };
}

export const useShownError = (): string | null => message.use();
