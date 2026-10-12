import AppRail from "./AppRail";
import { useLookKnobs } from "./lookKnobs";
import { useDevToolsShortcut, useShownIdentity } from "./devPreview";
import { useReduceMotion } from "./motion";
import { ACCENT_KEY, ACCENTS, useControllerAccent } from "./live/controllerAccent";
import { CLEAR_GLASS_BAR } from "./glass/variants";
import { useGlass } from "./glass/useGlass";
import { GLASS_KEY } from "./glass/glassPref";
import { useFlagPref, usePref, writePref } from "./storage";
import { colorway } from "./live/colorways";
import ArtBackdrop from "./live/ArtBackdrop";
import { PANEL_TOGGLE_EVENT } from "./live/ControllerView";
import { useGameProfile } from "./library/useGameProfile";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApplyTheme } from "../components/ThemeToggle";
import { useDs5Bridge } from "../hooks/useDs5Bridge";
import { renderTrayIcon } from "./tray/trayIcon";
import AboutPage, { type AboutTab } from "./pages/AboutPage";
import SetupScreen, { HAD_DONGLE_KEY } from "./SetupScreen";
import { hardwareName } from "./hardwareName";
import GamesPage, { allFixes, loadDeclined } from "./pages/GamesPage";
import type { GamesReport } from "./games/types";
import ControllerView from "./live/ControllerView";
import type { PanelView } from "./live/PartPanel";
import UpdateBanners from "./UpdateBanners";
import AutoUpdateAsk from "./AutoUpdateAsk";
import { useAppUpdate, useFirmwareUpdate } from "./useUpdates";
import { usePoll } from "./usePoll";
import "./desktop.css";
import NarratorCaption from "./NarratorCaption";
import { firmwareNarratorValue, say, useNarrator } from "./narrator";
import { IDENTITY_FEATURES } from "../protocol/bridgeClient";

// One screen: the live controller with its settings panel. Games and About
// replace it while open (with a way back); the dongle and the app's own
// settings open in the panel.
type MainView = "controller" | "games" | "about";

const APPLY_DEBOUNCE_MS = 150;

