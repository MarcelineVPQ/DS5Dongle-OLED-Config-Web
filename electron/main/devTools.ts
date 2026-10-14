// The Developer card's main-process side (Fake games) is built into dev builds
// only, like the card itself (electron.vite.config.ts defines VITE_DEV_TOOLS
// for the main process too: DS5_DEV_TOOLS=1 or an X.Y.Z-dev.N version). In a
// stable release this is the constant false, so the bundler drops everything
// behind it: no fake games service, no dev IPC channel, and a devFakeGames
// value left in settings.json from a dev build changes nothing.
export const DEV_TOOLS_BUILT: boolean = import.meta.env.VITE_DEV_TOOLS === "1";
