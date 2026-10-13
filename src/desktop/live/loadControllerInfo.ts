// What the "Controller info" card shows, read from the dongle (protocol 1.12).
import type { Ds5BridgeClient } from "../../protocol/bridgeClient";
import { CTRL_TEST, type ControllerFirmware, type Telemetry, decodeActiveTimeOnly, decodeBatteryMillivolts, decodeTelemetry, telemetryPages, telemetrySupported } from "../../protocol/controllerInfo";

export interface ControllerInfoData {
  firmware: ControllerFirmware | null;
  // The model as the dongle saw it (null: it didn't say).
  edge: boolean | null;
  btPatch: number | null;
  millivolts: number | null;
  telemetry: Telemetry | null;
  // Older controller firmware: no full counters, maybe the play time.
  tooOld: boolean;
  activeOnly: number | null;
}

// Reads everything the dongle can tell about the controller (a few seconds:
// two test commands go over Bluetooth).
export async function loadControllerInfo(client: Ds5BridgeClient): Promise<ControllerInfoData> {
  const voltage = await client.runControllerTest(CTRL_TEST.battery.dev, CTRL_TEST.battery.action, 1);
  // After the first test the dongle knows the model (it waits for its own connect-time read).
  const header = await client.readControllerHeader();
  const firmware = await client.readControllerFirmware();
  const edge = header?.model === "edge";
  const block = await client.runControllerTest(CTRL_TEST.telemetry.dev, CTRL_TEST.telemetry.action, telemetryPages(edge));
  const full = !!firmware && telemetrySupported(firmware, edge);
  return {
    firmware,
    edge: header?.model ? header.model === "edge" : null,
    btPatch: header?.btPatch ?? null,
    millivolts: voltage ? decodeBatteryMillivolts(voltage) : null,
    telemetry: full && block ? decodeTelemetry(block, edge) : null,
    tooOld: !!firmware && !full,
    activeOnly: !full && block ? decodeActiveTimeOnly(block) : null,
  };
}
