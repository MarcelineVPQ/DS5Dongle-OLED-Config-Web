// Whether the user lets the app read their game launchers (the gamesScanAllowed
// setting). Games' first-visit card turns it on; App settings → Privacy turns it
// on or off. Every part of the window that shows it hears a change at once.
export const GAMES_ALLOWED_EVENT = "ds5:games-allowed";

export function setGamesAllowed(value: boolean): Promise<unknown> {
  window.dispatchEvent(new CustomEvent<boolean>(GAMES_ALLOWED_EVENT, { detail: value }));
  return window.desktop?.setSetting("gamesScanAllowed", value) ?? Promise.resolve();
}

export function onGamesAllowed(listener: (value: boolean) => void): () => void {
  const handle = (e: Event) => listener((e as CustomEvent<boolean>).detail);
  window.addEventListener(GAMES_ALLOWED_EVENT, handle);
  return () => window.removeEventListener(GAMES_ALLOWED_EVENT, handle);
}
