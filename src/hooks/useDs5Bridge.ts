import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { causeText } from "../desktop/shownError";
import { useTranslation } from "react-i18next";
import { type BridgeIdentity, Ds5BridgeClient, sameIdentity } from "../protocol/bridgeClient";
import { ConfigBody, DEFAULT_CONFIG, ConfigValidationIssue, configsEqual, normalizeConfig, validateConfig } from "../protocol/config";
import { WebUsbTransport, isDongle, webUsbAvailable } from "../protocol/webUsbTransport";
import { SimulatedDongle } from "../protocol/simulatedDongle";
import type { Ds5Transport } from "../protocol/transport";
import { simulatedCore1Stage, simulatedDongleOn } from "../desktop/devPreview";
import { logged } from "../errorText";
import { isWindowShown } from "../desktop/useWindowShown";

// While the window is hidden, an animated lightbar (rainbow, breathing, a
// charging pulse) changes the identity on every 1 s poll, and each change
// re-rendered the whole app (a hidden window still draws its frames: GPU
// process and renderer) and redrew the tray icon (measured hidden with an
// animated lightbar: ~4.9% of a core). Hidden, a change in nothing but the
// lightbar color is taken once the color holds for one poll (a new static
// color reaches the tray icon a second later), and while it keeps changing at
// most every HIDDEN_LIGHTBAR_MS. Any other change is taken at once, and so is
// everything while the window is shown.
export const HIDDEN_LIGHTBAR_MS = 60_000;
export function takeIdentity(prev: BridgeIdentity | null, next: BridgeIdentity, shown: boolean, lightbarSteady: boolean, takenAt: number, now: number): boolean {
  if (sameIdentity(prev, next)) return false;
  if (shown || !prev || lightbarSteady || now - takenAt >= HIDDEN_LIGHTBAR_MS) return true;
  return !sameIdentity({ ...prev, lightbar: null }, { ...next, lightbar: null });
}

type Operation = "connecting" | "reading" | "applying" | "saving" | "reconnecting" | null;
type SaveState = "idle" | "dirty" | "applied" | "saved";

export interface UseDs5BridgeResult {
  supported: boolean;
  client: Ds5BridgeClient | null;
  identity: BridgeIdentity | null;
  firmwareVersion: string | null;
  deviceLabel: string;
  config: ConfigBody | null;
  // What the dongle has in flash, as far as this app knows: the config read at
  // connect, updated on every successful save.
  savedConfig: ConfigBody | null;
  // From the dongle itself when the firmware reports it (identity [19]):
  // true after an app restart or USB reconnect with unsaved changes, false
  // after a slot switch (which saves). Else compared against savedConfig.
  hasUnsavedChanges: boolean;
  // Revert needs to know what's in flash: only after a save or a connect
  // without unsaved changes.
  canRevert: boolean;
  draft: ConfigBody;
  issues: ConfigValidationIssue[];
  saveState: SaveState;
  operation: Operation;
  // error: SHOWN — english: DesktopApp's ErrorNotice with Dismiss (USB and protocol errors are English, batch E3)
  error: string | null;
  statusText: string;
  isConnected: boolean;
  isDirty: boolean;
  setDraftField: <Key extends keyof ConfigBody>(field: Key, value: ConfigBody[Key]) => void;
  connect: () => Promise<void>;
  readConfig: () => Promise<boolean>;
  // Resolves false if the dongle refused or the transfer failed (see error).
  applyConfig: () => Promise<boolean>;
  saveToFlash: () => Promise<boolean>;
  reconnectUsb: () => Promise<boolean>;
  // Protocol 1.14: the PC sleep options (POWER_FLAGS bits), saved on the
  // dongle right away; identity.powerFlags shows them once it has.
  setPowerFlags: (bits: number) => Promise<boolean>;
  resetDraft: () => void;
  // Put the dongle back to savedConfig (RAM only; flash already holds it).
  revertToSaved: () => Promise<void>;
  // Put this exact config on the dongle (RAM only) and make it the draft:
  // per-game profiles switching in and out.
  applyBody: (body: ConfigBody) => Promise<boolean>;
  clearError: () => void;
}

