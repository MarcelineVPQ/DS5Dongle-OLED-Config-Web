// Types for tools/inspect_fuse.mjs (for tests/security/electron.test.ts).
export function builtDevTools(projectDir: string): boolean;
export default function afterPack(
  context: {
    electronPlatformName: string;
    arch: number;
    packager: { projectDir: string; addElectronFuses(context: unknown, fuses: Record<string, unknown>): Promise<number> };
  },
  devTools?: (projectDir: string) => boolean,
): Promise<void>;
