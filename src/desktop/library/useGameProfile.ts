// Per-game profiles: when a game with a profile is running, its settings go
// onto the dongle (RAM only, never flash), and the player's normal values come
// back when it closes. The values a profile replaces are kept on disk first
// (the restore point), so a crash or a quit mid-game restores them on the next
// start. Only the renderer talks to the dongle, so this lives here, at the app
// level (the Games tab doesn't have to be open).
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { causeText, shown } from "../shownError";
import { normalizeConfig } from "../../protocol/config";
import { EMPTY_LIBRARY, type LibraryFile, type ProfileSettings } from "../games/library";
import { profileTarget } from "./libraryContext";
import { applyGameProfile, gamePartsOf, ProfileNotApplied, profileCaps, putGameParts, restoreNormal } from "./profileDongle";
import { captureProfile, layoutForButtons, profileConfig, profileCurves, profileToSave, profileUnsaved, sameGameCurves, settingsFrom, withSettings, type GameCurves } from "./profileValues";
import { KeyedError, logged } from "../../errorText";

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

// error: NOT-WORTH — \`failed\` is an input (the step that failed, so it isn't retried in a loop); the failure itself is shown where it happens
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
  // Saves into the profile being edited (else the active one); false when
  // nothing was saved, with the reason in `error`.
  saveToProfile: () => Promise<boolean>;
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
  // A profile that didn't go on or wasn't saved (shown as a notice).
  // error: SHOWN — desktop.profile.applyFailed (DesktopApp's ErrorNotice; also partlyOn / restoreFailed / saveFailed / notOn)
  error: string | null;
  clearError: () => void;
  startEditing: (gameKey: string, title: string) => void;
  stopEditing: () => void;
}

export interface ButtonsDraft {
  table: number[];
  extra?: number[]; // the Edge's Fn buttons and paddles (protocol 1.9)
  revert: () => void;
}

