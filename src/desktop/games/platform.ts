// The Games library runs on Linux and Windows. Proton (how Steam runs Windows
// games on Linux), its fixes and the Linux system checks exist on Linux only.
export const GAMES_PLATFORMS = ["linux", "win32"];
export const gamesSupported = (): boolean => GAMES_PLATFORMS.includes(window.desktop?.platform ?? "");
export const protonApplies = (): boolean => window.desktop?.platform === "linux";
