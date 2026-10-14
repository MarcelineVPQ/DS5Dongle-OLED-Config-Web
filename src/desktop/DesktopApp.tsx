import AppRail, { type RailItem } from "./AppRail";
import Notice from "./Notice";
import { NoticeTasksContext, pruneStored, railReminders } from "./notices";
import { openTasks } from "./openTasks";
import { useBoardProblems } from "./dongle/useBoardProblems";
import { useLookKnobs } from "./lookKnobs";
import { gamesSupported } from "./games/platform";
import { onGamesAllowed, setGamesAllowed } from "./games/consent";
import { useDevToolsShortcut, useShownIdentity } from "./devPreview";
import { useReduceMotion } from "./motion";
import { ACCENT_KEY, ACCENTS, useControllerAccent } from "./live/controllerAccent";
import { CLEAR_GLASS_BAR } from "./glass/variants";
import { useGlass } from "./glass/useGlass";
import { GLASS_KEY } from "./glass/glassPref";
import { useFlagPref, usePref, writePref } from "./storage";
import { colorway } from "./live/colorways";
import { mergeColors, useCustomColors } from "./live/customColors";
import ArtBackdrop from "./live/ArtBackdrop";
import { PANEL_TOGGLE_EVENT } from "./live/ControllerView";
import { useGameProfile } from "./library/useGameProfile";
import { LibraryContext, profileTarget } from "./library/libraryContext";
import { BusyButton } from "./controls";
import { causeText, clearShownError, shown, showError, useShownError } from "./shownError";
import { MAIN_ERROR_KEYS, MAIN_NOTICE_KEYS } from "./api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApplyTheme } from "../components/ThemeToggle";
import { useDs5Bridge } from "../hooks/useDs5Bridge";
import { renderTrayIcon } from "./tray/trayIcon";
import AboutPage, { type AboutTab } from "./pages/AboutPage";
import SetupScreen, { HAD_DONGLE_KEY } from "./SetupScreen";
import { hardwareName, trackBoard } from "./hardwareName";
import { previewUpdates, useUpdatePreview } from "./updatePreview";
import GamesPage, { allFixes, loadDeclined } from "./pages/GamesPage";
import type { GamesReport } from "./games/types";
import ControllerView from "./live/ControllerView";
import type { PanelView } from "./live/PartPanel";
import UpdateBanners from "./UpdateBanners";
import AutoUpdateAsk from "./AutoUpdateAsk";
import { useAppUpdate, useFirmwareUpdate } from "./useUpdates";
import "./desktop.css";
import NarratorCaption from "./NarratorCaption";
import Toasts from "./Toasts";
import { announce, showToast } from "./toast";
import { firmwareNarratorValue, sayInPassing, useNarrator } from "./narrator";
import { IDENTITY_FEATURES } from "../protocol/bridgeClient";
import { identityChargeState } from "../protocol/controllerInfo";
import { logged } from "../errorText";

// One screen: the live controller with its settings panel. Games and About
// replace it while open (with a way back); the dongle and the app's own
// settings open in the panel.
type MainView = "controller" | "games" | "about";

const APPLY_DEBOUNCE_MS = 150;

