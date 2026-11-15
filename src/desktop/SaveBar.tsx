// The one save bar (IA audit Q1, page rule 4), at the bottom of the pages
// whose settings it saves (saveBar.ts: the Controller and Pico 2 W pages).
// Every board setting is kept here, nowhere else: the config body (applied
// live, saved to flash) and the staged writes (buttons, stick curves,
// calibration, PC sleep: boardDrafts.tsx). Revert puts all of them back;
// Save writes the staged ones, then saves the config to flash.
//
// While a game's profile is on, the bar saves to that profile instead
// (Save to profile: the profile's settings, buttons and curves); what belongs
// to the board (calibration, the board-wide settings) waits until the profile
// ends, as their sections say.
//
// Keys and mouse (protocol 1.24, config byte 53) have no switch: Save turns
// them on when a layout that runs on the board sends keys or moves the mouse
// (keysMouseWanted), off when none does, and when that changes what's saved
// it reconnects the board's USB (0xF6 0x03), since the board adds or drops
// its keyboard + mouse interface only at a USB connect, and says so.
import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../hooks/useDs5Bridge";
import { BusyButton } from "./controls";
import type { GameProfileState } from "./library/useGameProfile";
import { profileTarget, useLibrary } from "./library/libraryContext";
import { profileCaps } from "./library/profileDongle";
import type { BoardDrafts } from "./live/boardDrafts";
import { keysMouseWanted } from "./live/layoutEditor";
import { supportsKeysMouse } from "../protocol/bridgeClient";
import { announce, showToast } from "./toast";
import { showError } from "./shownError";

export type MainView = "controller" | "games" | "app" | "about";

// Where the bar shows: only on the pages whose settings it saves, the
// Controller page and the Pico 2 W page (both are the controller view). App
// settings (this PC's settings, saved as you change them), Games and About
// save nothing to the board, so they have no bar.
export const showsSaveBar = (main: MainView): boolean => main === "controller";

interface Props {
  bridge: UseDs5BridgeResult;
  profiles: Pick<GameProfileState, "active" | "editing" | "profileDirty" | "revertToProfile" | "saveToProfile">;
  drafts: BoardDrafts;
  barRef?: Ref<HTMLElement>;
}

export default function SaveBar({ bridge, profiles, drafts, barRef }: Props) {
  const { t } = useTranslation();
  const { library } = useLibrary();
  const busy = bridge.operation !== null;
  if (profiles.active)
    return (
      <footer className="dk-bar" ref={barRef}>
        <span className="dk-bar-note">
          <b>{t("desktop.bar.profileActive", { title: profiles.active.title })}</b> · {profiles.profileDirty ? t("desktop.bar.profileUnsaved") : t("desktop.bar.profileSaved")}
        </span>
        <span className="dk-spacer" />
        <BusyButton className="dk-btn" disabled={busy || !profiles.profileDirty} onClick={profiles.revertToProfile}>
          {t("desktop.bar.revert", "Revert")}
        </BusyButton>
        <BusyButton className="dk-btn primary" disabled={busy || !profiles.profileDirty || bridge.isDirty} onClick={profiles.saveToProfile}>
          {/* Named: it saves into the profile being edited, which needn't be the active one. */}
          {t("desktop.bar.saveProfileTo", { title: (profileTarget(profiles.editing, profiles.active) ?? profiles.active).title })}
        </BusyButton>
      </footer>
    );
  const unsaved = bridge.hasUnsavedChanges || drafts.staged;
  const save = async () => {
    const staged = drafts.staged ? await drafts.saveStaged() : true;
    // error: SHOWN — desktop.errors.saveFailed (what wasn't saved is also said in its own section)
    if (!staged) showError("desktop.errors.saveFailed");
    // The layouts as Save leaves them on the board (only once they were read on this connection).
    const tn = drafts.tension;
    const keys = staged && supportsKeysMouse(bridge.identity) && tn.buttons && tn.loaded && !tn.readOnly ? keysMouseWanted(tn.sets, library, profileCaps(bridge.identity).forNow) : null;
    const patch = keys !== null && keys !== bridge.config?.keysMouse ? { keysMouse: keys } : undefined;
    const config = bridge.hasUnsavedChanges || patch ? await bridge.saveToFlash(patch) : true;
    if (config && keys !== null && bridge.savedConfig && keys !== bridge.savedConfig.keysMouse) {
      // error: SHOWN — the board's keyed USB errors (causeText) in the app's error notice (bridge.error), and Button assignments' warn.reconnect with Reconnect USB
      if (await bridge.reconnectUsb()) showToast(keys ? "desktop.bar.keysOn" : "desktop.bar.keysOff");
      return;
    }
    if (staged && config) announce("desktop.bar.saved", "app_saved");
  };
  const revert = async () => {
    drafts.revertStaged();
    if (bridge.canRevert) await bridge.revertToSaved();
  };
  return (
    <footer className="dk-bar" ref={barRef}>
      <span className="dk-bar-note">
        {busy
          ? t(`statusText.${bridge.operation}`)
          : drafts.staged
            ? t("desktop.bar.staged")
            : bridge.hasUnsavedChanges
              ? t("desktop.bar.unsaved", "Applied to {{device}}, not saved yet: changes are lost when it powers off.")
              : t("desktop.bar.saved", "All changes saved on {{device}}.")}
      </span>
      <span className="dk-spacer" />
      <BusyButton className="dk-btn" disabled={busy || !(bridge.canRevert || drafts.staged)} onClick={revert}>
        {t("desktop.bar.revert", "Revert")}
      </BusyButton>
      <BusyButton className="dk-btn primary" disabled={busy || !unsaved || bridge.isDirty} onClick={save}>
        {t("desktop.bar.save", "Save to {{device}}")}
      </BusyButton>
    </footer>
  );
}
