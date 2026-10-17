// One save model (IA audit Q1): every board setting is kept by the one save
// bar at the bottom (SaveBar.tsx). The config body applies live to the
// board's RAM as you change it (DesktopApp) and the bar saves it to flash;
// the settings the firmware only takes as a saved write wait here as drafts
// ("staged") until the bar's Save: button assignments (0x10), stick curves
// (0x14), calibration (0x0D: sticks, triggers, gyroscope) and the PC sleep
// options (0x17). The firmware applies none of these four only for now: each
// write saves, so staging them changes nothing about what the board does
// until Save, and Revert just drops the drafts.
//
// The drafts live with the app (DesktopApp), not in a section: folding a
// section or leaving the page keeps them, as it keeps the config draft. While
// a game's profile is on, buttons and curves go to the profile (its own Save
// to profile, useGameProfile.ts); calibration and the PC sleep options belong
// to the board and wait for the bar once the profile ends (said in their
// sections), like the board-wide config settings.
import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { FEATURES2, supportsFeature2, type Ds5BridgeClient } from "../../protocol/bridgeClient";
import { DEFAULT_CALIBRATION, normalizeCalibration, type Calibration } from "../../protocol/calibration";
import { DEFAULT_CURVES, curvesEqual, type StickCurvePair } from "../../protocol/stickCurve";
import { causeText } from "../shownError";
import { useRemap, type Remap } from "./useRemap";
import { useSlotSettings, type SlotRead } from "./slotSettings";

export const supportsCalibration = (identity: UseDs5BridgeResult["identity"]) => supportsFeature2(identity, 5, FEATURES2.calibration);
export const supportsStickCurves = (identity: UseDs5BridgeResult["identity"]) => supportsFeature2(identity, 10, FEATURES2.stickCurves);

const readCal = (client: Ds5BridgeClient): Promise<SlotRead<Calibration>> => client.readCalibration().then(({ slot, calibration }) => ({ slot, value: calibration }));
const readCurves = (client: Ds5BridgeClient): Promise<SlotRead<StickCurvePair> | null> => client.readStickCurves().then((r) => r && { slot: r.slot, value: r.saved });

// A per-slot setting the board saves on write (calibration, curves): read
// once per connection and slot, a draft to edit, dirty against what's saved.
export interface SlotDraft<T> {
  supported: boolean;
  slot: number;
  saved: T | null;
  draft: T;
  setDraft: (next: T | ((d: T) => T)) => void;
  dirty: boolean;
  // error: SHOWN — desktop.errors.saveFailed (the save bar's notice) and the board's keyed errors (causeText) in the section's SlotReadError line
  error: string | null;
  retry: () => Promise<void>;
  // Writes the draft (saved on the board) and reads it back; false = the error says why.
  save: () => Promise<boolean>;
  revert: () => void;
}

function useSlotDraft<T>(
  bridge: UseDs5BridgeResult,
  supported: boolean,
  initial: T,
  read: (client: Ds5BridgeClient) => Promise<SlotRead<T> | null>,
  write: (client: Ds5BridgeClient, slot: number, value: T) => Promise<void>,
  same: (a: T, b: T) => boolean,
  unreadable = "",
): SlotDraft<T> {
  const s = useSlotSettings(bridge, supported, initial, read, unreadable);
  const { client } = bridge;
  const { slot, saved, draft, setDraft, error, setError, loaded, retry } = s;
  const dirty = saved !== null && !same(draft, saved);
  const save = useCallback(async () => {
    if (!client || saved === null) return false;
    setError(null);
    try {
      await write(client, slot, draft);
      const back = await read(client);
      if (back) loaded(back);
      return true;
    } catch (cause) {
      // error: SHOWN — desktop.errors.boardFailed (causeText, with the other keyed board errors): the section's error line, and the save bar's notice (SaveBar)
      setError(causeText(cause));
      return false;
    }
  }, [client, saved, setError, write, slot, draft, read, loaded]);
  const revert = useCallback(() => {
    if (saved !== null) setDraft(saved);
  }, [saved, setDraft]);
  return useMemo(() => ({ supported, slot, saved, draft, setDraft, dirty, error, retry, save, revert }), [supported, slot, saved, draft, setDraft, dirty, error, retry, save, revert]);
}

const writeCal = (client: Ds5BridgeClient, slot: number, c: Calibration) => client.setCalibration(slot, c);
const writeCurves = (client: Ds5BridgeClient, slot: number, pair: StickCurvePair) => client.applyStickCurves(slot, pair[0], pair[1], false);
const sameCal = (a: Calibration, b: Calibration) => JSON.stringify(normalizeCalibration(a)) === JSON.stringify(normalizeCalibration(b));
// loop: NOT-WORTH — N = 2 sticks
const sameCurves = (a: StickCurvePair, b: StickCurvePair) => a.every((c, i) => curvesEqual(c, b[i]));