export default function DesktopApp() {
  const { t, i18n } = useTranslation();
  useApplyTheme();
  const bridge = useDs5Bridge();
  const shownError = useShownError();
  // Something the app did on its own in the background (main process), e.g.
  // the controller's volume set back to full after it reconnected.
  const [mainNotice, setMainNotice] = useState<string | null>(null);
  // Remembered so the setup screen can tell "no dongle yet" from "the dongle
  // is waiting for its controller" (it stays off USB until one connects).
  // lifetime: OK — acquires nothing (remembers that a dongle was seen)
  useEffect(() => {
    if (bridge.client) writePref(HAD_DONGLE_KEY, "1");
  }, [bridge.client]);
  // lifetime: OK — acquires nothing (trackBoard records the board name, returns nothing)
  useEffect(() => trackBoard(bridge.identity), [bridge.identity]);
  const realAppUpdate = useAppUpdate();
  const realFw = useFirmwareUpdate(bridge, realAppUpdate);
  // Developer preview: update banners and buttons without a real update.
  const [updatePreview] = useUpdatePreview();
  const [appUpdate, fw] = previewUpdates(updatePreview, realAppUpdate, realFw);
  const [main, setMain] = useState<MainView>("controller");
  const [panel, setPanel] = useState<PanelView>("overview");
  // A game page to open when the Games page shows next (after editing its profile).
  const [openGame, setOpenGame] = useState<{ key: string } | null>(null);
  const [aboutTab, setAboutTab] = useState<AboutTab>("guide");
  // Done pressed with changes not saved into the profile: ask first.
  const [confirmDone, setConfirmDone] = useState(false);
  const whatsNew = useWhatsNew();
  const games = useGamesAttention();
  // Per-game profiles switch in while their game runs (never mid-update).
  const updating = fw.state.phase === "running" || fw.state.phase === "verifying";
  const profiles = useGameProfile(bridge, updating);
  const switchSlot = profiles.switchSlot;

  const openPanel = (view: PanelView) => {
    setMain("controller");
    setPanel(view);
  };
  // A rail item's page (App settings → Dismissed notices: the place to act).
  const goTo = (item: RailItem) => {
    if (item === "games" || item === "about") setMain(item);
    else if (item === "controller") openPanel("overview");
    else openPanel(item);
  };

  // Open tasks: the rail's dots, and which dismissed notices still apply.
  const boardProblems = useBoardProblems(bridge);
  const { tasks, settled } = useMemo(
    () => openTasks(t, { app: appUpdate, fw, connected: bridge.isConnected, board: boardProblems, gamesCount: games.count }),
    [t, appUpdate, fw, bridge.isConnected, boardProblems, games.count],
  );
  const reminders = useMemo(() => railReminders(tasks), [tasks]);
  // loop: NOT-WORTH — N ≤ 3 notice ids; when what applies changes
  const settledSig = JSON.stringify([...settled].sort(([a], [b]) => a.localeCompare(b)));
  // lifetime: OK — acquires nothing (drops dismissals whose reason no longer applies)
  useEffect(() => {
    pruneStored(new Map(JSON.parse(settledSig) as Array<[string, string[]]>));
  }, [settledSig]);

  // Edits apply to the dongle's RAM as you make them (debounced), so every
  // change is heard and felt immediately. Saving to flash is a separate step.
  // A draft the dongle refused isn't sent again until it changes (no retry
  // loop with the error showing).
  const { isDirty, issues, operation, applyConfig, draft } = bridge;
  const failedDraft = useRef<typeof draft | null>(null);
  // lifetime: OK — cleanup: clears the apply debounce timer (draft change / unmount)
  useEffect(() => {
    if (!isDirty || issues.length > 0 || operation || draft === failedDraft.current) return;
    // lifetime: OK — cleared in the effect cleanup
    const timer = setTimeout(() => {
      applyConfig()
        .then((ok) => {
          failedDraft.current = ok ? null : draft;
        })
        .catch(logged("applying the draft live (applyConfig shows its own error and resolves false)"));
    }, APPLY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isDirty, issues.length, operation, applyConfig, draft]);

  const connected = bridge.isConnected;

  // Narrator events (she only speaks if the user said yes, and only through
  // the controller; see narrator.ts).
  const wasConnected = useRef(false);
  // lifetime: OK — acquires nothing (narrator line on connect)
  useEffect(() => {
    if (connected && !wasConnected.current) sayInPassing("app_dongle_online");
    wasConnected.current = connected;
  }, [connected]);
  const offered = useRef<string | null>(null);
  // lifetime: OK — acquires nothing (narrator line once per offered version)
  useEffect(() => {
    const version = fw.available ? fw.latest?.version : null;
    if (version && offered.current !== version) {
      offered.current = version;
      sayInPassing("app_fw_available");
    }
  }, [fw.available, fw.latest?.version]);
  // lifetime: OK — acquires nothing (narrator line when an update finishes)
  useEffect(() => {
    if (fw.state.phase === "done") sayInPassing("app_fw_updated");
  }, [fw.state.phase]);
  const busy = bridge.operation !== null;
  // Leave the profile being edited: back to the game page it started from
  // (unsaved changes go with it; Done asks first when there are any).
  const finishEditing = () => {
    setConfirmDone(false);
    if (profiles.editing) setOpenGame({ key: profiles.editing.gameKey });
    profiles.stopEditing();
    setMain("games");
  };
  const standalone = main !== "controller";

  // Keep the tray icon/menu in step with the device, even while the window is
  // hidden (the window keeps running in the background for exactly this):
  // the connection hook's identity poll (every second, also while hidden) is
  // the one identity poll for the whole app (Pairing slots reads it too). The
  // one exception: the live lightbar color (useLiveLightbar) reads identity
  // faster, only while the controller view is shown.
  const client = bridge.client;
  const realIdentity = bridge.identity;
  // What the UI shows (the developer preview can stand in another model/colorway).
  const liveIdentity = useShownIdentity(realIdentity);
  useDevToolsShortcut();
  // Glass (preview): the functional layer (rail, save bar) as clear liquid
  // glass floating over the content; content stays a plain surface.
  useReduceMotion();
  useLookKnobs();
  const [glass] = useFlagPref(GLASS_KEY);
  const [accentChoice] = usePref(ACCENT_KEY, "controller", ACCENTS);
  // The player's own controller colors (App settings), on top of the colorway.
  const customColors = useCustomColors().active;
  useControllerAccent(liveIdentity?.colorwayCode ?? null, accentChoice, customColors);
  const controllerColors = useMemo(
    () => mergeColors(colorway(liveIdentity?.colorwayCode ?? null, liveIdentity?.model ?? null)?.colors ?? null, customColors),
    [liveIdentity?.colorwayCode, liveIdentity?.model, customColors],
  );
  // lifetime: OK — acquires nothing (toggles data-glass on <html>)
  useEffect(() => {
    document.documentElement.toggleAttribute("data-glass", glass);
  }, [glass]);
  const barRef = useGlass(glass, CLEAR_GLASS_BAR);
  const firmware = bridge.firmwareVersion;
  const controllerOn = Boolean(connected && liveIdentity?.controllerConnected);
  // Events (toasts): a controller connecting or going away while the board
  // stays connected (not the one already there at start), and a game's
  // profile going on or off by itself (not while one is being edited).
  const wasControllerOn = useRef<boolean | null>(null);
  const hasIdentity = connected && !!liveIdentity;
  const firmwareNarrates = !!((liveIdentity?.features ?? 0) & IDENTITY_FEATURES.narrator);
  // lifetime: OK — acquires nothing (a toast when the controller comes or goes)
  useEffect(() => {
    if (!hasIdentity) {
      wasControllerOn.current = null;
      return;
    }
    const was = wasControllerOn.current;
    wasControllerOn.current = controllerOn;
    if (was === null || was === controllerOn) return;
    // The board says its own "Connected" when it has the narrator.
    if (controllerOn) announce("desktop.toast.controllerConnected", firmwareNarrates ? null : "app_controller");
    else showToast("desktop.toast.controllerDisconnected");
  }, [hasIdentity, controllerOn, firmwareNarrates]);
  const activeProfile = profiles.active?.title ?? null;
  const wasProfile = useRef<string | null>(null);
  const editingProfile = !!profiles.editing;
  // lifetime: OK — acquires nothing (a toast when a game profile goes on or off)
  useEffect(() => {
    const was = wasProfile.current;
    // A profile being edited is on because of that: not an event.
    wasProfile.current = editingProfile ? null : activeProfile;
    if (editingProfile || was === activeProfile) return;
    if (activeProfile) showToast("desktop.bar.profileActive", { vars: { title: activeProfile } });
    else if (was) showToast("desktop.toast.profileOff", { vars: { title: was } });
  }, [activeProfile, editingProfile]);
  const charge = controllerOn && liveIdentity ? identityChargeState(liveIdentity) : null;
  const power = charge === "charging" || charge === "pluggedIn" || charge === "full" ? charge : null;
  const charging = power === "charging";
  const battery = controllerOn ? (liveIdentity?.battery ?? null) : null;
  const lightbar = controllerOn ? (liveIdentity?.lightbar ?? null) : null;
  const lightbarKey = lightbar ? lightbar.join(",") : "";
  const slot = connected && liveIdentity ? liveIdentity.currentSlot : -1;
  // Only when what the tray shows changes (not on every identity change: the
  // main process rebuilds the tray menu for each report).
  // lifetime: OK — acquires nothing (sends the status to the tray over IPC)
  useEffect(() => {
    window.desktop?.reportStatus({
      dongle: connected,
      controller: controllerOn,
      slot,
      firmware: connected ? firmware : null,
      power,
      battery,
    });
  }, [connected, controllerOn, slot, firmware, power, battery]);

  // The dongle has her too (connected, slot, battery low; firmware 1.3):
  // keep it in step with the app's narrator setting and language. Written
  // only when it differs, since the dongle saves it to flash.
  const narrator = useNarrator();
  const fwNarrator = Boolean(liveIdentity && liveIdentity.features & IDENTITY_FEATURES.narrator);
  // lifetime: OK — cleanup: drops a stale narrator read (holds no resource)
  useEffect(() => {
    if (!client || !fwNarrator) return;
    const want = firmwareNarratorValue(narrator);
    let cancelled = false;
    void client
      .readNarrator()
      .then((have) => (!cancelled && have !== null && have !== want ? client.setNarrator(want) : undefined))
      .catch(logged("syncing the board's narrator setting (busy or gone: tried again on the next change or reconnect)"));
    return () => {
      cancelled = true;
    };
  }, [client, fwNarrator, narrator, i18n.resolvedLanguage]);

  // Redraw the tray icon only when something it shows changes.
  const darkTaskbar = useDarkTaskbar();
  // lifetime: OK — cleanup: drops a stale tray icon render (holds no resource)
  useEffect(() => {
    if (!window.desktop) return;
    // loop: NOT-WORTH — N = 3 numbers; only when the tray icon's inputs change
    const rgb = lightbarKey ? (lightbarKey.split(",").map(Number) as [number, number, number]) : null;
    let cancelled = false;
    void renderTrayIcon({ dot: !connected ? "none" : controllerOn ? "ok" : "away", darkTaskbar, lightbar: rgb, charging })
      .then((png) => !cancelled && window.desktop?.setTrayIcon(png))
      .catch(logged("drawing the tray icon (the tray keeps its last icon)"));
    return () => {
      cancelled = true;
    };
  }, [connected, controllerOn, charging, lightbarKey, darkTaskbar]);

  // lifetime: OK — the effect returns the preload's unsubscribe for main-process errors (unmount)
  // Main-process failures of a user action (a tray toggle, a link): the same notice.
  useEffect(() => window.desktop?.onShowError((key) => (MAIN_ERROR_KEYS as readonly string[]).includes(key) && showError(key)), []);
  // lifetime: OK — the effect returns the preload's unsubscribe for main-process notices (unmount)
  useEffect(() => window.desktop?.onShowNotice((key) => (MAIN_NOTICE_KEYS as readonly string[]).includes(key) && setMainNotice(t(key))), [t]);
  // lifetime: OK — cleanup: the preload's unsubscribe (removeListener) for tray commands
  useEffect(
    () =>
      // lifetime: OK — the effect returns its unsubscribe (unmount)
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
          // error: SHOWN — desktop.errors.slotSwitch (was SILENT-BUG: the tray's slot switch failed with nothing shown)
          switchSlot(command.slot).catch((cause: unknown) => shown("desktop.errors.slotSwitch", { slot: String(command.slot), reason: causeText(cause) })(cause));
        }
      }),
    [switchSlot],
  );

  return (
    <NoticeTasksContext.Provider value={{ tasks, goTo }}>
      <LibraryContext.Provider
        value={{
          library: profiles.library,
          setLibrary: profiles.setLibrary,
          active: profiles.active,
          editing: profiles.editing,
          appliedStamp: profiles.appliedStamp,
          switchSlot: profiles.switchSlot,
          curvesDraft: profiles.curvesDraft,
          setCurvesDraft: profiles.setCurvesDraft,
          setButtonsDraft: profiles.setButtonsDraft,
          saveToProfile: profiles.saveToProfile,
          editProfile: (gameKey, title) => {
            setConfirmDone(false);
            profiles.startEditing(gameKey, title);
            setMain("controller");
            setPanel("overview");
          },
        }}
      >
        <div className="dk dk-one">
          <ArtBackdrop colors={controllerColors} />
          <NarratorCaption />
          <div className="dk-main">
            <main tabIndex={-1} className={`dk-body${main === "controller" && connected ? " dk-body-live" : ""}${main === "games" && games.allowed ? " dk-body-lib" : ""}`}>
              <UpdateBanners
                app={appUpdate}
                fw={fw}
                onShowFirmware={() => openPanel("dongle")}
                onFirmwareChanges={() => {
                  setAboutTab("firmware");
                  setMain("about");
                }}
              />
              <AutoUpdateAsk />
              {whatsNew.version && (
                <Notice
                  onDismiss={whatsNew.dismiss}
                  action={
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
                  }
                >
                  <span>{t("desktop.about.updated", { version: whatsNew.version, defaultValue: "Updated to {{version}}." })}</span>
                </Notice>
              )}
              <ErrorNotice message={shownError} onDismiss={clearShownError} pinned />
              {mainNotice && (
                <Notice pinned role="status" onDismiss={() => setMainNotice(null)}>
                  <span>{mainNotice}</span>
                </Notice>
              )}
              <ErrorNotice message={bridge.error} onDismiss={bridge.clearError} />
              <ErrorNotice message={profiles.error} onDismiss={profiles.clearError} />
              {main === "games" && (
                <GamesPage
                  bridge={bridge}
                  profiles={profiles}
                  openGame={openGame}
                  allowed={games.allowed}
                  onAllowedChange={games.setAllowed}
                  onScanned={games.update}
                  onDeclinedChange={games.recount}
                />
              )}
              {main === "about" && <AboutPage key={aboutTab} initialTab={aboutTab} />}
              {main === "controller" && profiles.editing && (
                <div className="dk-editing" role="status">
                  {confirmDone ? (
                    <>
                      <span>{t("desktop.editing.unsaved", { title: profiles.editing.title })}</span>
                      <span className="dk-spacer" />
                      <button type="button" className="dk-btn" onClick={() => setConfirmDone(false)}>
                        {t("desktop.common.cancel")}
                      </button>
                      <button type="button" className="dk-btn" onClick={finishEditing}>
                        {t("desktop.editing.discard")}
                      </button>
                      <BusyButton
                        className="dk-btn primary"
                        disabled={busy || bridge.isDirty}
                        onClick={async () => {
                          if (await profiles.saveToProfile()) finishEditing();
                        }}
                      >
                        {t("desktop.editing.saveClose")}
                      </BusyButton>
                    </>
                  ) : (
                    <>
                      <span>
                        <b>{t("desktop.editing.title", { title: profiles.editing.title })}</b> · {t("desktop.editing.hint")}
                      </span>
                      <span className="dk-spacer" />
                      <button type="button" className="dk-btn primary" onClick={() => (profiles.profileDirty || bridge.isDirty ? setConfirmDone(true) : finishEditing())}>
                        {t("desktop.editing.done")}
                      </button>
                    </>
                  )}
                </div>
              )}
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
            <Toasts />

            {connected && !standalone && (
              <footer className="dk-bar" ref={barRef}>
                {profiles.active ? (
                  <>
                    <span className="dk-bar-note">
                      <b>{t("desktop.bar.profileActive", { title: profiles.active.title })}</b> · {profiles.profileDirty ? t("desktop.bar.profileUnsaved") : t("desktop.bar.profileSaved")}
                    </span>
                    <span className="dk-spacer" />
                    <BusyButton className="dk-btn" disabled={busy || !profiles.profileDirty} onClick={profiles.revertToProfile}>
                      {t("desktop.bar.revert", "Revert")}
                    </BusyButton>
                    <BusyButton className="dk-btn primary" disabled={busy || !profiles.profileDirty || bridge.isDirty} onClick={profiles.saveToProfile}>
                      {/* Named: it saves into the profile being edited, which needn't be the active one. */}
                      {t("desktop.bar.saveProfileTo", { title: (profileTarget(profiles.editing, profiles.active) ?? profiles.active).title })}
                    </BusyButton>
                  </>
                ) : (
                  <>
                    <span className="dk-bar-note">
                      {busy
                        ? t(`statusText.${bridge.operation}`)
                        : bridge.hasUnsavedChanges
                          ? t("desktop.bar.unsaved", "Applied to {{device}}, not saved yet: changes are lost when it powers off.")
                          : t("desktop.bar.saved", "All changes saved on {{device}}.")}
                    </span>
                    <span className="dk-spacer" />
                    <BusyButton className="dk-btn" disabled={busy || !bridge.canRevert} onClick={bridge.revertToSaved}>
                      {t("desktop.bar.revert", "Revert")}
                    </BusyButton>
                    <BusyButton
                      className="dk-btn primary"
                      disabled={busy || !bridge.hasUnsavedChanges || bridge.isDirty}
                      onClick={() =>
                        bridge.saveToFlash().then((ok) => {
                          if (ok) announce("desktop.bar.saved", "app_saved");
                        })
                      }
                    >
                      {t("desktop.bar.save", "Save to {{device}}")}
                    </BusyButton>
                  </>
                )}
              </footer>
            )}
          </div>
          <AppRail
            active={main === "games" ? "games" : main === "about" ? "about" : panel === "dongle" ? "dongle" : panel === "app" ? "app" : "controller"}
            onSelect={(item) => {
              // After the page or panel renders, focus moves into it (the page
              // in the middle; App settings / Pico open in the side panel), so
              // the keyboard and screen readers continue there, not in the rail.
              // lifetime: OK — fires once (moves focus after the page renders)
              requestAnimationFrame(() => {
                const target = item === "dongle" || item === "app" ? document.querySelector<HTMLElement>(".live-panel-head h2") : document.querySelector<HTMLElement>("main.dk-body");
                target?.focus({ preventScroll: true });
              });
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
            reminders={reminders}
            connected={connected}
            connecting={bridge.operation === "connecting"}
            firmware={bridge.firmwareVersion}
            deviceLabel={bridge.deviceLabel}
            device={hardwareName(bridge.identity)}
          />
        </div>
      </LibraryContext.Provider>
    </NoticeTasksContext.Provider>
  );
}

// Whether the taskbar is dark, from the desktop's own colors (KDE's color
// scheme, or the system's dark/light setting): independent of the app's theme.
// An error notice with Dismiss; `pinned` stays at the top of a scrolled page
// (the one for shown() errors, which can come from anywhere on the page).
function ErrorNotice({ message, onDismiss, pinned }: { message: string | null; onDismiss: () => void; pinned?: boolean }) {
  if (!message) return null;
  return (
    <Notice error pinned={pinned} role="alert" onDismiss={onDismiss}>
      <span>{message}</span>
    </Notice>
  );
}

function useDarkTaskbar(): boolean {
  const query = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
  const [dark, setDark] = useState(query);
  // lifetime: OK — cleanup: palette unsubscribe + media query listener removed (app root)
  useEffect(() => {
    const desktop = window.desktop;
    let live = true;
    const fromPalette = (p: { isDark: boolean } | null) => live && setDark(p ? p.isDark : query());
    const read = () => {
      if (desktop) desktop.getDesktopPalette().then(fromPalette).catch(logged("reading whether the taskbar is dark (for the tray icon; the system setting answers instead)"));
    };
    read();
    // lifetime: OK — off() in the effect cleanup
    const off = desktop?.onDesktopPalette(fromPalette);
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onChange = read;
    // lifetime: OK — removed in the effect cleanup
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
      // error: NOT-WORTH — storage unavailable: no "What's new" banner this time
      return null;
    }
    return seen && seen !== current ? current : null;
  });
  const dismiss = () => {
    try {
      if (current) window.localStorage.setItem(SEEN_KEY, current);
    } catch {
      // error: NOT-WORTH — storage unavailable: the banner just reappears next launch
    }
    setVersion(null);
  };
  return { version, dismiss };
}

