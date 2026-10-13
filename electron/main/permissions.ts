// The page's web permissions besides WebUSB (devices.ts). Pure, so the
// security tests check the decisions directly; index.ts supplies whether the
// asker is the app's own page (request: the exact page in the main window;
// check: the app origin).
//
// Request (prompts): only "media" for audio alone, so the microphone test can
// open the controller's mic (micTest.ts). Camera, screen capture, audio with
// video, and everything else are refused.
export function allowPermissionRequest(permission: string, details: { mediaTypes?: readonly string[] }, fromApp: boolean): boolean {
  const types = details.mediaTypes ?? [];
  return fromApp && permission === "media" && types.length > 0 && types.every((t) => t === "audio");
}

// Check (no prompt): "usb", "speaker-selection" and "media" for audio, so
// Chromium shows the audio device names the speaker and mic tests and the
// narrator pick the controller by.
export function allowPermissionCheck(permission: string, details: { mediaType?: string }, fromApp: boolean): boolean {
  return fromApp && (permission === "usb" || permission === "speaker-selection" || (permission === "media" && details.mediaType === "audio"));
}
