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

const same = (a: ProfileSettings, b: ProfileSettings) => PROFILE_FIELDS.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
const withSettings = (c: ConfigBody, s: ProfileSettings): ConfigBody => ({ ...c, ...s }) as ConfigBody; // ranges checked by ProfileSettingsSchema

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
    void desktop.gamesRunning().then(setRunning, () => undefined);
    return desktop.onRunningGame(setRunning);
  }, [desktop]);

  const { isConnected, config, operation, applyBody } = bridge;
  // A reconnect (dongle reboot, USB replug) loads its flash settings again.
  useEffect(() => {
    if (!isConnected) appliedFor.current = null;
  }, [isConnected]);

  useEffect(() => {
    if (!desktop || !loaded || !isConnected || !config || operation || paused) return;
    const record = running ? library.games[running] : undefined;
    const profile = record?.profile;
    const restore = library.restore;
    const stamp = profile ? `${running}@${profile.updated}` : null;

    // The profile's game is running: apply it (once per profile version).
    if (running && profile && record) {
      if (appliedFor.current === stamp) return;
      void switchOnce(async () => {
        // Keep the player's normal values first, unless a restore point is
        // already there (switching from another game, or the app restarted
        // mid-game): that one still holds the normal values.
        let file = library;
        if (!restore) file = await desktop.librarySetRestore({ gameKey: running, settings: settingsFrom(config) });
        else if (restore.gameKey !== running) file = await desktop.librarySetRestore({ ...restore, gameKey: running });
        setLibrary(file);
        if (await applyBody(withSettings(config, profile.settings))) {
          appliedFor.current = stamp;
          setActive({ gameKey: running, title: record.title });
        }
      });
      return;
    }

    // No profile running (the game closed, or the app started after a crash
    // mid-game): put the normal values back.
    if (restore) {
      void switchOnce(async () => {
        if (await applyBody(withSettings(config, restore.settings))) {
          setLibrary(await desktop.librarySetRestore(null));
          appliedFor.current = null;
          setActive(null);
        }
      });
    } else if (active) setActive(null);
  }, [desktop, loaded, isConnected, config, operation, paused, running, library, applyBody, active, switchOnce]);

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