// Linux Games page: whether the user allowed it to read launcher settings, and
// how many recommended changes are waiting (the sidebar badge). The startup
// check only runs once the user has allowed it.
function useGamesAttention() {
  const supported = gamesSupported();
  const [allowed, setAllowedState] = useState(false);
  const [count, setCount] = useState(0);
  // cache: OK — key=none (the last games report); invalidated=each scan, cleared when Games consent is turned off; bound=1 report
  const last = useRef<GamesReport | null>(null);
  const recount = useCallback(() => setCount(last.current ? allFixes(last.current).filter((f) => f.recommended && !loadDeclined().has(f.id)).length : 0), []);
  const update = useCallback(
    (report: GamesReport) => {
      last.current = report;
      recount();
    },
    [recount],
  );
  // lifetime: OK — cleanup: drops a late settings / scan answer (holds no resource)
  useEffect(() => {
    if (!supported) return;
    let live = true;
    window
      .desktop!.getSettings()
      .then((s) => {
        if (!live) return;
        setAllowedState(s.gamesScanAllowed);
        if (s.gamesScanAllowed)
          window.desktop!.gamesScan().then((r) => live && update(r), logged("the background scan for the rail's attention count (the Games page scans again and shows its errors)"));
      })
      .catch(logged("reading the Games consent for the rail's count (the count stays hidden)"));
    return () => {
      live = false;
    };
  }, [supported, update]);
  // Games' consent card or App settings → Privacy changed it.
  // lifetime: OK — cleanup: onGamesAllowed's remover (removeEventListener)
  useEffect(
    () =>
      // lifetime: OK — the effect returns its remover (unmount)
      onGamesAllowed((value) => {
        setAllowedState(value);
        if (!value) {
          last.current = null;
          recount();
        }
      }),
    [recount],
  );
  const setAllowed = useCallback((value: boolean) => void setGamesAllowed(value).catch(shown("desktop.errors.settingNotSaved")), []);
  return { supported, allowed, setAllowed, count, update, recount };
}