export default function DesktopApp() {
  const { t, i18n } = useTranslation();
  useApplyTheme();
  const bridge = useDs5Bridge();
  // Remembered so the setup screen can tell "no dongle yet" from "the dongle
  // is waiting for its controller" (it stays off USB until one connects).
  useEffect(() => {
    if (bridge.client) writePref(HAD_DONGLE_KEY, "1");
  }, [bridge.client]);
  const appUpdate = useAppUpdate();
  const fw = useFirmwareUpdate(bridge, appUpdate);
  const [main, setMain] = useState<MainView>("controller");
  const [panel, setPanel] = useState<PanelView>("overview");
  const [aboutTab, setAboutTab] = useState<AboutTab>("changes");
  const whatsNew = useWhatsNew();
  const games = useGamesAttention();
  // Per-game profiles switch in while their game runs (never mid-update).
  const updating = fw.state.phase === "running" || fw.state.phase === "verifying";
  const profiles = useGameProfile(bridge, updating);

  const openPanel = (view: PanelView) => {
    setMain("controller");
    setPanel(view);
  };

  // Edits apply to the dongle's RAM as you make them (debounced), so every
  // change is heard and felt immediately. Saving to flash is a separate step.
  // A draft the dongle refused isn't sent again until it changes (no retry
  // loop with the error showing).
  const { isDirty, issues, operation, applyConfig, draft } = bridge;
  const failedDraft = useRef<typeof draft | null>(null);
  useEffect(() => {
    if (!isDirty || issues.length > 0 || operation || draft === failedDraft.current) return;
    const timer = setTimeout(() => {
      void applyConfig().then((ok) => {
        failedDraft.current = ok ? null : draft;
      });
    }, APPLY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isDirty, issues.length, operation, applyConfig, draft]);

  const connected = bridge.isConnected;

  // Narrator events (she only speaks if the user said yes, and only through
  // the controller; see narrator.ts).
  const wasConnected = useRef(false);
  useEffect(() => {
    if (connected && !wasConnected.current) void say("app_dongle_online");
    wasConnected.current = connected;
  }, [connected]);
  const offered = useRef<string | null>(null);
  useEffect(() => {
    const version = fw.available ? fw.latest?.version : null;
    if (version && offered.current !== version) {
      offered.current = version;
      void say("app_fw_available");
    }
  }, [fw.available, fw.latest?.version]);
  useEffect(() => {
    if (fw.state.phase === "done") void say("app_fw_updated");
  }, [fw.state.phase]);
  const busy = bridge.operation !== null;
  const standalone = main !== "controller";

  // Keep the tray icon/menu in step with the device, even while the window is
  // hidden (the window keeps running in the background for exactly this).
  const client = bridge.client;
  const realIdentity = usePoll(() => client!.identity(), 2000, Boolean(client)).value;
  // What the UI shows (the developer preview can stand in another model/colorway).
  const liveIdentity = useShownIdentity(realIdentity);
  useDevToolsShortcut();
  // Glass (preview): the functional layer (rail, save bar) as clear liquid
  // glass floating over the content; content stays a plain surface.
  useReduceMotion();
  useLookKnobs();
  const [glass] = useFlagPref(GLASS_KEY);
  const [accentChoice] = usePref(ACCENT_KEY, "controller", ACCENTS);
  useControllerAccent(liveIdentity?.colorwayCode ?? null, accentChoice);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-glass", glass);
  }, [glass]);
  const barRef = useGlass(glass, CLEAR_GLASS_BAR);
  const firmware = bridge.firmwareVersion;
  const controllerOn = Boolean(connected && liveIdentity?.controllerConnected);
  const charging = controllerOn && Boolean(liveIdentity?.charging);
  const battery = controllerOn ? (liveIdentity?.battery ?? null) : null;
  const lightbar = controllerOn ? (liveIdentity?.lightbar ?? null) : null;
  const lightbarKey = lightbar ? lightbar.join(",") : "";
  useEffect(() => {
    window.desktop?.reportStatus({
      dongle: connected,
      controller: controllerOn,
      slot: connected && liveIdentity ? liveIdentity.currentSlot : -1,
      firmware: connected ? firmware : null,
      charging,
      battery,
    });
  }, [connected, controllerOn, liveIdentity, firmware, charging, battery]);

  // The dongle has her too (connected, slot, battery low; firmware 1.3):
  // keep it in step with the app's narrator setting and language. Written
  // only when it differs, since the dongle saves it to flash.
  const narrator = useNarrator();
  const fwNarrator = Boolean(liveIdentity && liveIdentity.features & IDENTITY_FEATURES.narrator);
  useEffect(() => {
    if (!client || !fwNarrator) return;
    const want = firmwareNarratorValue(narrator);
    let cancelled = false;
    void client
      .readNarrator()
      .then((have) => (!cancelled && have !== null && have !== want ? client.setNarrator(want) : undefined))
      .catch(() => undefined); // busy or gone: tried again on the next change or reconnect
    return () => {
      cancelled = true;
    };
  }, [client, fwNarrator, narrator, i18n.resolvedLanguage]);

  // Redraw the tray icon only when something it shows changes.
  const darkTaskbar = useDarkTaskbar();
  useEffect(() => {
    if (!window.desktop) return;
    const rgb = lightbarKey ? (lightbarKey.split(",").map(Number) as [number, number, number]) : null;
    let cancelled = false;
    void renderTrayIcon({ dot: !connected ? "none" : controllerOn ? "ok" : "away", darkTaskbar, lightbar: rgb, charging })
      .then((png) => !cancelled && window.desktop?.setTrayIcon(png))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [connected, controllerOn, charging, lightbarKey, darkTaskbar]);

  useEffect(
    () =>
      window.desktop?.onTrayCommand((command) => {
        if (command.type === "openPage") {
          // The tray's "Diagnostics" opens the Dongle page (its live diagnostics).
          if (command.page === "diagnostics") {
            setMain("controller");
            setPanel("dongle");
          } else if (command.page === "games" || command.page === "about") setMain(command.page);
          else {
            setMain("controller");
            if (command.page === "dongle") setPanel("dongle");
          }
        } else if (command.type === "switchSlot") {
          void client?.switchSlot(command.slot).catch(() => undefined);
        }
      }),
    [client],
  );

  return (
    <div className="dk dk-one">
      <ArtBackdrop colors={colorway(liveIdentity?.colorwayCode ?? null)?.colors ?? null} />
      <NarratorCaption />
      <div className="dk-main">
        <main className={`dk-body${main === "controller" && connected ? " dk-body-live" : ""}${main === "games" && games.allowed ? " dk-body-lib" : ""}`}>
          <UpdateBanners app={appUpdate} fw={fw} device={hardwareName(bridge.identity, t)} onShowFirmware={() => openPanel("dongle")} />
          <AutoUpdateAsk />
          {whatsNew.version && (
            <div className="dk-notice">
              <span>{t("desktop.about.updated", { version: whatsNew.version, defaultValue: "Updated to {{version}}." })}</span>
              <span className="dk-spacer" />
              <button
                type="button"
                className="dk-btn"
                onClick={() => {
                  setAboutTab("changes");
                  setMain("about");
                  whatsNew.dismiss();
                }}
              >
                {t("desktop.about.seeWhatsNew", "See what's new")}
              </button>
              <button type="button" className="dk-btn" onClick={whatsNew.dismiss}>
                {t("notice.dismiss")}
              </button>
            </div>
          )}
          {bridge.error && (
            <div className="dk-notice error" role="alert">
              <span>{bridge.error}</span>
              <span className="dk-spacer" />
              <button type="button" className="dk-btn" onClick={bridge.clearError}>
                {t("notice.dismiss")}
              </button>
            </div>
          )}
          {main === "games" && <GamesPage bridge={bridge} profiles={profiles} allowed={games.allowed} onAllowedChange={games.setAllowed} onScanned={games.update} onDeclinedChange={games.recount} />}
          {main === "about" && <AboutPage key={aboutTab} initialTab={aboutTab} />}
          {main === "controller" &&
            (connected ? (
              <ControllerView bridge={bridge} fw={fw} view={panel} onView={setPanel} />
            ) : panel === "app" ? (
              <ControllerView bridge={bridge} fw={fw} view="app" onView={setPanel} />
            ) : fw.state.phase === "running" || fw.state.phase === "verifying" ? (
              // Mid-update the dongle is a bootloader drive: the update banner
              // shows the progress; Setup must not offer to flash it again.
              <div className="dk-page" />
            ) : (
              <SetupScreen supported={bridge.supported} />
            ))}
        </main>

        {connected && !standalone && (
          <footer className="dk-bar" ref={barRef}>
            {profiles.active ? (
              <>
                <span className="dk-bar-note">
                  <b>{t("desktop.bar.profileActive", { title: profiles.active.title })}</b> · {profiles.profileDirty ? t("desktop.bar.profileUnsaved") : t("desktop.bar.profileSaved")}
                </span>
                <span className="dk-spacer" />
                <button type="button" className="dk-btn" disabled={busy || !profiles.profileDirty} onClick={() => void profiles.revertToProfile()}>
                  {t("desktop.bar.revert", "Revert")}
                </button>
                <button type="button" className="dk-btn primary" disabled={busy || !profiles.profileDirty || bridge.isDirty} onClick={() => void profiles.saveToProfile()}>
                  {t("desktop.bar.saveProfile")}
                </button>
              </>
            ) : (
              <>
                <span className="dk-bar-note">
                  {busy
                    ? t(`statusText.${bridge.operation}`)
                    : bridge.hasUnsavedChanges
                      ? t("desktop.bar.unsaved", "Applied to the dongle, not saved yet: changes are lost when it powers off.")
                      : t("desktop.bar.saved", "All changes saved on the dongle.")}
                </span>
                <span className="dk-spacer" />
                <button type="button" className="dk-btn" disabled={busy || !bridge.canRevert} onClick={() => void bridge.revertToSaved()}>
                  {t("desktop.bar.revert", "Revert")}
                </button>
                <button
                  type="button"
                  className="dk-btn primary"
                  disabled={busy || !bridge.hasUnsavedChanges || bridge.isDirty}
                  onClick={() =>
                    void bridge.saveToFlash().then((ok) => {
                      if (ok) void say("app_saved");
                    })
                  }
                >
                  {t("desktop.bar.save", "Save to dongle")}
                </button>
              </>
            )}
          </footer>
        )}
      </div>
      <AppRail
        active={main === "games" ? "games" : main === "about" ? "about" : panel === "dongle" ? "dongle" : panel === "app" ? "app" : "controller"}
        onSelect={(item) => {
          if (item === "games" || item === "about") setMain(item);
          else if (item === "controller") {
            // Already there: show / hide its settings panel.
            if (main === "controller" && panel !== "dongle" && panel !== "app") window.dispatchEvent(new Event(PANEL_TOGGLE_EVENT));
            else {
              setMain("controller");
              setPanel("overview");
            }
          } else openPanel(item);
        }}
        gamesSupported={games.supported}
        gamesBadge={games.count}
        connected={connected}
        connecting={bridge.operation === "connecting"}
        firmware={bridge.firmwareVersion}
        deviceLabel={bridge.deviceLabel}
        device={hardwareName(bridge.identity, t)}
      />
    </div>
  );
}

