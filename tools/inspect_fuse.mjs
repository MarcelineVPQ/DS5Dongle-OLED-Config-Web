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
import { FuseV1Options, FuseVersion } from "@electron/fuses";

export const devToolsBuild = (version, env = process.env) => env.DS5_DEV_TOOLS === "1" || /-dev\.\d+$/.test(version);

export default async function afterPack(context) {
  const inspect = devToolsBuild(context.packager.appInfo.version);
  console.log(`  • inspect fuse: ${inspect ? "on (dev-tools build)" : "off (release build)"}`);
  await context.packager.addElectronFuses(context, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: context.electronPlatformName === "darwin",
    [FuseV1Options.EnableNodeCliInspectArguments]: inspect,
  });
}
