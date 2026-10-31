import { useCallback, useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { causeText } from "./shownError";
import type { UseDs5BridgeResult } from "../hooks/useDs5Bridge";
import { devNumber, isNewer, sameVersion } from "../update/manifest";
import type { FeedProblem, FirmwareHoldState, FirmwareLookup, LatestFirmware, UpdateState } from "./api";
import { type FirmwareProgress, findBootloader, installFirmware, onlyBootloader, updateFirmware } from "./firmwareUpdate";
import { logged } from "../errorText";
import i18n from "../i18n";
import { announce, showToast } from "./toast";

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
  // The board came back in BOOTSEL after the write: the new firmware didn't start.
  | { phase: "notStarted"; version: string }
  | { phase: "failed"; detail: string };

const RECONNECT_TIMEOUT_MS = 45_000;
// After the write, how often and for how long to look for the bootloader
// coming back (an image the boot ROM won't start: it re-enters BOOTSEL about
// a second after the restart). A board still in BOOTSEL this long after the
// restart, with no gap seen between two looks, didn't start either.
const BOOTLOADER_LOOK_MS = 500;
const BOOTLOADER_WATCH_MS = 30_000;
const STILL_IN_BOOTSEL_MS = 8_000;

// Whether `latest` is offered to a dongle running `installed`: a newer
// version; or, on a dongle running a development build, the stable version
// (after "Back to stable"), even though it's older.
export function firmwareOffer(latest: string | null | undefined, installed: string | null | undefined): { available: boolean; backToStable: boolean } {
  if (!latest || !installed) return { available: false, backToStable: false };
  const backToStable = devNumber(installed) !== null && devNumber(latest) === null && !sameVersion(latest, installed);
  return { available: isNewer(latest, installed) || backToStable, backToStable };
}

// The message for a failed update check: what really happened (a refused
// feed, the server's HTTP error or rate limit, an error inside the app), or
// `offlineKey` when the server didn't answer at all (never "offline?" when
// the network worked).
export function feedProblemText(t: TFunction, problem: FeedProblem | "noBuild" | "stableMismatch" | "unpublished" | "disabled" | null | undefined, offlineKey: string): string {
  if (problem === "noBuild") return t("desktop.updateFeed.noBuild");
  if (problem === "stableMismatch") return t("desktop.updateFeed.stableMismatch");
  if (problem === "unsigned") return t("desktop.updateFeed.unsigned");
  if (problem === "malformed") return t("desktop.updateFeed.malformed");
  if (problem === "wrongChannel") return t("desktop.updateFeed.wrongChannel");
  if (problem === "olderFeed") return t("desktop.updateFeed.olderFeed");
  if (problem === "rateLimited") return t("desktop.updateFeed.rateLimited");
  if (problem === "internal") return t("desktop.updateFeed.internal");
  if (problem?.startsWith("http")) return t("desktop.updateFeed.server", { status: problem.slice(4) });
  return t(offlineKey);
}

export interface FirmwareUpdate {
  latest: LatestFirmware | null;
  // error: SHOWN — desktop.firmware.offline (FirmwarePage: unpublished / offline / unsigned / malformed under Latest)
  problem: FirmwareLookup["problem"]; // why there's no latest: nothing published yet, offline, or the feed was refused
  available: boolean;
  backToStable: boolean; // the offer is the stable version, older than this development build
  state: FirmwareUpdateState;
  start: () => Promise<void>;
  // After "notStarted": write the same firmware again to the board in BOOTSEL.
  reinstall: () => Promise<void>;
  refreshLatest: () => Promise<FirmwareLookup>;
  dismiss: () => void;
}

export function useFirmwareUpdate(bridge: UseDs5BridgeResult, appUpdate: UpdateState): FirmwareUpdate {
  const [latest, setLatest] = useState<LatestFirmware | null>(null);
  const [problem, setProblem] = useState<FirmwareLookup["problem"]>(null);
  const [state, setState] = useState<FirmwareUpdateState>({ phase: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The firmware entry the last write installed (Install again writes exactly it).
  const written = useRef<LatestFirmware | null>(null);
  // The board it was written to (protocol 1.20 id; null on older firmware):
  // Install again writes only that board's bootloader, or the only one.
  const [writtenTo, setWrittenTo] = useState<string | null>(null);

  const refreshLatest = useCallback(async (): Promise<FirmwareLookup> => {
    let r: FirmwareLookup;
    try {
      // A check button: allowed to go online even with automatic checks off.
      r = (await window.desktop?.latestFirmware(true)) ?? { latest: null, problem: "internal" };
    } catch (cause) {
      // error: SHOWN — desktop.updateFeed.internal (the app's own lookup failed: not the network), the cause logged
      logged("looking up the latest firmware (shown as an error inside the app)")(cause);
      r = { latest: null, problem: "internal" };
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
    // error: SHOWN — desktop.firmware.internal (the app's own lookup failed: not the network), the cause logged
    window.desktop?.latestFirmware(false).then(
      (r) => {
        if (!live) return;
        setLatest(r.latest);
        setProblem(r.problem);
      },
      (cause: unknown) => {
        logged("looking up the latest firmware (shown as an error inside the app)")(cause);
        if (live) setProblem("internal");
      },
    );
    return () => {
      live = false;
    };
  }, [phase, midCheck]);

  const installed = bridge.firmwareVersion;
  const { available, backToStable } = firmwareOffer(latest?.version, installed);

  // Written and restarted: wait for the board to come back with `version`.
  const verify = useCallback((version: string) => {
    setState({ phase: "verifying", version });
    // The dongle only shows up on USB once a controller connects, so a slow
    // return isn't a failure: keep waiting, and ask for PS.
    // lifetime: OK — cleared once the update settles, and on unmount (effects below)
    timer.current = setTimeout(() => setState((s) => (s.phase === "verifying" && s.version === version ? { phase: "verifying", version, slow: true } : s)), RECONNECT_TIMEOUT_MS);
  }, []);

  const start = useCallback(async () => {
    const client = bridge.client;
    if (!client || !latest || state.phase === "running" || state.phase === "verifying") return;
    // Never flash while the app is replacing itself.
    if (appUpdate.phase === "downloading" || appUpdate.phase === "installing") {
      setState({ phase: "failed", detail: i18n.t("desktop.firmware.waitForApp") });
      return;
    }
    try {
      // The entry shown on the card, exactly (never a newer feed's).
      written.current = latest;
      setWrittenTo(client.boardId);
      verify(await updateFirmware(client, latest, (progress) => setState({ phase: "running", progress })));
    } catch (cause) {
      // error: SHOWN — desktop.firmware.writeFailed and the other keyed flash/board errors (causeText) in the firmware banner's error notice with Dismiss
      setState({ phase: "failed", detail: causeText(cause) });
      // Show what the feed offers now (the failed install already fetched it,
      // so this doesn't go online again).
      window.desktop?.latestFirmware(false).then((r) => {
        setLatest(r.latest);
        setProblem(r.problem);
      }, logged("refreshing the offer after a failed install (the failure is already shown)"));
    }
  }, [appUpdate.phase, bridge.client, latest, state.phase, verify]);

  // Install again, after the new firmware didn't start: the board waits in
  // BOOTSEL, so this writes it directly (no reboot command first).
  const reinstall = useCallback(async () => {
    const firmware = written.current;
    if (state.phase !== "notStarted" || !firmware) return;
    try {
      const device = await onlyBootloader(writtenTo);
      verify(await installFirmware(device, firmware, (progress) => setState({ phase: "running", progress })));
    } catch (cause) {
      // error: SHOWN — desktop.firmware.writeFailed: the firmware banner's error notice with Dismiss (also noBootsel / wrongFile, in plain words)
      setState({ phase: "failed", detail: causeText(cause) });
    }
  }, [state.phase, verify, writtenTo]);

  // The hook reconnects to the rebooted dongle by itself; the outcome is the
  // version it reports. Kept once known (set while rendering, React's pattern
  // for state that follows a value): the board leaving USB again later (its
  // controller turned off, unplugged) is not a new wait for the update.
  let shown: FirmwareUpdateState = state;
  // With several boards, only the board that was written settles it (another
  // board shown meanwhile, e.g. while the updated one waits for its
  // controller, says nothing about the update). Unknown ids: as before.
  const sameBoardBack = !writtenTo || !bridge.client?.boardId || bridge.client.boardId === writtenTo;
  if (state.phase === "verifying" && installed && sameBoardBack) {
    shown = sameVersion(state.version, installed)
      ? { phase: "done", version: installed }
      : { phase: "failed", detail: i18n.t("desktop.firmware.wrongVersion", { installed, expected: state.version }) };
    setState(shown);
  }
  // "Press the PS button" only while no controller is connected: once one is
  // (it connected after the update, or was already there when the board came
  // back), the notice gives way to a confirmation toast that clears itself.
  // `said`: the notice was on screen, so the narrator already said her line.
  const [confirmed, setConfirmed] = useState<{ version: string; said: boolean } | null>(null);
  if (shown.phase === "done" && bridge.isConnected && bridge.identity?.controllerConnected) {
    setConfirmed({ version: shown.version, said: state.phase === "done" });
    shown = { phase: "idle" };
    setState(shown);
  }
  // lifetime: OK — acquires nothing (one toast per confirmed update)
  useEffect(() => {
    if (!confirmed) return;
    const vars = { version: confirmed.version };
    if (confirmed.said) showToast("desktop.update.fwUpdated", { vars });
    else announce("desktop.update.fwUpdated", "app_fw_updated", { vars });
  }, [confirmed]);
  const verifying = state.phase === "verifying";
  // lifetime: OK — acquires nothing (clears the slow-return timer once settled)
  useEffect(() => {
    if (!verifying && timer.current) clearTimeout(timer.current);
  }, [verifying]);

  // An image the boot ROM won't start leaves the board in BOOTSEL: the
  // bootloader goes away with the restart and comes back. Look for it for a
  // while after the write (the running firmware never shows up as one).
  const waitingFor = state.phase === "verifying" ? state.version : null;
  // lifetime: OK — cleanup: stops the bootloader look (settled, a new write, unmount)
  useEffect(() => {
    if (!waitingFor) return;
    const since = Date.now();
    let stopped = false;
    let gone = false;
    let look: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let device: unknown;
      try {
        device = await findBootloader();
      } catch (cause) {
        // error: LOGGED-OK — one look at the USB devices failed; the next look (500 ms) tries again, and the wait for the board goes on as before
        logged("looking for the bootloader after a firmware write")(cause);
        device = undefined;
      }
      if (stopped) return;
      if (device === null) gone = true;
      else if (device && (gone || Date.now() - since > STILL_IN_BOOTSEL_MS)) {
        setState((s) => (s.phase === "verifying" && s.version === waitingFor ? { phase: "notStarted", version: waitingFor } : s));
        return;
      }
      // loop: SERIAL-REQUIRED — a deadline: one USB look every 500 ms, for 30 s after the write
      // lifetime: OK — self re-arming until the deadline; cleared in the cleanup
      if (Date.now() - since < BOOTLOADER_WATCH_MS) look = setTimeout(() => void tick().catch(logged("the bootloader look (it catches its own errors)")), BOOTLOADER_LOOK_MS);
    };
    tick().catch(logged("the bootloader look (it catches its own errors)"));
    return () => {
      stopped = true;
      if (look) clearTimeout(look);
    };
  }, [waitingFor]);

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
    reinstall,
    refreshLatest,
    dismiss: () => setState({ phase: "idle" }),
  };
}
