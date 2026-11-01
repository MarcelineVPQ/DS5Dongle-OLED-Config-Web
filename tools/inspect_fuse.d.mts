// Types for tools/inspect_fuse.mjs (for tests/security/electron.test.ts).
export function devToolsBuild(version: string, env?: Record<string, string | undefined>): boolean;
export default function afterPack(context: {
  electronPlatformName: string;
  packager: { appInfo: { version: string }; addElectronFuses(context: unknown, fuses: Record<string, unknown>): Promise<number> };
}): Promise<void>;
