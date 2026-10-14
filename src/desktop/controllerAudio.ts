// The controller's own audio devices, found by the name the OS gives the
// board's USB audio interface ("DualSense Wireless Controller", on Windows
// e.g. "Microphone (DualSense Wireless Controller)"). One matcher for the
// speaker (narrator, speaker test) and the microphone (mic test), so they
// never pick the PC's own speakers or mic.
const CONTROLLER = /dualsense|wireless controller/i;
// Chromium's aliases for whatever the system default is: skip them so the
// choice doesn't move when the default changes; the real entry is listed too.
const ALIASES = new Set(["default", "communications"]);

export type ControllerAudioKind = "audioinput" | "audiooutput";

export function findControllerAudio(devices: readonly Pick<MediaDeviceInfo, "kind" | "label" | "deviceId">[], kind: ControllerAudioKind): string | null {
  return (
    // loop: NOT-WORTH — N ≈ 10 audio devices; once per narration or test start, not per frame
    devices.find(
      (d) =>
        d.kind === kind &&
        !ALIASES.has(d.deviceId) &&
        CONTROLLER.test(d.label) &&
        // PulseAudio/PipeWire list each output's monitor as an input too.
        !/^monitor of /i.test(d.label),
    )?.deviceId ?? null
  );
}

// The controller's speaker or microphone device id, or null.
export async function controllerAudio(kind: ControllerAudioKind): Promise<string | null> {
  try {
    return findControllerAudio(await navigator.mediaDevices.enumerateDevices(), kind);
  } catch {
    return null;
  }
}
