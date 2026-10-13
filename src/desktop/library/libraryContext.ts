// The Games library file (layouts, profiles), shared by the profile hook
// (DesktopApp), the Games page and the Buttons page, so a layout saved on the
// Buttons page reaches a running game's profile at once.
import { createContext, useContext } from "react";
import { EMPTY_LIBRARY, type LibraryFile } from "../games/library";
import type { GameCurves } from "./profileValues";
import type { ButtonsDraft } from "./useGameProfile";

export interface LibraryContextValue {
  library: LibraryFile;
  setLibrary: (file: LibraryFile) => void;
  // The game whose profile is on the dongle now (its layout, if any, is too).
  active: { gameKey: string; title: string } | null;
  // Opens the controller view editing this game's profile (game page button).
  editProfile: (gameKey: string, title: string) => void;
  // The game whose profile is being edited in the controller view, if any.
  editing: { gameKey: string; title: string } | null;
  // Changes whenever a profile (or a new version of it) goes on or comes off
  // the dongle, so views showing what's on it read it again.
  appliedStamp: string | null;
  // Switches pairing slots without saving a game's profile into flash.
  switchSlot: (slot: number) => Promise<void>;
  // While a profile is on, the panels with their own drafts (curves, buttons)
  // hand them to the profile, and "Save to profile" saves everything at once.
  curvesDraft: GameCurves | null;
  setCurvesDraft: (curves: GameCurves | null) => void;
  setButtonsDraft: (draft: ButtonsDraft | null) => void;
  // Resolves false when nothing was saved (the reason shows as the profile error).
  saveToProfile: () => Promise<boolean>;
}

export const LibraryContext = createContext<LibraryContextValue>({
  library: EMPTY_LIBRARY,
  setLibrary: () => undefined,
  active: null,
  editProfile: () => undefined,
  editing: null,
  appliedStamp: null,
  switchSlot: async () => undefined,
  curvesDraft: null,
  setCurvesDraft: () => undefined,
  setButtonsDraft: () => undefined,
  saveToProfile: async () => false,
});
export const useLibrary = () => useContext(LibraryContext);

type ProfileGame = { gameKey: string; title: string };
// The profile the controller view works on: the one being edited, else the
// one on the dongle (its game running). One rule for every panel and for
// "Save to profile".
export const profileTarget = (editing: ProfileGame | null, active: ProfileGame | null): ProfileGame | null => editing ?? active;
export function useProfileTarget(): ProfileGame | null {
  const { editing, active } = useLibrary();
  return profileTarget(editing, active);
}
