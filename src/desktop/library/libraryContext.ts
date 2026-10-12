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
}

export const LibraryContext = createContext<LibraryContextValue>({ library: EMPTY_LIBRARY, setLibrary: () => undefined, active: null, editProfile: () => undefined, editing: null });
export const useLibrary = () => useContext(LibraryContext);
