// Per-game profiles: when a game with a profile is running, its settings go
// onto the dongle (RAM only, never flash), and the player's normal values come
// back when it closes. The values a profile replaces are kept on disk first
// (the restore point), so a crash or a quit mid-game restores them on the next
// start. Only the renderer talks to the dongle, so this lives here, at the app
// level (the Games tab doesn't have to be open).
import { useCallback, useEffect, useRef, useState } from "react";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { EMPTY_LIBRARY, type LibraryFile, type ProfileSettings } from "../games/library";
import { applyGameProfile, gamePartsOf, profileCaps, putGameParts, restoreNormal } from "./profileDongle";
import { captureProfile, layoutForButtons, profileConfig, profileCurves, profileDiffers, profileToSave, sameGameCurves, settingsFrom, withSettings, type GameCurves } from "./profileValues";

export { nonConfigParts, settingsFrom } from "./profileValues";

// What the profile hook should do now (pure, so the switch/restore rules are
// unit-tested): apply the running game's profile (keeping the normal values
// as a restore point first), put the normal values back, or nothing. A step
// that failed isn't retried until something changes (`failed`).
export type ProfileStep =
  | { kind: "apply"; gameKey: string; title: string; settings: ProfileSettings; stamp: string; restorePoint: "keep" | "new" | "rekey" }
  | { kind: "restore"; settings: ProfileSettings }
  | { kind: "clear-active" }
  | { kind: "none" };

export function decideProfileStep(s: { running: string | null; library: LibraryFile; appliedFor: string | null; failed: string | null; active: boolean }): ProfileStep {
  const record = s.running ? s.library.games[s.running] : undefined;
  const profile = record?.profile;
  const restore = s.library.restore;
  if (s.running && record && profile) {
    // A layout edited while its game runs is applied again (its own stamp).
    const layout = profile.settings.buttonLayout ? s.library.layouts?.[profile.settings.buttonLayout] : undefined;
    const stamp = `${s.running}@${profile.updated}${layout ? `+${profile.settings.buttonLayout}@${layout.updated}` : ""}`;
    if (s.appliedFor === stamp || s.failed === stamp) return { kind: "none" };
    // A restore point already there (switching from another game, or the app
    // restarted mid-game) still holds the normal values: keep it.
    const restorePoint = !restore ? "new" : restore.gameKey !== s.running ? "rekey" : "keep";
    return { kind: "apply", gameKey: s.running, title: record.title, settings: profile.settings, stamp, restorePoint };
  }
  if (restore) return s.failed === "restore" ? { kind: "none" } : { kind: "restore", settings: restore.settings };
  return s.active ? { kind: "clear-active" } : { kind: "none" };
}

// A game with a profile runs, or a restore point waits: the steps above handle the layout then.
const restoreNeeded = (running: string | null, library: LibraryFile) => !!library.restore || !!(running && library.games[running]?.profile);

export interface GameProfileState {
  library: LibraryFile;
  setLibrary: (file: LibraryFile) => void;
  running: string | null;
  // The game whose profile is on the dongle right now.
  active: { gameKey: string; title: string } | null;
  // Something edited in the live view while the profile is active isn't in
  // the stored profile yet: the dongle's settings, the buttons or the curves.
  profileDirty: boolean;
  // The stick curves picked for this game, not saved yet (null: the stored ones).
  curvesDraft: GameCurves | null;
  setCurvesDraft: (curves: GameCurves | null) => void;
  // The Buttons list's changes while a profile is on (null: none), so
  // "Save to profile" saves them into the game's layout too.
  setButtonsDraft: (draft: ButtonsDraft | null) => void;
  saveToProfile: () => Promise<void>;
  revertToProfile: () => Promise<void>;
  // Editing a game's profile on purpose (game page → "Edit in controller
  // view"): it goes onto the dongle as if the game were running, so every
  // panel edits it and it can be felt; Done brings the normal settings back.
  editing: { gameKey: string; title: string } | null;
  // Changes whenever a profile (or a new version of it) goes on or comes off.
  appliedStamp: string | null;
  // Switch pairing slots without saving a profile into flash: the dongle
  // saves its settings on a slot switch, so the normal ones go back on
  // first and the profile follows again after.
  switchSlot: (slot: number) => Promise<void>;
  startEditing: (gameKey: string, title: string) => void;
  stopEditing: () => void;
}

export interface ButtonsDraft {
  table: number[];
  extra?: number[]; // the Edge's Fn buttons and paddles (protocol 1.9)
  revert: () => void;
}