// The PC sleep options (protocol 1.14): the board's bits (identity [47]) and a staged change.
export interface PowerDraft {
  supported: boolean;
  value: number | null; // what the switches show: the staged bits, else the board's
  set: (bits: number) => void;
  dirty: boolean;
  save: () => Promise<boolean>;
  revert: () => void;
}

function usePowerDraft(bridge: UseDs5BridgeResult): PowerDraft {
  const board = bridge.identity?.powerFlags ?? null;
  const [staged, setStaged] = useState<number | null>(null);
  const dirty = staged !== null && board !== null && staged !== board;
  const { setPowerFlags } = bridge;
  const save = useCallback(async () => {
    if (!dirty || staged === null) return true;
    const ok = await setPowerFlags(staged);
    if (ok) setStaged(null);
    return ok;
  }, [dirty, staged, setPowerFlags]);
  return useMemo(
    () => ({ supported: board !== null, value: dirty ? staged : board, set: (bits: number) => setStaged(bits === board ? null : bits), dirty, save, revert: () => setStaged(null) }),
    [board, dirty, staged, save],
  );
}

export interface BoardDrafts {
  remap: Remap;
  calibration: SlotDraft<Calibration>;
  curves: SlotDraft<StickCurvePair>;
  power: PowerDraft;
  // A game's profile is on: buttons and curves go to it, not to the board.
  inProfile: boolean;
  // Anything staged for the board's Save (buttons and curves only outside a profile).
  staged: boolean;
  // Writes everything staged, in protocol order; false = something wasn't saved (its section and the bar say why).
  saveStaged: () => Promise<boolean>;
  revertStaged: () => void;
}

export function useBoardDraftsState(bridge: UseDs5BridgeResult, { inProfile, appliedStamp }: { inProfile: boolean; appliedStamp: string | null }): BoardDrafts {
  const { t } = useTranslation();
  const remap = useRemap(bridge.client, bridge.identity?.remapTemporary ?? null, appliedStamp);
  const calibration = useSlotDraft(bridge, supportsCalibration(bridge.identity), DEFAULT_CALIBRATION, readCal, writeCal, sameCal);
  const curves = useSlotDraft(bridge, supportsStickCurves(bridge.identity), DEFAULT_CURVES, readCurves, writeCurves, sameCurves, t("desktop.curves.readFailed"));
  const power = usePowerDraft(bridge);
  const remapStaged = !inProfile && remap.dirty;
  const curvesStaged = !inProfile && curves.dirty;
  const staged = remapStaged || curvesStaged || calibration.dirty || power.dirty;
  const saveStaged = useCallback(async () => {
    let ok = true;
    // loop: SERIAL-REQUIRED — the board's vendor interface is one session: one write after another
    for (const [on, part] of [
      [remapStaged, remap.apply],
      [curvesStaged, curves.save],
      [calibration.dirty, calibration.save],
      [power.dirty, power.save],
    ] as const) {
      if (on && !(await part())) ok = false;
    }
    return ok;
  }, [remapStaged, remap.apply, curvesStaged, curves.save, calibration.dirty, calibration.save, power.dirty, power.save]);
  const revertStaged = useCallback(() => {
    if (!inProfile) {
      remap.revert();
      curves.revert();
    }
    calibration.revert();
    power.revert();
  }, [inProfile, remap, curves, calibration, power]);
  return useMemo(() => ({ remap, calibration, curves, power, inProfile, staged, saveStaged, revertStaged }), [remap, calibration, curves, power, inProfile, staged, saveStaged, revertStaged]);
}

export const BoardDraftsContext = createContext<BoardDrafts | null>(null);

// The drafts for a subtree that isn't under DesktopApp (tests, previews): the same state, its own copy.
export function BoardDraftsProvider({
  bridge,
  inProfile = false,
  appliedStamp = null,
  children,
}: {
  bridge: UseDs5BridgeResult;
  inProfile?: boolean;
  appliedStamp?: string | null;
  children?: ReactNode;
}) {
  const drafts = useBoardDraftsState(bridge, { inProfile, appliedStamp });
  return createElement(BoardDraftsContext.Provider, { value: drafts }, children);
}

export function useBoardDrafts(): BoardDrafts {
  const drafts = useContext(BoardDraftsContext);
  if (!drafts) throw new Error("useBoardDrafts outside BoardDraftsContext (DesktopApp provides it)");
  return drafts;
}
