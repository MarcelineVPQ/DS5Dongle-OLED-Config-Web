import { useCallback, useEffect, useRef, useState } from "react";
import { causeText } from "./shownError";
import type { UseDs5BridgeResult } from "../hooks/useDs5Bridge";
import { devNumber, isNewer, sameVersion } from "../update/manifest";
import type { FirmwareHoldState, FirmwareLookup, LatestFirmware, UpdateState } from "./api";
import { deviceText } from "./hardwareName";
import { type FirmwareProgress, updateFirmware } from "./firmwareUpdate";
import { logged } from "../errorText";

// App self-update state, mirrored from the main process.
export function useAppUpdate(): UpdateState {
  const [state, setState] = useState<UpdateState>({ phase: "idle" });
  // lifetime: OK — cleanup: the preload's unsubscribe (removeListener) for the update state
  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop) return;
    desktop.getUpdateState().then(setState).catch(logged("reading the update state at start (updates still arrive through onUpdateState)"));
    // lifetime: OK — the effect returns its unsubscribe
    return desktop.onUpdateState(setState);
  }, []);
  return state;
}

// Firmware being written, and the restart/quit waiting for it (main process).
export function useFirmwareHold(): FirmwareHoldState {
  const [state, setState] = useState<FirmwareHoldState>({ writing: false, restartQueued: false, quitQueued: false });
  // lifetime: OK — cleanup: the preload's unsubscribe (removeListener) for the firmware hold
  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop) return;
    desktop.getFirmwareHold().then(setState).catch(logged("reading the firmware-write hold at start (changes still arrive through onFirmwareHold)"));
    // lifetime: OK — the effect returns its unsubscribe
    return desktop.onFirmwareHold(setState);
  }, []);
  return state;
}

export type FirmwareUpdateState =
  | { phase: "idle" }
  | { phase: "running"; progress: FirmwareProgress }
  | { phase: "verifying"; version: string; slow?: boolean }
  | { phase: "done"; version: string }
  | { phase: "failed"; detail: string };

const RECONNECT_TIMEOUT_MS = 45_000;

// Whether `latest` is offered to a dongle running `installed`: a newer
// version; or, on a dongle running a development build, the stable version
// (after "Back to stable"), even though it's older.
export function firmwareOffer(latest: string | null | undefined, installed: string | null | undefined): { available: boolean; backToStable: boolean } {
  if (!latest || !installed) return { available: false, backToStable: false };
  const backToStable = devNumber(installed) !== null && devNumber(latest) === null && !sameVersion(latest, installed);
  return { available: isNewer(latest, installed) || backToStable, backToStable };
}

export interface FirmwareUpdate {
  latest: LatestFirmware | null;
  // error: SHOWN — desktop.firmware.offline (FirmwarePage: unpublished / offline under Latest)
  problem: FirmwareLookup["problem"]; // why there's no latest: nothing published yet, or offline
  available: boolean;
  backToStable: boolean; // the offer is the stable version, older than this development build
  state: FirmwareUpdateState;
  start: () => Promise<void>;
  refreshLatest: () => Promise<FirmwareLookup>;
  dismiss: () => void;
}

export function useFirmwareUpdate(bridge: UseDs5BridgeResult, appUpdate: UpdateState): FirmwareUpdate {
  const [latest, setLatest] = useState<LatestFirmware | null>(null);
  const [problem, setProblem] = useState<FirmwareLookup["problem"]>(null);
  const [state, setState] = useState<FirmwareUpdateState>({ phase: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshLatest = useCallback(async (): Promise<FirmwareLookup> => {
    let r: FirmwareLookup;
    try {
      // A check button: allowed to go online even with automatic checks off.
      r = (await window.desktop?.latestFirmware(true)) ?? { latest: null, problem: "offline" };
    } catch {
      // error: SHOWN — desktop.firmware.checkedOffline (an unanswered lookup reads as offline)
      r = { latest: null, problem: "offline" };
    }
    setLatest(r.latest);
    setProblem(r.problem);
    return r;
  }, []);

  // Look up the published firmware at start and whenever an app update check
  // ends. Main goes online for it only with automatic checks on, and reuses
  // the check's own feed (one fetch per check).
  const phase = appUpdate.phase;
  const midCheck = phase === "checking" || phase === "downloading" || phase === "installing";
  // lifetime: OK — cleanup: drops a late lookup answer (holds no resource)
  useEffect(() => {
    if (midCheck) return;
    let live = true;
    // error: SHOWN — desktop.firmware.offline (an unanswered lookup reads as offline)
    window.desktop?.latestFirmware(false).then(
      (r) => {
        if (!live) return;
        setLatest(r.latest);
        setProblem(r.problem);
      },
      () => live && setProblem("offline"),
    );
    return () => {
      live = false;
    };
  }, [phase, midCheck]);

  const installed = bridge.firmwareVersion;
  const { available, backToStable } = firmwareOffer(latest?.version, installed);

  const start = useCallback(async () => {
    const client = bridge.client;
    if (!client || !latest || state.phase === "running" || state.phase === "verifying") return;
    // Never flash while the app is replacing itself.
    if (appUpdate.phase === "downloading" || appUpdate.phase === "installing") {
      setState({ phase: "failed", detail: "Wait for the app update to finish first." });
      return;
    }
    try {
      // The entry shown on the card, exactly (never a newer feed's).
      const version = await updateFirmware(client, latest, (progress) => setState({ phase: "running", progress }));
      setState({ phase: "verifying", version });
      // The dongle only shows up on USB once a controller connects, so a slow
      // return isn't a failure: keep waiting, and ask for PS.
      // lifetime: OK — cleared once the update settles, and on unmount (effects below)
      timer.current = setTimeout(() => setState({ phase: "verifying", version, slow: true }), RECONNECT_TIMEOUT_MS);
    } catch (cause) {
      // error: SHOWN — english: the firmware banner's error notice with Dismiss (flash errors are English, batch E3)
      setState({ phase: "failed", detail: causeText(cause) });
      // Show what the feed offers now (the failed install already fetched it,
      // so this doesn't go online again).
      window.desktop?.latestFirmware(false).then((r) => {
        setLatest(r.latest);
        setProblem(r.problem);
      }, logged("refreshing the offer after a failed install (the failure is already shown)"));
    }
  }, [appUpdate.phase, bridge.client, latest, state.phase]);

  // The hook reconnects to the rebooted dongle by itself; the outcome is
  // derived from the version it reports, not stored separately.
  let shown: FirmwareUpdateState = state;
  if (state.phase === "verifying" && installed) {
    shown = sameVersion(state.version, installed)
      ? { phase: "done", version: installed }
      : { phase: "failed", detail: `${deviceText("{{device, capitalize}}")} came back reporting ${installed}, expected ${state.version}.` };
  }
  const settled = shown !== state;
  // lifetime: OK — acquires nothing (clears the slow-return timer once settled)
  useEffect(() => {
    if (settled && timer.current) clearTimeout(timer.current);
  }, [settled]);

  // lifetime: OK — cleanup: clears the slow-return timer on unmount
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return {
    problem,
    latest,
    available,
    backToStable,
    state: shown,
    start,
    refreshLatest,
    dismiss: () => setState({ phase: "idle" }),
  };
}
