// The app's version as people see it: the release number, plus, on a local
// dev build, exactly what it was built from ("0.9.3 · dev +3.a1b2c3d"), so a
// dev build never looks like a release. Logic (updates, what's new) uses the
// plain window.desktop.appVersion.
export const BUILD_ID: string = import.meta.env.VITE_BUILD_ID ?? "";

// A development build: a local dev copy (built with a Git build id) or a
// Development-channel release (X.Y.Z-dev.N). The rail says so.
export function isDevelopmentBuild(version?: string): boolean {
  const v = version ?? (typeof window === "undefined" ? undefined : window.desktop?.appVersion);
  return BUILD_ID !== "" || /-dev\.\d+/.test(v ?? "");
}

export function appVersionLabel(version?: string): string {
  const v = version ?? (typeof window === "undefined" ? undefined : window.desktop?.appVersion);
  if (!v) return "";
  return BUILD_ID ? `${v} · dev ${BUILD_ID}` : v;
}
