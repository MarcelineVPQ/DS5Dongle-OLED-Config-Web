import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type BridgeIdentity, Ds5BridgeClient } from "../protocol/bridgeClient";
import { ConfigBody, DEFAULT_CONFIG, ConfigValidationIssue, configsEqual, normalizeConfig, validateConfig } from "../protocol/config";
import { WebUsbTransport, isDongle, webUsbAvailable } from "../protocol/webUsbTransport";
import { SimulatedDongle } from "../protocol/simulatedDongle";
import type { Ds5Transport } from "../protocol/transport";
import { simulatedDongleOn } from "../desktop/devPreview";

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
      // Windows: a dongle Windows won't let us open (no WinUSB driver, or it
      // vanished during Repair USB driver). The setup screen explains that
      // and offers the repair (WindowsUsbRepair.tsx); the raw error helps no one.
      if (!(window.desktop?.platform === "win32" && isOpenFailure(cause))) setError(errorMessage(cause));
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
      await attachTransport(new SimulatedDongle({ live: true, protoMinor: 9, version: "v0.9.4-oled-edition+12.a1b2c3d.dirty+simulated" }));
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
      if (!(cause instanceof DOMException && cause.name === "NotFoundError")) setError(errorMessage(cause));
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
      setError(errorMessage(cause));
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

  useEffect(() => {
    void autoConnect();
  }, [autoConnect]);

  // Keep up with the dongle: its identity every second (unsaved flag, slot,
  // last command), and every other second its settings, so a change made on
  // the OLED (or a slot switch) shows here and isn't overwritten by the next
  // edit from the app. Skipped while the app has edits of its own on the way.
  const isDirtyRef = useRef(isDirty);
  const operationRef = useRef(operation);
  const configRef = useRef(config);
  useEffect(() => {
    isDirtyRef.current = isDirty;
    operationRef.current = operation;
    configRef.current = config;
  });
  useEffect(() => {
    if (!client) return;
    let stopped = false;
    let tick = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        if (!operationRef.current) {
          const id = await client.identity();
          if (!stopped) setIdentity(id);
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
        // gone or busy: the USB events handle reconnecting
      }
      if (!stopped) timer = setTimeout(() => void poll(), 1000);
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [client]);

  // Reboot, BOOTSEL + flash, USB reconnect and replugging all re-enumerate the
  // dongle: drop the old handle and pick the new one up automatically.
  useEffect(() => {
    if (!supported) return;
    const onDisconnect = (event: USBConnectionEvent) => {
      const current = clientRef.current?.transport;
      if (current instanceof WebUsbTransport && current.device === event.device) detach();
    };
    const onConnect = (event: USBConnectionEvent) => {
      if (isDongle(event.device)) void autoConnect();
    };
    navigator.usb.addEventListener("disconnect", onDisconnect);
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
    resetDraft,
    revertToSaved,
    applyBody,
    clearError: () => setError(null),
  };
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return "Unexpected USB error";
}