// Whether the taskbar is dark, from the desktop's own colors (KDE's color
// scheme, or the system's dark/light setting): independent of the app's theme.
function useDarkTaskbar(): boolean {
  const query = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
  const [dark, setDark] = useState(query);
  useEffect(() => {
    const desktop = window.desktop;
    let live = true;
    const fromPalette = (p: { isDark: boolean } | null) => live && setDark(p ? p.isDark : query());
    void desktop?.getDesktopPalette().then(fromPalette);
    const off = desktop?.onDesktopPalette(fromPalette);
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onChange = () => void desktop?.getDesktopPalette().then(fromPalette);
    mq?.addEventListener("change", onChange);
    return () => {
      live = false;
      off?.();
      mq?.removeEventListener("change", onChange);
    };
  }, []);
  return dark;
}

// Shows "Updated to X" once after the app version changes (not on first run).
const SEEN_KEY = "ds5-last-seen-version";
function useWhatsNew(): { version: string | null; dismiss: () => void } {
  const current = window.desktop?.appVersion ?? null;
  const [version, setVersion] = useState<string | null>(() => {
    if (!current) return null;
    let seen: string | null;
    try {
      seen = window.localStorage.getItem(SEEN_KEY);
      if (!seen) window.localStorage.setItem(SEEN_KEY, current);
    } catch {
      return null;
    }
    return seen && seen !== current ? current : null;
  });
  const dismiss = () => {
    try {
      if (current) window.localStorage.setItem(SEEN_KEY, current);
    } catch {
      // storage unavailable: the banner just reappears next launch
    }
    setVersion(null);
  };
  return { version, dismiss };
}

