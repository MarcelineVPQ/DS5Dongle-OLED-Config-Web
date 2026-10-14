// Whether the user lets the app read their game launchers (the gamesScanAllowed
// setting). Games' first-visit card turns it on; App settings → Privacy turns it
// on or off. Every part of the window that shows it hears a change at once.
export const GAMES_ALLOWED_EVENT = "ds5:games-allowed";

// Every part of the window hears the change once it's saved; a save that
// fails rejects and changes nothing, and the caller shows
// desktop.errors.settingNotSaved (the error pass: the window used to change
// while the setting stayed as it was).
export function setGamesAllowed(value: boolean): Promise<void> {
  // error: PASSES-ON — returned below; each caller shows desktop.errors.settingNotSaved
  const save = window.desktop?.setSetting("gamesScanAllowed", value) ?? Promise.resolve();
  return save.then(() => void window.dispatchEvent(new CustomEvent<boolean>(GAMES_ALLOWED_EVENT, { detail: value })));
}

export function onGamesAllowed(listener: (value: boolean) => void): () => void {
  const handle = (e: Event) => listener((e as CustomEvent<boolean>).detail);
  // lifetime: OK — the returned remover calls removeEventListener (callers' effect cleanups)
  window.addEventListener(GAMES_ALLOWED_EVENT, handle);
  return () => window.removeEventListener(GAMES_ALLOWED_EVENT, handle);
}
