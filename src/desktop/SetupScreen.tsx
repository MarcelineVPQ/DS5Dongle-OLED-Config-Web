// What the app shows while no dongle is connected. Two paths:
//   - a dongle that's already set up: plug it in, it connects by itself;
//   - a new (or non-dongle) Pico plugged in with BOOTSEL held: the app finds
//     it and, when the user agrees, installs the firmware bundled with the app
//     (no download needed, no files to copy). The Pico then restarts as the
//     dongle. A dongle only appears on USB once a controller is connected (it
//     takes on the controller's identity), so the next step is pairing.
import { useEffect, useState } from "react";
import { errorText } from "../errorText";
import { useTranslation } from "react-i18next";
import type { PicoflashHandle } from "../flash";
import type { LatestFirmware } from "./api";
import { findBootloader, installFirmware, type FirmwareProgress } from "./firmwareUpdate";
import { readPref } from "./storage";
import { BusyButton } from "./controls";
import { shortVersion } from "../update/manifest";
import UsbAccessSetup from "./UsbAccessSetup";
import WindowsUsbRepair from "./WindowsUsbRepair";

const POLL_MS = 1000;

// Set once a dongle has connected on this PC (DesktopApp).
export const HAD_DONGLE_KEY = "ds5.hadDongle";

type Install = { phase: "idle" } | { phase: "running"; progress: FirmwareProgress } | { phase: "restarting"; version: string } | { phase: "failed"; detail: string };

export default function SetupScreen({ supported }: { supported: boolean }) {
  const { t } = useTranslation();
  const [hadDongle] = useState(() => readPref(HAD_DONGLE_KEY) === "1");
  const [pico, setPico] = useState<PicoflashHandle | null>(null);
  const [firmware, setFirmware] = useState<LatestFirmware | null>(null);
  const [install, setInstall] = useState<Install>({ phase: "idle" });

  // Watch for a Pico in BOOTSEL mode (stops while installing).
  const installing = install.phase === "running";
  useEffect(() => {
    if (!supported || installing) return;
    let live = true;
    const tick = () =>
      void findBootloader()
        .then((d) => live && setPico(d))
        .catch(() => undefined);
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [supported, installing]);

  useEffect(() => {
    if (!pico || firmware) return;
    void window.desktop
      ?.latestFirmware()
      .then((r) => setFirmware(r.latest))
      .catch(() => undefined);
  }, [pico, firmware]);

  const start = async () => {
    if (!pico) return;
    try {
      const version = await installFirmware(pico, (progress) => setInstall({ phase: "running", progress }));
      setInstall({ phase: "restarting", version });
    } catch (cause) {
      setInstall({ phase: "failed", detail: errorText(cause) });
    }
  };

  if (install.phase === "running") {
    const p = install.progress;
    return (
      <Center>
        <strong>{t("desktop.setup.installing", "Installing the firmware…")}</strong>
        {p.step === "flashing" && <progress className="dk-progress" max={1} value={p.fraction ?? 0} />}
        <span className="dk-hint">{t("desktop.setup.keepPlugged", "Keep the Pico plugged in.")}</span>
      </Center>
    );
  }

  // A Pico back in BOOTSEL (the user retried, or a different one) ends the
  // wait: offer to set it up again.
  if (install.phase === "restarting" && !pico) {
    return (
      <Center>
        <strong>{t("desktop.setup.restarting", { version: install.version })}</strong>
        <span>{t("desktop.setup.restartingHint")}</span>
      </Center>
    );
  }

  if (pico) {
    return (
      <Center>
        <strong>{t("desktop.setup.found", "A Pico is ready to set up")}</strong>
        <span>
          {firmware
            ? t(firmware.source === "bundled" ? "desktop.setup.offerBundled" : "desktop.setup.offerOnline", { version: firmware.version })
            : t("desktop.setup.noFirmware", "Looking for the firmware…")}
        </span>
        <span className="dk-hint">{t("desktop.setup.replaces", "This replaces whatever is on the Pico now.")}</span>
        <span className="dk-hint">{t("desktop.setup.driveNote")}</span>
        {install.phase === "failed" && <span className="dk-bad">{install.detail}</span>}
        <button type="button" className="dk-btn primary" disabled={!firmware} onClick={() => void start()}>
          {t("desktop.setup.install", "Install the firmware")}
        </button>
      </Center>
    );
  }

  return (
    <Center>
      {/* The dongle only appears on USB once a controller connects, so a
          dongle waiting to pair looks like no dongle at all. */}
      <strong>{t(hadDongle ? "desktop.setup.turnOnTitle" : "desktop.empty.title")}</strong>
      <span>{t("desktop.setup.pairHint")}</span>
      <span className="dk-hint">{t("desktop.setup.whyHidden")}</span>
      <span>{t("desktop.setup.newPico")}</span>
      {!supported && <span className="dk-bad">{t("statusText.webusbUnavailable")}</span>}
      {install.phase === "failed" && <span className="dk-bad">{install.detail}</span>}
      <UsbAccessSetup compact />
      <WindowsUsbRepair />
      <UpdatesWithoutDongle />
    </Center>
  );
}

// Updates with no dongle connected (it stays off USB until a controller
// connects, so the Firmware card isn't reachable): the firmware this app would
// install, how to install it without a controller (BOOTSEL: the screen above
// then offers it), and a check for a newer app (its banner shows up top).
function UpdatesWithoutDongle() {
  const { t } = useTranslation();
  const desktop = window.desktop;
  const [firmware, setFirmware] = useState<LatestFirmware | null>(null);
  const [checked, setChecked] = useState<string | null>(null);
  useEffect(() => {
    void desktop
      ?.latestFirmware()
      .then((r) => setFirmware(r.latest))
      .catch(() => undefined);
  }, [desktop]);
  if (!desktop) return null;
  const check = async () => {
    setChecked(null);
    const [app, lookup] = await Promise.all([desktop.checkForUpdates().catch(() => null), desktop.latestFirmware().catch(() => null)]);
    if (lookup?.latest) setFirmware(lookup.latest);
    setChecked(
      !app || app.phase === "failed"
        ? t("desktop.setup.checkFailed")
        : app.phase === "up-to-date"
          ? t("desktop.setup.checkedCurrent", { version: app.version })
          : app.phase === "idle" || app.phase === "checking"
            ? null
            : t("desktop.setup.checkedNewer", { version: app.version }),
    );
  };
  return (
    <div className="dk-setup-updates" data-testid="setup-updates">
      <strong>{t("desktop.setup.updatesTitle")}</strong>
      {firmware && <span>{t("desktop.setup.fwReady", { version: shortVersion(firmware.version) })}</span>}
      <span className="dk-hint">{t("desktop.setup.fwHowTo")}</span>
      <BusyButton onClick={check}>{t("desktop.setup.checkUpdates")}</BusyButton>
      {checked && <span className="dk-hint">{checked}</span>}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="dk-empty">
      <div className="dk-setup">{children}</div>
    </div>
  );
}