// Linux Games page: whether the user allowed it to read launcher settings, and
// how many recommended changes are waiting (the sidebar badge). The startup
// check only runs once the user has allowed it.
function useGamesAttention() {
  const supported = window.desktop?.platform === "linux";
  const [allowed, setAllowedState] = useState(false);
  const [count, setCount] = useState(0);
  const last = useRef<GamesReport | null>(null);
  const recount = useCallback(() => setCount(last.current ? allFixes(last.current).filter((f) => f.recommended && !loadDeclined().has(f.id)).length : 0), []);
  const update = useCallback(
    (report: GamesReport) => {
      last.current = report;
      recount();
    },
    [recount],
  );
  useEffect(() => {
    if (!supported) return;
    let live = true;
    void window.desktop!.getSettings().then((s) => {
      if (!live) return;
      setAllowedState(s.gamesScanAllowed);
      if (s.gamesScanAllowed)
        window.desktop!.gamesScan().then(
          (r) => live && update(r),
          () => undefined,
        );
    });
    return () => {
      live = false;
    };
  }, [supported, update]);
  const setAllowed = useCallback(
    (value: boolean) => {
      setAllowedState(value);
      if (!value) {
        last.current = null;
        recount();
      }
      void window.desktop!.setSetting("gamesScanAllowed", value);
    },
    [recount],
  );
  return { supported, allowed, setAllowed, count, update, recount };
}
