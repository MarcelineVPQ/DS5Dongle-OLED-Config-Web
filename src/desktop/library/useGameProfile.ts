// Per-game profiles: when a game with a profile is running, its settings go
// onto the dongle (RAM only, never flash), and the player's normal values come
// back when it closes. The values a profile replaces are kept on disk first
// (the restore point), so a crash or a quit mid-game restores them on the next
// start. Only the renderer talks to the dongle, so this lives here, at the app
// level (the Games tab doesn't have to be open).
import { useCallback, useEffect, useRef, useState } from "react";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import type { ConfigBody } from "../../protocol/config";
import { EMPTY_LIBRARY, PROFILE_FIELDS, type LibraryFile, type ProfileSettings } from "../games/library";

export function settingsFrom(c: ConfigBody): ProfileSettings {
  return {
    hapticsGain: c.hapticsGain,
    hapticsGainRight: c.hapticsGainRight,
    autoHapticsEnable: c.autoHapticsEnable,
    autoHapticsGain: c.autoHapticsGain,
    autoHapticsLowpass: c.autoHapticsLowpass,
    speakerVolume: c.speakerVolume,
    lightbarMode: c.lightbarMode,
    lbFavR: [...c.lbFavR],
    lbFavG: [...c.lbFavG],
    lbFavB: [...c.lbFavB],
    btMicEnable: c.btMicEnable,
  };
}

// A profile from before the left/right split has one strength for both grips.
const filled = (s: ProfileSettings): ProfileSettings => ({ ...s, hapticsGainRight: s.hapticsGainRight ?? s.hapticsGain });
const same = (a: ProfileSettings, b: ProfileSettings) => PROFILE_FIELDS.every((k) => JSON.stringify(filled(a)[k]) === JSON.stringify(filled(b)[k]));
const withSettings = (c: ConfigBody, s: ProfileSettings): ConfigBody => ({ ...c, ...filled(s) }) as ConfigBody; // ranges checked by ProfileSettingsSchema

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
    const stamp = `${s.running}@${profile.updated}`;
    if (s.appliedFor === stamp || s.failed === stamp) return { kind: "none" };
    // A restore point already there (switching from another game, or the app
    // restarted mid-game) still holds the normal values: keep it.
    const restorePoint = !restore ? "new" : restore.gameKey !== s.running ? "rekey" : "keep";
    return { kind: "apply", gameKey: s.running, title: record.title, settings: profile.settings, stamp, restorePoint };
  }
  if (restore) return s.failed === "restore" ? { kind: "none" } : { kind: "restore", settings: restore.settings };
  return s.active ? { kind: "clear-active" } : { kind: "none" };
}

export interface GameProfileState {
  library: LibraryFile;
  setLibrary: (file: LibraryFile) => void;
  running: string | null;
  // The game whose profile is on the dongle right now.
  active: { gameKey: string; title: string } | null;
  // The dongle's profile settings differ from the stored profile (edits made
  // in the live view while the profile is active).
  profileDirty: boolean;
  saveToProfile: () => Promise<void>;
  revertToProfile: () => Promise<void>;
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
  // What this app last put on the dongle for the active profile, so a profile
  // edited on its game page is re-applied (and only then).
  const appliedFor = useRef<string | null>(null);
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

  const { isConnected, config, operation, applyBody } = bridge;
  // The step that failed last (an apply stamp, or "restore"), so it isn't
  // retried on every config change; cleared when the game or connection changes.
  const failed = useRef<string | null>(null);
  // A reconnect (dongle reboot, USB replug) loads its flash settings again.
  useEffect(() => {
    if (!isConnected) appliedFor.current = null;
    failed.current = null;
  }, [isConnected, running]);

  useEffect(() => {
    if (!desktop || !loaded || !runningKnown || !isConnected || !config || operation || paused) return;
    const step = decideProfileStep({ running, library, appliedFor: appliedFor.current, failed: failed.current, active: !!active });
    if (step.kind === "clear-active") setActive(null);
    if (step.kind === "apply") {
      void switchOnce(async () => {
        try {
          let file = library;
          if (step.restorePoint === "new") file = await desktop.librarySetRestore({ gameKey: step.gameKey, settings: settingsFrom(config) });
          else if (step.restorePoint === "rekey" && library.restore) file = await desktop.librarySetRestore({ ...library.restore, gameKey: step.gameKey });
          setLibrary(file);
          if (!(await applyBody(withSettings(config, step.settings)))) throw new Error("apply failed");
          appliedFor.current = step.stamp;
          setActive({ gameKey: step.gameKey, title: step.title });
        } catch (cause) {
          failed.current = step.stamp;
          console.error("Game profile not applied", cause);
        }
      });
    }
    // No profile running (the game closed, or the app started after a crash
    // mid-game): put the normal values back.
    if (step.kind === "restore") {
      void switchOnce(async () => {
        try {
          if (!(await applyBody(withSettings(config, step.settings)))) throw new Error("restore failed");
          setLibrary(await desktop.librarySetRestore(null));
          appliedFor.current = null;
          setActive(null);
        } catch (cause) {
          failed.current = "restore";
          console.error("Normal settings not restored", cause);
        }
      });
    }
  }, [desktop, loaded, runningKnown, isConnected, config, operation, paused, running, library, applyBody, active, switchOnce]);

  const profile = active ? library.games[active.gameKey]?.profile : undefined;
  const profileDirty = !!(active && profile && config && !same(settingsFrom(config), profile.settings));

  const saveToProfile = useCallback(async () => {
    if (!desktop || !active || !config) return;
    const file = await desktop.librarySetProfile({ gameKey: active.gameKey, title: active.title, settings: settingsFrom(config) });
    // Already on the dongle: don't re-apply the version just saved.
    const updated = file.games[active.gameKey]?.profile?.updated;
    appliedFor.current = `${active.gameKey}@${updated}`;
    setLibrary(file);
  }, [desktop, active, config]);

  const revertToProfile = useCallback(async () => {
    if (active && profile && config) await applyBody(withSettings(config, profile.settings));
  }, [active, profile, config, applyBody]);

  return { library, setLibrary, running, active, profileDirty, saveToProfile, revertToProfile };
}
