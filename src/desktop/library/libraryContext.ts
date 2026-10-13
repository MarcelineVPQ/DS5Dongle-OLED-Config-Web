// The Games library file (layouts, profiles), shared by the profile hook
// (DesktopApp), the Games page and the Buttons page, so a layout saved on the
// Buttons page reaches a running game's profile at once.
import { createContext, useContext } from "react";
import { EMPTY_LIBRARY, type LibraryFile } from "../games/library";

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
}

export const LibraryContext = createContext<LibraryContextValue>({
  library: EMPTY_LIBRARY,
  setLibrary: () => undefined,
  active: null,
  editProfile: () => undefined,
  editing: null,
  appliedStamp: null,
  switchSlot: async () => undefined,
});
export const useLibrary = () => useContext(LibraryContext);
