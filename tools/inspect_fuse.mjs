// electron-builder's afterPack hook (electron-builder.yml): the one Electron
// fuse that depends on the build, EnableNodeCliInspectArguments (--inspect,
// --inspect-brk, and the main-process inspector SIGUSR1 starts).
//
// 2026-10-31 app review S1, the owner's choice (b): a released build ignores
// them; a dev-tools build keeps them, because the test tools drive those
// builds' main process through --inspect (mac-smoke builds with
// DS5_DEV_TOOLS=1; tools/budgets_vm.ps1 and tools/sleep_wake_vm.mjs run an
// installed X.Y.Z-dev.N build). A dev-tools build is the same rule as
// electron.vite.config.ts's DEV_TOOLS: DS5_DEV_TOOLS=1 or an X.Y.Z-dev.N
// version. The unpackaged dev copy (node_modules/electron, tools/isolated.sh,
// tools/check_tray_kwin.sh) has no fuses flipped at all.
//
// The other fuses are in electron-builder.yml (electronFuses, which leaves this
// one out so it doesn't undo this); electron-builder flips them right after
// this hook and then resets the Mac build's ad-hoc signature.
//
// @electron/fuses' values written out (it's only the packager's dependency, not
// ours, so importing it would depend on npm's hoisting; 2026-11-01 re-review
// N1): FuseVersion.V1 is "1" and FuseV1Options.EnableNodeCliInspectArguments
// is 3 (@electron/fuses 1.8.0, dist/config.js).
const FUSE_VERSION_V1 = "1";
const ENABLE_NODE_CLI_INSPECT_ARGUMENTS = 3;

export const devToolsBuild = (version, env = process.env) => env.DS5_DEV_TOOLS === "1" || /-dev\.\d+$/.test(version);

// builder-util's Arch.universal. A universal Mac build packs an x64 and an
// arm64 temp app first (with its own fuses off) and merges them; flipping
// (and re-signing) those would make the two differ beyond their binaries,
// which the merge refuses (2026-11-01 app re-review S1). The hook runs again
// on the merged app, and that one gets the fuse.
const UNIVERSAL = 4;

export default async function afterPack(context) {
  if (context.electronPlatformName === "darwin" && context.arch !== UNIVERSAL) return;
  const inspect = devToolsBuild(context.packager.appInfo.version);
  console.log(`  • inspect fuse: ${inspect ? "on (dev-tools build)" : "off (release build)"}`);
  await context.packager.addElectronFuses(context, {
    version: FUSE_VERSION_V1,
    resetAdHocDarwinSignature: context.electronPlatformName === "darwin",
    [ENABLE_NODE_CLI_INSPECT_ARGUMENTS]: inspect,
  });
}
