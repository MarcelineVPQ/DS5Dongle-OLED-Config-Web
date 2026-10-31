// What the app shows while no dongle is connected. Two paths:
//   - a dongle that's already set up: plug it in, it connects by itself;
//   - a new (or non-dongle) Pico plugged in with BOOTSEL held: the app finds
//     it and, when the user agrees, installs the firmware bundled with the app
//     (no download needed, no files to copy). The Pico then restarts as the
//     dongle. A dongle only appears on USB once a controller is connected (it
//     takes on the controller's identity), so the next step is pairing.
import { useEffect, useState } from "react";
import { causeText } from "./shownError";
import { useTranslation } from "react-i18next";
import type { PicoflashHandle } from "../flash";
import type { LatestFirmware } from "./api";
import { findBootloader, installFirmware, onlyBootloader, type FirmwareProgress } from "./firmwareUpdate";
import { readPref } from "./storage";
import { BusyButton } from "./controls";
import { usePoll } from "./usePoll";
import { shortVersion } from "../update/manifest";
import UsbAccessSetup from "./UsbAccessSetup";
import WindowsUsbRepair from "./WindowsUsbRepair";
import { logged } from "../errorText";
import { feedProblemText } from "./useUpdates";
import { IMAGE_NEEDS, PICO2_W } from "../update/boardIdentity";

const POLL_MS = 1000;
// The same board back in BOOTSEL this many times after an install (the
// firmware didn't start): stop offering it. A Pico 2 without the wireless
// chip can't run the Pico 2 W image and can't be told apart in BOOTSEL
// (DESIGN_FIRMWARE_IDENTITY §1.2).
const MAX_TRIES = 3;

// Set once a dongle has connected on this PC (DesktopApp).
export const HAD_DONGLE_KEY = "ds5.hadDongle";

// `left`: the flashed Pico has left BOOTSEL. Until then the poll can still
// see it (it restarts half a second after the write), and that must not read
// as "a Pico is ready to set up" again.
// `ask`: the board's flash is blank, so its size can't be read: the user
// decides before anything is written (owner decision, design §9).
type Install =
  | { phase: "idle" }
  | { phase: "ask"; answer: (install: boolean) => void }
  | { phase: "running"; progress: FirmwareProgress }
  | { phase: "restarting"; version: string; left: boolean }
  | { phase: "failed"; detail: string };