// WebUSB's errors from open() / claimInterface() (DOMException NetworkError
// or NotFoundError: "Unable to claim interface", "The device was disconnected").
export function isOpenFailure(cause: unknown): boolean {
  return cause instanceof DOMException && (cause.name === "NetworkError" || cause.name === "NotFoundError" || /claimInterface|open/.test(cause.message));
}

export function useDs5Bridge(): UseDs5BridgeResult {
  const { t } = useTranslation();
  const supported = webUsbAvailable();
  const [client, setClient] = useState<Ds5BridgeClient | null>(null);
  const [identity, setIdentity] = useState<BridgeIdentity | null>(null);
  const [firmwareVersion, setFirmwareVersion] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfigBody | null>(null);
  const [savedConfig, setSavedConfig] = useState<ConfigBody | null>(null);
  const [draft, setDraft] = useState<ConfigBody>(DEFAULT_CONFIG);
  const [operation, setOperation] = useState<Operation>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<Ds5BridgeClient | null>(null);
  // lifetime: OK — acquires nothing (mirrors the client into a ref)
  useEffect(() => {
    clientRef.current = client;
  }, [client]);

  const issues = useMemo(() => validateConfig(draft), [draft]);
  const isConnected = Boolean(client?.isOpen);
  const isDirty = !configsEqual(config, draft);
  const deviceLabel = client ? client.transport.label : t("device.noDevice");

  const statusText = useMemo(() => {
    if (!supported) return t("statusText.webusbUnavailable");
    if (operation) return t(`statusText.${operation}`);
    if (!client) return t("statusText.ready");
    if (isDirty) return t("statusText.unsaved");
    if (saveState === "applied") return t("statusText.applied");
    if (saveState === "saved") return t("statusText.saved");
    return t("statusText.connected");
  }, [client, isDirty, operation, saveState, supported, t]);

  const detach = useCallback(() => {
    setClient(null);
    setIdentity(null);
    setFirmwareVersion(null);
    setConfig(null);
    setSavedConfig(null);
    setDraft(DEFAULT_CONFIG);
    setSaveState("idle");
  }, []);

  const attachTransport = useCallback(async (transport: Ds5Transport) => {
    setOperation("connecting");
    try {
      const next = new Ds5BridgeClient(transport);
      await next.transport.open();
      const id = await next.checkCompatible();
      const [version, cfg] = await Promise.all([next.readFirmwareVersion(), next.readConfig()]);
      const normalized = normalizeConfig(cfg);
      setClient(next);
      setIdentity(id);
      setFirmwareVersion(version);
      setConfig(normalized);
      // Flash holds this only if the dongle says nothing is unsaved (older
      // firmware can't say: assume it does, as before).
      setSavedConfig(id.unsaved ? null : normalized);
      setDraft(normalized);
      setSaveState("idle");
      setError(null);
    } catch (cause) {
      // error: SHOWN — english: the error notice (bridge.error); on Windows an open failure is desktop.windowsUsb.seen on the setup screen instead
      // Windows: a dongle Windows won't let us open (no WinUSB driver, or it
      // vanished during Repair USB driver). The setup screen explains that
      // and offers the repair (WindowsUsbRepair.tsx); the raw error helps no one.
      if (!(window.desktop?.platform === "win32" && isOpenFailure(cause))) setError(causeText(cause));
    } finally {
      setOperation(null);
    }
  }, []);

  const attach = useCallback((device: USBDevice) => attachTransport(new WebUsbTransport(device)), [attachTransport]);

  // Desktop: the main process has already granted the dongle, so this connects
  // with no prompt. Browser: works once the user has picked the dongle before.
  // Dev builds can use the simulated dongle instead (Developer card).
  const autoConnect = useCallback(async () => {
    if (clientRef.current) return;
    if (simulatedDongleOn()) {
      await attachTransport(new SimulatedDongle({ live: true, protoMinor: 17, version: "v0.9.4-oled-edition+12.a1b2c3d.dirty+simulated", core1StuckStage: simulatedCore1Stage() }));
      return;
    }
    if (!supported) return;
    const device = await WebUsbTransport.findPermitted();
    if (device) await attach(device);
  }, [attach, attachTransport, supported]);

  const connect = useCallback(async () => {
    try {
      await attach(await WebUsbTransport.request());
    } catch (cause) {
      // error: SHOWN — english: the error notice (bridge.error); NotFoundError is the user closing the device picker, not an error
      if (!(cause instanceof DOMException && cause.name === "NotFoundError")) setError(causeText(cause));
    }
  }, [attach]);

  const run = useCallback(async (op: Exclude<Operation, null>, task: (c: Ds5BridgeClient) => Promise<void>): Promise<boolean> => {
    const c = clientRef.current;
    if (!c) return false;
    setOperation(op);
    try {
      await task(c);
      setError(null);
      return true;
    } catch (cause) {
      // error: SHOWN — english: the error notice (bridge.error), and the caller gets false
      setError(causeText(cause));
      return false;
    } finally {
      setOperation(null);
    }
  }, []);

  const readConfig = useCallback(
    () =>
      run("reading", async (c) => {
        const next = normalizeConfig(await c.readConfig());
        setConfig(next);
        setDraft(next);
        setSaveState("idle");
      }),
    [run],
  );

  const applyConfig = useCallback(async (): Promise<boolean> => {
    if (issues.length > 0) return false;
    return run("applying", async (c) => {
      const sent = draft;
      const normalized = normalizeConfig(sent);
      await c.applyConfig(normalized);
      setConfig(normalized);
      // Edits made while this was on its way stay (and get applied next).
      setDraft((current) => (current === sent ? normalized : current));
      setSaveState("applied");
    });
  }, [draft, issues.length, run]);

  const saveToFlash = useCallback(async (): Promise<boolean> => {
    if (isDirty) return false;
    return run("saving", async (c) => {
      await c.saveToFlash();
      setSavedConfig(config);
      setSaveState("saved");
    });
  }, [config, isDirty, run]);

  const revertToSaved = useCallback(async () => {
    if (!savedConfig) return;
    await run("applying", async (c) => {
      await c.applyConfig(savedConfig);
      setConfig(savedConfig);
      setDraft(savedConfig);
      setSaveState("idle");
    });
  }, [run, savedConfig]);

  const applyBody = useCallback(
    (body: ConfigBody) =>
      run("applying", async (c) => {
        const normalized = normalizeConfig(body);
        await c.applyConfig(normalized);
        setConfig(normalized);
        setDraft(normalized);
        setSaveState("applied");
      }),
    [run],
  );

  const reconnectUsb = useCallback(() => run("reconnecting", (c) => c.reconnectUsb()), [run]);

  const setPowerFlags = useCallback(
    (bits: number) =>
      run("saving", async (c) => {
        await c.setPowerFlags(bits);
        const id = await c.identity();
        setIdentity((prev) => (sameIdentity(prev, id) ? prev : id));
      }),
    [run],
  );

  const setDraftField = useCallback(<Key extends keyof ConfigBody>(field: Key, value: ConfigBody[Key]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setSaveState("dirty");
  }, []);

  const resetDraft = useCallback(() => {
    if (config) {
      setDraft(config);
      setSaveState("idle");
    }
  }, [config]);

  // lifetime: OK — acquires nothing (one auto-connect attempt)
  useEffect(() => {
    void autoConnect().catch(logged("connecting to an already-permitted board at start (without one, the setup screen shows)"));
  }, [autoConnect]);

  // Keep up with the dongle: its identity every second (unsaved flag, slot,
  // last command), and every other second its settings, so a change made on
  // the OLED (or a slot switch) shows here and isn't overwritten by the next
  // edit from the app. Skipped while the app has edits of its own on the way.
  const isDirtyRef = useRef(isDirty);
  const operationRef = useRef(operation);
  const configRef = useRef(config);
  // lifetime: OK — acquires nothing (mirrors state into refs)
  useEffect(() => {
    isDirtyRef.current = isDirty;
    operationRef.current = operation;
    configRef.current = config;
  });
  // lifetime: OK — cleanup: stops the 1 s identity / config poll (client change / unmount)
  useEffect(() => {
    if (!client) return;
    let stopped = false;
    let tick = 0;
    // When an identity was last taken, and the lightbar the last poll read
    // (takeIdentity: hidden, a lightbar that keeps changing waits).
    let takenAt = 0;
    let lastLightbar: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        if (!operationRef.current) {
          const id = await client.identity();
          const now = Date.now();
          const lightbar = String(id.lightbar);
          const steady = lightbar === lastLightbar;
          lastLightbar = lightbar;
          if (!stopped)
            setIdentity((prev) => {
              if (!takeIdentity(prev, id, isWindowShown(), steady, takenAt, now)) return prev;
              takenAt = now;
              return id;
            });
          // Saved by something else (a slot switch, the OLED): flash = RAM now.
          if (!stopped && id.unsaved === false && !isDirtyRef.current) setSavedConfig(configRef.current);
          if (++tick % 2 === 0 && !isDirtyRef.current && !operationRef.current) {
            const next = normalizeConfig(await client.readConfig());
            if (!stopped && !isDirtyRef.current && !operationRef.current && !configsEqual(next, configRef.current)) {
              setConfig(next);
              setDraft(next);
            }
          }
        }
      } catch {
        // error: NOT-WORTH — gone or busy: the USB events handle reconnecting
      }
      // lifetime: OK — self re-arming 1 s poll, runs hidden on purpose (tray); cleared in the cleanup
      if (!stopped) timer = setTimeout(next, 1000);
    };
    // poll() catches its own errors; this only keeps a bug from being unhandled.
    const next = () => void poll().catch(logged("the board's identity/settings poll"));
    // lifetime: OK — the first tick; cleared in the cleanup
    timer = setTimeout(next, 1000);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [client]);

  // Reboot, BOOTSEL + flash, USB reconnect and replugging all re-enumerate the
  // dongle: drop the old handle and pick the new one up automatically.
  // lifetime: OK — cleanup: removes both USB connect / disconnect listeners
  useEffect(() => {
    if (!supported) return;
    const onDisconnect = (event: USBConnectionEvent) => {
      const current = clientRef.current?.transport;
      if (current instanceof WebUsbTransport && current.device === event.device) detach();
    };
    const onConnect = (event: USBConnectionEvent) => {
      if (isDongle(event.device)) autoConnect().catch(logged("connecting to a board that was plugged in (it stays on the setup screen)"));
    };
    // lifetime: OK — removed in the effect cleanup
    navigator.usb.addEventListener("disconnect", onDisconnect);
    // lifetime: OK — removed in the effect cleanup
    navigator.usb.addEventListener("connect", onConnect);
    return () => {
      navigator.usb.removeEventListener("disconnect", onDisconnect);
      navigator.usb.removeEventListener("connect", onConnect);
    };
  }, [autoConnect, detach, supported]);

  return {
    supported,
    client,
    identity,
    firmwareVersion,
    deviceLabel,
    config,
    savedConfig,
    hasUnsavedChanges: identity?.unsaved ?? !configsEqual(config, savedConfig),
    canRevert: !!savedConfig && !configsEqual(config, savedConfig),
    draft,
    issues,
    saveState,
    operation,
    error,
    statusText,
    isConnected,
    isDirty,
    setDraftField,
    connect,
    readConfig,
    applyConfig,
    saveToFlash,
    reconnectUsb,
    setPowerFlags,
    resetDraft,
    revertToSaved,
    applyBody,
    clearError: () => setError(null),
  };
}
