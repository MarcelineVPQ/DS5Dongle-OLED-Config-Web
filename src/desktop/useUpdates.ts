import { useCallback, useEffect, useRef, useState } from "react";
import type { UseDs5BridgeResult } from "../hooks/useDs5Bridge";
import { isNewer, parseVersion } from "../update/manifest";
import type { FirmwareLookup, LatestFirmware, UpdateState } from "./api";
import { type FirmwareProgress, updateFirmware } from "./firmwareUpdate";

// App self-update state, mirrored from the main process.
export function useAppUpdate(): UpdateState {
  const [state, setState] = useState<UpdateState>({ phase: "idle" });
  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop) return;
    void desktop.getUpdateState().then(setState);
    return desktop.onUpdateState(setState);
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

export interface FirmwareUpdate {
  latest: LatestFirmware | null;
  problem: FirmwareLookup["problem"]; // why there's no latest: nothing published yet, or offline
  available: boolean;
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
      r = (await window.desktop?.latestFirmware()) ?? { latest: null, problem: "offline" };
    } catch {
      r = { latest: null, problem: "offline" };
    }
    setLatest(r.latest);
    setProblem(r.problem);
    return r;
  }, []);

  // Look up the published firmware whenever the app checks for updates.
  useEffect(() => {
    let live = true;
    window.desktop?.latestFirmware().then(
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
  }, [appUpdate.phase]);

  const installed = bridge.firmwareVersion;
  const available = Boolean(latest && installed && isNewer(latest.version, installed));

  const start = useCallback(async () => {
    const client = bridge.client;
    if (!client || state.phase === "running" || state.phase === "verifying") return;
    // Never flash while the app is replacing itself.
    if (appUpdate.phase === "downloading" || appUpdate.phase === "installing") {
      setState({ phase: "failed", detail: "Wait for the app update to finish first." });
      return;
    }
    try {
      const version = await updateFirmware(client, (progress) => setState({ phase: "running", progress }));
      setState({ phase: "verifying", version });
      // The dongle only shows up on USB once a controller connects, so a slow
      // return isn't a failure: keep waiting, and ask for PS.
      timer.current = setTimeout(() => setState({ phase: "verifying", version, slow: true }), RECONNECT_TIMEOUT_MS);
    } catch (cause) {
      setState({ phase: "failed", detail: cause instanceof Error ? cause.message : String(cause) });
    }
  }, [appUpdate.phase, bridge.client, state.phase]);

  // The hook reconnects to the rebooted dongle by itself; the outcome is
  // derived from the version it reports, not stored separately.
  let shown: FirmwareUpdateState = state;
  if (state.phase === "verifying" && installed) {
    const want = parseVersion(state.version);
    const got = parseVersion(installed);
    shown =
      want && got && want.join(".") === got.join(".") ? { phase: "done", version: installed } : { phase: "failed", detail: `The dongle came back reporting ${installed}, expected ${state.version}.` };
  }
  const settled = shown !== state;
  useEffect(() => {
    if (settled && timer.current) clearTimeout(timer.current);
  }, [settled]);

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
    state: shown,
    start,
    refreshLatest,
    dismiss: () => setState({ phase: "idle" }),
  };
}