export function useGameProfile(bridge: UseDs5BridgeResult, paused: boolean): GameProfileState {
  const desktop = window.desktop;
  const [library, setLibrary] = useState<LibraryFile>(EMPTY_LIBRARY);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  // Whether the running game is known yet (so a restore point isn't undone at
  // startup before we learn the game is still running).
  const [runningKnown, setRunningKnown] = useState(false);
  const [active, setActive] = useState<{ gameKey: string; title: string } | null>(null);
  const [editing, setEditing] = useState<{ gameKey: string; title: string } | null>(null);
  // The game whose profile should be on the dongle: the one being edited,
  // else the one running.
  const wanted = editing?.gameKey ?? running;
  // What this app last put on the dongle for the active profile, so a profile
  // edited on its game page is re-applied (and only then).
  const appliedFor = useRef<string | null>(null);
  // The same, for views that read the dongle again when a profile goes on.
  const [appliedStamp, setAppliedStamp] = useState<string | null>(null);
  // One switch at a time (the library updates mid-switch re-run the effect).
  const switching = useRef(false);
  const switchOnce = useCallback(async (task: () => Promise<void>) => {
    if (switching.current) return;
    switching.current = true;
    try {
      await task();
    } finally {
      switching.current = false;
    }
  }, []);

  useEffect(() => {
    if (!desktop) return;
    void desktop.libraryGet().then((f) => {
      setLibrary(f);
      setLoaded(true);
    });
    void desktop.gamesRunning().then(
      (key) => {
        setRunning(key);
        setRunningKnown(true);
      },
      () => setRunningKnown(true),
    );
    return desktop.onRunningGame((key) => {
      setRunning(key);
      setRunningKnown(true);
    });
  }, [desktop]);

  const { isConnected, config, operation, applyBody, client, identity } = bridge;
  const caps = profileCaps(identity);
  const { layouts, edgeExtras, curves: curvesSupported, slot } = caps;
  // A game's layout or curves (RAM only) are on the dongle now.
  const gameTemporary = !!(identity?.remapTemporary || identity?.curvesTemporary);
  // The step that failed last (an apply stamp, or "restore"), so it isn't
  // retried on every config change; cleared when the game or connection changes.
  const failed = useRef<string | null>(null);
  // A reconnect (dongle reboot, USB replug) loads its flash settings again.
  useEffect(() => {
    if (!isConnected) appliedFor.current = null;
    failed.current = null;
  }, [isConnected, wanted]);

  useEffect(() => {
    if (!desktop || !loaded || !runningKnown || !isConnected || !config || operation || paused) return;
    const step = decideProfileStep({ running: wanted, library, appliedFor: appliedFor.current, failed: failed.current, active: !!active });
    if (step.kind === "clear-active") setActive(null);
    const capsNow = { layouts, edgeExtras, curves: curvesSupported, slot };
    if (step.kind === "apply") {
      void switchOnce(async () => {
        try {
          let file = library;
          // The normal values: kept before the first profile goes on, and
          // under every profile after it (so a setting this game leaves out
          // is the normal one, not the previous game's).
          const normal = step.restorePoint === "new" || !library.restore ? settingsFrom(config) : library.restore.settings;
          if (step.restorePoint === "new") file = await desktop.librarySetRestore({ gameKey: step.gameKey, settings: normal });
          else if (step.restorePoint === "rekey" && library.restore) file = await desktop.librarySetRestore({ ...library.restore, gameKey: step.gameKey });
          setLibrary(file);
          await applyGameProfile({ client, caps: capsNow, applyConfig: applyBody, config, normal, profile: step.settings, parts: gamePartsOf(library, step.settings) });
          appliedFor.current = step.stamp;
          setAppliedStamp(step.stamp);
          setActive({ gameKey: step.gameKey, title: step.title });
        } catch (cause) {
          failed.current = step.stamp;
          console.error("Game profile not applied", cause);
        }
      });
    }
    // No profile running (the game closed, editing is done, or the app
    // started after a crash mid-game): put the normal values back.
    if (step.kind === "restore") {
      void switchOnce(async () => {
        try {
          await restoreNormal({ client, caps: capsNow, applyConfig: applyBody, config, normal: step.settings });
          setLibrary(await desktop.librarySetRestore(null));
          appliedFor.current = null;
          setAppliedStamp(null);
          setActive(null);
        } catch (cause) {
          failed.current = "restore";
          console.error("Normal settings not restored", cause);
        }
      });
    }
    // A game's layout still on the dongle with no game running (the app was
    // closed mid-game and the restore point is gone): back to the saved one.
    if (step.kind === "none" && !restoreNeeded(wanted, library) && gameTemporary && !active && client) void switchOnce(() => putGameParts(client, capsNow, null).catch(() => undefined));
  }, [
    desktop,
    loaded,
    runningKnown,
    isConnected,
    config,
    operation,
    paused,
    wanted,
    library,
    applyBody,
    active,
    switchOnce,
    client,
    layouts,
    edgeExtras,
    curvesSupported,
    slot,
    gameTemporary,
    appliedStamp,
  ]);

  const profile = active ? library.games[active.gameKey]?.profile : undefined;
  // The normal settings under the active profile (its restore point).
  const normal = library.restore?.settings ?? null;
  // Drafts kept for a profile until it's saved (or another profile goes on).
  const [curvesDraft, setCurvesDraft] = useState<GameCurves | null>(null);
  const [buttonsDraft, setButtonsDraft] = useState<ButtonsDraft | null>(null);
  const storedCurves = profileCurves(profile?.settings);
  // A new version of the profile's curves (saved here or on the game page), or another profile: start from it.
  const curvesKey = JSON.stringify([active?.gameKey ?? editing?.gameKey ?? null, storedCurves]);
  const [curvesFor, setCurvesFor] = useState(curvesKey);
  if (curvesFor !== curvesKey) {
    setCurvesFor(curvesKey);
    setCurvesDraft(null);
  }
  const curvesDirty = !!curvesDraft && !sameGameCurves(curvesDraft, storedCurves);
  const profileDirty = !!(active && profile && config && (profileDiffers(config, normal, profile.settings) || curvesDirty || buttonsDraft));

  const saveToProfile = useCallback(async () => {
    if (!desktop || !active || !config) return;
    const stored = library.games[active.gameKey]?.profile?.settings;
    // The buttons go into this game's layout (a new one named after it if it has none).
    let buttonLayout: string | undefined;
    if (buttonsDraft) {
      const l = layoutForButtons(stored, library.layouts, active.title, `l-${Date.now().toString(36)}`);
      await desktop.librarySetLayout({ id: l.id, name: l.name, table: buttonsDraft.table, ...(buttonsDraft.extra ? { extra: buttonsDraft.extra } : {}) });
      buttonLayout = l.id;
    }
    // What differs from the normal settings becomes this game's; the layout and curves stay unless edited here.
    const settings = profileToSave(captureProfile(config, normal, stored), { curves: curvesDirty ? curvesDraft : null, buttonLayout });
    const file = await desktop.librarySetProfile({ gameKey: active.gameKey, title: active.title, settings });
    // Settings only: already on the dongle, so don't re-apply the version just
    // saved. New buttons or curves are put on by re-applying it.
    if (!buttonLayout && !curvesDirty) {
      const updated = file.games[active.gameKey]?.profile?.updated;
      const layoutId = file.games[active.gameKey]?.profile?.settings.buttonLayout;
      const layout = layoutId ? file.layouts?.[layoutId] : undefined;
      appliedFor.current = `${active.gameKey}@${updated}${layout ? `+${layoutId}@${layout.updated}` : ""}`;
    }
    setCurvesDraft(null);
    setLibrary(file);
  }, [desktop, active, config, library, normal, buttonsDraft, curvesDirty, curvesDraft]);

  const revertToProfile = useCallback(async () => {
    if (!active || !profile || !config) return;
    setCurvesDraft(null);
    buttonsDraft?.revert();
    await applyBody(normal ? profileConfig(config, normal, profile.settings) : config);
  }, [active, profile, config, applyBody, normal, buttonsDraft]);

  const switchSlot = useCallback(
    async (slot: number) => {
      if (!client) return;
      if (!active || !normal || !config) return client.switchSlot(slot);
      switching.current = true; // the profile goes on again after, not in between
      try {
        if (!(await applyBody(withSettings(config, normal)))) throw new Error("Normal settings not restored before the slot switch");
        await client.switchSlot(slot);
      } finally {
        switching.current = false;
        appliedFor.current = null;
        setAppliedStamp(null);
      }
    },
    [client, active, normal, config, applyBody],
  );

  const startEditing = useCallback((gameKey: string, title: string) => setEditing({ gameKey, title }), []);
  const stopEditing = useCallback(() => setEditing(null), []);

  return {
    library,
    setLibrary,
    running,
    active,
    profileDirty,
    curvesDraft,
    setCurvesDraft,
    setButtonsDraft,
    saveToProfile,
    revertToProfile,
    editing,
    appliedStamp,
    switchSlot,
    startEditing,
    stopEditing,
  };
}