export default function SetupScreen({ supported }: { supported: boolean }) {
  const { t } = useTranslation();
  const [hadDongle] = useState(() => readPref(HAD_DONGLE_KEY) === "1");
  const [firmware, setFirmware] = useState<LatestFirmware | null>(null);
  const [install, setInstall] = useState<Install>({ phase: "idle" });
  // Installs on one board (its BOOTSEL serial) that ended back in BOOTSEL.
  const [tries, setTries] = useState({ serial: "", count: 0 });

  // Watch for a Pico in BOOTSEL mode (stops while installing, and while the
  // window is hidden: it's only shown here).
  const installing = install.phase === "running";
  // lifetime: OK — usePoll: stops while installing, when hidden, or when setup unmounts
  const pico: PicoflashHandle | null = usePoll(findBootloader, POLL_MS, supported && !installing).value;

  // Online only with automatic checks on (main); otherwise the bundled build.
  // The Pico 2 W image: installFirmware reads the board in BOOTSEL first and
  // writes only to an RP2350A with enough flash (design §1.2).
  // lifetime: OK — acquires nothing (one firmware lookup once a Pico shows up)
  useEffect(() => {
    if (!pico || firmware) return;
    window.desktop
      ?.latestFirmware(false, PICO2_W)
      .then((r) => setFirmware(r.latest))
      .catch(logged("looking up the firmware to install (without it, Install says desktop.setup.noFirmware)"));
  }, [pico, firmware]);

  const start = async () => {
    if (!pico || !firmware) return;
    try {
      // With several Picos in BOOTSEL, none is guessed (the message says to unplug the others).
      const ask = () => new Promise<boolean>((answer) => setInstall({ phase: "ask", answer }));
      const version = await installFirmware(await onlyBootloader(), firmware, (progress) => setInstall({ phase: "running", progress }), ask);
      // Cancelled at the ask: nothing was written.
      setInstall(version === null ? { phase: "idle" } : { phase: "restarting", version, left: false });
    } catch (cause) {
      // error: SHOWN — desktop.firmware.writeFailed and the other keyed flash/board errors (causeText) next to Install
      setInstall({ phase: "failed", detail: causeText(cause) });
      // Look again: if the feed changed, the new offer shows (the failed
      // install already fetched it, so this doesn't go online).
      setFirmware(null);
    }
  };

  const restarting = install.phase === "restarting" ? install : null;
  // The flashed Pico has left BOOTSEL (noted while rendering, React's pattern
  // for state that follows a value from the last render).
  if (restarting && !restarting.left && !pico) setInstall({ ...restarting, left: true });
  // A Pico back in BOOTSEL after the flashed one left: the new firmware didn't
  // start (the boot ROM went back to BOOTSEL, or the user put it there after
  // it never came up). Say so, and offer it again, MAX_TRIES times per board.
  else if (restarting && restarting.left && pico) {
    const serial = pico.getUsbDeviceInfo().serialNumber ?? "";
    const count = tries.serial === serial ? tries.count + 1 : 1;
    setTries({ serial, count });
    setInstall({ phase: "failed", detail: t(count >= MAX_TRIES ? "desktop.setup.stopTrying" : "desktop.firmware.didntStart") });
  }
  const stopped = !!pico && tries.count >= MAX_TRIES && tries.serial === (pico.getUsbDeviceInfo().serialNumber ?? "");

  if (install.phase === "ask") {
    const needs = firmware ? IMAGE_NEEDS[firmware.board] : undefined;
    return (
      <Center>
        <strong>{t("desktop.setup.askTitle")}</strong>
        <span>{t("desktop.setup.askFlash", { board: needs?.name ?? "", needed: needs ? `${needs.flash_min / (1024 * 1024)} MB` : "" })}</span>
        <div>
          <button className="dk-btn primary" onClick={() => install.answer(true)}>
            {t("desktop.setup.askInstall")}
          </button>{" "}
          <button className="dk-btn" onClick={() => install.answer(false)}>
            {t("desktop.common.cancel")}
          </button>
        </div>
      </Center>
    );
  }

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

  if (restarting) {
    return (
      <Center>
        <strong>{t("desktop.setup.restarting", { version: restarting.version })}</strong>
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
        {/* hint: MUST-SHOW — the first-run setup: the step's own instruction, read while doing it */}
        <span className="dk-hint">{t("desktop.setup.driveNote")}</span>
        {install.phase === "failed" && <span className="dk-bad">{install.detail}</span>}
        {!stopped && (
          <BusyButton className="dk-btn primary" disabled={!firmware} onClick={start}>
            {install.phase === "failed" ? t("desktop.firmware.installAgain") : t("desktop.setup.install", "Install the firmware")}
          </BusyButton>
        )}
      </Center>
    );
  }

  return (
    <Center>
      {/* The dongle only appears on USB once a controller connects, so a
          dongle waiting to pair looks like no dongle at all. */}
      <strong>{t(hadDongle ? "desktop.setup.turnOnTitle" : "desktop.empty.title")}</strong>
      <span>{t("desktop.setup.pairHint")}</span>
      {/* hint: MUST-SHOW — the first-run setup: the step's own instruction, read while doing it */}
      <span className="dk-hint">{t("desktop.setup.whyHidden")}</span>
      <span>{t("desktop.setup.newPico")}</span>
      {!supported && <span className="dk-bad">{t("statusText.webusbUnavailable")}</span>}
      {install.phase === "failed" && <span className="dk-bad">{install.detail}</span>}
      <UsbAccessSetup variant="compact" />
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
  // lifetime: OK — acquires nothing (one firmware lookup on mount)
  useEffect(() => {
    desktop
      ?.latestFirmware(false, PICO2_W)
      .then((r) => setFirmware(r.latest))
      .catch(logged("looking up the latest firmware (Check now reports it when asked)"));
  }, [desktop]);
  if (!desktop) return null;
  const check = async () => {
    setChecked(null);
    // error: SHOWN — desktop.setup.checkFailed (no answer), desktop.updateFeed.* by problem (refused feed, HTTP error, rate limit), desktop.updateFeed.internal when the app's own call failed (null)
    const [app, lookup] = await Promise.all([desktop.checkForUpdates().catch(() => null), desktop.latestFirmware(true, PICO2_W).catch(() => null)]);
    if (lookup?.latest) setFirmware(lookup.latest);
    setChecked(
      !app || app.phase === "failed"
        ? feedProblemText(t, app ? app.problem : "internal", "desktop.setup.checkFailed")
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
      {/* hint: MUST-SHOW — the first-run setup: the step's own instruction, read while doing it */}
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