export function useGameProfile(bridge: UseDs5BridgeResult, paused: boolean): GameProfileState {
  const { t } = useTranslation();
  const desktop = window.desktop;
  const [error, setError] = useState<string | null>(null);
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
  // A profile step that comes up meanwhile is decided again after it (with
  // what's wanted then); a slot switch waits its turn.
  const switching = useRef<Promise<void> | null>(null);
  const missed = useRef(false);
  const [retry, setRetry] = useState(0);
  const switchOnce = useCallback(async (task: () => Promise<void>, wait = false) => {
    // loop: SERIAL-REQUIRED — one profile switch at a time: one HID session, protocol order
    while (switching.current) {
      if (!wait) {
        missed.current = true;
        return;
      }
      await switching.current;
    }
    const run = task();
    // error: NOT-WORTH — the wait's own copy; \`run\` is awaited below with its error
    switching.current = run.catch(() => undefined);
    try {
      await run;
    } finally {
      switching.current = null;
      if (missed.current) {
        missed.current = false;
        setRetry((n) => n + 1);
      }
    }
  }, []);
  // The normal settings while a game's config is (or may be) in the dongle's
  // RAM: the dongle saves its config on a slot switch, so they go back first.
  const profileInRam = useRef<ProfileSettings | null>(null);

  // lifetime: OK — cleanup unsubscribes onRunningGame (unmount)
  useEffect(() => {
    if (!desktop) return;
    desktop
      .libraryGet()
      .then((f) => {
        // A restore point left from before (a crash or quit mid-game): a game's config may still be on.
        profileInRam.current = f.restore?.settings ?? null;
        setLibrary(f);
        setLoaded(true);
      })
      .catch(shown("desktop.errors.libraryRead"));
    // error: NOT-WORTH — unknown reads as "no game running"; onRunningGame corrects it within one watcher pass (2-3 s)
    void desktop.gamesRunning().then(
      (key) => {
        setRunning(key);
        setRunningKnown(true);
      },
      () => setRunningKnown(true),
    );
    // lifetime: OK — the effect returns its unsubscribe
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
  // lifetime: OK — acquires nothing (resets refs)
  useEffect(() => {
    if (!isConnected) appliedFor.current = null;
    failed.current = null;
  }, [isConnected, wanted]);

  // lifetime: OK — acquires nothing (queues one profile switch; switchOnce serializes them)
  useEffect(() => {
    if (!desktop || !loaded || !runningKnown || !isConnected || !config || operation || paused) return;
    const step = decideProfileStep({ running: wanted, library, appliedFor: appliedFor.current, failed: failed.current, active: !!active });
    if (step.kind === "clear-active") setActive(null);
    const capsNow = { layouts, edgeExtras, curves: curvesSupported, slot };
    if (step.kind === "apply") {
      switchOnce(async () => {
        try {
          let file = library;
          // The normal values: kept before the first profile goes on, and
          // under every profile after it (so a setting this game leaves out
          // is the normal one, not the previous game's).
          const normal = step.restorePoint === "new" || !library.restore ? settingsFrom(config) : library.restore.settings;
          if (step.restorePoint === "new") file = await desktop.librarySetRestore({ gameKey: step.gameKey, settings: normal });
          else if (step.restorePoint === "rekey" && library.restore) file = await desktop.librarySetRestore({ ...library.restore, gameKey: step.gameKey });
          setLibrary(file);
          profileInRam.current = normal;
          await applyGameProfile({ client, caps: capsNow, applyConfig: applyBody, config, normal, profile: step.settings, parts: gamePartsOf(library, step.settings) });
          appliedFor.current = step.stamp;
          setAppliedStamp(step.stamp);
          setActive({ gameKey: step.gameKey, title: step.title });
        } catch (cause) {
          // error: SHOWN — desktop.profile.applyFailed (or partlyOn)
          failed.current = step.stamp;
          console.error("Game profile not applied", cause);
          // Before anything went to the dongle (the restore point wasn't saved): the normal
          // settings are still on (was SILENT-BUG: only logged).
          if (!(cause instanceof ProfileNotApplied)) return setError(t("desktop.profile.applyFailed", { title: step.title, reason: causeText(cause) }));
          appliedFor.current = null;
          if (cause.left === "normal") {
            // The normal values are back on: the normal mode (and its Save to dongle) is right.
            profileInRam.current = null;
            setAppliedStamp(null);
            setActive(null);
          } else {
            // The game's config may still be on: the profile mode stays (its parts missing), so
            // Save to dongle can't write it to flash; tried again on a reconnect or a new version.
            setAppliedStamp(step.stamp);
            setActive({ gameKey: step.gameKey, title: step.title });
          }
          setError(t(cause.left === "normal" ? "desktop.profile.applyFailed" : "desktop.profile.partlyOn", { title: step.title, reason: causeText(cause) }));
        }
      }).catch(logged("switchOnce's apply task (it shows its own errors)"));
    }
    // No profile running (the game closed, editing is done, or the app
    // started after a crash mid-game): put the normal values back.
    if (step.kind === "restore") {
      switchOnce(async () => {
        try {
          await restoreNormal({ client, caps: capsNow, applyConfig: applyBody, config, normal: step.settings });
          profileInRam.current = null;
          setLibrary(await desktop.librarySetRestore(null));
          appliedFor.current = null;
          setAppliedStamp(null);
          setActive(null);
        } catch (cause) {
          // error: SHOWN — desktop.profile.restoreFailed (was SILENT-BUG: only logged; the game's settings stayed on with no word)
          failed.current = "restore";
          console.error("Normal settings not restored", cause);
          setError(t("desktop.profile.restoreFailed", { reason: causeText(cause) }));
        }
      }).catch(logged("switchOnce's restore task (it shows its own errors)"));
    }
    // A game's layout still on the dongle with no game running (the app was
    // closed mid-game and the restore point is gone): back to the saved one.
    if (step.kind === "none" && !restoreNeeded(wanted, library) && gameTemporary && !active && client)
      switchOnce(() => putGameParts(client, capsNow, null)).catch(logged("taking a game's layout off with no game running (busy or gone: tried again on the next change or reconnect)"));
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
    retry,
    t,
  ]);

  const profile = active ? library.games[active.gameKey]?.profile : undefined;
  // The normal settings under the active profile (its restore point).
  const normal = library.restore?.settings ?? null;
  // Drafts kept for a profile until it's saved (or another profile goes on).
  const [curvesDraft, setCurvesDraft] = useState<GameCurves | null>(null);
  const [buttonsDraft, setButtonsDraft] = useState<ButtonsDraft | null>(null);
  const storedCurves = profileCurves(profile?.settings);
  // A new version of the profile's curves (saved here or on the game page), or another profile: start from it.
  const curvesKey = JSON.stringify([profileTarget(editing, active)?.gameKey ?? null, storedCurves]);
  const [curvesFor, setCurvesFor] = useState(curvesKey);
  if (curvesFor !== curvesKey) {
    setCurvesFor(curvesKey);
    setCurvesDraft(null);
  }
  const curvesDirty = !!curvesDraft && !sameGameCurves(curvesDraft, storedCurves);
  const profileDirty = !!(active && profile && config && profileUnsaved({ config, normal, profile: profile.settings, curvesDraft, buttonsChanged: !!buttonsDraft }));

  const saveToProfile = useCallback(async (): Promise<boolean> => {
    const target = profileTarget(editing, active);
    if (!desktop || !target || !config) return false;
    // What's on the dongle is saved: only into that profile, never another game's.
    if (target.gameKey !== active?.gameKey) {
      setError(t("desktop.profile.notOn", { title: target.title }));
      return false;
    }
    let file: LibraryFile | null = null;
    try {
      const stored = library.games[target.gameKey]?.profile?.settings;
      // The buttons go into this game's layout (a new one named after it if it has none).
      const layout = buttonsDraft ? layoutForButtons(stored, library.layouts, target.title, `l-${Date.now().toString(36)}`) : null;
      // What differs from the normal settings becomes this game's; the layout and curves stay unless edited here.
      const settings = profileToSave(captureProfile(config, normal, stored), { curves: curvesDirty ? curvesDraft : null, buttonLayout: layout?.id });
      file = await desktop.librarySetProfile({ gameKey: target.gameKey, title: target.title, settings });
      // The layout after the profile, so a profile that didn't save leaves no layout behind.
      if (layout && buttonsDraft) file = await desktop.librarySetLayout({ id: layout.id, name: layout.name, table: buttonsDraft.table, ...(buttonsDraft.extra ? { extra: buttonsDraft.extra } : {}) });
      // Settings only: already on the dongle, so don't re-apply the version just
      // saved. New buttons or curves are put on by re-applying it.
      if (!layout && !curvesDirty) {
        const updated = file.games[target.gameKey]?.profile?.updated;
        const layoutId = file.games[target.gameKey]?.profile?.settings.buttonLayout;
        const saved = layoutId ? file.layouts?.[layoutId] : undefined;
        appliedFor.current = `${target.gameKey}@${updated}${saved ? `+${layoutId}@${saved.updated}` : ""}`;
      }
      setCurvesDraft(null);
      setLibrary(file);
      setError(null);
      return true;
    } catch (cause) {
      // error: SHOWN — desktop.profile.saveFailed
      if (file) setLibrary(file); // the profile saved, its layout didn't
      setError(t("desktop.profile.saveFailed", { title: target.title, reason: causeText(cause) }));
      return false;
    }
  }, [desktop, editing, active, config, library, normal, buttonsDraft, curvesDirty, curvesDraft, t]);

  const revertToProfile = useCallback(async () => {
    if (!active || !profile || !config) return;
    setCurvesDraft(null);
    buttonsDraft?.revert();
    await applyBody(normal ? profileConfig(config, normal, profile.settings) : config);
  }, [active, profile, config, applyBody, normal, buttonsDraft]);

  // Waits for a profile going on or off first: mid-apply, the game's config
  // could otherwise be in RAM when the dongle saves it.
  const switchSlot = useCallback(
    async (slot: number) => {
      if (!client) return;
      await switchOnce(async () => {
        try {
          const normalNow = profileInRam.current;
          if (normalNow) {
            const now = normalizeConfig(await client.readConfig());
            if (!(await applyBody(withSettings(now, normalNow)))) throw new KeyedError("desktop.errors.board.normalNotRestored");
            profileInRam.current = null; // the profile follows again after
          }
          await client.switchSlot(slot);
        } finally {
          appliedFor.current = null;
          setAppliedStamp(null);
        }
      }, true);
    },
    [client, applyBody, switchOnce],
  );

  const clearError = useCallback(() => setError(null), []);
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
    error,
    clearError,
    startEditing,
    stopEditing,
  };
}
